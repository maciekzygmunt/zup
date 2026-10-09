import { spawn } from "node:child_process"
import { createInterface } from "node:readline/promises"
import type { AccessType } from "@zup/shared"

// Terminal output helpers. Colors and progress only on interactive terminals.

const useColor = process.stdout.isTTY && !process.env.NO_COLOR
const paint = (code: number) => (text: string) => (useColor ? `\x1b[${code}m${text}\x1b[0m` : text)

export const bold = paint(1)
export const dim = paint(2)
export const red = paint(31)
export const green = paint(32)
export const yellow = paint(33)
export const cyan = paint(36)

export const interactive = Boolean(process.stdin.isTTY && process.stderr.isTTY)

// Thrown for expected failures; printed without a stack trace.
export class CliError extends Error {}

export const info = (message: string) => process.stderr.write(`${message}\n`)
export const warn = (message: string) => process.stderr.write(`${yellow("!")} ${message}\n`)

// Prints aligned "label  value" rows to stdout.
export function rows(entries: [string, string | null | undefined][]) {
  const shown = entries.filter((entry): entry is [string, string] => !!entry[1])
  const width = Math.max(...shown.map(([label]) => label.length))
  for (const [label, value] of shown)
    process.stdout.write(`  ${dim(label.padEnd(width))}  ${value}\n`)
}

export async function confirm(question: string, defaultYes = false): Promise<boolean> {
  if (!interactive) return false
  const answer = await ask(`${question} ${dim(defaultYes ? "[Y/n]" : "[y/N]")} `)
  return answer ? /^y(es)?$/i.test(answer) : defaultYes
}

export async function ask(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stderr })
  try {
    return (await rl.question(question)).trim()
  } finally {
    rl.close()
  }
}

// One redrawn line on stderr, e.g. an upload progress bar.
export function progress(label: string) {
  let last = 0
  return {
    update(done: number, total: number) {
      if (!process.stderr.isTTY || Date.now() - last < 80) return
      last = Date.now()
      const ratio = total ? Math.min(done / total, 1) : 1
      const width = 24
      const bar = "█".repeat(Math.round(ratio * width)).padEnd(width, "░")
      process.stderr.write(
        `\r${label} ${cyan(bar)} ${String(Math.round(ratio * 100)).padStart(3)}%`,
      )
    },
    done() {
      if (process.stderr.isTTY) process.stderr.write("\r\x1b[2K")
    },
  }
}

export function openInBrowser(url: string) {
  const command =
    process.platform === "darwin" ? "open" : process.platform === "win32" ? "explorer" : "xdg-open"
  try {
    spawn(command, [url], { stdio: "ignore", detached: true })
      .on("error", () => {})
      .unref()
  } catch {
    // The URL is printed too, so a missing opener is fine.
  }
}

export function relativeTime(iso: string): string {
  const seconds = Math.round((new Date(iso).getTime() - Date.now()) / 1000)
  const units: [Intl.RelativeTimeFormatUnit, number][] = [
    ["year", 31_536_000],
    ["month", 2_592_000],
    ["week", 604_800],
    ["day", 86_400],
    ["hour", 3600],
    ["minute", 60],
  ]
  const format = new Intl.RelativeTimeFormat("en", { numeric: "auto" })
  for (const [unit, size] of units) {
    if (Math.abs(seconds) >= size) return format.format(Math.round(seconds / size), unit)
  }
  return format.format(seconds, "second")
}

export const accessBadge = (access: AccessType) =>
  ({ private: dim("private"), public: green("public"), password: yellow("password") })[access]

// Link that opens a site in the browser; non-public sites go through the owner login handoff.
export function browserUrl(server: string, url: string, access: AccessType) {
  if (access === "public") return url
  return `${server}/api/preview-session?next=${encodeURIComponent(new URL(url).pathname)}`
}
