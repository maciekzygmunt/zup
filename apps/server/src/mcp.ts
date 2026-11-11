import { requireMcpAuth } from "@better-auth/mcp"
import { createMcpHandler, McpServer } from "@modelcontextprotocol/server"
import {
  type AccessInput,
  accessTypes,
  contentTypeFor,
  createSiteSchema,
  generateKey,
  isTextContentType,
  parseExpiry,
  slugSchema,
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

const indexableField = z
  .boolean()
  .describe(
    "Let search engines crawl the site. Only for public sites. Omitted keeps the current value (off for a new site).",
  )

const slugField = slugSchema.describe("The site's name in its URL: <preview-url>/<slug>/")

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
            "Paths are relative, e.g. index.html or assets/app.js. A single HTML or Markdown file is served at the root. " +
            "Use base64 encoding for binary files. " +
            "A slug that is in use fails unless update is true; update replaces all files of that site and deletes the old ones.",
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
            slug: slugField.optional().describe("URL name. Omitted: a random one."),
            update: z
              .boolean()
              .default(false)
              .describe("Replace the files of the existing site at slug. Needs slug."),
            title: z.string().max(200).optional(),
            access: accessField
              .optional()
              .describe("Omitted: private for a new site, unchanged on update."),
            indexable: indexableField.optional(),
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
            const siteInput = createSiteSchema.parse({
              slug: input.slug,
              update: input.update,
              title: input.title,
              files: uploads.map((upload) => upload.file),
              entrypoint: input.entrypoint ? toManifestPath(input.entrypoint) : undefined,
              spa: input.spa,
              access: input.access && toAccess(input.access),
              indexable: input.indexable,
              expiresAt: input.expires ? parseExpiry(input.expires).toISOString() : undefined,
              source: "mcp",
            })
            for (const { bytes, file } of uploads) {
              if ((await blobs.size(file.hash)) === null) {
                await blobs.write(file.hash, new Blob([bytes]).stream(), config.MAX_FILE_BYTES)
              }
            }
            const { site, key, created } = await sites.createSite(siteInput)
            return {
              url: site.url,
              slug: site.slug,
              replaced: !created,
              access: site.access,
              indexable: site.indexable,
              password: key?.key,
              shareUrl: key?.shareUrl,
              expiresAt: site.expiresAt,
            }
          }),
      )

      server.registerTool(
        "list_sites",
        {
          title: "List sites",
          description:
            "List published sites, last changed first. Optionally search by title or slug.",
          inputSchema: z.object({
            query: z.string().optional(),
            limit: z.number().int().min(1).max(200).default(30),
          }),
          annotations: { readOnlyHint: true },
        },
        ({ query, limit }) => run(() => sites.listSites({ query, limit, offset: 0 })),
      )

      server.registerTool(
        "get_site",
        {
          title: "Get site",
          description: "Details and the file list of one site.",
          inputSchema: z.object({ slug: slugField }),
          annotations: { readOnlyHint: true },
        },
        ({ slug }) => run(() => sites.getSite(slug)),
      )

      server.registerTool(
        "read_site_file",
        {
          title: "Read a file",
          description: "Read one text file of a site (up to 1 MiB).",
          inputSchema: z.object({ slug: slugField, path: z.string() }),
          annotations: { readOnlyHint: true },
        },
        ({ slug, path }) =>
          run(async () => {
            const detail = await sites.getSite(slug)
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
            "Change the slug, title, access, search engine access or expiry of a site. " +
            "A new slug changes the URL and the old URL stops working. " +
            "Setting access to password generates a new password. Access other than public turns indexable off.",
          inputSchema: z.object({
            slug: slugField,
            newSlug: slugField.optional(),
            title: z.string().max(200).optional(),
            access: accessField.optional(),
            indexable: indexableField.optional(),
            expires: expiryField.or(z.literal("never")).optional(),
          }),
        },
        ({ slug, newSlug, title, access, indexable, expires }) =>
          run(() =>
            sites.updateSite(slug, {
              slug: newSlug,
              title,
              access: access && toAccess(access),
              indexable,
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
          description: "Delete a site and its files.",
          inputSchema: z.object({ slug: slugField }),
          annotations: { destructiveHint: true },
        },
        ({ slug }) =>
          run(async () => {
            await sites.deleteSite(slug)
            return { deleted: slug }
          }),
      )

      server.registerTool(
        "get_share_link",
        {
          title: "Get share link",
          description:
            "Get a link that opens a password-protected site without typing the password.",
          inputSchema: z.object({ slug: slugField }),
          annotations: { readOnlyHint: true },
        },
        ({ slug }) => run(() => sites.shareLink(slug)),
      )

      return server
    },
    { maxRequestBodySize: config.MCP_MAX_BODY_BYTES },
  )

  return requireMcpAuth(auth, (request) => handler.fetch(request), {
    resource: `${config.appOrigin}/mcp`,
  })
}
