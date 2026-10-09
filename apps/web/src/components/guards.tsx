import { useQuery } from "@tanstack/react-query"
import { Navigate, Outlet, useLocation } from "react-router"
import { errorMessage } from "../lib/api.ts"
import { authClient } from "../lib/auth.ts"
import { setupQuery } from "../lib/queries.ts"
import { Button, Spinner } from "./ui.tsx"

export function FullPageSpinner() {
  return (
    <div className="grid min-h-dvh place-items-center">
      <Spinner />
    </div>
  )
}

export const loginPath = (location: { pathname: string; search: string }) =>
  `/login?redirect=${encodeURIComponent(location.pathname + location.search)}`

// Sends every page to /setup until the owner account exists.
export function SetupGate() {
  const setup = useQuery(setupQuery)
  const { pathname } = useLocation()
  if (setup.isPending) return <FullPageSpinner />
  if (setup.error) {
    return (
      <div className="grid min-h-dvh place-items-center p-6 text-center">
        <div className="grid gap-3">
          <p className="font-medium">Cannot reach the zup server.</p>
          <p className="text-[13px] text-muted">{errorMessage(setup.error)}</p>
          <Button onClick={() => setup.refetch()}>Try again</Button>
        </div>
      </div>
    )
  }
  if (setup.data.needsSetup && pathname !== "/setup") return <Navigate to="/setup" replace />
  if (!setup.data.needsSetup && pathname === "/setup") return <Navigate to="/" replace />
  return <Outlet />
}

export function RequireAuth() {
  const { data, isPending } = authClient.useSession()
  const location = useLocation()
  if (isPending) return <FullPageSpinner />
  if (!data) return <Navigate to={loginPath(location)} replace />
  return <Outlet />
}
