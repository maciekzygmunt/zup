import type { ReactNode } from "react"
import { ConnectedApps } from "./settings/ConnectedApps.tsx"
import { Passkeys } from "./settings/Passkeys.tsx"
import { Profile } from "./settings/Profile.tsx"
import { Sessions } from "./settings/Sessions.tsx"
import { SetupHelp } from "./settings/SetupHelp.tsx"

export function SettingsPage() {
  return (
    <div className="grid gap-8">
      <h1 className="text-xl font-semibold">Settings</h1>
      <Profile />
      <Passkeys />
      <Sessions />
      <ConnectedApps />
      <SetupHelp />
    </div>
  )
}

// A titled settings block with an optional action on the right.
export function Section({
  title,
  description,
  action,
  children,
}: {
  title: string
  description?: ReactNode
  action?: ReactNode
  children: ReactNode
}) {
  return (
    <section className="grid gap-3 md:grid-cols-[14rem_1fr] md:gap-8">
      <div className="grid content-start gap-1">
        <h2 className="text-sm font-semibold">{title}</h2>
        {description && <p className="text-[13px] text-muted text-pretty">{description}</p>}
        {action && <div className="pt-2">{action}</div>}
      </div>
      <div className="min-w-0">{children}</div>
    </section>
  )
}
