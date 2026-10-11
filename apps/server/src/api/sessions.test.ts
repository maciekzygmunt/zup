import { afterAll, beforeAll, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createServer } from "../app.ts"
import { loadConfig } from "../config.ts"

const dataDir = mkdtempSync(join(tmpdir(), "zup-test-"))
const config = loadConfig({
  APP_URL: "http://localhost:4100",
  PREVIEW_URL: "http://127.0.0.1:4100",
  BETTER_AUTH_SECRET: "test-secret-that-is-long-enough-1234567890",
  DATA_DIR: dataDir,
})
let server: Awaited<ReturnType<typeof createServer>>
// Better Auth POSTs hang on in-memory Requests, so go through a real HTTP server.
let http: ReturnType<typeof Bun.serve>

const request = (method: string, path: string, init: { token?: string; body?: unknown } = {}) =>
  fetch(`http://127.0.0.1:${http.port}${path}`, {
    method,
    headers: {
      host: "localhost:4100",
      origin: config.appOrigin,
      "content-type": "application/json",
      ...(init.token && { authorization: `Bearer ${init.token}` }),
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  })

// Signs in through Better Auth and returns the bearer token of the new session.
async function login(path: "sign-up" | "sign-in") {
  const body = { email: "owner@example.com", password: "a-long-password", name: "Owner" }
  const response = await request("POST", `/api/auth/${path}/email`, { body })
  expect(response.status).toBe(200)
  return response.headers.get("set-auth-token")!
}

beforeAll(async () => {
  server = await createServer(config)
  http = Bun.serve({ port: 0, fetch: (req, bun) => server.fetch(req, bun.requestIP(req)?.address) })
})
afterAll(() => {
  http.stop(true)
  server.close()
  rmSync(dataDir, { recursive: true, force: true })
})

test("lists sessions without tokens and revokes them by id", async () => {
  const first = await login("sign-up")
  const second = await login("sign-in")

  const response = await request("GET", "/api/sessions", { token: second })
  const text = await response.text()
  // Bearer tokens are `<session token>.<signature>`.
  for (const token of [first, second]) expect(text).not.toContain(token.split(".")[0]!)
  const { sessions } = JSON.parse(text) as { sessions: { id: string; current: boolean }[] }
  expect(sessions).toHaveLength(2)
  const other = sessions.find((s) => !s.current)!

  const revoked = await request("DELETE", `/api/sessions/${other.id}`, { token: second })
  expect(revoked.status).toBe(204)
  expect((await request("GET", "/api/sessions", { token: first })).status).toBe(401)
  expect((await request("DELETE", `/api/sessions/${other.id}`, { token: second })).status).toBe(404)
})
