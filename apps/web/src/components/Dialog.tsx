import { Dialog as Base } from "@base-ui/react/dialog"
import { X } from "lucide-react"
import { type ReactNode, useRef } from "react"
import { buttonClass, cx } from "./ui.tsx"

// Controlled modal shell. Its children mount on open and unmount on close, so content
// components can keep form state in plain useState and start fresh each time.
// Focus starts on the element marked `data-autofocus`, else the first tabbable one.
export function Dialog({
  open,
  onOpenChange,
  children,
  wide,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  children: ReactNode
  wide?: boolean
}) {
  const popup = useRef<HTMLDivElement>(null)
  return (
    <Base.Root open={open} onOpenChange={onOpenChange}>
      <Base.Portal>
        <Base.Backdrop className="fixed inset-0 z-40 bg-black/30 transition-opacity duration-150 data-ending-style:opacity-0 data-starting-style:opacity-0 dark:bg-black/60" />
        <Base.Popup
          ref={popup}
          initialFocus={(type) =>
            type === "touch" ||
            (popup.current?.querySelector<HTMLElement>("[data-autofocus]") ?? true)
          }
          className={cx(
            "fixed top-1/2 left-1/2 z-40 flex max-h-[calc(100dvh-2rem)] w-[calc(100vw-2rem)] -translate-x-1/2 -translate-y-1/2 flex-col rounded-xl border border-line bg-card shadow-xl outline-none",
            "transition-[scale,opacity] duration-150 ease-out data-ending-style:scale-[0.98] data-ending-style:opacity-0 data-starting-style:scale-[0.98] data-starting-style:opacity-0",
            wide ? "max-w-2xl" : "max-w-md",
          )}
        >
          {children}
        </Base.Popup>
      </Base.Portal>
    </Base.Root>
  )
}

export function DialogHeader({
  title,
  description,
}: {
  title: ReactNode
  description?: ReactNode
}) {
  return (
    <div className="flex items-start justify-between gap-4 px-5 pt-4">
      <div className="grid gap-1">
        <Base.Title className="text-base font-semibold text-balance">{title}</Base.Title>
        {description && (
          <Base.Description className="text-[13px] text-muted text-pretty">
            {description}
          </Base.Description>
        )}
      </div>
      <Base.Close className={cx(buttonClass("ghost", "icon"), "-mr-2 size-7")} aria-label="Close">
        <X className="size-4" />
      </Base.Close>
    </div>
  )
}

export function DialogBody({ children }: { children: ReactNode }) {
  return <div className="grid min-h-0 gap-4 overflow-y-auto px-5 py-4">{children}</div>
}

export function DialogFooter({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-wrap justify-end gap-2 border-t border-line px-5 py-3">
      {children}
    </div>
  )
}

export function CancelButton({ label = "Cancel" }: { label?: string }) {
  return <Base.Close className={buttonClass("secondary")}>{label}</Base.Close>
}
