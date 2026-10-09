import { afterAll, expect, test } from "bun:test"
import { execFileSync } from "node:child_process"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { scan } from "./scan.ts"

const root = mkdtempSync(join(tmpdir(), "zup-scan-"))
afterAll(() => rmSync(root, { recursive: true, force: true }))

function files(base: string, entries: Record<string, string>) {
  for (const [path, content] of Object.entries(entries)) {
    mkdirSync(dirname(join(base, path)), { recursive: true })
    writeFileSync(join(base, path), content)
  }
}

const paths = async (inputs: string[]) => (await scan(inputs)).files.map((file) => file.path)

test("skips secrets, VCS data, gitignored and .zupignore files", async () => {
  const site = join(root, "repo")
  files(site, {
    "index.html": "<h1>hi</h1>",
    "notes.txt": "draft",
    "drafts/a.md": "a",
    ".env": "TOKEN=1",
    ".env.example": "TOKEN=",
    "node_modules/x/index.js": "x",
    ".gitignore": "notes.txt\n",
    ".zupignore": "drafts/\n",
  })
  execFileSync("git", ["init", "-q"], { cwd: site })
  expect(await paths([site])).toEqual(["/.env.example", "/index.html"])
})

test("keeps a gitignored build folder when it is the upload itself", async () => {
  const repo = join(root, "app")
  files(repo, { ".gitignore": "dist/\n", "dist/index.html": "x", "dist/app.js": "y" })
  execFileSync("git", ["init", "-q"], { cwd: repo })
  expect(await paths([join(repo, "dist")])).toEqual(["/app.js", "/index.html"])
})

test("several inputs keep folder names and file names", async () => {
  const base = join(root, "multi")
  files(base, { "a.html": "a", "assets/x.css": "x" })
  expect(await paths([join(base, "a.html"), join(base, "assets")])).toEqual([
    "/a.html",
    "/assets/x.css",
  ])
})
