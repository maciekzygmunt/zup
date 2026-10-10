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

// No 0/o or 1/i/l, so generated passwords are easy to read and type.
const keyAlphabet = "23456789abcdefghjkmnpqrstuvwxyz"

// A generated password: four groups of five characters, e.g. "k7m2p-x9qte-4hwna-c3vzr" (~99 bits).
export function generateKey(): string {
  let key = ""
  while (key.length < 20) {
    for (const byte of crypto.getRandomValues(new Uint8Array(32))) {
      // 248 = 8 × 31: bytes above it are skipped so every character is equally likely.
      if (byte < 248 && key.length < 20) key += keyAlphabet[byte % keyAlphabet.length]
    }
  }
  return key.match(/.{5}/g)!.join("-")
}

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
