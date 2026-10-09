import { execFile } from "node:child_process"
import { createHash } from "node:crypto"
import { createReadStream } from "node:fs"
import { readdir, readFile, stat } from "node:fs/promises"
import { basename, join, relative, resolve, sep } from "node:path"
import { promisify } from "node:util"
import { contentTypeFor, type ManifestFile, toManifestPath } from "@zup/shared"
import ignore from "ignore"
import { mapLimit } from "./pool.ts"
import { CliError } from "./ui.ts"

const run = promisify(execFile)

// Never uploaded from folders: VCS data, dependencies, OS junk and secrets.
const defaultIgnores = [
  ".git/",
  ".hg/",
  ".svn/",
  "node_modules/",
  ".DS_Store",
  "Thumbs.db",
  ".env",
  ".env.*",
  "!.env.example",
  ".npmrc",
  ".netrc",
  ".zupignore",
  ".gitignore",
  ".gitattributes",
  ".vercel/",
  ".netlify/",
]

export type LocalFile = ManifestFile & { absolutePath: string }

export type ScanResult = {
  files: LocalFile[]
  // Name for the default title: the folder or the single file.
  name: string
  skippedByGit: number
}

async function walk(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true })
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const path = join(dir, entry.name)
      if (entry.isDirectory()) return walk(path)
      if (entry.isFile()) return [path]
      // Symlinks are followed when they point at files.
      if (entry.isSymbolicLink()) {
        const target = await stat(path).catch(() => null)
        if (target?.isFile()) return [path]
      }
      return []
    }),
  )
  return nested.flat()
}

// Paths (relative to `root`) that git ignores. Empty outside a repository, and when the
// folder itself is ignored (a build output like dist/ is usually gitignored on purpose).
async function gitIgnored(root: string, paths: string[]): Promise<Set<string>> {
  try {
    await run("git", ["-C", root, "rev-parse", "--is-inside-work-tree"])
  } catch {
    return new Set()
  }
  const rootIgnored = await run("git", ["-C", root, "check-ignore", "-q", "."]).then(
    () => true,
    () => false,
  )
  if (rootIgnored || !paths.length) return new Set()
  return new Promise((done) => {
    const child = execFile(
      "git",
      ["-C", root, "check-ignore", "--stdin", "-z"],
      { maxBuffer: 64 * 1024 * 1024 },
      (_error, stdout) => done(new Set(stdout.split("\0").filter(Boolean))),
    )
    child.stdin?.end(paths.map((path) => path.split(sep).join("/")).join("\0"))
  })
}

async function folderFiles(root: string) {
  const all = (await walk(root)).map((path) => relative(root, path).split(sep).join("/"))
  const rules = ignore().add(defaultIgnores)
  const zupignore = await readFile(join(root, ".zupignore"), "utf8").catch(() => "")
  rules.add(zupignore)
  const candidates = all.filter((path) => !rules.ignores(path))
  const ignoredByGit = await gitIgnored(root, candidates)
  return {
    paths: candidates.filter((path) => !ignoredByGit.has(path)),
    skippedByGit: ignoredByGit.size,
  }
}

export async function hashFile(path: string): Promise<string> {
  const hash = createHash("sha256")
  for await (const chunk of createReadStream(path)) hash.update(chunk)
  return hash.digest("hex")
}

// Builds the manifest. One folder → its contents are the site root. Several inputs →
// files by name and folders as subfolders.
export async function scan(inputs: string[]): Promise<ScanResult> {
  const entries: { absolutePath: string; path: string }[] = []
  let skippedByGit = 0
  const resolved = await Promise.all(
    inputs.map(async (input) => {
      const absolutePath = resolve(input)
      const info = await stat(absolutePath).catch(() => null)
      if (!info) throw new CliError(`${input} does not exist`)
      return { input, absolutePath, isDir: info.isDirectory() }
    }),
  )

  for (const { absolutePath, isDir } of resolved) {
    if (!isDir) {
      entries.push({ absolutePath, path: basename(absolutePath) })
      continue
    }
    const folder = await folderFiles(absolutePath)
    skippedByGit += folder.skippedByGit
    const prefix = resolved.length === 1 ? "" : `${basename(absolutePath)}/`
    for (const path of folder.paths) {
      entries.push({ absolutePath: join(absolutePath, path), path: `${prefix}${path}` })
    }
  }

  const seen = new Set<string>()
  for (const entry of entries) {
    if (seen.has(entry.path)) throw new CliError(`Two inputs both contain ${entry.path}`)
    seen.add(entry.path)
  }
  if (!entries.length) throw new CliError("Nothing to upload: no files found")

  const files = await mapLimit(entries, 16, async (entry): Promise<LocalFile> => {
    const path = toManifestPath(entry.path)
    return {
      absolutePath: entry.absolutePath,
      path,
      hash: await hashFile(entry.absolutePath),
      size: (await stat(entry.absolutePath)).size,
      contentType: contentTypeFor(path),
    }
  })
  files.sort((a, b) => a.path.localeCompare(b.path))

  const [first] = resolved
  const name =
    resolved.length === 1 && first ? basename(first.absolutePath) : basename(process.cwd())
  return { files, name, skippedByGit }
}
