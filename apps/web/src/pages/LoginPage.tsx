import { Fingerprint } from "lucide-react"
import { type FormEvent, useEffect, useEffectEvent, useState } from "react"
import { useNavigate, useSearchParams } from "react-router"
import { CenteredPage } from "../components/AppShell.tsx"
import { Button, ErrorNote, Field, Input } from "../components/ui.tsx"
import { authClient } from "../lib/auth.ts"

// Sign-in responses carry `{ redirect, url }` when they continue an OAuth authorization.
const oauthUrl = (data: object) =>
  "url" in data && typeof data.url === "string" && data.url ? data.url : null

export function LoginPage() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const session = authClient.useSession()
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState<"password" | "passkey" | null>(null)
  // An MCP client's authorization request arrives as a signed query (with `sig`).
  const oauth = params.has("sig")
  const redirect = params.get("redirect") ?? "/"

  const finish = (data: object) => {
    const url = oauthUrl(data)
    // /api/ targets (like the preview-session handoff) need a full page load.
    if (url) window.location.href = url
    else if (redirect.startsWith("/api/")) window.location.assign(redirect)
    else
      navigate(redirect.startsWith("/") && !redirect.startsWith("//") ? redirect : "/", {
        replace: true,
      })
  }

  const onSignedIn = useEffectEvent(finish)

  // Already signed in: continue at once, unless an OAuth client asked to log in again.
  const signedIn = !!session.data
  useEffect(() => {
    if (signedIn && !oauth) onSignedIn({})
  }, [signedIn, oauth])

  // Passkey autofill (conditional UI) in the email field, where the browser supports it.
  useEffect(() => {
    let active = true
    window.PublicKeyCredential?.isConditionalMediationAvailable?.().then(async (available) => {
      if (!available || !active) return
      const result = await authClient.signIn.passkey({ autoFill: true })
      if (active && result.data) onSignedIn(result.data)
    })
    return () => {
      active = false
    }
  }, [])

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setError(null)
    setPending("password")
    const { data, error } = await authClient.signIn.email({ email, password })
    setPending(null)
    if (error) return setError(error.message ?? "Could not sign in.")
    finish(data)
  }

  const passkey = async () => {
    setError(null)
    setPending("passkey")
    const result = await authClient.signIn.passkey()
    setPending(null)
    if (result.error) return setError(result.error.message ?? "Passkey sign-in failed.")
    finish(result.data)
  }

  return (
    <CenteredPage>
      <div className="grid gap-1">
        <h1 className="text-xl font-semibold">Sign in</h1>
        <p className="text-[13px] text-muted text-pretty">
          {oauth
            ? "An app wants to connect to your zup. Sign in to review the request."
            : "Sign in to manage your sites."}
        </p>
      </div>
      <form onSubmit={submit} className="grid gap-4">
        <Field label="Email">
          <Input
            required
            type="email"
            autoComplete="username webauthn"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </Field>
        <Field label="Password">
          <Input
            required
            type="password"
            autoComplete="current-password webauthn"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </Field>
        {error && <ErrorNote>{error}</ErrorNote>}
        <Button variant="primary" type="submit" className="h-9" pending={pending === "password"}>
          Sign in
        </Button>
      </form>
      <div className="flex items-center gap-3 text-xs text-muted">
        <span className="h-px flex-1 bg-line" />
        or
        <span className="h-px flex-1 bg-line" />
      </div>
      <Button className="h-9" onClick={passkey} pending={pending === "passkey"}>
        <Fingerprint className="size-4" aria-hidden />
        Sign in with a passkey
      </Button>
    </CenteredPage>
  )
}
