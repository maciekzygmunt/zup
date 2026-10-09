import { useMutation, useQuery } from "@tanstack/react-query"
import { Check, Plug } from "lucide-react"
import { useSearchParams } from "react-router"
import { CenteredPage } from "../components/AppShell.tsx"
import { Button, Card, ErrorNote, Spinner } from "../components/ui.tsx"
import { authClient, unwrap } from "../lib/auth.ts"
import { useInfo } from "../lib/queries.ts"

const scopeText: Record<string, string> = {
  openid: "Confirm that it is you",
  profile: "See your name",
  email: "See your email address",
  offline_access: "Stay connected until you revoke it",
}

// OAuth consent for MCP clients. The page query is signed by the server; the auth client
// sends it back with the decision.
export function ConsentPage() {
  const [params] = useSearchParams()
  const info = useInfo()
  const clientId = params.get("client_id") ?? ""
  const scopes = (params.get("scope") ?? "").split(" ").filter(Boolean)
  const client = useQuery({
    queryKey: ["oauth-client", clientId],
    queryFn: () => unwrap(authClient.oauth2.publicClient({ query: { client_id: clientId } })),
    enabled: !!clientId,
    retry: false,
  })
  const decide = useMutation({
    mutationFn: (accept: boolean) => unwrap(authClient.oauth2.consent({ accept })),
    onSuccess: (data) => {
      if (data?.url) window.location.href = data.url
    },
  })
  const name = client.data?.client_name || "An app"

  if (!params.has("sig")) {
    return (
      <CenteredPage>
        <ErrorNote>
          This page needs a request from an app. Start the connection in the app.
        </ErrorNote>
      </CenteredPage>
    )
  }
  return (
    <CenteredPage>
      <div className="grid gap-1">
        <h1 className="text-xl font-semibold text-balance">Connect {name} to zup?</h1>
        <p className="text-[13px] text-muted text-pretty">
          {name} will be able to publish, change and delete sites on{" "}
          {info ? new URL(info.appUrl).host : "this server"} through MCP.
        </p>
      </div>
      <Card className="grid gap-4 p-5">
        <div className="flex items-center gap-3">
          <span className="grid size-9 place-items-center rounded-lg bg-subtle font-semibold uppercase">
            {client.data?.client_name?.slice(0, 1) ?? <Plug className="size-4" aria-hidden />}
          </span>
          <div className="grid min-w-0">
            <span className="truncate font-medium">{client.isPending ? <Spinner /> : name}</span>
            {client.data?.client_uri && (
              <span className="truncate text-xs text-muted">{client.data.client_uri}</span>
            )}
            <span className="truncate font-mono text-[11px] text-muted">{clientId}</span>
          </div>
        </div>
        {scopes.length > 0 && (
          <ul className="grid gap-1.5 text-[13px]">
            {scopes.map((scope) => (
              <li key={scope} className="flex items-center gap-2">
                <Check className="size-3.5 text-ok" aria-hidden />
                {scopeText[scope] ?? scope}
              </li>
            ))}
            <li className="flex items-center gap-2">
              <Check className="size-3.5 text-ok" aria-hidden />
              Manage your sites and aliases
            </li>
          </ul>
        )}
        <p className="text-xs text-muted">
          Only allow apps you set up yourself. You can disconnect it later in Settings.
        </p>
        {decide.error && <ErrorNote>{decide.error.message}</ErrorNote>}
        <div className="grid grid-cols-2 gap-2">
          <Button
            className="h-9"
            disabled={decide.isPending}
            pending={decide.isPending && decide.variables === false}
            onClick={() => decide.mutate(false)}
          >
            Deny
          </Button>
          <Button
            variant="primary"
            className="h-9"
            disabled={decide.isPending}
            pending={decide.isPending && decide.variables === true}
            onClick={() => decide.mutate(true)}
          >
            Allow
          </Button>
        </div>
      </Card>
    </CenteredPage>
  )
}
