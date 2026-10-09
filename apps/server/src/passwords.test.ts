import { expect, test } from "bun:test"
import {
  createShareToken,
  createUnlockToken,
  hashPassword,
  siteScope,
  unlockTtlMs,
  verifyPassword,
  verifyShareToken,
  verifyUnlockToken,
} from "./passwords.ts"

const scope = siteScope({ alias: "report" })

test("passwords verify only against their own hash", async () => {
  const hash = await hashPassword("correct horse")
  expect(await verifyPassword("correct horse", hash)).toBe(true)
  expect(await verifyPassword("wrong horse", hash)).toBe(false)
  expect(await verifyPassword("correct horse", "garbage")).toBe(false)
})

test("unlock cookies are bound to one site, one key and expire", async () => {
  const hash = await hashPassword("correct horse")
  const now = Date.now()
  const token = createUnlockToken(hash, scope, now)
  expect(verifyUnlockToken(token, hash, scope, now)).toBe(true)
  expect(verifyUnlockToken(token, hash, siteScope({ alias: "other" }), now)).toBe(false)
  expect(verifyUnlockToken(token, await hashPassword("correct horse"), scope, now)).toBe(false)
  expect(verifyUnlockToken(token, hash, scope, now + unlockTtlMs + 1)).toBe(false)
  expect(verifyUnlockToken(undefined, hash, scope)).toBe(false)
})

test("share tokens cannot pass as unlock cookies and die with the key", async () => {
  const hash = await hashPassword("correct horse")
  const share = createShareToken(hash, scope)
  expect(verifyShareToken(share, hash, scope)).toBe(true)
  expect(verifyUnlockToken(share, hash, scope)).toBe(false)
  expect(verifyShareToken(share, await hashPassword("new key 123"), scope)).toBe(false)
})
