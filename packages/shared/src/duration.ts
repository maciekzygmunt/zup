const units: Record<string, number> = {
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
  w: 604_800_000,
}

// Parses "30m", "12h", "7d", "2w" or an ISO date into an absolute date.
export function parseExpiry(input: string, now = Date.now()): Date {
  const match = /^(\d+)\s*([mhdw])$/i.exec(input.trim())
  if (match) {
    return new Date(now + Number(match[1]) * units[match[2]!.toLowerCase()]!)
  }
  const date = new Date(input)
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid expiry "${input}". Use 30m, 12h, 7d, 2w or an ISO date.`)
  }
  if (date.getTime() <= now) throw new Error("Expiry must be in the future")
  return date
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), 4)
  return `${(bytes / 1024 ** exponent).toFixed(1)} ${["B", "KiB", "MiB", "GiB", "TiB"][exponent]}`
}
