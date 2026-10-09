import { LogOut, Settings, UserRound } from "lucide-react"
import type { ReactNode } from "react"
import { NavLink, Outlet, useNavigate } from "react-router"
import { authClient } from "../lib/auth.ts"
import { queryClient } from "../lib/queries.ts"
import { Menu, MenuItem, MenuSeparator } from "./Menu.tsx"
import { cx } from "./ui.tsx"
import { UploadProvider } from "./upload/UploadProvider.tsx"

const links = [
  { to: "/", label: "Sites", end: true },
  { to: "/aliases", label: "Aliases", end: false },
  { to: "/settings", label: "Settings", end: false },
]

export function Logo() {
  return (
    <span className="flex items-center gap-2 font-mono text-[13px] font-semibold tracking-wide">
      <img src="/favicon.svg" alt="" className="size-5" />
      zup
    </span>
  )
}

export function AppShell() {
  const { data } = authClient.useSession()
  const navigate = useNavigate()
  const signOut = async () => {
    await authClient.signOut()
    queryClient.clear()
    navigate("/login")
  }
  return (
    <UploadProvider>
      <div className="min-h-dvh">
        <header className="sticky top-0 z-30 border-b border-line bg-bg/85 backdrop-blur">
          <div className="mx-auto flex h-12 max-w-6xl items-center gap-4 px-4 sm:gap-6">
            <NavLink to="/" aria-label="zup home">
              <Logo />
            </NavLink>
            <nav className="flex items-center gap-1" aria-label="Main">
              {links.map((link) => (
                <NavLink
                  key={link.to}
                  to={link.to}
                  end={link.end}
                  className={({ isActive }) =>
                    cx(
                      "rounded-md px-2.5 py-1 text-[13px] font-medium transition-colors",
                      isActive ? "bg-subtle text-fg" : "text-muted hover:text-fg",
                    )
                  }
                >
                  {link.label}
                </NavLink>
              ))}
            </nav>
            <div className="ml-auto">
              <Menu
                trigger={
                  <button
                    type="button"
                    className="flex size-8 items-center justify-center rounded-full border border-line bg-card text-[12px] font-semibold uppercase hover:bg-subtle"
                    aria-label="Account"
                  >
                    {data?.user.name.slice(0, 1) || <UserRound className="size-4" />}
                  </button>
                }
              >
                <div className="px-2 py-1.5">
                  <p className="truncate text-[13px] font-medium">{data?.user.name}</p>
                  <p className="truncate text-xs text-muted">{data?.user.email}</p>
                </div>
                <MenuSeparator />
                <MenuItem icon={Settings} onClick={() => navigate("/settings")}>
                  Settings
                </MenuItem>
                <MenuItem icon={LogOut} onClick={signOut}>
                  Sign out
                </MenuItem>
              </Menu>
            </div>
          </div>
        </header>
        <main className="mx-auto max-w-6xl px-4 py-6 sm:py-8">
          <Outlet />
        </main>
      </div>
    </UploadProvider>
  )
}

// Centered single-card layout for setup, login, device approval and consent.
export function CenteredPage({ children }: { children: ReactNode }) {
  return (
    <main className="grid min-h-dvh place-items-center px-4 py-10">
      <div className="grid w-full max-w-sm gap-6">
        <Logo />
        {children}
      </div>
    </main>
  )
}
