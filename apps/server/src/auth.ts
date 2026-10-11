import type { Database } from "bun:sqlite"
import { cimd } from "@better-auth/cimd"
import { fetchClientMetadataResource } from "@better-auth/cimd/node"
import { mcp } from "@better-auth/mcp"
import { passkey } from "@better-auth/passkey"
import { APIError, betterAuth } from "better-auth"
import { createAuthMiddleware } from "better-auth/api"
import { getMigrations } from "better-auth/db/migration"
import { bearer, deviceAuthorization, jwt } from "better-auth/plugins"
import type { Config } from "./config.ts"

export const cliClientId = "zup-cli"
export const clientIpHeader = "x-zup-client-ip"
export const mcpScopes = ["openid", "profile", "email", "offline_access"]

export type Auth = ReturnType<typeof createAuth>

const isLoopbackRedirect = (uri: unknown) => {
  if (typeof uri !== "string") return false
  try {
    const url = new URL(uri)
    return url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
  } catch {
    return false
  }
}

// MCP clients such as Claude Code register http://localhost callbacks without
// `application_type`, which defaults to "web" and is rejected. Treat them as native apps.
const nativeLoopbackClients = createAuthMiddleware(async (ctx) => {
  if (ctx.path !== "/oauth2/register") return
  const body = ctx.body as { application_type?: string; redirect_uris?: unknown[] } | undefined
  const uris = body?.redirect_uris
  if (body && !body.application_type && uris?.length && uris.every(isLoopbackRedirect)) {
    return { context: { body: { ...body, application_type: "native" } } }
  }
})

// zup has one owner: the first account. Sign-up closes after it exists.
export function createAuth(config: Config, sqlite: Database) {
  return betterAuth({
    appName: "zup",
    baseURL: config.appOrigin,
    basePath: "/api/auth",
    secret: config.BETTER_AUTH_SECRET,
    database: sqlite,
    trustedOrigins: [config.appOrigin],
    disabledPaths: ["/token"],
    emailAndPassword: { enabled: true, minPasswordLength: 10 },
    session: {
      // CLI tokens are sessions too; using them keeps them alive.
      expiresIn: 60 * 60 * 24 * 60,
      updateAge: 60 * 60 * 24,
      // Off: listing your own sessions should not need a recent sign-in.
      freshAge: 0,
    },
    rateLimit: {
      enabled: true,
      window: 60,
      max: 100,
      customRules: {
        "/sign-in/*": { window: 60, max: 5 },
        "/sign-up/*": { window: 60, max: 3 },
        "/device/*": { window: 60, max: 30 },
        // Open to anyone (MCP clients register before login): keep it slow.
        "/oauth2/register": { window: 60, max: 3 },
      },
    },
    advanced: {
      // Set by the server from the resolved client IP (see clientIp.ts), never by the client.
      ipAddress: { ipAddressHeaders: [clientIpHeader] },
      useSecureCookies: config.appOrigin.startsWith("https:"),
    },
    hooks: { before: nativeLoopbackClients },
    databaseHooks: {
      user: {
        create: {
          before: async (user) => {
            if (hasOwner(sqlite)) throw new APIError("FORBIDDEN", { message: "Sign-up is closed" })
            return { data: user }
          },
        },
      },
    },
    plugins: [
      bearer(),
      deviceAuthorization({
        verificationUri: "/device",
        expiresIn: "10m",
        validateClient: (clientId) => clientId === cliClientId,
      }),
      passkey({
        rpID: new URL(config.appOrigin).hostname,
        rpName: "zup",
        origin: config.appOrigin,
      }),
      // Signs MCP access tokens. Sessions do not need a JWT header.
      jwt({ disableSettingJwtHeader: true }),
      mcp({
        loginPage: "/login",
        consentPage: "/consent",
        resource: `${config.appOrigin}/mcp`,
        scopes: mcpScopes,
        // Claude Code and most MCP clients still register themselves with DCR.
        allowDynamicClientRegistration: true,
        allowUnauthenticatedClientRegistration: true,
      }),
      cimd({ fetchClientMetadataResource, metadataProfile: "mcp-2026-07-28" }),
    ],
  })
}

// Creates or updates Better Auth tables. Runs at every start.
export async function migrateAuth(auth: Auth) {
  const { runMigrations } = await getMigrations(auth.options)
  await runMigrations()
}

export function hasOwner(sqlite: Database) {
  return sqlite.query("SELECT 1 FROM user LIMIT 1").get() !== null
}
