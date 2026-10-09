// Fixed-window counter in memory. zup runs as one process, so this is enough.
export function createRateLimiter(max: number, windowMs: number) {
  const hits = new Map<string, { count: number; resetAt: number }>()
  setInterval(() => {
    const now = Date.now()
    for (const [key, entry] of hits) if (entry.resetAt <= now) hits.delete(key)
  }, windowMs).unref()

  // Returns false when `key` used up its budget for the current window.
  return (key: string) => {
    const now = Date.now()
    const entry = hits.get(key)
    if (!entry || entry.resetAt <= now) {
      hits.set(key, { count: 1, resetAt: now + windowMs })
      return true
    }
    entry.count++
    return entry.count <= max
  }
}
