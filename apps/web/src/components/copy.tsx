import type { GrantedKey } from "@zup/shared"
import { Check, Copy, ExternalLink, TriangleAlert } from "lucide-react"
import { useState } from "react"
import { toast } from "sonner"
import { buttonClass, cx } from "./ui.tsx"

export async function copyText(text: string, message = "Link copied") {
  try {
    await navigator.clipboard.writeText(text)
    toast.success(message)
    return true
  } catch {
    toast.error("Could not copy. Select the text and copy it yourself.")
    return false
  }
}

export function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      type="button"
      className={buttonClass("ghost", "icon")}
      aria-label={label}
      title={label}
      onClick={async () => {
        if (!(await copyText(text, "Copied"))) return
        setCopied(true)
        setTimeout(() => setCopied(false), 1500)
      }}
    >
      {copied ? <Check className="size-4 text-ok" /> : <Copy className="size-4" />}
    </button>
  )
}

// A read-only value with copy (and optional open) buttons.
export function CopyRow({
  label,
  value,
  href,
  secret,
}: {
  label: string
  value: string
  href?: string
  secret?: boolean
}) {
  return (
    <div className="grid gap-1">
      <span className="text-[12px] font-medium text-muted">{label}</span>
      <div className="flex items-center gap-1 rounded-md border border-line bg-subtle pl-3">
        <input
          readOnly
          value={value}
          aria-label={label}
          onFocus={(e) => e.currentTarget.select()}
          className={cx(
            "h-8 min-w-0 flex-1 bg-transparent font-mono text-[12.5px] outline-none",
            secret && "font-semibold",
          )}
        />
        <CopyButton text={value} label={`Copy ${label.toLowerCase()}`} />
        {href && (
          <a
            href={href}
            target="_blank"
            rel="noreferrer"
            className={buttonClass("ghost", "icon")}
            aria-label={`Open ${label.toLowerCase()}`}
            title="Open in new tab"
          >
            <ExternalLink className="size-4" />
          </a>
        )}
      </div>
    </div>
  )
}

// The server returns a password only once; it cannot be shown again later.
export function KeyReveal({ grant, label = "Password" }: { grant: GrantedKey; label?: string }) {
  return (
    <div className="grid gap-3 rounded-lg border border-warn/40 bg-warn/5 p-3">
      <p className="flex items-start gap-2 text-[13px] text-warn">
        <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
        <span>
          <strong className="font-semibold">Shown only once.</strong> Copy the password or the share
          link now. zup stores only a hash. You can create new share links later.
        </span>
      </p>
      <CopyRow label={label} value={grant.key} secret />
      <CopyRow label="Share link (unlocks without typing)" value={grant.shareUrl} />
    </div>
  )
}
