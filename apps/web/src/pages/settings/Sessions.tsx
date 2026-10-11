import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Monitor, TerminalSquare } from "lucide-react"
import { toast } from "sonner"
import { Button, Card, ErrorNote, Spinner } from "../../components/ui.tsx"
import { api, parseResponse } from "../../lib/api.ts"
import { authClient, unwrap } from "../../lib/auth.ts"
import { describeAgent, fullDate, timeAgo } from "../../lib/format.ts"
import { Section } from "../SettingsPage.tsx"

const sessionsKey = ["sessions"]

export function Sessions() {
  const queryClient = useQueryClient()
  const list = useQuery({
    queryKey: sessionsKey,
    queryFn: async () => (await parseResponse(api.sessions.$get())).sessions,
  })
  const refresh = () => queryClient.invalidateQueries({ queryKey: sessionsKey })
  const revoke = useMutation({
    mutationFn: (id: string) => parseResponse(api.sessions[":id"].$delete({ param: { id } })),
    onSuccess: () => {
      toast.success("Session signed out")
      refresh()
    },
    onError: (error) => toast.error(error.message),
  })
  const revokeOthers = useMutation({
    mutationFn: () => unwrap(authClient.revokeOtherSessions()),
    onSuccess: () => {
      toast.success("Other sessions signed out")
      refresh()
    },
    onError: (error) => toast.error(error.message),
  })
  const sessions = [...(list.data ?? [])].sort(
    (a, b) =>
      Number(b.current) - Number(a.current) ||
      new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
  )

  return (
    <Section
      title="Sessions"
      description="Browsers and CLI logins (zup login) signed in to your account."
      action={
        sessions.length > 1 && (
          <Button size="sm" onClick={() => revokeOthers.mutate()} pending={revokeOthers.isPending}>
            Sign out other sessions
          </Button>
        )
      }
    >
      <Card className="divide-y divide-line">
        {list.isPending && <Spinner className="m-4" />}
        {list.error && <ErrorNote>{list.error.message}</ErrorNote>}
        {sessions.map((session) => {
          const agent = describeAgent(session.userAgent)
          const Icon = agent === "zup CLI" ? TerminalSquare : Monitor
          return (
            <div key={session.id} className="flex items-center gap-3 px-4 py-2.5">
              <Icon className="size-4 shrink-0 text-muted" aria-hidden />
              <div className="grid min-w-0 flex-1">
                <span className="flex items-center gap-2 text-[13px] font-medium">
                  {agent}
                  {session.current && (
                    <span className="rounded-full bg-ok/10 px-1.5 text-[11px] font-medium text-ok">
                      This browser
                    </span>
                  )}
                </span>
                <span className="truncate text-xs text-muted">
                  {session.ipAddress || "Unknown IP"} ·{" "}
                  <span title={fullDate(session.createdAt)}>
                    signed in {timeAgo(session.createdAt)}
                  </span>{" "}
                  ·{" "}
                  <span title={fullDate(session.updatedAt)}>
                    active {timeAgo(session.updatedAt)}
                  </span>
                </span>
              </div>
              {!session.current && (
                <Button
                  size="sm"
                  variant="ghost"
                  pending={revoke.isPending && revoke.variables === session.id}
                  onClick={() => revoke.mutate(session.id)}
                >
                  Sign out
                </Button>
              )}
            </div>
          )
        })}
      </Card>
    </Section>
  )
}
