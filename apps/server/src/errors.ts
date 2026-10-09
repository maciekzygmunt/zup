import type { ContentfulStatusCode } from "hono/utils/http-status"

// Thrown by services; the API turns it into `{ error, message }` with this status.
export class HttpError extends Error {
  constructor(
    readonly status: ContentfulStatusCode,
    readonly code: string,
    message: string,
  ) {
    super(message)
  }
}
