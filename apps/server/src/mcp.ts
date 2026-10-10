import { requireMcpAuth } from "@better-auth/mcp"
import { createMcpHandler, McpServer } from "@modelcontextprotocol/server"
import {
  type AccessInput,
  accessTypes,
  aliasNameSchema,
  contentTypeFor,
  createDeploymentSchema,
  generateKey,
  isTextContentType,
  parseExpiry,
  toManifestPath,
} from "@zup/shared"
import { z } from "zod"
import type { Auth } from "./auth.ts"
import type { BlobStore } from "./blobs.ts"
import type { Config } from "./config.ts"
import { HttpError } from "./errors.ts"
import type { SiteService } from "./sites.ts"

type Deps = { config: Config; auth: Auth; blobs: BlobStore; sites: SiteService }

const accessField = z
  .enum(accessTypes)
  .describe(
    "private: only the owner. public: anyone with the URL. password: anyone with a generated password (returned once, with a share link).",
  )

const expiryField = z
  .string()
  .describe('Expiry as a duration ("30m", "12h", "7d", "2w") or an ISO date')

const text = (value: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }],
})

// Runs a tool body and reports service errors to the model instead of failing the call.
async function run(body: () => Promise<unknown>) {
  try {
    return text(await body())
  } catch (error) {
    const message =
      error instanceof z.ZodError
        ? z.prettifyError(error)
        : error instanceof HttpError || error instanceof Error
          ? error.message
          : String(error)
    return { ...text({ error: message }), isError: true }
  }
}

// The model never picks passwords: generated keys are strong and returned only once.
const toAccess = (access: (typeof accessTypes)[number]): AccessInput =>
  access === "password" ? { type: access, password: generateKey() } : { type: access }

// Stateless Streamable HTTP MCP endpoint at /mcp, protected by OAuth access tokens.
export function createMcpEndpoint({ config, auth, blobs, sites }: Deps) {
  const handler = createMcpHandler(
    () => {
      const server = new McpServer({ name: "zup", version: "1.0.0" })

      server.registerTool(
        "deploy_site",
        {
          title: "Publish files",
          description:
            "Publish files (an HTML page, a static website, Markdown, images, any static file) and get a URL. " +
            "With an alias, the site and the alias share one password. " +
            "Paths are relative, e.g. index.html or assets/app.js. A single HTML or Markdown file is served at the root. " +
            "Use base64 encoding for binary files. Sites are private unless access says otherwise.",
          inputSchema: z.object({
            files: z
              .array(
                z.object({
                  path: z.string().min(1),
                  content: z.string(),
                  encoding: z.enum(["utf8", "base64"]).default("utf8"),
                  contentType: z.string().optional(),
                }),
              )
              .min(1)
              .max(2000),
            title: z.string().max(200).optional(),
            access: accessField.default("private"),
            alias: aliasNameSchema
              .optional()
              .describe(
                "Stable name: the site is also served at <preview-url>/<alias>/. Moves the alias if it exists.",
              ),
            entrypoint: z
              .string()
              .optional()
              .describe("File served at the root. Inferred when omitted."),
            spa: z
              .boolean()
              .optional()
              .describe("Serve the entrypoint for unknown extensionless paths"),
            expires: expiryField.optional(),
          }),
        },
        (input) =>
          run(async () => {
            const uploads = input.files.map((file) => {
              const bytes =
                file.encoding === "base64"
                  ? Buffer.from(file.content, "base64")
                  : Buffer.from(file.content, "utf8")
              const hash = new Bun.CryptoHasher("sha256").update(bytes).digest("hex")
              const path = toManifestPath(file.path)
              const contentType = file.contentType ?? contentTypeFor(path)
              return { bytes, file: { path, hash, size: bytes.byteLength, contentType } }
            })
            // Same checks as the REST API: paths and content types come from the model.
            const access = toAccess(input.access)
            const deploymentInput = createDeploymentSchema.parse({
              title: input.title,
              files: uploads.map((upload) => upload.file),
              entrypoint: input.entrypoint ? toManifestPath(input.entrypoint) : undefined,
              spa: input.spa,
              access,
              expiresAt: input.expires ? parseExpiry(input.expires).toISOString() : undefined,
              source: "mcp",
            })
            for (const { bytes, file } of uploads) {
              if ((await blobs.size(file.hash)) === null) {
                await blobs.write(file.hash, new Blob([bytes]).stream(), config.MAX_FILE_BYTES)
              }
            }
            const { deployment, key } = await sites.createDeployment(deploymentInput)
            const alias = input.alias
              ? await sites.putAlias(input.alias, {
                  deploymentId: deployment.id,
                  access,
                  mode: "upsert",
                })
              : undefined
            return {
              url: deployment.url,
              id: deployment.id,
              access: deployment.access,
              password: key?.key,
              shareUrl: key?.shareUrl,
              alias: alias && { url: alias.alias.url, shareUrl: alias.key?.shareUrl },
              expiresAt: deployment.expiresAt,
            }
          }),
      )

      server.registerTool(
        "list_sites",
        {
          title: "List sites",
          description:
            "List published sites, newest first. Optionally search by title, id or alias.",
          inputSchema: z.object({
            query: z.string().optional(),
            limit: z.number().int().min(1).max(200).default(30),
          }),
          annotations: { readOnlyHint: true },
        },
        ({ query, limit }) => run(() => sites.listDeployments({ query, limit, offset: 0 })),
      )

      server.registerTool(
        "get_site",
        {
          title: "Get site",
          description: "Details and the file list of one deployment.",
          inputSchema: z.object({ id: z.string() }),
          annotations: { readOnlyHint: true },
        },
        ({ id }) => run(() => sites.getDeployment(id)),
      )

      server.registerTool(
        "read_site_file",
        {
          title: "Read a file",
          description: "Read one text file of a deployment (up to 1 MiB).",
          inputSchema: z.object({ id: z.string(), path: z.string() }),
          annotations: { readOnlyHint: true },
        },
        ({ id, path }) =>
          run(async () => {
            const detail = await sites.getDeployment(id)
            const file = detail.files.find((f) => f.path === toManifestPath(path))
            if (!file) throw new HttpError(404, "file_not_found", `No file ${path}`)
            if (!isTextContentType(file.contentType) || file.size > 1024 * 1024) {
              return { ...file, content: null, note: "Binary or too large to show" }
            }
            return { ...file, content: await blobs.file(file.hash).text() }
          }),
      )

      server.registerTool(
        "update_site",
        {
          title: "Update site",
          description:
            "Change title, access or expiry of a deployment. Setting access to password generates a new password.",
          inputSchema: z.object({
            id: z.string(),
            title: z.string().max(200).optional(),
            access: accessField.optional(),
            expires: expiryField.or(z.literal("never")).optional(),
          }),
        },
        ({ id, title, access, expires }) =>
          run(() =>
            sites.updateDeployment(id, {
              title,
              access: access && toAccess(access),
              expiresAt:
                expires === undefined
                  ? undefined
                  : expires === "never"
                    ? null
                    : parseExpiry(expires).toISOString(),
            }),
          ),
      )

      server.registerTool(
        "delete_site",
        {
          title: "Delete site",
          description: "Delete a deployment and every alias that points to it.",
          inputSchema: z.object({ id: z.string() }),
          annotations: { destructiveHint: true },
        },
        ({ id }) =>
          run(async () => {
            await sites.deleteDeployment(id)
            return { deleted: id }
          }),
      )

      server.registerTool(
        "list_aliases",
        {
          title: "List aliases",
          description: "List stable alias names and the deployments they point to.",
          inputSchema: z.object({}),
          annotations: { readOnlyHint: true },
        },
        () => run(() => sites.listAliases()),
      )

      server.registerTool(
        "set_alias",
        {
          title: "Set alias",
          description:
            "Point an alias at a deployment (creates or moves it). Without access, a moved alias keeps its access and password.",
          inputSchema: z.object({
            name: aliasNameSchema,
            deploymentId: z.string(),
            access: accessField.optional(),
          }),
        },
        ({ name, deploymentId, access }) =>
          run(() =>
            sites.putAlias(name, {
              deploymentId,
              access: access && toAccess(access),
              mode: "upsert",
            }),
          ),
      )

      server.registerTool(
        "delete_alias",
        {
          title: "Delete alias",
          description: "Delete an alias. The deployment stays.",
          inputSchema: z.object({ name: aliasNameSchema }),
          annotations: { destructiveHint: true },
        },
        ({ name }) =>
          run(async () => {
            await sites.deleteAlias(name)
            return { deleted: name }
          }),
      )

      server.registerTool(
        "get_share_link",
        {
          title: "Get share link",
          description:
            "Get a link that opens a password-protected deployment or alias without typing the password.",
          inputSchema: z.object({
            deploymentId: z.string().optional(),
            alias: aliasNameSchema.optional(),
          }),
          annotations: { readOnlyHint: true },
        },
        ({ deploymentId, alias }) =>
          run(() => {
            if (alias) return sites.shareLink({ alias })
            if (deploymentId) return sites.shareLink({ deploymentId })
            throw new HttpError(400, "invalid_request", "Pass deploymentId or alias")
          }),
      )

      return server
    },
    { maxRequestBodySize: config.MCP_MAX_BODY_BYTES },
  )

  return requireMcpAuth(auth, (request) => handler.fetch(request), {
    resource: `${config.appOrigin}/mcp`,
  })
}
