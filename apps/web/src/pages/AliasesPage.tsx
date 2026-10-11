import { Link } from "react-router"
import { AliasMenu } from "../components/AliasMenu.tsx"
import { AliasAccessBadge } from "../components/access.tsx"
import { CopyButton } from "../components/copy.tsx"
import { Card, ErrorNote, Mono, Spinner } from "../components/ui.tsx"
import { errorMessage } from "../lib/api.ts"
import { fullDate, plural, timeAgo } from "../lib/format.ts"
import { useAliases } from "../lib/queries.ts"

export function AliasesPage() {
  const aliases = useAliases()
  return (
    <div className="grid gap-5">
      <div>
        <h1 className="text-xl font-semibold">Aliases</h1>
        <p className="text-[13px] text-muted">
          {aliases.data ? plural(aliases.data.length, "alias", "aliases") : " "} · Stable names that
          point to one deployment, each with its own access.
        </p>
      </div>
      {aliases.error && <ErrorNote>{errorMessage(aliases.error)}</ErrorNote>}
      {aliases.isPending ? (
        <Spinner className="mx-auto my-16" />
      ) : aliases.data?.length === 0 ? (
        <Card className="border-dashed px-6 py-14 text-center text-[13px] text-muted">
          No aliases yet. Add one from a site's menu, or with{" "}
          <Mono>zup ./dist --alias my-site</Mono>.
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <table className="w-full text-[13px]">
            <thead className="text-left text-xs text-muted">
              <tr className="border-b border-line">
                <th className="px-4 py-2 font-medium">Alias</th>
                <th className="hidden px-4 py-2 font-medium sm:table-cell">Points to</th>
                <th className="px-4 py-2 font-medium">Access</th>
                <th className="hidden px-4 py-2 font-medium md:table-cell">Updated</th>
                <th className="w-px px-2 py-2">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {aliases.data?.map((alias) => {
                const title = alias.deploymentTitle
                return (
                  <tr key={alias.name} className="hover:bg-subtle/60">
                    <td className="max-w-0 px-4 py-2">
                      <div className="flex min-w-0 items-center gap-1">
                        <Mono className="truncate font-medium" title={alias.url}>
                          /{alias.name}
                        </Mono>
                        <CopyButton text={alias.url} label={`Copy /${alias.name} URL`} />
                      </div>
                      <Link
                        to={`/sites/${alias.deploymentId}`}
                        className="block truncate text-xs text-muted hover:text-fg sm:hidden"
                      >
                        → {title || alias.deploymentId}
                      </Link>
                    </td>
                    <td className="hidden max-w-0 px-4 py-2 sm:table-cell">
                      <Link
                        to={`/sites/${alias.deploymentId}`}
                        className="grid min-w-0 hover:text-accent"
                      >
                        <span className="truncate">{title || alias.deploymentId}</span>
                        {title && <Mono className="truncate text-muted">{alias.deploymentId}</Mono>}
                      </Link>
                    </td>
                    <td className="px-4 py-2">
                      <AliasAccessBadge alias={alias} />
                    </td>
                    <td
                      className="hidden px-4 py-2 whitespace-nowrap text-muted md:table-cell"
                      title={fullDate(alias.updatedAt)}
                    >
                      {timeAgo(alias.updatedAt)}
                    </td>
                    <td className="px-2 py-1">
                      <AliasMenu alias={alias} />
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  )
}
