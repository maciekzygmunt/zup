import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { AccessInput } from "@zup/shared"
import { contentTypeFor } from "@zup/shared"
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

async function publish(files: Record<string, string>, access: AccessInput = { type: "public" }) {
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
  return server.sites.createDeployment({ files: manifest, access, source: "cli" })
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
    const { deployment } = await publish({
      "/index.html": "<h1>home</h1>",
      "/docs/index.html": "<h1>docs</h1>",
      "/app.js": "1",
    })
    expect(await (await get(`/u/${deployment.id}/`)).text()).toBe("<h1>home</h1>")
    expect(await (await get(`/u/${deployment.id}/docs/`)).text()).toBe("<h1>docs</h1>")
    expect((await get(`/u/${deployment.id}`)).headers.get("location")).toBe(`/u/${deployment.id}/`)
    expect((await get(`/u/${deployment.id}/docs`)).headers.get("location")).toBe(
      `/u/${deployment.id}/docs/`,
    )
    const js = await get(`/u/${deployment.id}/app.js`)
    expect(js.headers.get("content-type")).toContain("javascript")
    expect(
      (await get(`/u/${deployment.id}/app.js`, { "if-none-match": js.headers.get("etag")! }))
        .status,
    ).toBe(304)
  })

  test("SPA fallback only for extensionless page requests", async () => {
    const { deployment } = await publish({ "/index.html": "app" })
    expect((await get(`/u/${deployment.id}/settings/profile`, html)).status).toBe(200)
    expect((await get(`/u/${deployment.id}/missing.js`, html)).status).toBe(404)
    expect((await get(`/u/${deployment.id}/settings`)).status).toBe(404)
  })

  test("folders without an index get a listing; single files redirect to their name", async () => {
    const listing = await publish({ "/a.png": "a", "/b/c.png": "c" })
    const page = await (await get(`/u/${listing.deployment.id}/`, html)).text()
    expect(page).toContain("a.png")
    expect(page).toContain("b/")
    const single = await publish({ "/photo.png": "p" })
    expect((await get(`/u/${single.deployment.id}/`)).headers.get("location")).toBe(
      `/u/${single.deployment.id}/photo.png`,
    )
  })

  test("renders Markdown for browsers and keeps ?raw", async () => {
    const { deployment } = await publish({ "/README.md": "# Title\n\n*hi*" })
    const rendered = await (await get(`/u/${deployment.id}/README.md`, html)).text()
    expect(rendered).toContain("<h1>Title</h1>")
    expect(await (await get(`/u/${deployment.id}/README.md?raw`, html)).text()).toBe(
      "# Title\n\n*hi*",
    )
  })

  test("serves byte ranges", async () => {
    const { deployment } = await publish({ "/data.txt": "0123456789" })
    const response = await get(`/u/${deployment.id}/data.txt`, { range: "bytes=2-4" })
    expect(response.status).toBe(206)
    expect(await response.text()).toBe("234")
    expect(response.headers.get("content-range")).toBe("bytes 2-4/10")
  })

  test("root-relative assets redirect into the referring site", async () => {
    const { deployment } = await publish({ "/index.html": "x", "/assets/app.js": "1" })
    const response = await get("/assets/app.js?v=1", {
      referer: `http://127.0.0.1:4100/u/${deployment.id}/`,
    })
    expect(response.status).toBe(307)
    expect(response.headers.get("location")).toBe(`/u/${deployment.id}/assets/app.js?v=1`)
  })
})

describe("access", () => {
  test("private sites need the owner", async () => {
    const { deployment } = await publish({ "/index.html": "secret" }, { type: "private" })
    expect((await get(`/u/${deployment.id}/`)).status).toBe(401)
    const page = await (await get(`/u/${deployment.id}/`, html)).text()
    expect(page).toContain("/_zup/login?next=")
    expect(page).not.toContain("secret")
  })

  test("password sites unlock with the key and set a site-scoped cookie", async () => {
    const { deployment } = await publish(
      { "/index.html": "protected" },
      { type: "password", password: "open sesame" },
    )
    const base = `/u/${deployment.id}`
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

  test("an alias has its own access and keeps its password when moved", async () => {
    const first = await publish({ "/index.html": "v1" }, { type: "private" })
    const second = await publish({ "/index.html": "v2" }, { type: "private" })
    await server.sites.putAlias("demo", {
      deploymentId: first.deployment.id,
      access: { type: "password", password: "alias key 1" },
      mode: "create",
    })
    const moved = await server.sites.putAlias("demo", {
      deploymentId: second.deployment.id,
      mode: "upsert",
    })
    expect(moved.alias.access).toBe("password")
    expect(moved.key).toBeUndefined()
    const share = await server.sites.shareLink({ alias: "demo" })
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
    // The deployment itself stays private.
    expect((await get(`/u/${second.deployment.id}/`, { cookie })).status).toBe(401)
  })

  test("expired deployments answer 410 and are purged", async () => {
    const { deployment } = await publish({ "/index.html": "old" })
    await server.sites.updateDeployment(deployment.id, {
      expiresAt: new Date(Date.now() + 50).toISOString(),
    })
    await Bun.sleep(60)
    expect((await get(`/u/${deployment.id}/`)).status).toBe(410)
    expect(await server.sites.purgeExpired()).toBeGreaterThanOrEqual(1)
    expect((await get(`/u/${deployment.id}/`)).status).toBe(404)
  })
})

describe("robots.txt", () => {
  const robots = async () => (await get("/robots.txt")).text()
  const blockAll = "User-agent: *\nDisallow: /\n"

  test("blocks everything when no alias is indexable", async () => {
    expect(await robots()).toBe(blockAll)
  })

  test("allows public indexable aliases, lists their sitemaps and keeps the setting on a move", async () => {
    const first = await publish({ "/index.html": "v1" })
    const second = await publish({ "/index.html": "v2", "/sitemap.xml": "<urlset/>" })
    await server.sites.putAlias("landing", {
      deploymentId: first.deployment.id,
      access: { type: "public" },
      indexable: true,
      mode: "create",
    })
    expect(await robots()).toBe("User-agent: *\nAllow: /landing$\nAllow: /landing/\nDisallow: /\n")

    const moved = await server.sites.putAlias("landing", {
      deploymentId: second.deployment.id,
      mode: "upsert",
    })
    expect(moved.alias.indexable).toBe(true)
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

  test("leaving public access turns indexing off", async () => {
    await server.sites.updateAlias("landing", {
      access: { type: "password", password: "landing key" },
    })
    expect(await robots()).toBe(blockAll)
    // Switching back to public does not turn it on again.
    const { alias } = await server.sites.updateAlias("landing", { access: { type: "public" } })
    expect(alias.indexable).toBe(false)
    expect(await robots()).toBe(blockAll)
  })
})
