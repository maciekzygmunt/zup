import type { Database } from "bun:sqlite"
import { zValidator } from "@hono/zod-validator"
import {
  accessTypes,
  aliasNameSchema,
  createDeploymentSchema,
  missingBlobsSchema,
  putAliasSchema,
  type ServerInfo,
  sha256Schema,
  shareLinkSchema,
  updateAliasSchema,
  updateDeploymentSchema,
} from "@zup/shared"
import { and, eq } from "drizzle-orm"
import { Hono } from "hono"
import { createMiddleware } from "hono/factory"
import { z } from "zod"
import { type Auth, hasOwner } from "../auth.ts"
import type { BlobStore } from "../blobs.ts"
import type { Config } from "../config.ts"
import type { Db } from "../db/client.ts"
import { deploymentFiles } from "../db/schema.ts"
import { HttpError } from "../errors.ts"
import type { SiteService } from "../sites.ts"

export const version = "1.0.0"

type Deps = {
  config: Config
  db: Db
  sqlite: Database
  auth: Auth
  blobs: BlobStore
  sites: SiteService
}

// Turns zod failures into the same `{ error, message }` shape as HttpError.
const validate = <T extends z.ZodType, Target extends "json" | "query" | "param">(
  target: Target,
  schema: T,
) =>
  zValidator(target, schema, (result, c) => {
    if (!result.success) {
      const issue = result.error.issues[0]
      const where = issue?.path.length ? `${issue.path.join(".")}: ` : ""
      return c.json({ error: "invalid_request", message: `${where}${issue?.message}` }, 400)
    }
  })

const nameParam = z.object({ name: aliasNameSchema })

export function createApiRoutes({ config, db, sqlite, auth, blobs, sites }: Deps) {
  // Every route below needs the owner's session: a dashboard cookie or a CLI bearer token.
  const requireOwner = createMiddleware<{ Variables: { session: Auth["$Infer"]["Session"] } }>(
    async (c, next) => {
      const session = await auth.api.getSession({ headers: c.req.raw.headers })
      if (!session) return c.json({ error: "unauthorized", message: "Log in first" }, 401)
      // Cookie-authenticated writes must come from the dashboard itself (CSRF).
      const usesCookie = !c.req.header("authorization")
      if (usesCookie && c.req.method !== "GET" && c.req.header("origin") !== config.appOrigin) {
        return c.json({ error: "forbidden", message: "Cross-origin request" }, 403)
      }
      c.set("session", session)
      await next()
    },
  )

  const info: ServerInfo = {
    appUrl: config.appOrigin,
    previewUrl: config.previewOrigin,
    version,
    limits: {
      maxFileBytes: config.MAX_FILE_BYTES,
      maxDeploymentBytes: config.MAX_DEPLOYMENT_BYTES,
      maxFiles: config.MAX_FILES,
    },
  }

  return (
    new Hono()
      .get("/info", (c) => c.json(info))
      .get("/setup", (c) => c.json({ needsSetup: !hasOwner(sqlite) }))
      .use(requireOwner)
      .get("/stats", async (c) => c.json(await sites.stats()))

      .post("/blobs/missing", validate("json", missingBlobsSchema), async (c) => {
        const missing: string[] = []
        for (const hash of new Set(c.req.valid("json").hashes)) {
          if ((await blobs.size(hash)) === null) missing.push(hash)
          else await blobs.touch(hash)
        }
        return c.json({ missing })
      })

      .put("/blobs/:hash", validate("param", z.object({ hash: sha256Schema })), async (c) => {
        const { hash } = c.req.valid("param")
        const declared = Number(c.req.header("content-length") ?? Number.NaN)
        if (declared > config.MAX_FILE_BYTES) {
          throw new HttpError(
            413,
            "file_too_large",
            `Files can be up to ${config.MAX_FILE_BYTES} bytes`,
          )
        }
        if ((await blobs.size(hash)) === null) {
          const body = c.req.raw.body ?? new Blob([]).stream()
          await blobs.write(hash, body, config.MAX_FILE_BYTES)
        }
        return c.body(null, 204)
      })

      .post("/deployments", validate("json", createDeploymentSchema), async (c) =>
        c.json(await sites.createDeployment(c.req.valid("json")), 201),
      )

      .get(
        "/deployments",
        validate(
          "query",
          z.object({
            q: z.string().trim().max(200).optional(),
            access: z.enum(accessTypes).optional(),
            limit: z.coerce.number().int().min(1).max(500).default(50),
            offset: z.coerce.number().int().min(0).default(0),
          }),
        ),
        async (c) => {
          const { q, ...options } = c.req.valid("query")
          return c.json(await sites.listDeployments({ query: q, ...options }))
        },
      )

      .get("/deployments/:id", async (c) => c.json(await sites.getDeployment(c.req.param("id"))))

      .patch("/deployments/:id", validate("json", updateDeploymentSchema), async (c) =>
        c.json(await sites.updateDeployment(c.req.param("id"), c.req.valid("json"))),
      )

      .delete("/deployments/:id", async (c) => {
        await sites.deleteDeployment(c.req.param("id"))
        return c.body(null, 204)
      })

      // Raw bytes of one file, used by `zup pull` and dashboard downloads.
      .get("/deployments/:id/files/*", async (c) => {
        const id = c.req.param("id")
        const prefix = `/api/deployments/${id}/files`
        let path: string
        try {
          path = decodeURIComponent(new URL(c.req.url).pathname.slice(prefix.length))
        } catch {
          throw new HttpError(400, "invalid_path", "Malformed path")
        }
        const file = await db.query.deploymentFiles.findFirst({
          where: and(eq(deploymentFiles.deploymentId, id), eq(deploymentFiles.path, path)),
        })
        if (!file) throw new HttpError(404, "file_not_found", `No file ${path}`)
        const name = encodeURIComponent(path.split("/").pop()!)
        return c.body(blobs.file(file.hash).stream(), 200, {
          "Content-Type": file.contentType,
          "Content-Length": String(file.size),
          "Content-Disposition": `attachment; filename*=UTF-8''${name}`,
          "Cache-Control": "private, no-store",
          "X-Content-SHA256": file.hash,
        })
      })

      .get("/aliases", async (c) => c.json({ aliases: await sites.listAliases() }))

      .put(
        "/aliases/:name",
        validate("param", nameParam),
        validate("json", putAliasSchema),
        async (c) => c.json(await sites.putAlias(c.req.valid("param").name, c.req.valid("json"))),
      )

      .patch(
        "/aliases/:name",
        validate("param", nameParam),
        validate("json", updateAliasSchema),
        async (c) =>
          c.json(await sites.updateAlias(c.req.valid("param").name, c.req.valid("json"))),
      )

      .delete("/aliases/:name", validate("param", nameParam), async (c) => {
        await sites.deleteAlias(c.req.valid("param").name)
        return c.body(null, 204)
      })

      .post("/share-links", validate("json", shareLinkSchema), async (c) =>
        c.json(await sites.shareLink(c.req.valid("json"))),
      )

      // Better Auth's /list-sessions returns raw tokens, which are login credentials.
      // These routes expose only metadata and revoke by id.
      .get("/sessions", async (c) => {
        const { session, user } = c.get("session")
        const { internalAdapter } = await auth.$context
        const sessions = await internalAdapter.listSessions(user.id, { onlyActiveSessions: true })
        return c.json({
          sessions: sessions.map(({ id, userAgent, ipAddress, createdAt, updatedAt }) => ({
            id,
            userAgent,
            ipAddress,
            createdAt,
            updatedAt,
            current: id === session.id,
          })),
        })
      })

      .delete("/sessions/:id", async (c) => {
        const { user } = c.get("session")
        const { internalAdapter } = await auth.$context
        const sessions = await internalAdapter.listSessions(user.id)
        const target = sessions.find((s) => s.id === c.req.param("id"))
        if (!target) throw new HttpError(404, "session_not_found", "No such session")
        await internalAdapter.deleteSession(target.token)
        return c.body(null, 204)
      })
  )
}

export type ApiRoutes = ReturnType<typeof createApiRoutes>
