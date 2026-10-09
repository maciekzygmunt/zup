import { randomBytes } from "node:crypto"
import type { AccessInput } from "@zup/shared"
import { CliError } from "./ui.ts"

export type AccessFlags = {
  public?: boolean
  private?: boolean
  protect?: boolean
  password?: string
}

// Turns --public / --private / --protect / --password into an access input.
// --protect generates the key here, so a site and its alias can share it.
export function accessFromFlags(flags: AccessFlags): AccessInput | undefined {
  const chosen = [flags.public, flags.private, flags.protect || flags.password !== undefined]
  if (chosen.filter(Boolean).length > 1) {
    throw new CliError("Use only one of --public, --private, --protect / --password")
  }
  if (flags.public) return { type: "public" }
  if (flags.private) return { type: "private" }
  if (flags.password !== undefined) {
    if (flags.password.length < 8) throw new CliError("Passwords need at least 8 characters")
    return { type: "password", password: flags.password }
  }
  if (flags.protect) {
    return {
      type: "password",
      password: process.env.ZUP_PASSWORD || randomBytes(18).toString("base64url"),
    }
  }
  return undefined
}
