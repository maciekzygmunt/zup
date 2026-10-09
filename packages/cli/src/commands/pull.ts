import { createHash } from "node:crypto"
import { createWriteStream } from "node:fs"
import { lstat, mkdir, readdir, realpath, rename, rm } from "node:fs/promises"
import { dirname, join, relative, resolve, sep } from "node:path"
import { Readable } from "node:stream"
import { pipeline } from "node:stream/promises"
import type { ReadableStream } from "node:stream/web"
import { formatBytes } from "@zup/shared"
import { authHeaders, client, errorFrom, session, unwrap } from "../api.ts"
import { mapLimit } from "../pool.ts"
import { deploymentIdOf, resolveTarget } from "../target.ts"
import { CliError, dim, green, info, progress } from "../ui.ts"

type PullFlags = { server?: string; force?: boolean; "dry-run"?: boolean }

// Downloads every file of a deployment. Each file is written to a temporary name and
// renamed into place only after its SHA-256 matches, so no file is ever half-written.
export async function pull(input: string, dirInput: string | undefined, flags: PullFlags) {
  const current = await session(flags.server)
  const api = client(current)
  const target = await resolveTarget(current, api, input)
  const id = await deploymentIdOf(api, target)
  const detail = await unwrap(api.deployments[":id"].$get({ param: { id } }))
  const dir = resolve(dirInput ?? (target.kind === "alias" ? target.name : id))
  const existing = await readdir(dir).catch(() => [])

  if (flags["dry-run"]) {
    for (const file of detail.files)
      process.stdout.write(`${file.path}  ${dim(formatBytes(file.size))}\n`)
    info(
      `\n${detail.files.length} file(s) → ${dir}${existing.length ? " (not empty: needs --force)" : ""}`,
    )
    return
  }
  if (existing.length && !flags.force) {
    throw new CliError(`${dir} is not empty. Pass --force to overwrite files with the same path.`)
  }
  await mkdir(dir, { recursive: true })
  const root = await realpath(dir)

  const total = detail.totalBytes
  let done = 0
  const bar = progress(`Downloading ${detail.files.length} file(s)`)
  try {
    await mapLimit(detail.files, 6, async (file) => {
      const destination = join(root, ...file.path.split("/").filter(Boolean))
      if (relative(root, destination).startsWith(`..${sep}`)) {
        throw new CliError(`Refusing to write outside ${root}: ${file.path}`)
      }
      await mkdir(dirname(destination), { recursive: true })
      // Never write through a symlink planted inside the target folder.
      const parent = await realpath(dirname(destination))
      if (parent !== root && !parent.startsWith(`${root}${sep}`)) {
        throw new CliError(`Refusing to follow a symlink for ${file.path}`)
      }
      if ((await lstat(destination).catch(() => null))?.isSymbolicLink()) {
        throw new CliError(`Refusing to overwrite symlink ${file.path}`)
      }

      const encoded = file.path.split("/").map(encodeURIComponent).join("/")
      const response = await fetch(`${current.server}/api/deployments/${id}/files${encoded}`, {
        headers: authHeaders(current),
      })
      if (!response.ok || !response.body) throw await errorFrom(response)
      const temporary = `${destination}.zup-${process.pid}.tmp`
      const hash = createHash("sha256")
      const body = Readable.fromWeb(response.body as ReadableStream).on("data", (chunk) => {
        hash.update(chunk)
        done += chunk.length
        bar.update(done, total)
      })
      try {
        await pipeline(body, createWriteStream(temporary))
        if (hash.digest("hex") !== file.hash) {
          throw new CliError(`${file.path} did not match its checksum`)
        }
        await rename(temporary, destination)
      } finally {
        await rm(temporary, { force: true })
      }
    })
  } finally {
    bar.done()
  }
  info(`${green("✓")} ${detail.files.length} file(s), ${formatBytes(total)} → ${dir}`)
}
