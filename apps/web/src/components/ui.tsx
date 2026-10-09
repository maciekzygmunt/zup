import { Loader2 } from "lucide-react"
import type { ComponentProps, ReactNode } from "react"

export const cx = (...classes: (string | false | null | undefined)[]) =>
  classes.filter(Boolean).join(" ")

const buttonVariants = {
  primary: "bg-fg text-bg hover:opacity-85",
  accent: "bg-accent text-accent-fg hover:opacity-90",
  secondary: "border border-line bg-card text-fg hover:bg-subtle",
  ghost: "text-muted hover:bg-subtle hover:text-fg",
  danger: "bg-danger text-white hover:opacity-90",
}

export const buttonClass = (
  variant: keyof typeof buttonVariants = "secondary",
  size: "sm" | "md" | "icon" = "md",
) =>
  cx(
    "inline-flex shrink-0 items-center justify-center gap-1.5 rounded-md font-medium whitespace-nowrap select-none",
    "transition-[opacity,background-color,color,transform] duration-150 active:scale-[0.98]",
    "disabled:pointer-events-none disabled:opacity-50",
    size === "sm" && "h-7 px-2.5 text-[13px]",
    size === "md" && "h-8 px-3 text-sm",
    size === "icon" && "size-8",
    buttonVariants[variant],
  )

type ButtonProps = ComponentProps<"button"> & {
  variant?: keyof typeof buttonVariants
  size?: "sm" | "md" | "icon"
  pending?: boolean
}

export function Button({
  variant,
  size,
  pending,
  className,
  children,
  disabled,
  type = "button",
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      className={cx(buttonClass(variant, size), className)}
      disabled={disabled || pending}
      {...props}
    >
      {pending && <Loader2 className="size-3.5 animate-spin" aria-hidden />}
      {children}
    </button>
  )
}

export const inputClass = cx(
  "h-9 w-full rounded-md border border-line bg-card px-3 text-sm text-fg placeholder:text-muted",
  "outline-none focus:border-accent focus:ring-3 focus:ring-accent/20",
  "aria-invalid:border-danger disabled:opacity-60",
)

export function Input({ className, ...props }: ComponentProps<"input">) {
  return <input className={cx(inputClass, className)} {...props} />
}

// A label with its control and an optional hint or error below.
export function Field({
  label,
  hint,
  error,
  children,
  className,
}: {
  label: ReactNode
  hint?: ReactNode
  error?: string | null
  children: ReactNode
  className?: string
}) {
  return (
    <div className={cx("grid gap-1.5", className)}>
      {/* biome-ignore lint/a11y/noLabelWithoutControl: the control is passed as children */}
      <label className="grid gap-1.5">
        <span className="text-[13px] font-medium">{label}</span>
        {children}
      </label>
      {error ? (
        <span className="text-xs text-danger" role="alert">
          {error}
        </span>
      ) : (
        hint && <span className="text-xs text-muted">{hint}</span>
      )}
    </div>
  )
}

export function Card({ className, ...props }: ComponentProps<"section">) {
  return <section className={cx("rounded-lg border border-line bg-card", className)} {...props} />
}

export function Spinner({ className }: { className?: string }) {
  return (
    <Loader2 className={cx("size-4 animate-spin text-muted", className)} aria-label="Loading" />
  )
}

export function Mono({ className, ...props }: ComponentProps<"span">) {
  return <span className={cx("font-mono text-[12.5px]", className)} {...props} />
}

export function ErrorNote({ children }: { children: ReactNode }) {
  return (
    <p
      className="rounded-md border border-danger/30 bg-danger/5 px-3 py-2 text-[13px] text-danger"
      role="alert"
    >
      {children}
    </p>
  )
}
