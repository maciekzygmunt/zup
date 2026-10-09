import { accessTypes, formatBytes, parseExpiry } from "@zup/shared"
import { z } from "zod"
import { type AccessFlags, accessFromFlags } from "../access.ts"
import { type Client, client, session, unwrap } from "../api.ts"
import { deploymentIdOf, describe, resolveTarget, type Target } from "../target.ts"
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

export async function list(
  query: string | undefined,
  flags: Common & { access?: string; limit?: string },
) {
  const { api } = await connect(flags)
  const access = z.enum(accessTypes).optional().parse(flags.access)
  const result = await unwrap(
    api.deployments.$get({ query: { q: query, access, limit: flags.limit ?? "30" } }),
  )
  if (flags.json) return printJson(result)
  if (!result.deployments.length) return info(query ? "No matches" : "Nothing published yet")
  for (const deployment of result.deployments) {
    const aliases = deployment.aliases.map((alias) => bold(`/${alias.name}`)).join(" ")
    const expiry = deployment.expiresAt
      ? dim(` · expires ${relativeTime(deployment.expiresAt)}`)
      : ""
    process.stdout.write(
      `${dim(deployment.id)}  ${accessBadge(deployment.access)}${" ".repeat(9 - deployment.access.length)}${deployment.title ?? ""} ${aliases}\n` +
        `${" ".repeat(27)}${dim(`${relativeTime(deployment.createdAt)} · ${deployment.fileCount} file(s), ${formatBytes(deployment.totalBytes)}`)}${expiry}\n`,
    )
  }
  if (result.total > result.deployments.length) {
    info(dim(`Showing ${result.deployments.length} of ${result.total}. Use --limit or a search.`))
  }
}

export async function show(input: string, flags: Common) {
  const { current, api } = await connect(flags)
  const target = await resolveTarget(current, api, input)
  const detail = await unwrap(
    api.deployments[":id"].$get({ param: { id: await deploymentIdOf(api, target) } }),
  )
  if (flags.json) return printJson(detail)
  process.stdout.write(`${bold(detail.title ?? detail.id)}\n`)
  rows([
    ["URL", detail.url],
    ...detail.aliases.map((alias): [string, string] => [
      "Alias",
      `${alias.url} ${dim(`(${alias.access})`)}`,
    ]),
    ["Access", accessBadge(detail.access)],
    ["Root", detail.entrypoint ?? "file listing"],
    ["Created", new Date(detail.createdAt).toLocaleString()],
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
  const { current, api } = await connect(flags)
  const target = await resolveTarget(current, api, input)
  const { url, access } = await currentAccess(api, target)
  openInBrowser(browserUrl(current.server, url, access))
  info(url)
}

async function currentAccess(api: Client, target: Target) {
  if (target.kind === "alias") {
    const { aliases } = await unwrap(api.aliases.$get())
    return aliases.find((alias) => alias.name === target.name)!
  }
  return unwrap(api.deployments[":id"].$get({ param: { id: target.id } }))
}

export async function alias(
  input: string,
  name: string,
  flags: Common & AccessFlags & { update?: boolean },
) {
  const { current, api } = await connect(flags)
  const target = await resolveTarget(current, api, input)
  const deploymentId = await deploymentIdOf(api, target)
  const access = accessFromFlags(flags)
  const put = (mode: "create" | "upsert") =>
    api.aliases[":name"].$put({ param: { name }, json: { deploymentId, access, mode } })
  let response = await put("create")
  if (response.status === 409) {
    const move =
      flags.update || (interactive && (await confirm(`Alias ${bold(name)} exists. Move it?`)))
    if (!move) throw new CliError(`Alias ${name} exists. Pass --update to move it.`)
    response = await put("upsert")
  }
  const result = await unwrap(response)
  if (flags.json) return printJson(result)
  process.stdout.write(`${green("✓")} ${result.alias.url} → ${deploymentId}\n`)
  rows([
    ["Access", accessBadge(result.alias.access)],
    ["Password", access?.type === "password" && !flags.password ? access.password : null],
    ["Share link", result.key?.shareUrl],
  ])
}

export async function unalias(name: string, flags: Common) {
  const { api } = await connect(flags)
  await unwrap(api.aliases[":name"].$delete({ param: { name } }))
  info(`${green("✓")} Deleted alias ${name}`)
}

export async function setAccess(input: string, flags: Common & AccessFlags) {
  const access = accessFromFlags(flags)
  if (!access) throw new CliError("Pass --public, --private, --protect or --password <key>")
  const { current, api } = await connect(flags)
  const target = await resolveTarget(current, api, input)
  const result =
    target.kind === "alias"
      ? await unwrap(
          api.aliases[":name"].$patch({ param: { name: target.name }, json: { access } }),
        )
      : await unwrap(api.deployments[":id"].$patch({ param: { id: target.id }, json: { access } }))
  if (flags.json) return printJson(result)
  info(`${green("✓")} ${describe(target)} is now ${accessBadge(access.type)}`)
  rows([
    ["Password", access.type === "password" && !flags.password ? access.password : null],
    ["Share link", result.key?.shareUrl],
  ])
}

export async function expire(input: string, when: string, flags: Common) {
  const expiresAt = when === "never" ? null : parseExpiry(when).toISOString()
  const { current, api } = await connect(flags)
  const id = await deploymentIdOf(api, await resolveTarget(current, api, input))
  await unwrap(api.deployments[":id"].$patch({ param: { id }, json: { expiresAt } }))
  info(`${green("✓")} ${id} ${expiresAt ? `expires ${relativeTime(expiresAt)}` : "never expires"}`)
}

export async function rename(input: string, title: string, flags: Common) {
  const { current, api } = await connect(flags)
  const id = await deploymentIdOf(api, await resolveTarget(current, api, input))
  await unwrap(api.deployments[":id"].$patch({ param: { id }, json: { title } }))
  info(`${green("✓")} Renamed ${id}`)
}

export async function share(input: string, flags: Common) {
  const { current, api } = await connect(flags)
  const target = await resolveTarget(current, api, input)
  const result = await unwrap(
    api["share-links"].$post({
      json: target.kind === "alias" ? { alias: target.name } : { deploymentId: target.id },
    }),
  )
  if (flags.json) return printJson(result)
  process.stdout.write(`${result.shareUrl}\n`)
}

export async function remove(inputs: string[], flags: Common & { yes?: boolean }) {
  const { current, api } = await connect(flags)
  const targets = await Promise.all(inputs.map((input) => resolveTarget(current, api, input)))
  if (!flags.yes) {
    if (!interactive) throw new CliError("Pass --yes to delete without a prompt")
    const names = targets.map(describe).join(", ")
    const note = targets.some((t) => t.kind === "deployment")
      ? " Aliases that point to it go too."
      : ""
    if (!(await confirm(`Delete ${names}?${note}`))) return info("Nothing deleted")
  }
  for (const target of targets) {
    await unwrap(
      target.kind === "alias"
        ? api.aliases[":name"].$delete({ param: { name: target.name } })
        : api.deployments[":id"].$delete({ param: { id: target.id } }),
    )
    info(`${green("✓")} Deleted ${describe(target)}`)
  }
}
