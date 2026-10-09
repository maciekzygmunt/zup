import {
  type AccessInput,
  formatBytes,
  inferEntrypoint,
  parseExpiry,
  toManifestPath,
} from "@zup/shared"
import { type AccessFlags, accessFromFlags } from "../access.ts"
import { client, session, unwrap } from "../api.ts"
import { scan } from "../scan.ts"
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
  warn,
} from "../ui.ts"
import { uploadMissing } from "../upload.ts"

export type DeployFlags = AccessFlags & {
  title?: string
  alias?: string
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

export async function deploy(inputs: string[], flags: DeployFlags) {
  const access = accessFromFlags(flags)
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
  if (!flags.json) info(dim(`${files.length} file(s), ${formatBytes(totalBytes)}`))
  const uploaded = await uploadMissing(current, api, files)
  if (!flags.json && files.length > uploaded.count) {
    info(dim(`${files.length - uploaded.count} file(s) already on the server`))
  }

  const { deployment, key } = await unwrap(
    api.deployments.$post({
      json: {
        title: flags.title ?? name,
        files: files.map(({ absolutePath: _, ...file }) => file),
        entrypoint,
        spa: flags["no-spa"] ? false : flags.spa,
        access: access ?? { type: "private" },
        expiresAt,
        source: "cli",
      },
    }),
  )

  const alias = flags.alias ? await claimAlias(flags, deployment.id, access) : undefined

  if (flags.json) {
    process.stdout.write(`${JSON.stringify({ deployment, key, alias }, null, 2)}\n`)
    return
  }

  const password = access?.type === "password" && !flags.password ? access.password : null
  const shareUrl = (alias?.key ?? key)?.shareUrl
  process.stdout.write(`\n${green("✓")} ${bold("Published")}  ${deployment.url}\n`)
  rows([
    ["Alias", alias?.alias.url],
    ["Access", accessBadge(alias?.alias.access ?? deployment.access)],
    ["Password", password],
    ["Share link", shareUrl],
    [
      "Expires",
      deployment.expiresAt &&
        `${relativeTime(deployment.expiresAt)} (${new Date(deployment.expiresAt).toLocaleString()})`,
    ],
  ])
  if (alias && !alias.created && !access && alias.alias.access === "password") {
    warn("The alias kept its existing password. Pass --protect or --password to change it.")
  }
  if (shareUrl) info(dim("\nThe share link is shown only now. `zup share` makes a new one later."))
  if (flags.open) {
    const target = alias?.alias ?? deployment
    openInBrowser(browserUrl(current.server, target.url, target.access))
  }

  async function claimAlias(flags: DeployFlags, deploymentId: string, access?: AccessInput) {
    const name = flags.alias!
    const put = (mode: "create" | "upsert") =>
      api.aliases[":name"].$put({ param: { name }, json: { deploymentId, access, mode } })
    const created = await put("create")
    if (created.status !== 409) return unwrap(created)
    const move =
      flags.update ||
      (interactive &&
        (await confirm(`Alias ${bold(name)} already exists. Move it to this deployment?`)))
    if (!move) {
      warn(`Alias ${name} was not changed. Pass --update to move it.`)
      return undefined
    }
    return unwrap(put("upsert"))
  }
}
