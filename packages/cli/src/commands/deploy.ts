import { formatBytes, inferEntrypoint, parseExpiry, slugSchema, toManifestPath } from "@zup/shared"
import {
  type AccessFlags,
  accessFromFlags,
  type IndexFlags,
  indexableFromFlags,
} from "../access.ts"
import { client, session, unwrap } from "../api.ts"
import { scan } from "../scan.ts"
import {
  accessBadge,
  bold,
  browserUrl,
  CliError,
  dim,
  green,
  info,
  openInBrowser,
  relativeTime,
  rows,
  warn,
} from "../ui.ts"
import { uploadMissing } from "../upload.ts"

export type DeployFlags = AccessFlags &
  IndexFlags & {
    title?: string
    slug?: string
    update?: boolean
    expires?: string
    entrypoint?: string
    spa?: boolean
    "no-spa"?: boolean
    "dry-run"?: boolean
    json?: boolean
    open?: boolean
    server?: string
  }

const slugInUse = (slug: string) =>
  new CliError(
    `Slug ${slug} is in use. To replace its files, pass --update.\n` +
      `  To keep them, first move the old site: zup slug ${slug} <new-slug>`,
  )

export async function deploy(inputs: string[], flags: DeployFlags) {
  const access = accessFromFlags(flags)
  const indexable = indexableFromFlags(flags)
  const { slug, update = false } = flags
  if (slug !== undefined) {
    const parsed = slugSchema.safeParse(slug)
    if (!parsed.success) throw new CliError(`--slug: ${parsed.error.issues[0]?.message}`)
  }
  if (update && !slug) throw new CliError("--update needs --slug")
  // Checked before upload: the server refuses search engines for sites that are not public.
  if (indexable && (access ? access.type !== "public" : !update)) {
    throw new CliError("--index needs --public")
  }
  const expiresAt = flags.expires ? parseExpiry(flags.expires).toISOString() : undefined
  const { files, name, skippedByGit } = await scan(inputs.length ? inputs : ["."])
  const entrypoint = flags.entrypoint ? toManifestPath(flags.entrypoint) : undefined
  if (entrypoint && !files.some((file) => file.path === entrypoint)) {
    throw new CliError(`Entrypoint ${flags.entrypoint} is not in the upload`)
  }
  const totalBytes = files.reduce((sum, file) => sum + file.size, 0)
  if (skippedByGit) info(dim(`${skippedByGit} file(s) skipped by .gitignore`))

  if (flags["dry-run"]) {
    for (const file of files) process.stdout.write(`${file.path}  ${dim(formatBytes(file.size))}\n`)
    const root = entrypoint ?? inferEntrypoint(files.map((file) => file.path))
    process.stdout.write(
      `\n${files.length} file(s), ${formatBytes(totalBytes)}. Root: ${root ?? "file listing"}\n`,
    )
    return
  }

  const current = await session(flags.server)
  const api = client(current)
  // Fails before the upload, so a used slug does not cost the upload time.
  if (slug && !update && (await api.sites[":slug"].$get({ param: { slug } })).ok) {
    throw slugInUse(slug)
  }
  if (!flags.json) info(dim(`${files.length} file(s), ${formatBytes(totalBytes)}`))
  const uploaded = await uploadMissing(current, api, files)
  if (!flags.json && files.length > uploaded.count) {
    info(dim(`${files.length - uploaded.count} file(s) already on the server`))
  }

  const { site, key, created } = await unwrap(
    api.sites.$post({
      json: {
        slug,
        update,
        // An update keeps the current title unless --title is given.
        title: flags.title ?? (update ? undefined : name),
        files: files.map(({ absolutePath: _, ...file }) => file),
        entrypoint,
        spa: flags["no-spa"] ? false : flags.spa,
        access,
        indexable,
        expiresAt,
        source: "cli",
      },
    }),
  )

  if (flags.json) {
    process.stdout.write(`${JSON.stringify({ site, key, created }, null, 2)}\n`)
    return
  }

  process.stdout.write(`\n${green("✓")} ${bold(created ? "Published" : "Updated")}  ${site.url}\n`)
  rows([
    ["Access", accessBadge(site.access)],
    ["Search engines", site.indexable ? "allowed" : null],
    ["Password", flags.password ? null : key?.key],
    ["Share link", key?.shareUrl],
    [
      "Expires",
      site.expiresAt &&
        `${relativeTime(site.expiresAt)} (${new Date(site.expiresAt).toLocaleString()})`,
    ],
  ])
  if (!created && !access && site.access === "password") {
    warn("The site kept its password. Pass --protect or --password to change it.")
  }
  if (key) info(dim("\nThe share link is shown only now. `zup share` makes a new one later."))
  if (flags.open) openInBrowser(browserUrl(current.server, site.url, site.access))
}
