import { expect, test } from "bun:test"
import {
  grantOpens,
  hashPassword,
  shareToken,
  shareTokenOpens,
  siteScope,
  unlockGrant,
  unlockMaxAgeSeconds,
  verifyPassword,
} from "./passwords.ts"

const secret = "test-secret-that-is-long-enough-1234567890"
const scope = siteScope({ alias: "report" })

test("passwords verify only against their own hash", async () => {
  const hash = await hashPassword("correct horse")
  expect(await verifyPassword("correct horse", hash)).toBe(true)
  expect(await verifyPassword("wrong horse", hash)).toBe(false)
  expect(await verifyPassword("correct horse", "garbage")).toBe(false)
})

test("grants open one site, for one password, until they expire", async () => {
  const hash = await hashPassword("correct horse")
  const now = Date.now()
  const grant = unlockGrant(scope, hash, now)
  expect(grantOpens(grant, scope, hash, now)).toBe(true)
  expect(grantOpens(grant, siteScope({ alias: "other" }), hash, now)).toBe(false)
  expect(grantOpens(grant, scope, await hashPassword("correct horse"), now)).toBe(false)
  expect(grantOpens(grant, scope, hash, now + unlockMaxAgeSeconds * 1000 + 1000)).toBe(false)
  expect(grantOpens(false, scope, hash)).toBe(false)
})

test("share tokens stop working when the password changes", async () => {
  const hash = await hashPassword("correct horse")
  const token = shareToken(secret, scope, hash)
  expect(shareTokenOpens(token, secret, scope, hash)).toBe(true)
  expect(shareTokenOpens(token, secret, siteScope({ alias: "other" }), hash)).toBe(false)
  expect(shareTokenOpens(token, secret, scope, await hashPassword("new key 123"))).toBe(false)
})
