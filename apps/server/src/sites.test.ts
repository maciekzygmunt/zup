import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
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

async function publish(expiresAt?: string) {
  const content = "<h1>site</h1>"
  const hash = new Bun.CryptoHasher("sha256").update(content).digest("hex")
  await blobs.write(hash, new Blob([content]).stream(), 1e6)
  const { deployment } = await server.sites.createDeployment({
    files: [{ path: "/index.html", hash, size: content.length, contentType: "text/html" }],
    access: { type: "public" },
    expiresAt,
    source: "cli",
  })
  return deployment.id
}

const move = (name: string, deploymentId: string) =>
  server.sites.putAlias(name, { deploymentId, mode: "upsert" })
const expiryOf = async (id: string) => (await server.sites.getDeployment(id)).expiresAt

beforeAll(async () => {
  server = await createServer(config)
})
afterAll(() => {
  server.close()
  rmSync(dataDir, { recursive: true, force: true })
})

describe("moving an alias", () => {
  test("expires the replaced deployment, and moving back cancels it", async () => {
    const v1 = await publish()
    const v2 = await publish()
    await move("demo", v1)

    const { previous } = await move("demo", v2)
    expect(previous?.id).toBe(v1)
    const days = (Date.parse(previous!.expiresAt!) - Date.now()) / 86_400_000
    expect(days).toBeCloseTo(7, 1)

    await move("demo", v1)
    expect(await expiryOf(v1)).toBeNull()
    expect(await expiryOf(v2)).not.toBeNull()
  })

  test("keeps a deployment that has another alias or its own expiry", async () => {
    const expiresAt = new Date(Date.now() + 86_400_000).toISOString()
    const shared = await publish()
    const temporary = await publish(expiresAt)
    const next = await publish()
    await move("a", shared)
    await move("b", shared)
    await move("c", temporary)

    expect((await move("a", next)).previous?.expiresAt).toBeNull()
    expect((await move("c", next)).previous?.expiresAt).toBe(expiresAt)
    // An alias pointing back does not cancel an expiry the user chose.
    await move("c", temporary)
    expect(await expiryOf(temporary)).toBe(expiresAt)
  })
})

describe("indexable aliases", () => {
  const errorOf = (promise: Promise<unknown>) =>
    promise.then(
      () => null,
      (error: { code?: string }) => error.code,
    )

  test("is off by default and only allowed on public aliases", async () => {
    const id = await publish()
    const created = await move("plain", id)
    expect(created.alias.indexable).toBe(false)
    expect(created.alias.access).toBe("private")
    expect(await errorOf(server.sites.updateAlias("plain", { indexable: true }))).toBe("not_public")
    expect(
      await errorOf(
        server.sites.putAlias("hidden", {
          deploymentId: id,
          access: { type: "password" },
          indexable: true,
          mode: "create",
        }),
      ),
    ).toBe("not_public")
  })

  test("can change without new access, and keeps the access and password", async () => {
    const id = await publish()
    await server.sites.putAlias("open", {
      deploymentId: id,
      access: { type: "public" },
      mode: "create",
    })
    const on = await server.sites.updateAlias("open", { indexable: true })
    expect(on.alias).toMatchObject({ access: "public", indexable: true })
    expect(on.key).toBeUndefined()
    const off = await server.sites.updateAlias("open", { indexable: false })
    expect(off.alias).toMatchObject({ access: "public", indexable: false })

    await server.sites.updateAlias("open", { access: { type: "password", password: "secret key" } })
    const before = await server.sites.shareLink({ alias: "open" })
    const kept = await server.sites.updateAlias("open", { indexable: false })
    expect(kept.alias.access).toBe("password")
    expect((await server.sites.shareLink({ alias: "open" })).shareUrl).toBe(before.shareUrl)
  })
})
