const relative = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" })
const full = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" })

const steps: [Intl.RelativeTimeFormatUnit, number][] = [
  ["year", 365 * 24 * 3600],
  ["month", 30 * 24 * 3600],
  ["week", 7 * 24 * 3600],
  ["day", 24 * 3600],
  ["hour", 3600],
  ["minute", 60],
]

// "3 hours ago", "in 2 days", "now".
export function timeAgo(date: string | Date, now = Date.now()) {
  const seconds = (new Date(date).getTime() - now) / 1000
  for (const [unit, size] of steps) {
    if (Math.abs(seconds) >= size) return relative.format(Math.round(seconds / size), unit)
  }
  return "now"
}

export const fullDate = (iso: string | Date) => full.format(new Date(iso))

export const plural = (count: number, word: string, words = `${word}s`) =>
  `${count.toLocaleString()} ${count === 1 ? word : words}`

const browsers: [RegExp, string][] = [
  [/Edg\//, "Edge"],
  [/Firefox\//, "Firefox"],
  [/Chrome\//, "Chrome"],
  [/Safari\//, "Safari"],
]
const systems: [RegExp, string][] = [
  [/iPhone|iPad/, "iOS"],
  [/Android/, "Android"],
  [/Mac OS X/, "macOS"],
  [/Windows/, "Windows"],
  [/Linux/, "Linux"],
]
const find = (ua: string, table: [RegExp, string][]) => table.find(([re]) => re.test(ua))?.[1]

// "Chrome on macOS", "zup CLI", … from a user agent string.
export function describeAgent(ua: string | null | undefined) {
  if (!ua) return "Unknown device"
  if (ua.startsWith("zup-cli/")) return "zup CLI"
  const browser = find(ua, browsers)
  const os = find(ua, systems)
  if (browser && os) return `${browser} on ${os}`
  return browser ?? os ?? ua.split(" ")[0] ?? "Unknown device"
}
