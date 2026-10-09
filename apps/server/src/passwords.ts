import { createHmac, randomBytes, timingSafeEqual } from "node:crypto"

// Password-protected sites. Only an argon2id hash of the key is stored. Unlock cookies
// and share links are MACs keyed by that hash, so changing the key invalidates all of them.

export const unlockCookieName = "zup_unlock"
export const unlockTtlMs = 30 * 24 * 60 * 60 * 1000

// 18 random bytes = 24 base64url characters.
export const generateKey = () => randomBytes(18).toString("base64url")

export const hashPassword = (password: string) =>
  Bun.password.hash(password, { algorithm: "argon2id" })

export const verifyPassword = (password: string, hash: string) =>
  Bun.password.verify(password, hash).catch(() => false)

const mac = (key: string, message: string) =>
  createHmac("sha256", key).update(message).digest("base64url")

function safeEqual(a: string, b: string) {
  const left = Buffer.from(a)
  const right = Buffer.from(b)
  return left.length === right.length && timingSafeEqual(left, right)
}

// What a cookie or share link is bound to, so one site's never opens another.
export const siteScope = (target: { alias: string } | { deploymentId: string }) =>
  "alias" in target ? `a:${target.alias}` : `u:${target.deploymentId}`

export function createUnlockToken(passwordHash: string, scope: string, now = Date.now()) {
  const expiresAt = now + unlockTtlMs
  return `${expiresAt}.${mac(passwordHash, `unlock|${scope}|${expiresAt}`)}`
}

export function verifyUnlockToken(
  token: string | undefined,
  passwordHash: string,
  scope: string,
  now = Date.now(),
) {
  const [expiresText, signature] = token?.split(".") ?? []
  const expiresAt = Number(expiresText)
  if (!signature || !Number.isSafeInteger(expiresAt) || expiresAt <= now) return false
  return safeEqual(signature, mac(passwordHash, `unlock|${scope}|${expiresAt}`))
}

export const createShareToken = (passwordHash: string, scope: string) =>
  `v1.${mac(passwordHash, `share|${scope}`)}`

export function verifyShareToken(token: string | undefined, passwordHash: string, scope: string) {
  return !!token && safeEqual(token, createShareToken(passwordHash, scope))
}
