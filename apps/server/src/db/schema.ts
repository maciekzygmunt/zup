import { accessTypes } from "@zup/shared"
import { index, integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core"

export const deployments = sqliteTable("deployments", {
  id: text().primaryKey(),
  title: text(),
  // Null means "/" shows a directory listing.
  entrypoint: text(),
  spa: integer({ mode: "boolean" }).notNull(),
  access: text({ enum: accessTypes }).notNull(),
  passwordHash: text("password_hash"),
  fileCount: integer("file_count").notNull(),
  totalBytes: integer("total_bytes").notNull(),
  source: text({ enum: ["cli", "web", "mcp"] }).notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  expiresAt: integer("expires_at", { mode: "timestamp_ms" }),
})

export const deploymentFiles = sqliteTable(
  "deployment_files",
  {
    deploymentId: text("deployment_id")
      .notNull()
      .references(() => deployments.id, { onDelete: "cascade" }),
    path: text().notNull(),
    hash: text().notNull(),
    size: integer().notNull(),
    contentType: text("content_type").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.deploymentId, table.path] }),
    index("deployment_files_hash").on(table.hash),
  ],
)

export const aliases = sqliteTable(
  "aliases",
  {
    name: text().primaryKey(),
    deploymentId: text("deployment_id")
      .notNull()
      .references(() => deployments.id, { onDelete: "cascade" }),
    access: text({ enum: accessTypes }).notNull(),
    passwordHash: text("password_hash"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [index("aliases_deployment").on(table.deploymentId)],
)

export type Deployment = typeof deployments.$inferSelect
export type DeploymentFile = typeof deploymentFiles.$inferSelect
export type Alias = typeof aliases.$inferSelect
