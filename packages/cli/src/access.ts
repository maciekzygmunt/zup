import { type AccessInput, generateKey } from "@zup/shared"
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
      password: process.env.ZUP_PASSWORD || generateKey(),
    }
  }
  return undefined
}

export type IndexFlags = { index?: boolean; "no-index"?: boolean }

// Turns --index / --no-index into whether search engines may crawl an alias. Undefined keeps it.
export function indexableFromFlags(flags: IndexFlags) {
  if (flags.index && flags["no-index"]) throw new CliError("Use only one of --index, --no-index")
  return flags.index ? true : flags["no-index"] ? false : undefined
}
