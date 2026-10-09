import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Plug } from "lucide-react"
import { toast } from "sonner"
import { Button, Card, ErrorNote, Spinner } from "../../components/ui.tsx"
import { authClient, unwrap } from "../../lib/auth.ts"
import { fullDate, timeAgo } from "../../lib/format.ts"
import { Section } from "../SettingsPage.tsx"

const consentsKey = ["oauth-consents"]

// MCP clients (OAuth) the owner allowed on the consent page.
export function ConnectedApps() {
  const queryClient = useQueryClient()
  const list = useQuery({
    queryKey: consentsKey,
    queryFn: async () => {
      const consents = await unwrap(authClient.oauth2.getConsents())
      // Names come from each client's public metadata.
      return Promise.all(
        (consents ?? []).map(async (consent) => {
          const client = await authClient.oauth2.publicClient({
            query: { client_id: consent.clientId },
          })
          return { ...consent, name: client.data?.client_name || consent.clientId }
        }),
      )
    },
  })
  const revoke = useMutation({
    mutationFn: (id: string) => unwrap(authClient.oauth2.deleteConsent({ id })),
    onSuccess: () => {
      toast.success("App disconnected")
      queryClient.invalidateQueries({ queryKey: consentsKey })
    },
    onError: (error) => toast.error(error.message),
  })

  return (
    <Section
      title="Connected apps"
      description="MCP clients, like Claude Code, that can manage your sites."
    >
      <Card className="divide-y divide-line">
        {list.isPending && <Spinner className="m-4" />}
        {list.error && <ErrorNote>{list.error.message}</ErrorNote>}
        {list.data?.length === 0 && (
          <p className="p-4 text-[13px] text-muted">No apps connected.</p>
        )}
        {list.data?.map((consent) => (
          <div key={consent.id} className="flex items-center gap-3 px-4 py-2.5">
            <Plug className="size-4 shrink-0 text-muted" aria-hidden />
            <div className="grid min-w-0 flex-1">
              <span className="truncate text-[13px] font-medium">{consent.name}</span>
              <span className="truncate text-xs text-muted">
                <span title={fullDate(consent.createdAt)}>
                  Allowed {timeAgo(consent.createdAt)}
                </span>{" "}
                · {consent.scopes.join(" ")}
              </span>
            </div>
            <Button
              size="sm"
              variant="ghost"
              pending={revoke.isPending && revoke.variables === consent.id}
              onClick={() => revoke.mutate(consent.id)}
            >
              Disconnect
            </Button>
          </div>
        ))}
      </Card>
    </Section>
  )
}
