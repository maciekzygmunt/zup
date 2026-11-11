import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { CreateSiteInput } from "@zup/shared"
import { contentTypeFor, createSiteSchema } from "@zup/shared"
import { createServer } from "../app.ts"
import { createBlobStore } from "../blobs.ts"
import { loadConfig } from "../config.ts"

const dataDir = mkdtempSync(join(tmpdir(), "zup-test-"))
const config = loadConfig({
  APP_URL: "http://localhost:4100",
  PREVIEW_URL: "http://127.0.0.1:4100",
  BETTER_AUTH_SECRET: "test-secret-that-is-long-enough-1234567890",
  DATA_DIR: dataDir,
})
let server: Awaited<ReturnType<typeof createServer>>
const blobs = createBlobStore(config.dataDir)

async function publish(
  files: Record<string, string>,
  input: Omit<CreateSiteInput, "files"> = { access: { type: "public" } },
) {
  const manifest = []
  for (const [path, content] of Object.entries(files)) {
    const hash = new Bun.CryptoHasher("sha256").update(content).digest("hex")
    await blobs.write(hash, new Blob([content]).stream(), 1e6)
    manifest.push({
      path,
      hash,
      size: Buffer.byteLength(content),
      contentType: contentTypeFor(path),
    })
  }
  return (await server.sites.createSite(createSiteSchema.parse({ files: manifest, ...input }))).site
}

const get = (path: string, headers: Record<string, string> = {}) =>
  server.fetch(
    new Request(`http://127.0.0.1:4100${path}`, {
      headers: { host: "127.0.0.1:4100", ...headers },
    }),
  )

const html = { accept: "text/html" }

beforeAll(async () => {
  server = await createServer(config)
})
afterAll(() => {
  server.close()
  rmSync(dataDir, { recursive: true, force: true })
})

describe("serving", () => {
  test("serves files, index pages and redirects to a trailing slash", async () => {
    const site = await publish({
      "/index.html": "<h1>home</h1>",
      "/docs/index.html": "<h1>docs</h1>",
      "/app.js": "1",
    })
    expect(await (await get(`/${site.slug}/`)).text()).toBe("<h1>home</h1>")
    expect(await (await get(`/${site.slug}/docs/`)).text()).toBe("<h1>docs</h1>")
    expect((await get(`/${site.slug}`)).headers.get("location")).toBe(`/${site.slug}/`)
    expect((await get(`/${site.slug}/docs`)).headers.get("location")).toBe(`/${site.slug}/docs/`)
    const js = await get(`/${site.slug}/app.js`)
    expect(js.headers.get("content-type")).toContain("javascript")
    expect(
      (await get(`/${site.slug}/app.js`, { "if-none-match": js.headers.get("etag")! })).status,
    ).toBe(304)
  })

  test("SPA fallback only for extensionless page requests", async () => {
    const site = await publish({ "/index.html": "app" })
    expect((await get(`/${site.slug}/settings/profile`, html)).status).toBe(200)
    expect((await get(`/${site.slug}/missing.js`, html)).status).toBe(404)
    expect((await get(`/${site.slug}/settings`)).status).toBe(404)
  })

  test("folders without an index get a listing; single files redirect to their name", async () => {
    const listing = await publish({ "/a.png": "a", "/b/c.png": "c" })
    const page = await (await get(`/${listing.slug}/`, html)).text()
    expect(page).toContain("a.png")
    expect(page).toContain("b/")
    const single = await publish({ "/photo.png": "p" })
    expect((await get(`/${single.slug}/`)).headers.get("location")).toBe(
      `/${single.slug}/photo.png`,
    )
  })

  test("renders Markdown for browsers and keeps ?raw", async () => {
    const site = await publish({ "/README.md": "# Title\n\n*hi*" })
    const rendered = await (await get(`/${site.slug}/README.md`, html)).text()
    expect(rendered).toContain("<h1>Title</h1>")
    expect(await (await get(`/${site.slug}/README.md?raw`, html)).text()).toBe("# Title\n\n*hi*")
  })

  test("serves byte ranges", async () => {
    const site = await publish({ "/data.txt": "0123456789" })
    const response = await get(`/${site.slug}/data.txt`, { range: "bytes=2-4" })
    expect(response.status).toBe(206)
    expect(await response.text()).toBe("234")
    expect(response.headers.get("content-range")).toBe("bytes 2-4/10")
  })

  test("root-relative assets redirect into the referring site", async () => {
    const site = await publish({ "/index.html": "x", "/assets/app.js": "1" })
    const response = await get("/assets/app.js?v=1", {
      referer: `http://127.0.0.1:4100/${site.slug}/`,
    })
    expect(response.status).toBe(307)
    expect(response.headers.get("location")).toBe(`/${site.slug}/assets/app.js?v=1`)
  })
})

describe("access", () => {
  test("private sites need the owner", async () => {
    const site = await publish({ "/index.html": "secret" }, { access: { type: "private" } })
    expect((await get(`/${site.slug}/`)).status).toBe(401)
    const page = await (await get(`/${site.slug}/`, html)).text()
    expect(page).toContain("/_zup/login?next=")
    expect(page).not.toContain("secret")
  })

  test("password sites unlock with the key and set a site-scoped cookie", async () => {
    const site = await publish(
      { "/index.html": "protected" },
      { access: { type: "password", password: "open sesame" } },
    )
    const base = `/${site.slug}`
    expect((await get(`${base}/`, html)).status).toBe(401)
    const unlock = (password: string) =>
      server.fetch(
        new Request(`http://127.0.0.1:4100${base}/_zup/unlock`, {
          method: "POST",
          headers: { host: "127.0.0.1:4100" },
          body: new URLSearchParams({ password, next: `${base}/` }),
        }),
      )
    expect((await unlock("wrong key")).status).toBe(401)
    const ok = await unlock("open sesame")
    expect(ok.status).toBe(303)
    const cookie = ok.headers.get("set-cookie")!
    expect(cookie).toContain(`Path=${base}`)
    const opened = await get(`${base}/`, { cookie: cookie.split(";")[0]! })
    expect(await opened.text()).toBe("protected")
  })

  test("an update keeps the password, and share links serve the new files", async () => {
    await publish(
      { "/index.html": "v1" },
      { slug: "demo", access: { type: "password", password: "demo key 1" } },
    )
    await publish({ "/index.html": "v2" }, { slug: "demo", update: true })
    const share = await server.sites.shareLink("demo")
    const token = share.shareUrl.split("#token=")[1]!
    const unlocked = await server.fetch(
      new Request("http://127.0.0.1:4100/demo/_zup/unlock", {
        method: "POST",
        headers: { host: "127.0.0.1:4100" },
        body: new URLSearchParams({ token, next: "/demo/" }),
      }),
    )
    const cookie = unlocked.headers.get("set-cookie")!.split(";")[0]!
    expect(await (await get("/demo/", { cookie })).text()).toBe("v2")
  })

  test("expired sites answer 410 and are purged", async () => {
    const site = await publish({ "/index.html": "old" })
    await server.sites.updateSite(site.slug, {
      expiresAt: new Date(Date.now() + 50).toISOString(),
    })
    await Bun.sleep(60)
    expect((await get(`/${site.slug}/`)).status).toBe(410)
    expect(await server.sites.purgeExpired()).toBeGreaterThanOrEqual(1)
    expect((await get(`/${site.slug}/`)).status).toBe(404)
  })
})

describe("robots.txt", () => {
  const robots = async () => (await get("/robots.txt")).text()
  const blockAll = "User-agent: *\nDisallow: /\n"

  test("blocks everything when no site is indexable", async () => {
    expect(await robots()).toBe(blockAll)
  })

  test("allows public indexable sites and lists their sitemaps", async () => {
    await publish(
      { "/index.html": "v1" },
      { slug: "landing", access: { type: "public" }, indexable: true },
    )
    expect(await robots()).toBe("User-agent: *\nAllow: /landing$\nAllow: /landing/\nDisallow: /\n")

    await publish(
      { "/index.html": "v2", "/sitemap.xml": "<urlset/>" },
      { slug: "landing", update: true },
    )
    const response = await get("/robots.txt")
    expect(response.headers.get("cache-control")).toBe("public, max-age=300")
    expect(await response.text()).toBe(
      "User-agent: *\nAllow: /landing$\nAllow: /landing/\nDisallow: /\n\n" +
        "Sitemap: http://127.0.0.1:4100/landing/sitemap.xml\n",
    )
    // The page itself carries no noindex header.
    const page = await get("/landing/")
    expect(page.status).toBe(200)
    expect(page.headers.get("x-robots-tag")).toBeNull()
  })

  test("leaving public access blocks the site again", async () => {
    await server.sites.updateSite("landing", {
      access: { type: "password", password: "landing key" },
    })
    expect(await robots()).toBe(blockAll)
  })
})

describe("generated pages of an indexable site", () => {
  const noindex = async (path: string) => {
    const response = await get(path, html)
    expect(response.status).toBe(200)
    const body = await response.text()
    return {
      header: response.headers.get("x-robots-tag"),
      meta: body.includes('content="noindex"'),
    }
  }
  const indexed = { header: null, meta: false }
  const blocked = { header: "noindex", meta: true }

  test("Markdown pages and folder listings drop noindex only when indexable", async () => {
    const files = { "/a.png": "a", "/b/c.png": "c" }
    for (const [slug, site, indexable] of [
      ["md-on", { "/index.md": "# Docs" }, true],
      ["md-off", { "/index.md": "# Docs" }, false],
      ["files-on", files, true],
      ["files-off", files, false],
    ] as const) {
      await publish(site, { slug, access: { type: "public" }, indexable })
    }

    expect((await noindex("/md-on/")).meta).toBe(false)
    expect((await noindex("/md-off/")).meta).toBe(true)
    expect(await noindex("/files-on/")).toEqual(indexed)
    expect(await noindex("/files-on/b/")).toEqual(indexed)
    expect(await noindex("/files-off/")).toEqual(blocked)
  })
})
