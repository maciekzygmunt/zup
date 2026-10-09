import type { ApiRoutes } from "@zup/server/app"
import type { ServerInfo } from "@zup/shared"
import { type ClientResponse, DetailedError, hc, parseResponse } from "hono/client"
import { normalizeServer, readConfig } from "./config.ts"
import { CliError } from "./ui.ts"

export type Session = { server: string; token: string; info: ServerInfo }

const userAgent = "zup-cli/1.0.0"

// Returns the typed success body, or throws the server's `{ message }` as a CliError.
export async function unwrap<R extends ClientResponse<unknown>>(request: R | Promise<R>) {
  try {
    return await parseResponse(request)
  } catch (error) {
    if (!(error instanceof DetailedError)) throw error
    if (error.statusCode === 401) {
      throw new CliError("Not logged in or session expired. Run `zup login`.")
    }
    const message = (error.detail as { data?: { message?: string } } | undefined)?.data?.message
    throw new CliError(message ?? `Request failed with HTTP ${error.statusCode}`)
  }
}

export async function errorFrom(response: Response): Promise<CliError> {
  if (response.status === 401)
    return new CliError("Not logged in or session expired. Run `zup login`.")
  const body = (await response.json().catch(() => null)) as { message?: string } | null
  return new CliError(body?.message ?? `Request failed with HTTP ${response.status}`)
}

export async function fetchInfo(server: string): Promise<ServerInfo> {
  let response: Response
  try {
    response = await fetch(`${server}/api/info`, { headers: { "user-agent": userAgent } })
  } catch (error) {
    throw new CliError(`Cannot reach ${server}: ${(error as Error).message}`)
  }
  if (!response.ok) throw new CliError(`${server} does not look like a zup server`)
  return (await response.json()) as ServerInfo
}

// Resolves server and token from flags, environment and the saved login.
export async function session(serverFlag?: string): Promise<Session> {
  const saved = await readConfig()
  const serverInput = serverFlag ?? process.env.ZUP_SERVER ?? saved.server
  if (!serverInput) throw new CliError("No server configured. Run `zup login <server-url>`.")
  const server = normalizeServer(serverInput)
  const token = process.env.ZUP_TOKEN ?? (server === saved.server ? saved.token : undefined)
  if (!token) throw new CliError(`Not logged in to ${server}. Run \`zup login ${server}\`.`)
  return { server, token, info: await fetchInfo(server) }
}

export function client({ server, token }: Session) {
  return hc<ApiRoutes>(`${server}/api`, {
    headers: { authorization: `Bearer ${token}`, "user-agent": userAgent },
  })
}

export type Client = ReturnType<typeof client>

export const authHeaders = ({ token }: Session) => ({
  authorization: `Bearer ${token}`,
  "user-agent": userAgent,
})
