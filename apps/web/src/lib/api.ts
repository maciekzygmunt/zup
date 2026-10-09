import type { ApiRoutes } from "@zup/server/app"
import { hc, parseResponse } from "hono/client"

// Error from the zup API (`{ error, message }` bodies) or from Better Auth.
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message)
  }
}

const fallbackMessages: Record<number, string> = {
  401: "Your session ended. Log in again.",
  403: "You are not allowed to do this.",
  404: "Not found.",
  413: "The upload is too large.",
  429: "Too many requests. Wait a moment and try again.",
}

export async function errorFromResponse(response: Response): Promise<ApiError> {
  // zup sends `{ error, message }`, Better Auth sends `{ code, message }`.
  const body: { error?: unknown; code?: unknown; message?: unknown } | null = await response
    .json()
    .catch(() => null)
  const text = (value: unknown) => (typeof value === "string" && value ? value : undefined)
  const message =
    text(body?.message) ??
    fallbackMessages[response.status] ??
    `Request failed (${response.status} ${response.statusText})`
  return new ApiError(response.status, text(body?.error) ?? text(body?.code) ?? "error", message)
}

// Throws ApiError for non-2xx responses, so `parseResponse` only sees success bodies.
async function checkedFetch(input: RequestInfo | URL, init?: RequestInit) {
  const response = await fetch(input, init)
  if (!response.ok) throw await errorFromResponse(response)
  return response
}

export const api = hc<ApiRoutes>("/api", { fetch: checkedFetch })
export { parseResponse }

export const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : "Something went wrong"
