import { existsSync } from "node:fs"
import { join } from "node:path"
import { type Context, Hono } from "hono"
import { bodyLimit } from "hono/body-limit"
import { serveStatic } from "hono/bun"
import { secureHeaders } from "hono/secure-headers"
import { createApiRoutes } from "./api/routes.ts"
import { clientIpHeader, createAuth, migrateAuth } from "./auth.ts"
import { createBlobStore } from "./blobs.ts"
import { type RequestEnv, resolveClientIp } from "./clientIp.ts"
import type { Config } from "./config.ts"
import { openDatabase } from "./db/client.ts"
import { HttpError } from "./errors.ts"
import { createMcpEndpoint } from "./mcp.ts"
import { createPreviewApp } from "./preview/app.ts"
import { createOwnerSessions, safePath } from "./preview/owner.ts"
import { createSiteService } from "./sites.ts"

export type { ApiRoutes } from "./api/routes.ts"

const installScript = (server: string) => `#!/bin/sh
set -eu
SERVER="${server}"
if ! command -v node >/dev/null 2>&1; then
  echo "zup needs Node.js 20 or newer: https://nodejs.org" >&2
  exit 1
fi
DIR="$HOME/.local/share/zup"
BIN="$HOME/.local/bin"
mkdir -p "$DIR" "$BIN"
curl -fsSL "$SERVER/cli/zup.mjs" -o "$DIR/zup.mjs.tmp"
mv "$DIR/zup.mjs.tmp" "$DIR/zup.mjs"
chmod +x "$DIR/zup.mjs"
ln -sf "$DIR/zup.mjs" "$BIN/zup"
echo "Installed zup to $BIN/zup"
case ":$PATH:" in
  *":$BIN:"*) ;;
  *) echo 'Add ~/.local/bin to your PATH: export PATH="$HOME/.local/bin:$PATH"' ;;
esac
echo "Next: zup login $SERVER"
`

// Builds both hosts: the dashboard/API host (APP_URL) and the site host (PREVIEW_URL).
export async function createServer(config: Config) {
  const { db, sqlite } = openDatabase(config.dataDir, config.MIGRATIONS_DIR)
  const auth = createAuth(config, sqlite)
  await migrateAuth(auth)
  const blobs = createBlobStore(config.dataDir)
  const sites = createSiteService({ config, db, blobs })
  const owners = createOwnerSessions(config, auth)

  const app = new Hono<{ Bindings: RequestEnv }>()
  app.get("/healthz", (c) => c.text("ok"))

  // Better Auth reads the client IP from a header, so hand it the resolved one.
  const authRequest = (c: Context<{ Bindings: RequestEnv }>) => {
    const headers = new Headers(c.req.raw.headers)
    headers.delete(clientIpHeader)
    if (c.env.clientIp) headers.set(clientIpHeader, c.env.clientIp)
    return new Request(c.req.raw, { headers })
  }

  // File content goes to PUT /api/blobs (streamed, own limit) and /mcp (own limit).
  const tooLarge = (c: Context) =>
    c.json({ error: "body_too_large", message: "Request body is too large" }, 413)
  app.use("/api/auth/*", bodyLimit({ maxSize: 1024 * 1024, onError: tooLarge }))
  app.use("/api/*", async (c, next) => {
    if (c.req.method === "PUT" && c.req.path.startsWith("/api/blobs/")) return next()
    return bodyLimit({ maxSize: 32 * 1024 * 1024, onError: tooLarge })(c, next)
  })

  app.on(["GET", "POST"], "/api/auth/*", (c) => auth.handler(authRequest(c)))
  app.get("/.well-known/*", (c) => auth.handler(c.req.raw))
  const mcp = createMcpEndpoint({ config, auth, blobs, sites })
  app.all("/mcp", (c) => mcp(c.req.raw))

  // Gives the preview host a cookie for the logged-in owner (see preview/owner.ts).
  app.get("/api/preview-session", async (c) => {
    const next = safePath(c.req.query("next"))
    const session = await auth.api.getSession({ headers: c.req.raw.headers })
    if (!session) {
      const back = `/api/preview-session?next=${encodeURIComponent(next)}`
      return c.redirect(`/login?redirect=${encodeURIComponent(back)}`)
    }
    const token = owners.createHandoff(session.session.id)
    return c.redirect(
      `${config.previewOrigin}/_zup/callback?token=${encodeURIComponent(token)}&next=${encodeURIComponent(next)}`,
    )
  })

  // CLI install: `curl -fsSL <APP_URL>/install.sh | sh` puts the bundled CLI on PATH.
  app.get("/cli/zup.mjs", (c) => {
    if (!existsSync(config.CLI_DIST)) return c.text("CLI is not built", 503)
    return c.body(Bun.file(config.CLI_DIST).stream(), 200, {
      "Content-Type": "text/javascript; charset=utf-8",
      "Cache-Control": "no-cache",
    })
  })
  app.get("/install.sh", (c) =>
    c.body(installScript(config.appOrigin), 200, {
      "Content-Type": "text/x-shellscript; charset=utf-8",
      "Cache-Control": "no-cache",
    }),
  )

  app.route("/api", createApiRoutes({ config, sqlite, auth, blobs, sites }))
  app.all("/api/*", (c) => c.json({ error: "not_found", message: "No such endpoint" }, 404))

  app.onError((error, c) => {
    if (error instanceof HttpError) {
      return c.json({ error: error.code, message: error.message }, error.status)
    }
    console.error(error)
    return c.json({ error: "internal_error", message: "Something went wrong" }, 500)
  })

  // Dashboard single-page app.
  const indexHtml = join(config.WEB_DIST, "index.html")
  app.use(
    "*",
    secureHeaders({
      contentSecurityPolicy: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", "data:", "blob:"],
        connectSrc: ["'self'"],
        frameAncestors: ["'none'"],
        baseUri: ["'none'"],
        formAction: ["'self'"],
      },
      referrerPolicy: "same-origin",
    }),
  )
  app.use(
    "/assets/*",
    serveStatic({
      root: config.WEB_DIST,
      onFound: (_path, c) => {
        c.header("Cache-Control", "public, max-age=31536000, immutable")
      },
    }),
  )
  app.use("*", serveStatic({ root: config.WEB_DIST }))
  app.get("*", async (c) => {
    if (!existsSync(indexHtml)) return c.text("Dashboard is not built. Run `bun run build`.", 503)
    return c.html(await Bun.file(indexHtml).text(), 200, { "Cache-Control": "no-cache" })
  })

  const preview = createPreviewApp({ config, db, blobs, owners })

  // Background cleanup: expired sites, then content no site uses.
  async function cleanup() {
    try {
      const expired = await sites.purgeExpired()
      const removed = await sites.collectGarbage()
      if (expired || removed) console.log(`cleanup: ${expired} expired, ${removed} blobs removed`)
    } catch (error) {
      console.error("cleanup failed", error)
    }
  }

  return {
    sites,
    cleanup,
    fetch(request: Request, socketIp?: string) {
      const host = request.headers.get("host")
      const env: RequestEnv = {
        clientIp: resolveClientIp(request.headers, config.CLIENT_IP_HEADER, socketIp),
      }
      return host === config.previewHost ? preview.fetch(request, env) : app.fetch(request, env)
    },
    close: () => sqlite.close(),
  }
}
