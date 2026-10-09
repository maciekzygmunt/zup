import { resolve } from "node:path"
import { z } from "zod"

const bytes = (fallback: number) => z.coerce.number().int().positive().default(fallback)

const envSchema = z.object({
  APP_URL: z.url(),
  PREVIEW_URL: z.url(),
  BETTER_AUTH_SECRET: z.string().min(32, "BETTER_AUTH_SECRET must be at least 32 characters"),
  DATA_DIR: z.string().default("./.data"),
  WEB_DIST: z.string().default(resolve(import.meta.dir, "../../web/dist")),
  MIGRATIONS_DIR: z.string().default(resolve(import.meta.dir, "../drizzle")),
  CLI_DIST: z.string().default(resolve(import.meta.dir, "../../../packages/cli/dist/zup.mjs")),
  PORT: z.coerce.number().int().default(3000),
  MAX_FILE_BYTES: bytes(1024 ** 3),
  MAX_DEPLOYMENT_BYTES: bytes(4 * 1024 ** 3),
  MAX_FILES: bytes(10_000),
  MCP_MAX_BODY_BYTES: bytes(64 * 1024 ** 2),
  // Header with the client IP set by the reverse proxy (Traefik in Coolify).
  CLIENT_IP_HEADER: z.string().default("x-forwarded-for"),
})

export type Config = ReturnType<typeof loadConfig>

export function loadConfig(env: Record<string, string | undefined>) {
  const parsed = envSchema.parse(env)
  const appUrl = new URL(parsed.APP_URL)
  const previewUrl = new URL(parsed.PREVIEW_URL)
  if (appUrl.host === previewUrl.host) {
    throw new Error("APP_URL and PREVIEW_URL must use different hosts")
  }
  return {
    ...parsed,
    appOrigin: appUrl.origin,
    previewOrigin: previewUrl.origin,
    appHost: appUrl.host,
    previewHost: previewUrl.host,
    secureCookies: previewUrl.protocol === "https:",
    dataDir: resolve(parsed.DATA_DIR),
  }
}
