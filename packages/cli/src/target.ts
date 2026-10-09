import { aliasNameSchema } from "@zup/shared"
import { type Client, type Session, unwrap } from "./api.ts"
import { CliError } from "./ui.ts"

export type Target = { kind: "deployment"; id: string } | { kind: "alias"; name: string }

const deploymentIdPattern = /^[A-Za-z0-9]{16}$/

// Accepts a site URL (/u/<id>/ or /<alias>/), a dashboard URL, a deployment id or an alias.
export async function resolveTarget(session: Session, api: Client, input: string): Promise<Target> {
  if (/^https?:\/\//.test(input)) {
    const url = new URL(input)
    const [first, second] = url.pathname.split("/").filter(Boolean)
    if (url.origin === new URL(session.info.previewUrl).origin) {
      if (first === "u" && second) return { kind: "deployment", id: second }
      if (first) return { kind: "alias", name: first }
    }
    if (url.origin === session.server && first === "sites" && second) {
      return { kind: "deployment", id: second }
    }
    throw new CliError(`${input} is not a site URL of ${session.server}`)
  }
  if (deploymentIdPattern.test(input) && /[A-Z]/.test(input))
    return { kind: "deployment", id: input }
  if (aliasNameSchema.safeParse(input).success) {
    const { aliases } = await unwrap(api.aliases.$get())
    if (aliases.some((alias) => alias.name === input)) return { kind: "alias", name: input }
  }
  if (deploymentIdPattern.test(input)) return { kind: "deployment", id: input }
  throw new CliError(`No alias or deployment named ${input}`)
}

export const describe = (target: Target) =>
  target.kind === "alias" ? `alias ${target.name}` : `deployment ${target.id}`

// The deployment behind a target: an alias resolves to the deployment it points to.
export async function deploymentIdOf(api: Client, target: Target) {
  if (target.kind === "deployment") return target.id
  const { aliases } = await unwrap(api.aliases.$get())
  return aliases.find((alias) => alias.name === target.name)!.deploymentId
}
