import { describe, expect, test } from "bun:test"
import { resolveClientIp } from "./clientIp.ts"

describe("resolveClientIp", () => {
  const headers = (value?: string) =>
    new Headers(value === undefined ? {} : { "x-forwarded-for": value })

  test("takes the value a proxy appended last, not the client's own", () => {
    expect(resolveClientIp(headers("1.1.1.1, 203.0.113.9"), "x-forwarded-for", "10.0.0.2")).toBe(
      "203.0.113.9",
    )
  })

  test("falls back to the socket address when the header is missing or disabled", () => {
    expect(resolveClientIp(headers(), "x-forwarded-for", "10.0.0.2")).toBe("10.0.0.2")
    expect(resolveClientIp(headers("1.1.1.1"), "", "10.0.0.2")).toBe("10.0.0.2")
  })
})
