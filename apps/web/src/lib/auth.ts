import { oauthProviderClient } from "@better-auth/oauth-provider/client"
import { passkeyClient } from "@better-auth/passkey/client"
import { deviceAuthorizationClient } from "better-auth/client/plugins"
import { createAuthClient } from "better-auth/react"

// oauthProviderClient forwards the signed OAuth query of /login and /consent to the server,
// so sign-in and consent continue an MCP client's authorization.
export const authClient = createAuthClient({
  basePath: "/api/auth",
  plugins: [passkeyClient(), deviceAuthorizationClient(), oauthProviderClient()],
})

export type Session = typeof authClient.$Infer.Session

type AuthError = {
  status: number
  statusText: string
  message?: string
  error_description?: string
}

// Better Auth client calls resolve with `{ data, error }`; react-query wants a throw.
export async function unwrap<T>(
  call: Promise<{ data: T; error: null } | { data: null; error: AuthError }>,
): Promise<T> {
  const { data, error } = await call
  if (error) throw new Error(error.message || error.error_description || error.statusText)
  return data
}
