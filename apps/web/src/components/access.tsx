import { Tooltip } from "@base-ui/react/tooltip"
import {
  type AccessInput,
  type AccessType,
  type AliasSummary,
  accessTypes,
  passwordSchema,
} from "@zup/shared"
import { Bot, Globe, KeyRound, Lock } from "lucide-react"
import { useId } from "react"
import { cx, Field, Input } from "./ui.tsx"

export const accessInfo = {
  private: { label: "Private", icon: Lock, hint: "Only you can open it." },
  public: { label: "Public", icon: Globe, hint: "Anyone with the link can open it." },
  password: { label: "Password", icon: KeyRound, hint: "Anyone with the password can open it." },
} satisfies Record<AccessType, { label: string; icon: typeof Lock; hint: string }>

const badgeTone: Record<AccessType, string> = {
  private: "border-line bg-subtle text-muted",
  public: "border-ok/30 bg-ok/10 text-ok",
  password: "border-warn/30 bg-warn/10 text-warn",
}

export function AccessBadge({ access }: { access: AccessType }) {
  const { label, icon: Icon } = accessInfo[access]
  return (
    <span
      className={cx(
        "inline-flex h-5 items-center gap-1 rounded-full border px-1.5 text-[11.5px] font-medium",
        badgeTone[access],
      )}
    >
      <Icon className="size-3" aria-hidden />
      {label}
    </span>
  )
}

// Access badge for an alias, with a robot icon when search engines can crawl it.
export function AliasAccessBadge({ alias }: { alias: Pick<AliasSummary, "access" | "indexable"> }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <AccessBadge access={alias.access} />
      {alias.access === "public" && alias.indexable && <CrawlIcon />}
    </span>
  )
}

// Marks an alias that search engines can crawl, with a tooltip on hover or focus.
export function CrawlIcon({ className }: { className?: string }) {
  return (
    <Tooltip.Root>
      <Tooltip.Trigger
        delay={150}
        className={cx(
          "relative z-10 inline-flex cursor-default rounded-sm text-muted outline-accent",
          className,
        )}
      >
        <Bot className="size-3.5" aria-label="Crawlable" role="img" />
      </Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Positioner className="z-50" sideOffset={6}>
          <Tooltip.Popup className="max-w-56 rounded-md bg-fg px-2 py-1 text-xs text-bg shadow-md transition-opacity duration-100 data-ending-style:opacity-0 data-starting-style:opacity-0">
            Crawlable
          </Tooltip.Popup>
        </Tooltip.Positioner>
      </Tooltip.Portal>
    </Tooltip.Root>
  )
}

export function AccessIcon({ access, className }: { access: AccessType; className?: string }) {
  const { label, icon: Icon } = accessInfo[access]
  return <Icon className={cx("size-3", className)} aria-label={label} role="img" />
}

// Editable access state: `password` is the optional custom password.
export type AccessDraft = { type: AccessType; password: string }

export const accessDraft = (type: AccessType = "private"): AccessDraft => ({ type, password: "" })

export function draftError(draft: AccessDraft) {
  if (draft.type !== "password" || !draft.password) return null
  const result = passwordSchema.safeParse(draft.password)
  return result.success ? null : "Use at least 8 characters"
}

export const draftToInput = (draft: AccessDraft): AccessInput =>
  draft.type === "password"
    ? { type: "password", password: draft.password || undefined }
    : { type: draft.type }

export function AccessPicker({
  value,
  onChange,
  passwordHint = "Leave empty to generate a strong password.",
}: {
  value: AccessDraft
  onChange: (value: AccessDraft) => void
  passwordHint?: string
}) {
  const error = draftError(value)
  const name = useId()
  return (
    <div className="grid gap-3">
      <fieldset className="grid grid-cols-3 gap-2">
        <legend className="sr-only">Access</legend>
        {accessTypes.map((type) => {
          const { label, icon: Icon } = accessInfo[type]
          const checked = value.type === type
          return (
            <label
              key={type}
              className={cx(
                "flex cursor-pointer flex-col items-start gap-1 rounded-lg border px-3 py-2 transition-colors has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-accent",
                checked
                  ? "border-accent bg-accent/5 ring-1 ring-accent"
                  : "border-line hover:bg-subtle",
              )}
            >
              <input
                type="radio"
                name={name}
                className="sr-only"
                checked={checked}
                onChange={() => onChange({ ...value, type })}
              />
              <Icon className={cx("size-4", checked ? "text-accent" : "text-muted")} aria-hidden />
              <span className="text-[13px] font-medium">{label}</span>
            </label>
          )
        })}
      </fieldset>
      <p className="text-xs text-muted">{accessInfo[value.type].hint}</p>
      {value.type === "password" && (
        <Field label="Password (optional)" hint={passwordHint} error={error}>
          <Input
            type="text"
            autoComplete="off"
            spellCheck={false}
            className="font-mono"
            placeholder="Generate one for me"
            value={value.password}
            aria-invalid={!!error}
            onChange={(e) => onChange({ ...value, password: e.target.value })}
          />
        </Field>
      )}
    </div>
  )
}
