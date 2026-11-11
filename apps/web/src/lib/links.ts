import type { AccessType } from "@zup/shared"

// The preview host needs an owner cookie for non-public sites. This dashboard URL sets it
// and redirects to `path` on the preview host.
export const previewSessionHref = (siteUrl: string, suffix = "") =>
  `/api/preview-session?next=${encodeURIComponent(new URL(siteUrl).pathname + suffix)}`

export const openHref = (siteUrl: string, access: AccessType) =>
  access === "public" ? siteUrl : previewSessionHref(siteUrl)

// The owner-only file browser of a site.
export const browseHref = (siteUrl: string) => previewSessionHref(siteUrl, "_src/")

const encodePath = (path: string) => path.split("/").map(encodeURIComponent).join("/")

export const fileHref = (siteUrl: string, access: AccessType, path: string) => {
  const url = `${siteUrl}${encodePath(path).slice(1)}`
  return access === "public" ? url : previewSessionHref(url)
}

export const downloadHref = (slug: string, path: string) =>
  `/api/sites/${slug}/files${encodePath(path)}`
