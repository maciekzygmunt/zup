import { afterAll, expect, test } from "bun:test"
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { openDatabase } from "./client.ts"

const migrations = resolve(import.meta.dir, "../../drizzle")
const dir = mkdtempSync(join(tmpdir(), "zup-migrate-"))
afterAll(() => rmSync(dir, { recursive: true, force: true }))

// The migrations folder as it was before deployments and aliases became sites.
function migrationsBefore(tag: string) {
  const folder = join(dir, "old-migrations")
  mkdirSync(join(folder, "meta"), { recursive: true })
  const journal = JSON.parse(readFileSync(join(migrations, "meta/_journal.json"), "utf8"))
  const index = journal.entries.findIndex((entry: { tag: string }) => entry.tag === tag)
  journal.entries = journal.entries.slice(0, index)
  writeFileSync(join(folder, "meta/_journal.json"), JSON.stringify(journal))
  for (const { tag } of journal.entries) {
    cpSync(join(migrations, `${tag}.sql`), join(folder, `${tag}.sql`))
  }
  return folder
}

test("deployments become sites with the name and access of their oldest alias", () => {
  const data = join(dir, "data")
  const old = openDatabase(data, migrationsBefore("0003_sites")).sqlite
  const deployment = (id: string, access: string, passwordHash: string | null) =>
    old.run(
      `INSERT INTO deployments (id, title, entrypoint, spa, access, password_hash, file_count, total_bytes, source, created_at, expires_at)
       VALUES (?, ?, '/index.html', 1, ?, ?, 1, 5, 'cli', 1000, NULL)`,
      [id, `Title ${id}`, access, passwordHash],
    )
  const alias = (name: string, id: string, access: string, hash: string | null, at: number) =>
    old.run(
      `INSERT INTO aliases (name, deployment_id, access, password_hash, indexable, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [name, id, access, hash, access === "public" ? 1 : 0, at, at + 1],
    )
  deployment("Landing", "private", null)
  alias("zup", "Landing", "public", null, 2000)
  deployment("Locked", "password", "deployment-hash")
  alias("cancun", "Locked", "password", "alias-hash", 2000)
  deployment("Twice", "public", null)
  alias("second", "Twice", "private", null, 3000)
  alias("first", "Twice", "public", null, 2000)
  deployment("Plain", "public", null)
  old.run(
    `INSERT INTO deployment_files (deployment_id, path, hash, size, content_type)
     VALUES ('Landing', '/index.html', 'abc', 5, 'text/html')`,
  )
  old.close()

  const { sqlite } = openDatabase(data, migrations)
  const rows = sqlite
    .query(
      "SELECT id, slug, title, access, password_hash, indexable, updated_at FROM sites ORDER BY id",
    )
    .all() as Record<string, unknown>[]
  expect(rows).toEqual([
    expect.objectContaining({ id: "Landing", slug: "zup", access: "public", indexable: 1 }),
    expect.objectContaining({ id: "Locked", slug: "cancun", password_hash: "alias-hash" }),
    expect.objectContaining({ id: "Plain", access: "public", updated_at: 1000 }),
    expect.objectContaining({ id: "Twice", slug: "first", title: "Title Twice", access: "public" }),
  ])
  expect(rows[2]!.slug).toMatch(/^[0-9a-f]{20}$/)
  expect(sqlite.query("SELECT site_id, path FROM site_files").all()).toEqual([
    { site_id: "Landing", path: "/index.html" },
  ])
  sqlite.close()
})
