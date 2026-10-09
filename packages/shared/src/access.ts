import { z } from "zod"

export const accessTypes = ["private", "public", "password"] as const
export type AccessType = (typeof accessTypes)[number]

export const passwordSchema = z.string().min(8).max(200)

// Access sent by clients. A "password" access without a password makes the server generate one.
export const accessInputSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("private") }),
  z.object({ type: z.literal("public") }),
  z.object({ type: z.literal("password"), password: passwordSchema.optional() }),
])
export type AccessInput = z.infer<typeof accessInputSchema>

// Top-level preview paths that can never be alias names.
export const reservedAliasNames = new Set([
  "u",
  "_zup",
  "api",
  "assets",
  "favicon.ico",
  "robots.txt",
  "well-known",
])

export const aliasNameSchema = z
  .string()
  .regex(/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/, {
    message: "Use 1-63 lowercase letters, digits or dashes, not starting or ending with a dash",
  })
  .refine((name) => !reservedAliasNames.has(name), { message: "This alias name is reserved" })
