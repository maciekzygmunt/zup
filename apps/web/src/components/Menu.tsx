import { Menu as Base } from "@base-ui/react/menu"
import type { LucideIcon } from "lucide-react"
import type { ReactElement, ReactNode } from "react"
import { cx } from "./ui.tsx"

const itemClass = (danger?: boolean) =>
  cx(
    "flex cursor-default items-center gap-2 rounded-md px-2 py-1.5 text-[13px] outline-none select-none",
    "data-highlighted:bg-subtle data-disabled:opacity-50",
    danger ? "text-danger" : "text-fg",
  )

// Dropdown menu: a trigger element plus items.
export function Menu({
  trigger,
  children,
  align = "end",
}: {
  trigger: ReactElement
  children: ReactNode
  align?: "start" | "end"
}) {
  return (
    <Base.Root>
      <Base.Trigger render={trigger} />
      <Base.Portal>
        <Base.Positioner className="z-50 outline-none" sideOffset={4} align={align}>
          <Base.Popup className="min-w-48 origin-(--transform-origin) rounded-lg border border-line bg-card p-1 shadow-lg outline-none transition-[scale,opacity] duration-100 data-ending-style:scale-[0.98] data-ending-style:opacity-0 data-starting-style:scale-[0.98] data-starting-style:opacity-0">
            {children}
          </Base.Popup>
        </Base.Positioner>
      </Base.Portal>
    </Base.Root>
  )
}

export function MenuItem({
  icon: Icon,
  children,
  onClick,
  danger,
}: {
  icon: LucideIcon
  children: ReactNode
  onClick: () => void
  danger?: boolean
}) {
  return (
    <Base.Item className={itemClass(danger)} onClick={onClick}>
      <Icon className="size-3.5 opacity-70" aria-hidden />
      {children}
    </Base.Item>
  )
}

// A menu item that opens a link in a new tab.
export function MenuLink({
  icon: Icon,
  href,
  children,
}: {
  icon: LucideIcon
  href: string
  children: ReactNode
}) {
  return (
    <Base.LinkItem
      className={itemClass()}
      href={href}
      target="_blank"
      rel="noreferrer"
      closeOnClick
    >
      <Icon className="size-3.5 opacity-70" aria-hidden />
      {children}
    </Base.LinkItem>
  )
}

export function MenuSeparator() {
  return <Base.Separator className="mx-1 my-1 h-px bg-line" />
}
