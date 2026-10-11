import { z } from "zod"
import { type AccessType, accessInputSchema, aliasNameSchema } from "./access.ts"
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

export const createDeploymentSchema = z.object({
  title: z.string().trim().max(200).optional(),
  files: z.array(manifestFileSchema).min(1),
  entrypoint: manifestPathSchema.optional(),
  spa: z.boolean().optional(),
  access: accessInputSchema.default({ type: "private" }),
  expiresAt: z.iso.datetime().optional(),
  source: z.enum(["cli", "web", "mcp"]).default("cli"),
})
export type CreateDeploymentInput = z.input<typeof createDeploymentSchema>

export const updateDeploymentSchema = z.object({
  title: z.string().trim().max(200).nullable().optional(),
  access: accessInputSchema.optional(),
  expiresAt: z.iso.datetime().nullable().optional(),
  spa: z.boolean().optional(),
})
export type UpdateDeploymentInput = z.infer<typeof updateDeploymentSchema>

export const putAliasSchema = z.object({
  deploymentId: z.string().min(1),
  // Omitted access keeps the alias's current access (or private for a new alias).
  access: accessInputSchema.optional(),
  // Lets search engines crawl a public alias. Omitted keeps the current value (false for a
  // new alias). Access other than public turns it off.
  indexable: z.boolean().optional(),
  // "create" fails when the alias exists; "upsert" moves it.
  mode: z.enum(["create", "upsert"]).default("upsert"),
})
export type PutAliasInput = z.input<typeof putAliasSchema>

export const updateAliasSchema = z
  .object({ access: accessInputSchema.optional(), indexable: z.boolean().optional() })
  .refine((input) => input.access || input.indexable !== undefined, {
    message: "Pass access or indexable",
  })
export type UpdateAliasInput = z.infer<typeof updateAliasSchema>

export const shareLinkSchema = z.union([
  z.object({ deploymentId: z.string().min(1) }),
  z.object({ alias: aliasNameSchema }),
])

export const missingBlobsSchema = z.object({ hashes: z.array(sha256Schema).max(20_000) })

export type AliasSummary = {
  name: string
  deploymentId: string
  deploymentTitle: string | null
  access: AccessType
  // Search engines may crawl it while access is public.
  indexable: boolean
  url: string
  createdAt: string
  updatedAt: string
}

export type DeploymentSummary = {
  id: string
  title: string | null
  access: AccessType
  url: string
  entrypoint: string | null
  spa: boolean
  fileCount: number
  totalBytes: number
  source: "cli" | "web" | "mcp"
  createdAt: string
  expiresAt: string | null
  aliases: AliasSummary[]
}

export type DeploymentDetail = DeploymentSummary & { files: ManifestFile[] }

// Returned once when the server generates or receives a password; never readable later.
export type GrantedKey = { key: string; shareUrl: string }

export type ServerInfo = {
  appUrl: string
  previewUrl: string
  version: string
  limits: { maxFileBytes: number; maxDeploymentBytes: number; maxFiles: number }
}

export type ApiError = { error: string; message: string }
