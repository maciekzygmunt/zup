import { createHash, createHmac, timingSafeEqual } from "node:crypto"

// Password-protected sites. The server stores only an argon2id hash of the password.
// A visitor with the password (or a share link) gets a signed cookie for that one site.

export const unlockCookieName = "zup_unlock"
export const unlockMaxAgeSeconds = 30 * 24 * 60 * 60

export const hashPassword = (password: string) =>
  Bun.password.hash(password, { algorithm: "argon2id" })

export const verifyPassword = (password: string, hash: string) =>
  Bun.password.verify(password, hash).catch(() => false)

// The site that a cookie or link opens. Uses the internal id, so it survives a slug change.
export const siteScope = (siteId: string) => `site:${siteId}`

// Changes with every new password, so old cookies and links stop working.
const fingerprint = (passwordHash: string) =>
  createHash("sha256").update(passwordHash).digest("base64url").slice(0, 12)

// Cookie payload: site, password fingerprint and expiry (unix seconds). The caller signs it.
export const unlockGrant = (scope: string, passwordHash: string, now = Date.now()) =>
  `${scope}|${fingerprint(passwordHash)}|${Math.floor(now / 1000) + unlockMaxAgeSeconds}`

export function grantOpens(
  grant: string | false | undefined,
  scope: string,
  passwordHash: string,
  now = Date.now(),
) {
  const [grantScope, print, expires] = grant ? grant.split("|") : []
  return grantScope === scope && print === fingerprint(passwordHash) && Number(expires) * 1000 > now
}

// Share link token: a server MAC over the site and the password hash.
export const shareToken = (secret: string, scope: string, passwordHash: string) =>
  createHmac("sha256", secret)
    .update(`zup share link\n${scope}\n${passwordHash}`)
    .digest("base64url")
    .slice(0, 32)

export function shareTokenOpens(
  token: string,
  secret: string,
  scope: string,
  passwordHash: string,
) {
  const expected = Buffer.from(shareToken(secret, scope, passwordHash))
  const actual = Buffer.from(token)
  return actual.length === expected.length && timingSafeEqual(actual, expected)
}
