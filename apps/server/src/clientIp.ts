export type RequestEnv = { clientIp: string | undefined }

// Client IP for rate limits. With a proxy header configured, the last value wins:
// a proxy that appends puts the real client last, and one that overwrites leaves
// one value. The leftmost value is whatever the client sent, so it is never used.
// Without a header, or when the proxy did not set it, the socket address is used.
export function resolveClientIp(
  headers: Headers,
  header: string,
  socketIp: string | undefined,
): string | undefined {
  const forwarded = header ? headers.get(header) : null
  const ip = forwarded?.split(",").at(-1)?.trim()
  return ip || socketIp
}
