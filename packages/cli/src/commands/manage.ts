import { accessTypes, formatBytes, parseExpiry, slugSchema } from "@zup/shared"
import { z } from "zod"
import {
  type AccessFlags,
  accessFromFlags,
  type IndexFlags,
  indexableFromFlags,
} from "../access.ts"
import { client, session, unwrap } from "../api.ts"
import { siteSlug } from "../target.ts"
import {
  accessBadge,
  bold,
  browserUrl,
  CliError,
  confirm,
  dim,
  green,
  info,
  interactive,
  openInBrowser,
  relativeTime,
  rows,
} from "../ui.ts"

type Common = { server?: string; json?: boolean }

const printJson = (value: unknown) => process.stdout.write(`${JSON.stringify(value, null, 2)}\n`)

async function connect(flags: Common) {
  const current = await session(flags.server)
  return { current, api: client(current) }
}

// Connects and resolves a slug or site URL.
async function connectTo(input: string, flags: Common) {
  const { current, api } = await connect(flags)
  return { current, api, slug: siteSlug(current, input) }
}

export async function list(
  query: string | undefined,
  flags: Common & { access?: string; limit?: string },
) {
  const { api } = await connect(flags)
  const access = z.enum(accessTypes).optional().parse(flags.access)
  const result = await unwrap(
    api.sites.$get({ query: { q: query, access, limit: flags.limit ?? "30" } }),
  )
  if (flags.json) return printJson(result)
  if (!result.sites.length) return info(query ? "No matches" : "Nothing published yet")
  for (const site of result.sites) {
    const expiry = site.expiresAt ? dim(` · expires ${relativeTime(site.expiresAt)}`) : ""
    process.stdout.write(
      `${accessBadge(site.access)}${" ".repeat(9 - site.access.length)}${bold(site.title ?? site.slug)}\n` +
        `${" ".repeat(9)}${dim(`${site.url} · ${relativeTime(site.updatedAt)} · ${site.fileCount} file(s), ${formatBytes(site.totalBytes)}`)}${expiry}\n`,
    )
  }
  if (result.total > result.sites.length) {
    info(dim(`Showing ${result.sites.length} of ${result.total}. Use --limit or a search.`))
  }
}

export async function show(input: string, flags: Common) {
  const { api, slug } = await connectTo(input, flags)
  const detail = await unwrap(api.sites[":slug"].$get({ param: { slug } }))
  if (flags.json) return printJson(detail)
  process.stdout.write(`${bold(detail.title ?? detail.slug)}\n`)
  rows([
    ["URL", detail.url],
    ["Access", accessBadge(detail.access)],
    ["Search engines", detail.access === "public" && detail.indexable ? "allowed" : null],
    ["Root", detail.entrypoint ?? "file listing"],
    ["Created", new Date(detail.createdAt).toLocaleString()],
    ["Updated", new Date(detail.updatedAt).toLocaleString()],
    ["Expires", detail.expiresAt && new Date(detail.expiresAt).toLocaleString()],
    ["Files", `${detail.fileCount}, ${formatBytes(detail.totalBytes)}`],
    ["Source", `${detail.url}_src/`],
  ])
  process.stdout.write("\n")
  for (const file of detail.files) {
    process.stdout.write(`  ${file.path}  ${dim(formatBytes(file.size))}\n`)
  }
}

export async function open(input: string, flags: Common) {
  const { current, api, slug } = await connectTo(input, flags)
  const { url, access } = await unwrap(api.sites[":slug"].$get({ param: { slug } }))
  openInBrowser(browserUrl(current.server, url, access))
  info(url)
}

// Changes the slug, and with it the URL. The old URL stops working.
export async function setSlug(input: string, newSlug: string, flags: Common) {
  const parsed = slugSchema.safeParse(newSlug)
  if (!parsed.success) throw new CliError(`${newSlug}: ${parsed.error.issues[0]?.message}`)
  const { api, slug } = await connectTo(input, flags)
  const result = await unwrap(
    api.sites[":slug"].$patch({ param: { slug }, json: { slug: newSlug } }),
  )
  if (flags.json) return printJson(result)
  info(`${green("✓")} ${slug} is now ${result.site.url}`)
}

export async function setAccess(input: string, flags: Common & AccessFlags & IndexFlags) {
  const access = accessFromFlags(flags)
  const indexable = indexableFromFlags(flags)
  if (!access && indexable === undefined) {
    throw new CliError(
      "Pass --public, --private, --protect, --password <key>, --index or --no-index",
    )
  }
  const { api, slug } = await connectTo(input, flags)
  const result = await unwrap(
    api.sites[":slug"].$patch({ param: { slug }, json: { access, indexable } }),
  )
  if (flags.json) return printJson(result)
  const { site, key } = result
  info(`${green("✓")} ${slug} is now ${accessBadge(site.access)}`)
  rows([
    ["Search engines", site.access === "public" ? (site.indexable ? "allowed" : "blocked") : null],
    ["Password", flags.password ? null : key?.key],
    ["Share link", key?.shareUrl],
  ])
}

export async function expire(input: string, when: string, flags: Common) {
  const expiresAt = when === "never" ? null : parseExpiry(when).toISOString()
  const { api, slug } = await connectTo(input, flags)
  await unwrap(api.sites[":slug"].$patch({ param: { slug }, json: { expiresAt } }))
  info(
    `${green("✓")} ${slug} ${expiresAt ? `expires ${relativeTime(expiresAt)}` : "never expires"}`,
  )
}

export async function rename(input: string, title: string, flags: Common) {
  const { api, slug } = await connectTo(input, flags)
  await unwrap(api.sites[":slug"].$patch({ param: { slug }, json: { title } }))
  info(`${green("✓")} Renamed ${slug}`)
}

export async function share(input: string, flags: Common) {
  const { api, slug } = await connectTo(input, flags)
  const result = await unwrap(api.sites[":slug"]["share-link"].$post({ param: { slug } }))
  if (flags.json) return printJson(result)
  process.stdout.write(`${result.shareUrl}\n`)
}

export async function remove(inputs: string[], flags: Common & { yes?: boolean }) {
  const { current, api } = await connect(flags)
  const slugs = inputs.map((input) => siteSlug(current, input))
  if (!flags.yes) {
    if (!interactive) throw new CliError("Pass --yes to delete without a prompt")
    if (!(await confirm(`Delete ${slugs.join(", ")}?`))) return info("Nothing deleted")
  }
  for (const slug of slugs) {
    await unwrap(api.sites[":slug"].$delete({ param: { slug } }))
    info(`${green("✓")} Deleted ${slug}`)
  }
}
