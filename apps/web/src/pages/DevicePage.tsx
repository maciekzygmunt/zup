import { useMutation, useQuery } from "@tanstack/react-query"
import { CheckCircle2, TerminalSquare, TriangleAlert, XCircle } from "lucide-react"
import { useState } from "react"
import { useSearchParams } from "react-router"
import { CenteredPage } from "../components/AppShell.tsx"
import { Button, Card, ErrorNote, Field, Input, Spinner } from "../components/ui.tsx"
import { authClient, unwrap } from "../lib/auth.ts"

const clientNames: Record<string, string> = { "zup-cli": "zup CLI" }

// Codes are shown as ABCD-EFGH but stored without the dash.
const normalize = (code: string) => code.replace(/[^a-z0-9]/gi, "").toUpperCase()
const pretty = (code: string) => (code.length === 8 ? `${code.slice(0, 4)}-${code.slice(4)}` : code)

export function DevicePage() {
  const [params, setParams] = useSearchParams()
  const userCode = normalize(params.get("user_code") ?? "")
  const [input, setInput] = useState("")

  if (!userCode) {
    return (
      <CenteredPage>
        <div className="grid gap-1">
          <h1 className="text-xl font-semibold">Connect a device</h1>
          <p className="text-[13px] text-muted">Enter the code shown in your terminal.</p>
        </div>
        <form
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault()
            setParams({ user_code: normalize(input) })
          }}
        >
          <Field label="Code">
            <Input
              required
              className="h-11 text-center font-mono text-lg tracking-widest uppercase"
              placeholder="ABCD-EFGH"
              value={input}
              onChange={(e) => setInput(e.target.value)}
            />
          </Field>
          <Button variant="primary" type="submit" className="h-9">
            Continue
          </Button>
        </form>
      </CenteredPage>
    )
  }
  return <Approve userCode={userCode} />
}

function Approve({ userCode }: { userCode: string }) {
  const request = useQuery({
    queryKey: ["device", userCode],
    queryFn: () => unwrap(authClient.device({ query: { user_code: userCode } })),
    retry: false,
  })
  const decide = useMutation({
    mutationFn: async (approve: boolean) => {
      await unwrap(
        approve ? authClient.device.approve({ userCode }) : authClient.device.deny({ userCode }),
      )
      return approve
    },
  })

  if (decide.data !== undefined) {
    return (
      <CenteredPage>
        <Card className="grid gap-3 p-5 text-center">
          {decide.data ? (
            <CheckCircle2 className="mx-auto size-8 text-ok" aria-hidden />
          ) : (
            <XCircle className="mx-auto size-8 text-muted" aria-hidden />
          )}
          <h1 className="text-lg font-semibold">
            {decide.data ? "Device approved" : "Request denied"}
          </h1>
          <p className="text-[13px] text-muted">
            You can close this tab and go back to the terminal.
          </p>
        </Card>
      </CenteredPage>
    )
  }

  const clientId = request.data?.client_id
  const status = request.data?.status
  return (
    <CenteredPage>
      <div className="grid gap-1">
        <h1 className="text-xl font-semibold">Approve sign-in</h1>
        <p className="text-[13px] text-muted">A device asks to sign in to your zup account.</p>
      </div>
      {request.isPending && <Spinner className="mx-auto" />}
      {request.error && (
        <ErrorNote>
          This code is not valid or has expired. Run <code>zup login</code> again for a new code.
        </ErrorNote>
      )}
      {request.data && (
        <Card className="grid gap-4 p-5">
          <div className="flex items-center gap-3">
            <span className="grid size-9 place-items-center rounded-lg bg-subtle">
              <TerminalSquare className="size-5" aria-hidden />
            </span>
            <div className="grid">
              <span className="font-medium">
                {(clientId && clientNames[clientId]) ?? clientId ?? "Unknown client"}
              </span>
              <span className="font-mono text-xs text-muted">{clientId}</span>
            </div>
          </div>
          <div className="grid gap-1 text-center">
            <span className="text-xs text-muted">Code</span>
            <span className="font-mono text-2xl font-semibold tracking-widest">
              {pretty(userCode)}
            </span>
          </div>
          {status === "pending" ? (
            <>
              <p className="flex gap-2 rounded-lg border border-warn/40 bg-warn/5 p-3 text-[13px] text-warn">
                <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
                <span>
                  Approve only if you started <code className="font-mono">zup login</code> yourself
                  and the code matches your terminal. The device gets full access to your sites.
                </span>
              </p>
              {decide.error && <ErrorNote>{decide.error.message}</ErrorNote>}
              <div className="grid grid-cols-2 gap-2">
                <Button
                  className="h-9"
                  pending={decide.isPending && decide.variables === false}
                  disabled={decide.isPending}
                  onClick={() => decide.mutate(false)}
                >
                  Deny
                </Button>
                <Button
                  variant="primary"
                  className="h-9"
                  pending={decide.isPending && decide.variables === true}
                  disabled={decide.isPending}
                  onClick={() => decide.mutate(true)}
                >
                  Approve
                </Button>
              </div>
            </>
          ) : (
            <ErrorNote>This request is already {status}. Run zup login again if needed.</ErrorNote>
          )}
        </Card>
      )}
    </CenteredPage>
  )
}
