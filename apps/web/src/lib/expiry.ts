import { parseExpiry } from "@zup/shared"

export const expiryPresets = [
  { value: "never", label: "Never" },
  { value: "1h", label: "In 1 hour" },
  { value: "1d", label: "In 1 day" },
  { value: "7d", label: "In 7 days" },
  { value: "30d", label: "In 30 days" },
  { value: "custom", label: "Custom date…" },
] as const

export type ExpiryChoice = { preset: (typeof expiryPresets)[number]["value"]; custom: string }

export const noExpiry: ExpiryChoice = { preset: "never", custom: "" }

// Returns the ISO date to send, null for "never", or throws with a readable message.
export function expiryToIso({ preset, custom }: ExpiryChoice): string | null {
  if (preset === "never") return null
  if (preset === "custom") {
    if (!custom) throw new Error("Pick an expiry date")
    return parseExpiry(new Date(custom).toISOString()).toISOString()
  }
  return parseExpiry(preset).toISOString()
}

// Value for <input type="datetime-local"> in local time.
export function toLocalInput(iso: string) {
  const date = new Date(iso)
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16)
}
