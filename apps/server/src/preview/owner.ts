import { createHmac, randomBytes, timingSafeEqual } from "node:crypto"
import type { Auth } from "../auth.ts"
import type { Config } from "../config.ts"

// The owner's dashboard session lives on the app host. To view private sites, the preview
// host gets its own cookie through a short redirect handoff:
//   preview /_zup/login -> app /api/preview-session -> preview /_zup/callback (sets cookie)
// The cookie holds a signed session id, so logging out of the dashboard also ends it.

export const ownerCookieName = "zup_owner"
const handoffTtlMs = 60_000

export type OwnerSessions = ReturnType<typeof createOwnerSessions>

export function createOwnerSessions(config: Config, auth: Auth) {
  const key = createHmac("sha256", config.BETTER_AUTH_SECRET).update("zup-preview").digest()
  const mac = (value: string) => createHmac("sha256", key).update(value).digest("base64url")
  const usedNonces = new Map<string, number>()

  function verify(signed: string | undefined): string | null {
    if (!signed) return null
    const dot = signed.lastIndexOf(".")
    const value = signed.slice(0, dot)
    const actual = Buffer.from(signed.slice(dot + 1))
    const expected = Buffer.from(mac(value))
    if (dot < 1 || actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
      return null
    }
    return value
  }

  return {
    // Signed, single-use, one-minute token that carries the session id to the preview host.
    createHandoff(sessionId: string) {
      const value = `${sessionId}:${Date.now() + handoffTtlMs}:${randomBytes(12).toString("base64url")}`
      return `${value}.${mac(value)}`
    },

    redeemHandoff(token: string): string | null {
      const [sessionId, expiresText, nonce] = verify(token)?.split(":") ?? []
      const expiresAt = Number(expiresText)
      if (!sessionId || !nonce || !(expiresAt > Date.now()) || usedNonces.has(nonce)) return null
      usedNonces.set(nonce, expiresAt)
      for (const [used, expiry] of usedNonces) if (expiry < Date.now()) usedNonces.delete(used)
      return sessionId
    },

    cookieValue: (sessionId: string) => `${sessionId}.${mac(sessionId)}`,

    // True when the cookie names a live session of the owner.
    async isOwner(cookie: string | undefined): Promise<boolean> {
      const sessionId = verify(cookie)
      if (!sessionId) return false
      const { adapter } = await auth.$context
      const session = await adapter.findOne<{ expiresAt: Date }>({
        model: "session",
        where: [{ field: "id", value: sessionId }],
      })
      return !!session && new Date(session.expiresAt).getTime() > Date.now()
    },
  }
}

// Only same-host absolute paths are accepted as redirect targets.
export function safePath(next: string | undefined, fallback = "/"): string {
  return next?.startsWith("/") && !next.startsWith("//") && !next.includes("\\") ? next : fallback
}
