import { formatBytes } from "@zup/shared"

// Server-rendered pages on the preview host: errors, unlock form, file listings,
// source view and Markdown. They use no external assets.

export const escapeHtml = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!,
  )

// Builds an href from a manifest path, keeping "/" separators.
export const hrefFor = (base: string, path: string) =>
  `${base}${path.split("/").map(encodeURIComponent).join("/")}`

const css = `
:root { color-scheme: light dark; --bg: #fafaf9; --fg: #1c1917; --muted: #78716c; --line: #e7e5e4;
  --card: #fff; --accent: #4f46e5; --danger: #dc2626; --code: #f5f5f4;
  --sans: ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
  --mono: ui-monospace, "SF Mono", "JetBrains Mono", Menlo, monospace; }
@media (prefers-color-scheme: dark) { :root { --bg: #0c0a09; --fg: #f5f5f4; --muted: #a8a29e;
  --line: #292524; --card: #1c1917; --accent: #818cf8; --danger: #f87171; --code: #1c1917; } }
* { box-sizing: border-box; }
html { -webkit-font-smoothing: antialiased; }
body { margin: 0; background: var(--bg); color: var(--fg); font: 15px/1.6 var(--sans); }
a { color: var(--accent); text-decoration: none; } a:hover { text-decoration: underline; }
.center { min-height: 100dvh; display: grid; place-items: center; padding: 2rem 1.25rem; }
.box { width: min(100%, 26rem); }
.mark { font: 600 13px var(--mono); letter-spacing: .02em; color: var(--muted); margin: 0 0 2rem; }
.code { font: 600 13px var(--mono); color: var(--muted); margin: 0 0 .5rem; }
h1 { font-size: 1.5rem; line-height: 1.25; letter-spacing: -.015em; margin: 0 0 .5rem; text-wrap: balance; }
p.lede { color: var(--muted); margin: 0 0 1.5rem; text-wrap: pretty; }
form { display: grid; gap: .625rem; }
input { font: 15px var(--mono); padding: .7rem .85rem; border-radius: .5rem; border: 1px solid var(--line);
  background: var(--card); color: var(--fg); outline: none; }
input:focus { border-color: var(--accent); box-shadow: 0 0 0 3px color-mix(in oklab, var(--accent) 22%, transparent); }
button, .button { font: 600 14px var(--sans); padding: .7rem 1rem; border: 0; border-radius: .5rem; cursor: pointer;
  background: var(--fg); color: var(--bg); display: inline-block; text-align: center; transition: opacity .15s; }
button:hover, .button:hover { opacity: .85; text-decoration: none; }
button:active, .button:active { transform: scale(.98); }
.error { color: var(--danger); font-size: 14px; margin: 0 0 .75rem; }
.wrap { max-width: 64rem; margin: 0 auto; padding: 2rem 1.25rem 4rem; }
.crumbs { font: 14px var(--mono); margin: 0 0 1.25rem; overflow-wrap: anywhere; }
.crumbs span { color: var(--muted); }
table { width: 100%; border-collapse: collapse; font-size: 14px; }
td { padding: .5rem .75rem; border-top: 1px solid var(--line); }
td.num { text-align: right; color: var(--muted); font-variant-numeric: tabular-nums; white-space: nowrap; }
td.name { font-family: var(--mono); overflow-wrap: anywhere; }
.panel { border: 1px solid var(--line); border-radius: .75rem; background: var(--card); overflow: hidden; }
.bar { display: flex; gap: 1rem; align-items: center; justify-content: space-between; padding: .6rem .9rem;
  border-bottom: 1px solid var(--line); font-size: 13px; color: var(--muted); }
pre.source { margin: 0; padding: .9rem 0; overflow: auto; font: 13px/1.55 var(--mono); counter-reset: line; }
pre.source span { display: block; padding: 0 1rem 0 0; white-space: pre; }
pre.source span::before { counter-increment: line; content: counter(line); display: inline-block; width: 3.5rem;
  padding-right: 1rem; text-align: right; color: var(--muted); opacity: .6; user-select: none; }
.media { padding: 1rem; text-align: center; } .media img, .media video { max-width: 100%; max-height: 75vh; }
`

const markdownCss = `
.markdown { max-width: 46rem; margin: 0 auto; padding: 3rem 1.25rem 5rem; font-size: 16px; line-height: 1.7; }
.markdown h1, .markdown h2, .markdown h3 { line-height: 1.25; margin: 2em 0 .6em; letter-spacing: -.01em; }
.markdown h1 { font-size: 2rem; margin-top: 0; } .markdown h2 { font-size: 1.45rem; padding-bottom: .3em; border-bottom: 1px solid var(--line); }
.markdown code { font: .88em var(--mono); background: var(--code); padding: .15em .35em; border-radius: .3em; }
.markdown pre { background: var(--code); border: 1px solid var(--line); padding: 1rem; border-radius: .6rem; overflow: auto; }
.markdown pre code { background: none; padding: 0; }
.markdown blockquote { margin: 0; padding: 0 1rem; border-left: 3px solid var(--line); color: var(--muted); }
.markdown table { margin: 1rem 0; } .markdown th, .markdown td { border: 1px solid var(--line); padding: .4rem .7rem; }
.markdown img { max-width: 100%; } .markdown hr { border: 0; border-top: 1px solid var(--line); margin: 2rem 0; }
`

type PageOptions = { title: string; body: string; extraCss?: string; script?: string }

export function page({ title, body, extraCss = "", script }: PageOptions) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${escapeHtml(title)}</title>
<style>${css}${extraCss}</style>
</head>
<body>
${body}
${script ? `<script>${script}</script>` : ""}
</body>
</html>`
}

export function messagePage(options: {
  status: number
  title: string
  message: string
  action?: { href: string; label: string }
}) {
  const action = options.action
    ? `<a class="button" href="${escapeHtml(options.action.href)}">${escapeHtml(options.action.label)}</a>`
    : ""
  return page({
    title: options.title,
    body: `<main class="center"><div class="box">
<p class="mark">zup</p>
<p class="code">${options.status}</p>
<h1>${escapeHtml(options.title)}</h1>
<p class="lede">${escapeHtml(options.message)}</p>
${action}
</div></main>`,
  })
}

// Share links put the password or a token after "#", which browsers never send to the
// server. This script moves it into the form, removes it from the address bar and submits.
const unlockScript = `
const params = new URLSearchParams(location.hash.slice(1));
const form = document.forms.unlock;
const name = ["token", "password"].find((field) => params.get(field));
if (name) {
  history.replaceState(null, "", location.pathname + location.search);
  form.elements[name].value = params.get(name);
  form.submit();
}`

export function unlockPage(options: { action: string; next: string; error?: string }) {
  return page({
    title: "Password required",
    script: unlockScript,
    body: `<main class="center"><div class="box">
<p class="mark">zup</p>
<h1>Enter the password</h1>
<p class="lede">You need a password to open this page. This browser keeps access for 30 days.</p>
${options.error ? `<p class="error" role="alert">${escapeHtml(options.error)}</p>` : ""}
<form name="unlock" method="post" action="${escapeHtml(options.action)}">
<input type="password" name="password" aria-label="Password" placeholder="Password" autocomplete="current-password" autofocus required>
<input type="hidden" name="token">
<input type="hidden" name="next" value="${escapeHtml(options.next)}">
<button type="submit">Open page</button>
</form>
</div></main>`,
  })
}

export type ListingEntry = { name: string; href: string; size?: number; isDir: boolean }

function crumbs(base: string, dir: string, siteName: string) {
  const parts = dir.split("/").filter(Boolean)
  const links = [`<a href="${escapeHtml(base)}/">${escapeHtml(siteName)}</a>`]
  parts.forEach((part, i) => {
    const href = hrefFor(base, `/${parts.slice(0, i + 1).join("/")}/`)
    links.push(`<a href="${escapeHtml(href)}">${escapeHtml(part)}</a>`)
  })
  return `<p class="crumbs">${links.join(" <span>/</span> ")}</p>`
}

export function listingPage(options: {
  siteName: string
  base: string
  dir: string
  entries: ListingEntry[]
}) {
  const rows = options.entries
    .map(
      (entry) =>
        `<tr><td class="name"><a href="${escapeHtml(entry.href)}">${escapeHtml(entry.name)}${entry.isDir ? "/" : ""}</a></td><td class="num">${entry.size === undefined ? "" : formatBytes(entry.size)}</td></tr>`,
    )
    .join("")
  return page({
    title: `${options.dir} · ${options.siteName}`,
    body: `<main class="wrap">${crumbs(options.base, options.dir, options.siteName)}
<div class="panel"><table>${rows}</table></div></main>`,
  })
}

export function sourcePage(options: {
  siteName: string
  base: string
  path: string
  rawHref: string
  size: number
  contentType: string
  text?: string
}) {
  const dir = options.path.slice(0, options.path.lastIndexOf("/") + 1)
  let content: string
  if (options.text !== undefined) {
    const lines = options.text.replace(/\n$/, "").split("\n")
    content = `<pre class="source">${lines.map((line) => `<span>${escapeHtml(line)}</span>`).join("")}</pre>`
  } else if (options.contentType.startsWith("image/")) {
    content = `<div class="media"><img src="${escapeHtml(options.rawHref)}" alt=""></div>`
  } else if (options.contentType.startsWith("video/")) {
    content = `<div class="media"><video src="${escapeHtml(options.rawHref)}" controls></video></div>`
  } else {
    content = `<div class="media"><a class="button" href="${escapeHtml(options.rawHref)}">Open file</a></div>`
  }
  return page({
    title: `${options.path} · ${options.siteName}`,
    body: `<main class="wrap">${crumbs(options.base, dir, options.siteName)}
<div class="panel"><div class="bar"><span>${escapeHtml(options.path)} · ${formatBytes(options.size)} · ${escapeHtml(options.contentType)}</span><a href="${escapeHtml(options.rawHref)}">Raw</a></div>${content}</div></main>`,
  })
}

export const markdownPage = (title: string, html: string) =>
  page({ title, extraCss: markdownCss, body: `<article class="markdown">${html}</article>` })
