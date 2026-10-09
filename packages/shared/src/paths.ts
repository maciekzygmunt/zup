// Manifest paths are absolute POSIX paths inside a deployment, e.g. "/assets/app.js".
export function isValidManifestPath(value: string): boolean {
  if (!value.startsWith("/") || value.length > 2048) return false
  if (value.includes("\0") || value.includes("\\") || value.includes("//")) return false
  if (value.endsWith("/")) return false
  return !value.split("/").some((part) => part === "." || part === "..")
}

// Turns a relative path from the local disk into a manifest path.
export function toManifestPath(relativePath: string): string {
  return `/${relativePath
    .split(/[\\/]+/)
    .filter(Boolean)
    .join("/")}`
}

const htmlPattern = /\.html?$/i
const markdownPattern = /\.(md|markdown)$/i

export const isHtmlPath = (path: string) => htmlPattern.test(path)
export const isMarkdownPath = (path: string) => markdownPattern.test(path)

// Picks the file that "/" serves: an index file, else the only page, else the only file.
// Returns null when the root should show a directory listing.
export function inferEntrypoint(paths: readonly string[]): string | null {
  for (const index of ["/index.html", "/index.htm", "/index.md", "/index.markdown"]) {
    if (paths.includes(index)) return index
  }
  const pages = paths.filter((path) => isHtmlPath(path) || isMarkdownPath(path))
  if (pages.length === 1) return pages[0]!
  if (paths.length === 1) return paths[0]!
  return null
}
