import { slugSchema } from "@zup/shared"
import type { Session } from "./api.ts"
import { CliError } from "./ui.ts"

// Accepts a slug, a site URL (<preview-url>/<slug>/) or a dashboard URL (/sites/<slug>).
export function siteSlug(session: Session, input: string): string {
  let slug = input
  if (/^https?:\/\//.test(input)) {
    const url = new URL(input)
    const [first, second] = url.pathname.split("/").filter(Boolean)
    if (url.origin === new URL(session.info.previewUrl).origin && first) slug = first
    else if (url.origin === session.server && first === "sites" && second) slug = second
    else throw new CliError(`${input} is not a site URL of ${session.server}`)
  }
  if (!slugSchema.safeParse(slug).success) throw new CliError(`${input} is not a slug or site URL`)
  return slug
}
