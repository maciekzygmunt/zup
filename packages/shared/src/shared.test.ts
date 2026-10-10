import { describe, expect, test } from "bun:test"
import { aliasNameSchema, generateKey } from "./access.ts"
import { parseExpiry } from "./duration.ts"
import { inferEntrypoint, isValidManifestPath, toManifestPath } from "./paths.ts"

describe("inferEntrypoint", () => {
  test("prefers index files", () => {
    expect(inferEntrypoint(["/a.html", "/index.md", "/index.html"])).toBe("/index.html")
  })
  test("uses the only page", () => {
    expect(inferEntrypoint(["/report.html", "/chart.png"])).toBe("/report.html")
  })
  test("uses the only file of any type", () => {
    expect(inferEntrypoint(["/photo.png"])).toBe("/photo.png")
  })
  test("falls back to a listing", () => {
    expect(inferEntrypoint(["/a.html", "/b.html"])).toBeNull()
    expect(inferEntrypoint(["/a.png", "/b.png"])).toBeNull()
  })
})

test("manifest paths reject traversal and odd forms", () => {
  expect(isValidManifestPath("/assets/app.js")).toBe(true)
  for (const bad of ["assets/app.js", "/a/../b", "/a//b", "/a\\b", "/dir/", "/./a"]) {
    expect(isValidManifestPath(bad)).toBe(false)
  }
  expect(toManifestPath("dist\\assets//app.js")).toBe("/dist/assets/app.js")
})

test("parseExpiry reads durations and dates", () => {
  const now = Date.UTC(2026, 0, 1)
  expect(parseExpiry("7d", now).getTime()).toBe(now + 7 * 86_400_000)
  expect(parseExpiry("90m", now).getTime()).toBe(now + 90 * 60_000)
  expect(() => parseExpiry("soon", now)).toThrow()
  expect(() => parseExpiry("2020-01-01", now)).toThrow()
})

test("alias names are slugs and not reserved", () => {
  expect(aliasNameSchema.safeParse("weekly-report").success).toBe(true)
  for (const bad of ["Weekly", "-x", "x-", "u", "_zup", "a b"]) {
    expect(aliasNameSchema.safeParse(bad).success).toBe(false)
  }
})

test("generated keys are four groups of five readable characters", () => {
  expect(generateKey()).toMatch(/^[2-9a-hjkmnp-z]{5}(-[2-9a-hjkmnp-z]{5}){3}$/)
})
