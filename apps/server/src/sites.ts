import {
  type AccessInput,
  type AccessType,
  type AliasSummary,
  type createDeploymentSchema,
  type DeploymentDetail,
  type DeploymentSummary,
  type GrantedKey,
  generateKey,
  inferEntrypoint,
  isHtmlPath,
  type ManifestFile,
  type putAliasSchema,
  type UpdateAliasInput,
  type UpdateDeploymentInput,
} from "@zup/shared"
import {
  and,
  count,
  desc,
  eq,
  exists,
  inArray,
  isNull,
  like,
  lt,
  notExists,
  or,
  sql,
} from "drizzle-orm"
import type { z } from "zod"
import type { BlobStore } from "./blobs.ts"
import type { Config } from "./config.ts"
import type { Db } from "./db/client.ts"
import { type Alias, aliases, type Deployment, deploymentFiles, deployments } from "./db/schema.ts"
import { HttpError } from "./errors.ts"
import { deploymentId } from "./ids.ts"
import { hashPassword, shareToken, siteScope } from "./passwords.ts"

export type SiteService = ReturnType<typeof createSiteService>
export type ShareTarget = { deploymentId: string } | { alias: string }

type StoredAccess = { access: AccessType; passwordHash: string | null }

// How long a deployment stays after an alias moves away from it.
const REPLACED_TTL_MS = 7 * 24 * 60 * 60 * 1000

// Deployments (immutable uploads) and aliases (stable names that point at one deployment).
export function createSiteService({
  config,
  db,
  blobs,
}: {
  config: Config
  db: Db
  blobs: BlobStore
}) {
  const deploymentUrl = (id: string) => `${config.previewOrigin}/u/${id}/`
  const aliasUrl = (name: string) => `${config.previewOrigin}/${name}/`
  const urlFor = (target: ShareTarget) =>
    "alias" in target ? aliasUrl(target.alias) : deploymentUrl(target.deploymentId)

  // Hashes a chosen key or generates one. The plain key is returned once and never stored.
  async function storedAccess(
    input: AccessInput,
    target: ShareTarget,
  ): Promise<StoredAccess & { key?: GrantedKey }> {
    if (input.type !== "password") return { access: input.type, passwordHash: null }
    const key = input.password ?? generateKey()
    return {
      access: "password",
      passwordHash: await hashPassword(key),
      key: { key, shareUrl: `${urlFor(target)}#password=${encodeURIComponent(key)}` },
    }
  }

  const aliasSummary = (alias: Alias, deploymentTitle: string | null): AliasSummary => ({
    name: alias.name,
    deploymentId: alias.deploymentId,
    deploymentTitle,
    access: alias.access,
    indexable: alias.indexable,
    url: aliasUrl(alias.name),
    createdAt: alias.createdAt.toISOString(),
    updatedAt: alias.updatedAt.toISOString(),
  })

  function deploymentSummary(deployment: Deployment, aliasRows: Alias[]): DeploymentSummary {
    return {
      id: deployment.id,
      title: deployment.title,
      access: deployment.access,
      url: deploymentUrl(deployment.id),
      entrypoint: deployment.entrypoint,
      spa: deployment.spa,
      fileCount: deployment.fileCount,
      totalBytes: deployment.totalBytes,
      source: deployment.source,
      createdAt: deployment.createdAt.toISOString(),
      expiresAt: deployment.expiresAt?.toISOString() ?? null,
      aliases: aliasRows
        .filter((a) => a.deploymentId === deployment.id)
        .map((a) => aliasSummary(a, deployment.title)),
    }
  }

  async function summaries(rows: Deployment[]) {
    const ids = rows.map((row) => row.id)
    const aliasRows = ids.length
      ? await db.select().from(aliases).where(inArray(aliases.deploymentId, ids))
      : []
    return rows.map((row) => deploymentSummary(row, aliasRows))
  }

  async function requireDeployment(id: string) {
    const deployment = await db.query.deployments.findFirst({ where: eq(deployments.id, id) })
    if (!deployment) throw new HttpError(404, "deployment_not_found", `No deployment ${id}`)
    return deployment
  }

  async function requireAlias(name: string) {
    const alias = await db.query.aliases.findFirst({ where: eq(aliases.name, name) })
    if (!alias) throw new HttpError(404, "alias_not_found", `No alias ${name}`)
    return alias
  }

  function futureDate(value: string | null | undefined) {
    if (value == null) return null
    const date = new Date(value)
    if (date.getTime() <= Date.now()) {
      throw new HttpError(422, "invalid_expiry", "Expiry must be in the future")
    }
    return date
  }

  async function validateFiles(files: ManifestFile[]) {
    if (files.length > config.MAX_FILES) {
      throw new HttpError(422, "too_many_files", `A deployment can have ${config.MAX_FILES} files`)
    }
    const paths = new Set<string>()
    let totalBytes = 0
    for (const file of files) {
      if (paths.has(file.path)) {
        throw new HttpError(422, "duplicate_path", `Duplicate path ${file.path}`)
      }
      paths.add(file.path)
      if (file.size > config.MAX_FILE_BYTES) {
        throw new HttpError(413, "file_too_large", `${file.path} is too large`)
      }
      totalBytes += file.size
    }
    if (totalBytes > config.MAX_DEPLOYMENT_BYTES) {
      throw new HttpError(413, "deployment_too_large", "Deployment is too large")
    }
    const missing: string[] = []
    await Promise.all(
      files.map(async (file) => {
        if ((await blobs.size(file.hash)) !== file.size) missing.push(file.path)
      }),
    )
    if (missing.length) {
      throw new HttpError(
        422,
        "missing_blobs",
        `Content was not uploaded for ${missing.length} file(s): ${missing.slice(0, 5).join(", ")}`,
      )
    }
    return totalBytes
  }

  return {
    deploymentUrl,
    aliasUrl,

    async createDeployment(input: z.output<typeof createDeploymentSchema>) {
      const totalBytes = await validateFiles(input.files)
      const paths = input.files.map((file) => file.path)
      if (input.entrypoint && !paths.includes(input.entrypoint)) {
        throw new HttpError(422, "invalid_entrypoint", `${input.entrypoint} is not in the upload`)
      }
      const entrypoint = input.entrypoint ?? inferEntrypoint(paths)
      const id = deploymentId()
      const { key, ...access } = await storedAccess(input.access, { deploymentId: id })
      const row: Deployment = {
        id,
        title: input.title || null,
        entrypoint,
        spa: input.spa ?? (entrypoint !== null && isHtmlPath(entrypoint)),
        ...access,
        fileCount: input.files.length,
        totalBytes,
        source: input.source,
        createdAt: new Date(),
        expiresAt: futureDate(input.expiresAt),
        autoExpiry: false,
      }
      db.transaction((tx) => {
        tx.insert(deployments).values(row).run()
        // Chunked to stay below SQLite's bound-parameter limit.
        for (let i = 0; i < input.files.length; i += 1000) {
          tx.insert(deploymentFiles)
            .values(input.files.slice(i, i + 1000).map((file) => ({ deploymentId: id, ...file })))
            .run()
        }
      })
      return { deployment: deploymentSummary(row, []), key }
    },

    async listDeployments(options: {
      query?: string
      access?: AccessType
      limit: number
      offset: number
    }) {
      const pattern = options.query ? `%${options.query.replace(/[%_\\]/g, "\\$&")}%` : null
      const where = and(
        options.access ? eq(deployments.access, options.access) : undefined,
        pattern
          ? or(
              sql`${deployments.title} LIKE ${pattern} ESCAPE '\\'`,
              like(deployments.id, pattern),
              exists(
                db
                  .select({ one: sql`1` })
                  .from(aliases)
                  .where(
                    and(
                      eq(aliases.deploymentId, deployments.id),
                      sql`${aliases.name} LIKE ${pattern} ESCAPE '\\'`,
                    ),
                  ),
              ),
            )
          : undefined,
      )
      const [rows, [total]] = await Promise.all([
        db
          .select()
          .from(deployments)
          .where(where)
          .orderBy(desc(deployments.createdAt))
          .limit(options.limit)
          .offset(options.offset),
        db.select({ value: count() }).from(deployments).where(where),
      ])
      return { deployments: await summaries(rows), total: total?.value ?? 0 }
    },

    async getDeployment(id: string): Promise<DeploymentDetail> {
      const deployment = await requireDeployment(id)
      const [summary] = await summaries([deployment])
      const files = await db
        .select({
          path: deploymentFiles.path,
          hash: deploymentFiles.hash,
          size: deploymentFiles.size,
          contentType: deploymentFiles.contentType,
        })
        .from(deploymentFiles)
        .where(eq(deploymentFiles.deploymentId, id))
        .orderBy(deploymentFiles.path)
      return { ...summary!, files }
    },

    async updateDeployment(id: string, patch: UpdateDeploymentInput) {
      const current = await requireDeployment(id)
      const access = patch.access && (await storedAccess(patch.access, { deploymentId: id }))
      await db
        .update(deployments)
        .set({
          title: patch.title === undefined ? undefined : patch.title || null,
          spa: patch.spa,
          expiresAt: patch.expiresAt === undefined ? undefined : futureDate(patch.expiresAt),
          autoExpiry: patch.expiresAt === undefined ? undefined : false,
          access: access?.access,
          passwordHash: access ? access.passwordHash : undefined,
        })
        .where(eq(deployments.id, current.id))
      const [summary] = await summaries([await requireDeployment(id)])
      return { deployment: summary!, key: access?.key }
    },

    async deleteDeployment(id: string) {
      await requireDeployment(id)
      await db.delete(deployments).where(eq(deployments.id, id))
    },

    async listAliases() {
      const rows = await db
        .select({ alias: aliases, title: deployments.title })
        .from(aliases)
        .innerJoin(deployments, eq(aliases.deploymentId, deployments.id))
        .orderBy(aliases.name)
      return rows.map((row) => aliasSummary(row.alias, row.title))
    },

    async putAlias(name: string, input: z.output<typeof putAliasSchema>) {
      const deployment = await requireDeployment(input.deploymentId)
      const existing = await db.query.aliases.findFirst({ where: eq(aliases.name, name) })
      if (existing && input.mode === "create") {
        throw new HttpError(409, "alias_exists", `Alias ${name} already exists`)
      }
      // Moving an alias keeps its access (and password) and indexable unless new values are given.
      const access = input.access
        ? await storedAccess(input.access, { alias: name })
        : (existing ?? { access: "private" as const, passwordHash: null })
      const now = new Date()
      const row: Alias = {
        name,
        deploymentId: input.deploymentId,
        access: access.access,
        passwordHash: access.passwordHash,
        indexable: input.indexable ?? existing?.indexable ?? false,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      }
      // Reads happen inside the transaction, so concurrent requests do not use stale rows.
      const previousId = db.transaction((tx) => {
        const replaced = tx
          .select({ deploymentId: aliases.deploymentId })
          .from(aliases)
          .where(eq(aliases.name, name))
          .get()
        tx.insert(aliases)
          .values(row)
          .onConflictDoUpdate({ target: aliases.name, set: { ...row, createdAt: undefined } })
          .run()
        tx.update(deployments)
          .set({ expiresAt: null, autoExpiry: false })
          .where(and(eq(deployments.id, deployment.id), eq(deployments.autoExpiry, true)))
          .run()
        const replacedId =
          replaced && replaced.deploymentId !== row.deploymentId ? replaced.deploymentId : null
        // The replaced deployment expires later, unless it has an expiry or another alias.
        if (replacedId) {
          tx.update(deployments)
            .set({ expiresAt: new Date(now.getTime() + REPLACED_TTL_MS), autoExpiry: true })
            .where(
              and(
                eq(deployments.id, replacedId),
                isNull(deployments.expiresAt),
                notExists(
                  tx
                    .select({ one: sql`1` })
                    .from(aliases)
                    .where(eq(aliases.deploymentId, replacedId)),
                ),
              ),
            )
            .run()
        }
        return replacedId
      })
      const previous =
        previousId &&
        (await db.query.deployments.findFirst({
          columns: { id: true, expiresAt: true },
          where: eq(deployments.id, previousId),
        }))
      return {
        alias: aliasSummary(row, deployment.title),
        key: "key" in access ? access.key : undefined,
        created: !existing,
        previous: previous
          ? { id: previous.id, expiresAt: previous.expiresAt?.toISOString() ?? null }
          : null,
      }
    },

    async updateAlias(name: string, input: UpdateAliasInput) {
      await requireAlias(name)
      const { key, ...access } = await storedAccess(input.access, { alias: name })
      await db
        .update(aliases)
        .set({ ...access, indexable: input.indexable, updatedAt: new Date() })
        .where(eq(aliases.name, name))
      const alias = await requireAlias(name)
      const { title } = await requireDeployment(alias.deploymentId)
      return { alias: aliasSummary(alias, title), key }
    },

    async deleteAlias(name: string) {
      await requireAlias(name)
      await db.delete(aliases).where(eq(aliases.name, name))
    },

    // A working link for a password-protected site, without knowing the key.
    async shareLink(target: ShareTarget) {
      const record =
        "alias" in target
          ? await requireAlias(target.alias)
          : await requireDeployment(target.deploymentId)
      if (record.access !== "password" || !record.passwordHash) {
        throw new HttpError(409, "not_password_protected", "This site is not password protected")
      }
      const url = urlFor(target)
      const token = shareToken(config.BETTER_AUTH_SECRET, siteScope(target), record.passwordHash)
      return { url, shareUrl: `${url}#token=${token}` }
    },

    async stats() {
      const [totals] = await db
        .select({
          deployments: count(),
          bytes: sql<number>`coalesce(sum(${deployments.totalBytes}), 0)`,
        })
        .from(deployments)
      const [aliasCount] = await db.select({ value: count() }).from(aliases)
      return {
        deployments: totals?.deployments ?? 0,
        aliases: aliasCount?.value ?? 0,
        uploadedBytes: totals?.bytes ?? 0,
        storedBytes: await blobs.usedBytes(),
      }
    },

    async purgeExpired() {
      const expired = await db
        .delete(deployments)
        .where(lt(deployments.expiresAt, new Date()))
        .returning({ id: deployments.id })
      return expired.length
    },

    // Deletes blobs no deployment references. Recent blobs are kept for uploads in progress.
    async collectGarbage(graceMs = 6 * 60 * 60 * 1000) {
      let removed = 0
      const cutoff = Date.now() - graceMs
      for await (const blob of blobs.list()) {
        if (blob.mtimeMs > cutoff) continue
        const used = await db.query.deploymentFiles.findFirst({
          columns: { hash: true },
          where: eq(deploymentFiles.hash, blob.hash),
        })
        if (!used) {
          await blobs.remove(blob.hash)
          removed++
        }
      }
      await blobs.cleanTmp(graceMs)
      return removed
    },
  }
}
