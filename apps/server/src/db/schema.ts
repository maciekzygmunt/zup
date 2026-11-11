import { accessTypes } from "@zup/shared"
import { index, integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core"

// One published site: one URL, one access setting, one set of files.
export const sites = sqliteTable("sites", {
  // Internal and fixed. Clients use the slug, which can change.
  id: text().primaryKey(),
  slug: text().notNull().unique(),
  title: text(),
  // Null means "/" shows a directory listing.
  entrypoint: text(),
  spa: integer({ mode: "boolean" }).notNull(),
  access: text({ enum: accessTypes }).notNull(),
  passwordHash: text("password_hash"),
  // Search engines may crawl it. Only applies while access is public.
  indexable: integer({ mode: "boolean" }).notNull().default(false),
  fileCount: integer("file_count").notNull(),
  totalBytes: integer("total_bytes").notNull(),
  source: text({ enum: ["cli", "web", "mcp"] }).notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  expiresAt: integer("expires_at", { mode: "timestamp_ms" }),
})

export const siteFiles = sqliteTable(
  "site_files",
  {
    siteId: text("site_id")
      .notNull()
      .references(() => sites.id, { onDelete: "cascade" }),
    path: text().notNull(),
    hash: text().notNull(),
    size: integer().notNull(),
    contentType: text("content_type").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.siteId, table.path] }),
    index("site_files_hash").on(table.hash),
  ],
)

export type Site = typeof sites.$inferSelect
export type SiteFile = typeof siteFiles.$inferSelect
