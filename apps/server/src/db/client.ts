import { Database } from "bun:sqlite"
import { mkdirSync } from "node:fs"
import { join } from "node:path"
import { drizzle } from "drizzle-orm/bun-sqlite"
import { migrate } from "drizzle-orm/bun-sqlite/migrator"
import * as schema from "./schema.ts"

export type Db = ReturnType<typeof openDatabase>["db"]

// One SQLite file holds Better Auth tables and zup tables.
export function openDatabase(dataDir: string, migrationsFolder: string) {
  mkdirSync(dataDir, { recursive: true })
  const sqlite = new Database(join(dataDir, "zup.db"), { create: true, strict: true })
  sqlite.run("PRAGMA journal_mode = WAL")
  sqlite.run("PRAGMA synchronous = NORMAL")
  sqlite.run("PRAGMA foreign_keys = ON")
  sqlite.run("PRAGMA busy_timeout = 5000")
  const db = drizzle({ client: sqlite, schema })
  migrate(db, { migrationsFolder })
  return { sqlite, db }
}
