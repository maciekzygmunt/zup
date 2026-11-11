import { z } from "zod"
import { type AccessType, accessInputSchema, slugSchema } from "./access.ts"
import { isValidManifestPath } from "./paths.ts"

export const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/, { message: "Invalid sha256 hash" })

export const manifestPathSchema = z
  .string()
  .refine(isValidManifestPath, { message: "Invalid file path" })

export const manifestFileSchema = z.object({
  path: manifestPathSchema,
  hash: sha256Schema,
  size: z.number().int().nonnegative(),
  contentType: z.string().min(1).max(255),
})
export type ManifestFile = z.infer<typeof manifestFileSchema>

export const createSiteSchema = z
  .object({
    // Omitted: the server picks a random slug.
    slug: slugSchema.optional(),
    // Replaces the files of the site at `slug` when it exists. Without it, a used slug fails.
    update: z.boolean().default(false),
    title: z.string().trim().max(200).optional(),
    files: z.array(manifestFileSchema).min(1),
    entrypoint: manifestPathSchema.optional(),
    spa: z.boolean().optional(),
    // Omitted access and indexable: private and off for a new site, unchanged on update.
    access: accessInputSchema.optional(),
    indexable: z.boolean().optional(),
    expiresAt: z.iso.datetime().optional(),
    source: z.enum(["cli", "web", "mcp"]).default("cli"),
  })
  .refine((input) => !input.update || input.slug, {
    message: "update needs a slug",
    path: ["update"],
  })
export type CreateSiteInput = z.input<typeof createSiteSchema>

export const updateSiteSchema = z.object({
  // A new slug changes the URL. The old URL stops working.
  slug: slugSchema.optional(),
  title: z.string().trim().max(200).nullable().optional(),
  access: accessInputSchema.optional(),
  // Lets search engines crawl the site. Only for public access; other access turns it off.
  indexable: z.boolean().optional(),
  expiresAt: z.iso.datetime().nullable().optional(),
  spa: z.boolean().optional(),
})
export type UpdateSiteInput = z.infer<typeof updateSiteSchema>

export const missingBlobsSchema = z.object({ hashes: z.array(sha256Schema).max(20_000) })

export type SiteSummary = {
  slug: string
  title: string | null
  access: AccessType
  // Search engines may crawl it while access is public.
  indexable: boolean
  url: string
  entrypoint: string | null
  spa: boolean
  fileCount: number
  totalBytes: number
  source: "cli" | "web" | "mcp"
  createdAt: string
  // When the files or settings last changed.
  updatedAt: string
  expiresAt: string | null
}

export type SiteDetail = SiteSummary & { files: ManifestFile[] }

// Returned once when the server generates or receives a password; never readable later.
export type GrantedKey = { key: string; shareUrl: string }

export type ServerInfo = {
  appUrl: string
  previewUrl: string
  version: string
  limits: { maxFileBytes: number; maxSiteBytes: number; maxFiles: number }
}

export type ApiError = { error: string; message: string }
