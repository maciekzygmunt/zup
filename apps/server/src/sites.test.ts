import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { CreateSiteInput } from "@zup/shared"
import { createSiteSchema } from "@zup/shared"
import { createServer } from "./app.ts"
import { createBlobStore } from "./blobs.ts"
import { loadConfig } from "./config.ts"

const dataDir = mkdtempSync(join(tmpdir(), "zup-test-"))
const config = loadConfig({
  APP_URL: "http://localhost:4100",
  PREVIEW_URL: "http://127.0.0.1:4100",
  BETTER_AUTH_SECRET: "test-secret-that-is-long-enough-1234567890",
  DATA_DIR: dataDir,
})
let server: Awaited<ReturnType<typeof createServer>>
const blobs = createBlobStore(config.dataDir)

async function publish(content: string, input: Omit<CreateSiteInput, "files"> = {}) {
  const hash = new Bun.CryptoHasher("sha256").update(content).digest("hex")
  await blobs.write(hash, new Blob([content]).stream(), 1e6)
  return server.sites.createSite(
    createSiteSchema.parse({
      files: [{ path: "/index.html", hash, size: content.length, contentType: "text/html" }],
      ...input,
    }),
  )
}

const errorOf = (promise: Promise<unknown>) =>
  promise.then(
    () => null,
    (error: { code?: string }) => error.code,
  )

beforeAll(async () => {
  server = await createServer(config)
})
afterAll(() => {
  server.close()
  rmSync(dataDir, { recursive: true, force: true })
})

describe("slugs", () => {
  test("a site without a slug gets a random one", async () => {
    const { site } = await publish("random")
    expect(site.slug).toMatch(/^[a-z0-9]{20}$/)
    expect(site.url).toBe(`http://127.0.0.1:4100/${site.slug}/`)
  })

  test("a slug in use fails unless update is set", async () => {
    await publish("v1", { slug: "taken" })
    expect(await errorOf(publish("v2", { slug: "taken" }))).toBe("slug_taken")
    expect((await server.sites.getSite("taken")).files).toHaveLength(1)
  })

  test("update replaces the files and keeps the other settings", async () => {
    const first = await publish("v1", {
      slug: "report",
      title: "Report",
      access: { type: "password", password: "report key" },
      expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
    })
    const share = await server.sites.shareLink("report")

    const second = await publish("version two", { slug: "report", update: true })
    expect(second.created).toBe(false)
    expect(second.key).toBeUndefined()
    expect(second.site).toMatchObject({
      title: "Report",
      access: "password",
      expiresAt: first.site.expiresAt,
      createdAt: first.site.createdAt,
    })
    const detail = await server.sites.getSite("report")
    expect(detail.files).toEqual([expect.objectContaining({ size: "version two".length })])
    expect((await server.sites.shareLink("report")).shareUrl).toBe(share.shareUrl)
  })

  test("update creates the site when the slug is free", async () => {
    const { created, site } = await publish("new", { slug: "fresh", update: true })
    expect(created).toBe(true)
    expect(site.access).toBe("private")
  })

  test("a slug change moves the site and fails on a used slug", async () => {
    await publish("a", { slug: "old-name" })
    await publish("b", { slug: "other" })
    expect(await errorOf(server.sites.updateSite("old-name", { slug: "other" }))).toBe("slug_taken")
    const { site } = await server.sites.updateSite("old-name", { slug: "new-name" })
    expect(site.url).toBe("http://127.0.0.1:4100/new-name/")
    expect(await errorOf(server.sites.getSite("old-name"))).toBe("site_not_found")
  })
})

describe("search engines", () => {
  test("are off by default and only allowed on public sites", async () => {
    const { site } = await publish("plain", { slug: "plain" })
    expect(site.indexable).toBe(false)
    expect(await errorOf(server.sites.updateSite("plain", { indexable: true }))).toBe("not_public")
    expect(await errorOf(publish("x", { access: { type: "password" }, indexable: true }))).toBe(
      "not_public",
    )
  })

  test("can change without new access, and an update keeps the setting", async () => {
    await publish("open", { slug: "open", access: { type: "public" } })
    const on = await server.sites.updateSite("open", { indexable: true })
    expect(on.site).toMatchObject({ access: "public", indexable: true })
    expect(on.key).toBeUndefined()
    expect((await publish("open v2", { slug: "open", update: true })).site.indexable).toBe(true)
    // Access other than public turns it off, and public again does not turn it back on.
    await server.sites.updateSite("open", { access: { type: "private" } })
    const { site } = await server.sites.updateSite("open", { access: { type: "public" } })
    expect(site.indexable).toBe(false)
  })
})
