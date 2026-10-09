import { fetchInfo, session } from "../api.ts"
import { clearConfig, normalizeServer, readConfig, writeConfig } from "../config.ts"
import { bold, CliError, cyan, dim, green, info, openInBrowser } from "../ui.ts"

const clientId = "zup-cli"
const deviceGrant = "urn:ietf:params:oauth:grant-type:device_code"

type DeviceCode = {
  device_code: string
  user_code: string
  verification_uri: string
  verification_uri_complete?: string
  expires_in: number
  interval?: number
}

type OAuthError = { error?: string; error_description?: string; message?: string }

async function post<T>(url: string, body: object) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", "user-agent": "zup-cli/1.0.0" },
    body: JSON.stringify(body),
  })
  const data = (await response.json().catch(() => ({}))) as Partial<T> & OAuthError
  return { ok: response.ok, data }
}

// Browser login with the OAuth device flow: the CLI shows a code, the owner approves it
// in the dashboard, and the CLI receives a session token.
export async function login(serverInput: string | undefined, flags: { open?: boolean }) {
  const saved = await readConfig()
  const input = serverInput ?? process.env.ZUP_SERVER ?? saved.server
  if (!input) throw new CliError("Pass the server URL: zup login https://zup.example.com")
  const server = normalizeServer(input)
  await fetchInfo(server)

  const { ok, data: code } = await post<DeviceCode>(`${server}/api/auth/device/code`, {
    client_id: clientId,
  })
  if (!ok || !code.device_code || !code.user_code || !code.verification_uri || !code.expires_in) {
    throw new CliError(
      `Login failed: ${code.error_description ?? code.message ?? "unexpected response"}`,
    )
  }
  const userCode = `${code.user_code.slice(0, 4)}-${code.user_code.slice(4)}`
  const url = code.verification_uri_complete ?? code.verification_uri

  info(`\nOpen ${cyan(url)}`)
  info(`and check that it shows the code ${bold(userCode)}\n`)
  if (flags.open !== false) openInBrowser(url)
  info(dim("Waiting for approval…"))

  let interval = (code.interval ?? 5) * 1000
  const deadline = Date.now() + code.expires_in * 1000
  while (Date.now() < deadline) {
    await new Promise((done) => setTimeout(done, interval))
    const poll = await post<{ access_token: string }>(`${server}/api/auth/device/token`, {
      grant_type: deviceGrant,
      device_code: code.device_code,
      client_id: clientId,
    })
    if (poll.ok && poll.data.access_token) {
      const token = poll.data.access_token
      const me = await fetch(`${server}/api/auth/get-session`, {
        headers: { authorization: `Bearer ${token}` },
      }).then((response) => response.json() as Promise<{ user?: { email: string } } | null>)
      await writeConfig({ server, token, email: me?.user?.email })
      info(`${green("✓")} Logged in to ${server}${me?.user ? ` as ${me.user.email}` : ""}`)
      return
    }
    switch (poll.data.error) {
      case "authorization_pending":
        break
      case "slow_down":
        interval += 5000
        break
      case "access_denied":
        throw new CliError("Login was denied in the browser")
      case "expired_token":
        throw new CliError("The code expired. Run `zup login` again.")
      default:
        throw new CliError(`Login failed: ${poll.data.error_description ?? poll.data.error}`)
    }
  }
  throw new CliError("The code expired. Run `zup login` again.")
}

export async function logout() {
  const saved = await readConfig()
  if (saved.server && saved.token) {
    // Ends the session on the server too, so the token stops working everywhere.
    await fetch(`${saved.server}/api/auth/sign-out`, {
      method: "POST",
      headers: { authorization: `Bearer ${saved.token}`, origin: saved.server },
    }).catch(() => {})
  }
  await clearConfig()
  info("Logged out")
}

export async function whoami(flags: { server?: string }) {
  const current = await session(flags.server)
  const me = await fetch(`${current.server}/api/auth/get-session`, {
    headers: { authorization: `Bearer ${current.token}` },
  }).then(
    (response) => response.json() as Promise<{ user?: { email: string; name: string } } | null>,
  )
  if (!me?.user) throw new CliError("Session expired. Run `zup login`.")
  process.stdout.write(`${me.user.email}\n`)
  info(dim(`${current.server} · sites on ${current.info.previewUrl}`))
}
