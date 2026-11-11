import {
  type AccessInput,
  type AccessType,
  type createSiteSchema,
  type GrantedKey,
  generateKey,
  inferEntrypoint,
  isHtmlPath,
  type ManifestFile,
  type SiteDetail,
  type SiteSummary,
  type UpdateSiteInput,
} from "@zup/shared"
import { and, count, desc, eq, lt, or, sql } from "drizzle-orm"
import type { z } from "zod"
import type { BlobStore } from "./blobs.ts"
import type { Config } from "./config.ts"
import type { Db } from "./db/client.ts"
import { type Site, siteFiles, sites } from "./db/schema.ts"
import { HttpError } from "./errors.ts"
import { randomSlug, siteId } from "./ids.ts"
import { hashPassword, shareToken, siteScope } from "./passwords.ts"

export type SiteService = ReturnType<typeof createSiteService>

type StoredAccess = { access: AccessType; passwordHash: string | null }

const slugTaken = (slug: string) => new HttpError(409, "slug_taken", `Slug ${slug} is in use`)

// Some Drizzle calls wrap the SQLite error in `cause`, others throw it as is.
function isUniqueViolation(error: unknown) {
  const { code, cause } = error as { code?: string; cause?: { code?: string } }
  return (code ?? cause?.code) === "SQLITE_CONSTRAINT_UNIQUE"
}

// Sites: one slug (the URL), one access setting and one set of files. An update replaces the files.
export function createSiteService({
  config,
  db,
  blobs,
}: {
  config: Config
  db: Db
  blobs: BlobStore
}) {
  const siteUrl = (slug: string) => `${config.previewOrigin}/${slug}/`

  // Hashes a chosen key or generates one. The plain key is returned once and never stored.
  async function storedAccess(
    input: AccessInput,
    slug: string,
  ): Promise<StoredAccess & { key?: GrantedKey }> {
    if (input.type !== "password") return { access: input.type, passwordHash: null }
    const key = input.password ?? generateKey()
    return {
      access: "password",
      passwordHash: await hashPassword(key),
      key: { key, shareUrl: `${siteUrl(slug)}#password=${encodeURIComponent(key)}` },
    }
  }

  // Only public sites can be indexed: other access turns it off, and asking for it fails.
  function indexableFor(access: AccessType, requested: boolean | undefined, current: boolean) {
    if (access === "public") return requested ?? current
    if (requested) {
      throw new HttpError(422, "not_public", "Only public sites can allow search engines")
    }
    return false
  }

  const summary = (site: Site): SiteSummary => ({
    slug: site.slug,
    title: site.title,
    access: site.access,
    indexable: site.indexable,
    url: siteUrl(site.slug),
    entrypoint: site.entrypoint,
    spa: site.spa,
    fileCount: site.fileCount,
    totalBytes: site.totalBytes,
    source: site.source,
    createdAt: site.createdAt.toISOString(),
    updatedAt: site.updatedAt.toISOString(),
    expiresAt: site.expiresAt?.toISOString() ?? null,
  })

  const findSite = async (slug: string) =>
    (await db.query.sites.findFirst({ where: eq(sites.slug, slug) })) ?? null

  async function requireSite(slug: string) {
    const site = await findSite(slug)
    if (!site) throw new HttpError(404, "site_not_found", `No site ${slug}`)
    return site
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
      throw new HttpError(422, "too_many_files", `A site can have ${config.MAX_FILES} files`)
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
      throw new HttpError(413, "site_too_large", "The files are larger than the per-site limit")
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
    siteUrl,

    // Creates a site, or with `update` replaces the files of the site at `slug`.
    // Omitted settings keep their current values on update.
    async createSite(input: z.output<typeof createSiteSchema>) {
      const totalBytes = await validateFiles(input.files)
      const paths = input.files.map((file) => file.path)
      if (input.entrypoint && !paths.includes(input.entrypoint)) {
        throw new HttpError(422, "invalid_entrypoint", `${input.entrypoint} is not in the upload`)
      }
      const existing = input.slug ? await findSite(input.slug) : null
      if (existing && !input.update) throw slugTaken(existing.slug)
      const slug = input.slug ?? randomSlug()
      const granted = input.access && (await storedAccess(input.access, slug))
      const { access, passwordHash } = granted ??
        existing ?? { access: "private" as const, passwordHash: null }
      const entrypoint = input.entrypoint ?? inferEntrypoint(paths)
      const now = new Date()
      const row: Site = {
        id: existing?.id ?? siteId(),
        slug,
        title: input.title === undefined ? (existing?.title ?? null) : input.title || null,
        entrypoint,
        spa: input.spa ?? existing?.spa ?? (entrypoint !== null && isHtmlPath(entrypoint)),
        access,
        passwordHash,
        indexable: indexableFor(access, input.indexable, existing?.indexable ?? false),
        fileCount: input.files.length,
        totalBytes,
        source: input.source,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
        expiresAt: input.expiresAt ? futureDate(input.expiresAt) : (existing?.expiresAt ?? null),
      }
      try {
        db.transaction((tx) => {
          if (existing) {
            tx.update(sites).set(row).where(eq(sites.id, row.id)).run()
            tx.delete(siteFiles).where(eq(siteFiles.siteId, row.id)).run()
          } else {
            tx.insert(sites).values(row).run()
          }
          // Chunked to stay below SQLite's bound-parameter limit.
          for (let i = 0; i < input.files.length; i += 1000) {
            tx.insert(siteFiles)
              .values(input.files.slice(i, i + 1000).map((file) => ({ siteId: row.id, ...file })))
              .run()
          }
        })
      } catch (error) {
        // Another request took the slug since the check above.
        if (isUniqueViolation(error)) throw slugTaken(slug)
        throw error
      }
      return { site: summary(row), key: granted?.key, created: !existing }
    },

    async listSites(options: {
      query?: string
      access?: AccessType
      limit: number
      offset: number
    }) {
      const pattern = options.query ? `%${options.query.replace(/[%_\\]/g, "\\$&")}%` : null
      const where = and(
        options.access ? eq(sites.access, options.access) : undefined,
        pattern
          ? or(
              sql`${sites.title} LIKE ${pattern} ESCAPE '\\'`,
              sql`${sites.slug} LIKE ${pattern} ESCAPE '\\'`,
            )
          : undefined,
      )
      const [rows, [total]] = await Promise.all([
        db
          .select()
          .from(sites)
          .where(where)
          .orderBy(desc(sites.updatedAt))
          .limit(options.limit)
          .offset(options.offset),
        db.select({ value: count() }).from(sites).where(where),
      ])
      return { sites: rows.map(summary), total: total?.value ?? 0 }
    },

    async getSite(slug: string): Promise<SiteDetail> {
      const site = await requireSite(slug)
      const files = await db
        .select({
          path: siteFiles.path,
          hash: siteFiles.hash,
          size: siteFiles.size,
          contentType: siteFiles.contentType,
        })
        .from(siteFiles)
        .where(eq(siteFiles.siteId, site.id))
        .orderBy(siteFiles.path)
      return { ...summary(site), files }
    },

    async findFile(slug: string, path: string) {
      const [file] = await db
        .select({ hash: siteFiles.hash, size: siteFiles.size, contentType: siteFiles.contentType })
        .from(siteFiles)
        .innerJoin(sites, eq(sites.id, siteFiles.siteId))
        .where(and(eq(sites.slug, slug), eq(siteFiles.path, path)))
      return file ?? null
    },

    async updateSite(slug: string, patch: UpdateSiteInput) {
      const current = await requireSite(slug)
      const nextSlug = patch.slug ?? current.slug
      // A new password's share link uses the new slug.
      const granted = patch.access && (await storedAccess(patch.access, nextSlug))
      const { access, passwordHash } = granted ?? current
      try {
        await db
          .update(sites)
          .set({
            slug: nextSlug,
            title: patch.title === undefined ? undefined : patch.title || null,
            spa: patch.spa,
            expiresAt: patch.expiresAt === undefined ? undefined : futureDate(patch.expiresAt),
            access,
            passwordHash,
            indexable: indexableFor(access, patch.indexable, current.indexable),
            updatedAt: new Date(),
          })
          .where(eq(sites.id, current.id))
      } catch (error) {
        if (isUniqueViolation(error)) throw slugTaken(nextSlug)
        throw error
      }
      return { site: summary(await requireSite(nextSlug)), key: granted?.key }
    },

    async deleteSite(slug: string) {
      const site = await requireSite(slug)
      await db.delete(sites).where(eq(sites.id, site.id))
    },

    // A working link for a password-protected site, without knowing the key.
    async shareLink(slug: string) {
      const site = await requireSite(slug)
      if (site.access !== "password" || !site.passwordHash) {
        throw new HttpError(409, "not_password_protected", "This site is not password protected")
      }
      const url = siteUrl(site.slug)
      const token = shareToken(config.BETTER_AUTH_SECRET, siteScope(site.id), site.passwordHash)
      return { url, shareUrl: `${url}#token=${token}` }
    },

    async stats() {
      const [totals] = await db
        .select({ sites: count(), bytes: sql<number>`coalesce(sum(${sites.totalBytes}), 0)` })
        .from(sites)
      return {
        sites: totals?.sites ?? 0,
        uploadedBytes: totals?.bytes ?? 0,
        storedBytes: await blobs.usedBytes(),
      }
    },

    async purgeExpired() {
      const expired = await db
        .delete(sites)
        .where(lt(sites.expiresAt, new Date()))
        .returning({ id: sites.id })
      return expired.length
    },

    // Deletes blobs no site references. Recent blobs are kept for uploads in progress.
    async collectGarbage(graceMs = 6 * 60 * 60 * 1000) {
      let removed = 0
      const cutoff = Date.now() - graceMs
      for await (const blob of blobs.list()) {
        if (blob.mtimeMs > cutoff) continue
        const used = await db.query.siteFiles.findFirst({
          columns: { hash: true },
          where: eq(siteFiles.hash, blob.hash),
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
