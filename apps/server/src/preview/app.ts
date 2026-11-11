import { createHmac } from "node:crypto"
import { isMarkdownPath, isTextContentType } from "@zup/shared"
import { and, eq, like } from "drizzle-orm"
import { type Context, Hono } from "hono"
import { bodyLimit } from "hono/body-limit"
import { getCookie, getSignedCookie, setCookie, setSignedCookie } from "hono/cookie"
import MarkdownIt from "markdown-it"
import type { BlobStore } from "../blobs.ts"
import type { RequestEnv } from "../clientIp.ts"
import type { Config } from "../config.ts"
import type { Db } from "../db/client.ts"
import { type SiteFile, type Site as SiteRow, siteFiles, sites } from "../db/schema.ts"
import {
  grantOpens,
  shareTokenOpens,
  siteScope,
  unlockCookieName,
  unlockGrant,
  unlockMaxAgeSeconds,
  verifyPassword,
} from "../passwords.ts"
import { createRateLimiter } from "../rateLimit.ts"
import { type OwnerSessions, ownerCookieName, safePath } from "./owner.ts"
import {
  hrefFor,
  type ListingEntry,
  listingPage,
  markdownPage,
  messagePage,
  sourcePage,
  unlockPage,
} from "./pages.ts"

const markdown = new MarkdownIt({ html: true, linkify: true, typographer: true })
const maxSourcePreviewBytes = 512 * 1024

// A resolved site request: the site row and its URL prefix.
type Site = {
  row: SiteRow
  base: string
  name: string
  scope: string
  // A public site that search engines may index. Generated pages then drop noindex.
  indexable: boolean
}

type Deps = { config: Config; db: Db; blobs: BlobStore; owners: OwnerSessions }

// Serves uploaded sites on the preview host at /<slug>/...
export function createPreviewApp({ config, db, blobs, owners }: Deps) {
  const app = new Hono<{ Bindings: RequestEnv }>()
  // Only the unlock form takes a body here.
  app.use(
    "*",
    bodyLimit({ maxSize: 16 * 1024, onError: (c) => c.text("Request body is too large", 413) }),
  )
  // Own key for unlock cookies, so no other signed value can pass as one.
  const unlockCookieKey = createHmac("sha256", config.BETTER_AUTH_SECRET)
    .update("zup unlock cookie")
    .digest()
  const unlockPerIp = createRateLimiter(10, 60_000)
  const unlockPerSite = createRateLimiter(60, 60_000)

  const clientIp = (c: Context<{ Bindings: RequestEnv }>) => c.env.clientIp ?? "unknown"

  const wantsHtml = (c: Context) =>
    c.req.header("sec-fetch-dest") === "document" ||
    (c.req.header("accept") ?? "").includes("text/html")

  const html = (c: Context, body: string, status = 200, indexable = false) => {
    c.header("Cache-Control", "no-store")
    c.header("X-Content-Type-Options", "nosniff")
    c.header("Referrer-Policy", "same-origin")
    if (!indexable) c.header("X-Robots-Tag", "noindex")
    return c.html(body, status as 200)
  }

  const notFound = (c: Context) =>
    html(
      c,
      messagePage({
        status: 404,
        title: "Nothing here",
        message: "This page does not exist, or it was deleted.",
      }),
      404,
    )

  // Paths in URLs are percent-encoded per segment; manifest paths are not.
  function restPath(c: Context, base: string): string | null {
    const raw = new URL(c.req.url).pathname.slice(base.length)
    try {
      return decodeURIComponent(raw)
    } catch {
      return null
    }
  }

  async function siteFor(c: Context): Promise<Site | null> {
    const slug = c.req.param("slug")!
    const row = await db.query.sites.findFirst({ where: eq(sites.slug, slug) })
    return (
      (row && {
        row,
        base: `/${slug}`,
        name: row.title ?? slug,
        scope: siteScope(row.id),
        indexable: row.access === "public" && row.indexable,
      }) ||
      null
    )
  }

  const isOwner = (c: Context) => owners.isOwner(getCookie(c, ownerCookieName))

  // Returns a response that blocks the request, or null when the viewer may see the site.
  async function guard(c: Context, site: Site): Promise<Response | null> {
    const { access, passwordHash } = site.row
    if (access === "public") return null
    if (await isOwner(c)) return null
    const next = new URL(c.req.url).pathname
    if (access === "password" && passwordHash) {
      const grant = await getSignedCookie(c, unlockCookieKey, unlockCookieName)
      if (grantOpens(grant, site.scope, passwordHash)) return null
      if (!wantsHtml(c)) return c.json({ error: "password_required" }, 401)
      return html(c, unlockPage({ action: `${site.base}/_zup/unlock`, next }), 401)
    }
    // Private, or a password record without a hash (fails closed).
    if (!wantsHtml(c)) return c.json({ error: "login_required" }, 401)
    return html(
      c,
      messagePage({
        status: 401,
        title: "This page is private",
        message: "Only the owner can open it.",
        action: { href: `/_zup/login?next=${encodeURIComponent(next)}`, label: "Log in" },
      }),
      401,
    )
  }

  const findFile = async (siteId: string, path: string) =>
    (await db.query.siteFiles.findFirst({
      where: and(eq(siteFiles.siteId, siteId), eq(siteFiles.path, path)),
    })) ?? null

  async function filesUnder(siteId: string, dir: string) {
    const pattern = `${dir.replace(/[%_\\]/g, "\\$&")}%`
    return db
      .select({ path: siteFiles.path, size: siteFiles.size })
      .from(siteFiles)
      .where(and(eq(siteFiles.siteId, siteId), like(siteFiles.path, pattern)))
      .orderBy(siteFiles.path)
  }

  // Immediate children of `dir` ("/" or "/docs/"), folders first.
  async function listing(site: Site, dir: string, linkBase: string): Promise<ListingEntry[]> {
    const files = await filesUnder(site.row.id, dir)
    const dirs = new Set<string>()
    const entries: ListingEntry[] = []
    for (const file of files) {
      const rest = file.path.slice(dir.length)
      const slash = rest.indexOf("/")
      if (slash === -1) {
        entries.push({
          name: rest,
          href: hrefFor(linkBase, file.path),
          size: file.size,
          isDir: false,
        })
      } else if (!dirs.has(rest.slice(0, slash))) {
        const name = rest.slice(0, slash)
        dirs.add(name)
        entries.push({ name, href: hrefFor(linkBase, `${dir}${name}/`), isDir: true })
      }
    }
    return entries.sort((a, b) => Number(b.isDir) - Number(a.isDir))
  }

  async function sendFile(c: Context, site: Site, file: SiteFile) {
    const etag = `"${file.hash}"`
    const headers: Record<string, string> = {
      ETag: etag,
      "Cache-Control":
        site.row.access === "public" ? "public, max-age=60, must-revalidate" : "private, no-cache",
      "X-Content-Type-Options": "nosniff",
      "Accept-Ranges": "bytes",
    }
    if (site.row.access !== "public") headers["X-Robots-Tag"] = "noindex"
    if (c.req.header("if-none-match") === etag) return c.body(null, 304, headers)

    if (isMarkdownPath(file.path) && wantsHtml(c) && c.req.query("raw") === undefined) {
      const source = await blobs.file(file.hash).text()
      const title = /^#\s+(.+)$/m.exec(source)?.[1] ?? file.path.split("/").pop()!
      return c.html(markdownPage(title, markdown.render(source), site.indexable), 200, headers)
    }

    const blob = blobs.file(file.hash)
    headers["Content-Type"] = file.contentType
    const range = /^bytes=(\d*)-(\d*)$/.exec(c.req.header("range") ?? "")
    if (range && (range[1] || range[2])) {
      const start = range[1] ? Number(range[1]) : Math.max(0, file.size - Number(range[2]))
      const end = range[1] && range[2] ? Math.min(Number(range[2]), file.size - 1) : file.size - 1
      if (start > end || start >= file.size) {
        return c.body(null, 416, { ...headers, "Content-Range": `bytes */${file.size}` })
      }
      headers["Content-Range"] = `bytes ${start}-${end}/${file.size}`
      headers["Content-Length"] = String(end - start + 1)
      const body = c.req.method === "HEAD" ? null : blob.slice(start, end + 1)
      return new Response(body, { status: 206, headers })
    }
    headers["Content-Length"] = String(file.size)
    return new Response(c.req.method === "HEAD" ? null : blob, { status: 200, headers })
  }

  const siteListing = (c: Context, site: Site, dir: string, entries: ListingEntry[]) =>
    html(
      c,
      listingPage({
        siteName: site.name,
        base: site.base,
        dir,
        entries,
        indexable: site.indexable,
      }),
      200,
      site.indexable,
    )

  // Owner-only file browser at <site>/_src/.
  async function source(c: Context, site: Site, path: string) {
    if (!(await isOwner(c))) {
      const next = new URL(c.req.url).pathname
      return c.redirect(`/_zup/login?next=${encodeURIComponent(next)}`)
    }
    const srcBase = `${site.base}/_src`
    if (path === "/" || path.endsWith("/")) {
      const entries = await listing(site, path, srcBase)
      if (!entries.length) return notFound(c)
      return html(c, listingPage({ siteName: site.name, base: srcBase, dir: path, entries }))
    }
    const file = await findFile(site.row.id, path)
    if (!file) return notFound(c)
    const showText = isTextContentType(file.contentType) && file.size <= maxSourcePreviewBytes
    return html(
      c,
      sourcePage({
        siteName: site.name,
        base: srcBase,
        path,
        rawHref: `${hrefFor(site.base, path)}?raw`,
        size: file.size,
        contentType: file.contentType,
        text: showText ? await blobs.file(file.hash).text() : undefined,
      }),
    )
  }

  async function serveSite(c: Context) {
    const site = await siteFor(c)
    if (!site) return refererFallback(c) ?? notFound(c)
    const path = restPath(c, site.base)
    if (path === null) return notFound(c)
    if (path === "") return c.redirect(`${site.base}/`, 301)

    const { row } = site
    if (row.expiresAt && row.expiresAt.getTime() <= Date.now()) {
      return html(
        c,
        messagePage({
          status: 410,
          title: "This link expired",
          message: "The owner set it to expire.",
        }),
        410,
      )
    }
    const blocked = await guard(c, site)
    if (blocked) return blocked

    if (path === "/_src" || path.startsWith("/_src/")) {
      return source(c, site, path.slice("/_src".length) || "/")
    }

    if (path === "/") {
      if (!row.entrypoint) {
        const entries = await listing(site, "/", site.base)
        return siteListing(c, site, "/", entries)
      }
      const entry = await findFile(row.id, row.entrypoint)
      if (!entry) return notFound(c)
      // A single non-page file is served at its own name so downloads keep it.
      if (!/\.(html?|md|markdown)$/i.test(entry.path)) {
        return c.redirect(hrefFor(site.base, entry.path))
      }
      return sendFile(c, site, entry)
    }

    if (path.endsWith("/")) {
      for (const index of ["index.html", "index.htm", "index.md"]) {
        const file = await findFile(row.id, `${path}${index}`)
        if (file) return sendFile(c, site, file)
      }
      const entries = await listing(site, path, site.base)
      if (entries.length) return siteListing(c, site, path, entries)
    } else {
      const file = await findFile(row.id, path)
      if (file) return sendFile(c, site, file)
      if ((await filesUnder(row.id, `${path}/`)).length) {
        return c.redirect(`${hrefFor(site.base, path)}/`, 301)
      }
    }

    // Client-side routes of single-page apps: extensionless paths get the entrypoint.
    const lastSegment = path.split("/").filter(Boolean).pop() ?? ""
    if (row.spa && row.entrypoint && !lastSegment.includes(".") && wantsHtml(c)) {
      const entry = await findFile(row.id, row.entrypoint)
      if (entry) return sendFile(c, site, entry)
    }
    return notFound(c)
  }

  // Sites built for "/" request "/assets/app.js" instead of "/<slug>/assets/app.js".
  // The Referer tells which site asked, so redirect into it.
  function refererFallback(c: Context): Response | null {
    if (c.req.method !== "GET" && c.req.method !== "HEAD") return null
    const referer = c.req.header("referer")
    if (!referer?.startsWith(`${config.previewOrigin}/`)) return null
    const refererPath = new URL(referer).pathname
    const prefix = /^\/[a-z0-9-]+(?=\/)/.exec(refererPath)?.[0]
    const url = new URL(c.req.url)
    if (!prefix || url.pathname.startsWith(`${prefix}/`)) return null
    return c.redirect(`${prefix}${url.pathname}${url.search}`, 307)
  }

  async function unlock(c: Context) {
    const site = await siteFor(c)
    if (!site) return notFound(c)
    const form = await c.req.parseBody()
    const field = (name: string) => (typeof form[name] === "string" ? (form[name] as string) : "")
    const next = safePath(field("next"), `${site.base}/`)
    const target = next === site.base || next.startsWith(`${site.base}/`) ? next : `${site.base}/`
    const action = `${site.base}/_zup/unlock`
    const { passwordHash } = site.row
    if (site.row.access !== "password" || !passwordHash) return c.redirect(target, 303)

    if (!unlockPerIp(clientIp(c)) || !unlockPerSite(site.scope)) {
      return html(
        c,
        unlockPage({
          action,
          next: target,
          error: "Too many tries. Try again in one minute.",
        }),
        429,
      )
    }
    const token = field("token")
    const valid = token
      ? shareTokenOpens(token, config.BETTER_AUTH_SECRET, site.scope, passwordHash)
      : await verifyPassword(field("password"), passwordHash)
    if (!valid) {
      const error = token
        ? "This link does not work anymore. Enter the password, or ask for a new link."
        : "That password is not correct."
      return html(c, unlockPage({ action, next: target, error }), 401)
    }
    await setSignedCookie(
      c,
      unlockCookieName,
      unlockGrant(site.scope, passwordHash),
      unlockCookieKey,
      {
        path: site.base,
        httpOnly: true,
        secure: config.secureCookies,
        sameSite: "Lax",
        maxAge: unlockMaxAgeSeconds,
      },
    )
    return c.redirect(target, 303)
  }

  // Blocks everything except public sites marked indexable. Crawlers use the most specific
  // rule. `/<slug>$` lets them follow the redirect to `/<slug>/`.
  app.get("/robots.txt", async (c) => {
    const open = await db
      .select({ slug: sites.slug, sitemap: siteFiles.path })
      .from(sites)
      .leftJoin(siteFiles, and(eq(siteFiles.siteId, sites.id), eq(siteFiles.path, "/sitemap.xml")))
      .where(and(eq(sites.indexable, true), eq(sites.access, "public")))
      .orderBy(sites.slug)
    const allow = open.map(({ slug }) => `Allow: /${slug}$\nAllow: /${slug}/\n`).join("")
    const sitemaps = open
      .filter(({ sitemap }) => sitemap)
      .map(({ slug }) => `Sitemap: ${config.previewOrigin}/${slug}/sitemap.xml\n`)
      .join("")
    c.header("Cache-Control", "public, max-age=300")
    return c.text(`User-agent: *\n${allow}Disallow: /\n${sitemaps && `\n${sitemaps}`}`)
  })

  app.get("/", (c) =>
    html(c, messagePage({ status: 200, title: "zup", message: "Nothing to see at the root." })),
  )

  // Owner login handoff (see owner.ts).
  app.get("/_zup/login", (c) => {
    const next = safePath(c.req.query("next"))
    return c.redirect(`${config.appOrigin}/api/preview-session?next=${encodeURIComponent(next)}`)
  })

  app.get("/_zup/callback", (c) => {
    const sessionId = owners.redeemHandoff(c.req.query("token") ?? "")
    if (!sessionId) {
      return html(
        c,
        messagePage({ status: 400, title: "Login link expired", message: "Open the page again." }),
        400,
      )
    }
    setCookie(c, ownerCookieName, owners.cookieValue(sessionId), {
      path: "/",
      httpOnly: true,
      secure: config.secureCookies,
      sameSite: "Lax",
      maxAge: 60 * 60 * 24 * 60,
    })
    return c.redirect(safePath(c.req.query("next")))
  })

  app.post("/:slug/_zup/unlock", unlock)
  app.on(["GET", "HEAD"], "/:slug", serveSite)
  app.on(["GET", "HEAD"], "/:slug/*", serveSite)
  app.notFound((c) => refererFallback(c) ?? notFound(c))
  app.onError((error, c) => {
    console.error(error)
    return html(
      c,
      messagePage({ status: 500, title: "Something broke", message: "Try again in a moment." }),
      500,
    )
  })
  return app
}
