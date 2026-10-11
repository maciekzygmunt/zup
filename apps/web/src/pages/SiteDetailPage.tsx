import { Switch } from "@base-ui/react/switch"
import { useMutation } from "@tanstack/react-query"
import type { DeploymentDetail } from "@zup/shared"
import { formatBytes } from "@zup/shared"
import {
  ArrowLeft,
  Download,
  ExternalLink,
  FolderTree,
  Pencil,
  Plus,
  Share2,
  ShieldCheck,
  Trash2,
} from "lucide-react"
import { type ReactNode, useState } from "react"
import { Link, useParams } from "react-router"
import { toast } from "sonner"
import { AliasMenu } from "../components/AliasMenu.tsx"
import { AccessBadge, AliasAccessBadge } from "../components/access.tsx"
import { CopyButton } from "../components/copy.tsx"
import { copyShareLink } from "../components/SiteMenu.tsx"
import {
  AddAliasDialog,
  ChangeAccessDialog,
  DeleteDeploymentDialog,
  EditDetailsDialog,
  siteName,
} from "../components/site-dialogs.tsx"
import { Button, buttonClass, Card, ErrorNote, Mono, Spinner } from "../components/ui.tsx"
import { api, errorMessage, parseResponse } from "../lib/api.ts"
import { fullDate, plural, timeAgo } from "../lib/format.ts"
import { browseHref, downloadHref, fileHref, openHref } from "../lib/links.ts"
import { useDeployment, useInvalidateSites } from "../lib/queries.ts"

export function SiteDetailPage() {
  const { id = "" } = useParams()
  const deployment = useDeployment(id)
  return (
    <div className="grid gap-6">
      <Link
        to="/"
        className="inline-flex w-fit items-center gap-1 text-[13px] text-muted hover:text-fg"
      >
        <ArrowLeft className="size-3.5" aria-hidden /> Sites
      </Link>
      {deployment.isPending && <Spinner className="mx-auto my-16" />}
      {deployment.error && <ErrorNote>{errorMessage(deployment.error)}</ErrorNote>}
      {deployment.data && <Detail deployment={deployment.data} />}
    </div>
  )
}

type DialogName = "access" | "details" | "alias" | "delete"

function Detail({ deployment: d }: { deployment: DeploymentDetail }) {
  const [dialog, setDialog] = useState<DialogName | null>(null)
  const control = (name: DialogName) => ({
    open: dialog === name,
    onOpenChange: (open: boolean) => setDialog(open ? name : null),
  })
  return (
    <>
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="grid min-w-0 gap-1">
          <h1 className="truncate text-xl font-semibold">{siteName(d)}</h1>
          <div className="flex flex-wrap items-center gap-2">
            <AccessBadge access={d.access} />
            <Mono className="text-muted">{d.id}</Mono>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <a
            href={openHref(d.url, d.access)}
            target="_blank"
            rel="noreferrer"
            className={buttonClass("primary")}
          >
            <ExternalLink className="size-4" aria-hidden /> Open
          </a>
          <a href={browseHref(d.url)} target="_blank" rel="noreferrer" className={buttonClass()}>
            <FolderTree className="size-4" aria-hidden /> Browse files
          </a>
        </div>
      </header>

      <Card className="divide-y divide-line">
        <Row label="URL">
          <UrlLine url={d.url} />
        </Row>
        <Row
          label="Access"
          action={
            <Button size="sm" onClick={() => setDialog("access")}>
              <ShieldCheck className="size-3.5" aria-hidden /> Change
            </Button>
          }
        >
          <div className="flex flex-wrap items-center gap-2">
            <AccessBadge access={d.access} />
            {d.access === "password" && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => copyShareLink({ deploymentId: d.id })}
              >
                <Share2 className="size-3.5" aria-hidden /> Copy share link
              </Button>
            )}
          </div>
        </Row>
        <Row
          label="Details"
          action={
            <Button size="sm" onClick={() => setDialog("details")}>
              <Pencil className="size-3.5" aria-hidden /> Edit
            </Button>
          }
        >
          <dl className="grid gap-x-6 gap-y-1 text-[13px] sm:grid-cols-[auto_1fr]">
            <dt className="text-muted">Title</dt>
            <dd>{d.title || <span className="text-muted">None</span>}</dd>
            <dt className="text-muted">Created</dt>
            <dd title={fullDate(d.createdAt)}>
              {fullDate(d.createdAt)} · {timeAgo(d.createdAt)} · from {d.source}
            </dd>
            <dt className="text-muted">Expires</dt>
            <dd className={d.expiresAt ? "text-warn" : undefined}>
              {d.expiresAt ? `${fullDate(d.expiresAt)} · ${timeAgo(d.expiresAt)}` : "Never"}
            </dd>
            <dt className="text-muted">Size</dt>
            <dd className="tabular-nums">
              {plural(d.fileCount, "file")} · {formatBytes(d.totalBytes)}
            </dd>
            <dt className="text-muted">Entrypoint</dt>
            <dd>
              {d.entrypoint ? (
                <Mono>{d.entrypoint}</Mono>
              ) : (
                <span className="text-muted">None (shows a file listing)</span>
              )}
            </dd>
          </dl>
        </Row>
        <Row label="SPA mode">
          <SpaToggle deployment={d} />
        </Row>
      </Card>

      <AliasesSection deployment={d} onAdd={() => setDialog("alias")} />
      <FilesSection deployment={d} />

      <section className="grid gap-2">
        <h2 className="text-[13px] font-semibold text-danger">Danger zone</h2>
        <Card className="flex flex-wrap items-center justify-between gap-3 border-danger/30 p-4">
          <p className="text-[13px] text-muted">
            Delete this deployment, its files
            {d.aliases.length ? ` and ${plural(d.aliases.length, "alias", "aliases")}` : ""}.
          </p>
          <Button variant="danger" onClick={() => setDialog("delete")}>
            <Trash2 className="size-4" aria-hidden /> Delete
          </Button>
        </Card>
      </section>

      <ChangeAccessDialog
        target={{ kind: "deployment", id: d.id, access: d.access, aliases: d.aliases }}
        {...control("access")}
      />
      <EditDetailsDialog deployment={d} {...control("details")} />
      <AddAliasDialog deployment={d} {...control("alias")} />
      <DeleteDeploymentDialog deployment={d} afterDelete="/" {...control("delete")} />
    </>
  )
}

function Row({
  label,
  action,
  children,
}: {
  label: string
  action?: ReactNode
  children: ReactNode
}) {
  return (
    <div className="grid gap-2 px-4 py-3 sm:grid-cols-[8rem_1fr_auto] sm:items-start sm:gap-4">
      <span className="pt-0.5 text-[13px] font-medium text-muted">{label}</span>
      <div className="min-w-0">{children}</div>
      {action && <div className="justify-self-start sm:justify-self-end">{action}</div>}
    </div>
  )
}

function UrlLine({ url }: { url: string }) {
  return (
    <div className="flex min-w-0 items-center gap-1">
      <Mono className="truncate">{url}</Mono>
      <CopyButton text={url} label="Copy URL" />
    </div>
  )
}

function SpaToggle({ deployment }: { deployment: DeploymentDetail }) {
  const invalidate = useInvalidateSites()
  const mutation = useMutation({
    mutationFn: (spa: boolean) =>
      parseResponse(api.deployments[":id"].$patch({ param: { id: deployment.id }, json: { spa } })),
    onSuccess: () => invalidate(),
    onError: (error) => toast.error(errorMessage(error)),
  })
  const checked = mutation.isPending ? !!mutation.variables : deployment.spa
  return (
    <div className="flex items-start gap-3 text-[13px]">
      <Switch.Root
        aria-label="SPA mode"
        checked={checked}
        disabled={mutation.isPending}
        onCheckedChange={(spa) => mutation.mutate(spa)}
        className="mt-0.5 flex h-5 w-9 shrink-0 rounded-full bg-line p-0.5 transition-colors data-checked:bg-accent data-disabled:opacity-60"
      >
        <Switch.Thumb className="size-4 rounded-full bg-white shadow-sm transition-transform data-checked:translate-x-4" />
      </Switch.Root>
      <span className="text-muted text-pretty">
        Unknown paths serve the entrypoint, for client-side routing. Turn it off to show 404 pages
        instead.
      </span>
    </div>
  )
}

function AliasesSection({
  deployment,
  onAdd,
}: {
  deployment: DeploymentDetail
  onAdd: () => void
}) {
  return (
    <section className="grid gap-2">
      <div className="flex items-center justify-between">
        <h2 className="text-[13px] font-semibold">Aliases</h2>
        <Button size="sm" onClick={onAdd}>
          <Plus className="size-3.5" aria-hidden /> Add alias
        </Button>
      </div>
      {deployment.aliases.length === 0 ? (
        <p className="rounded-lg border border-dashed border-line px-4 py-6 text-center text-[13px] text-muted">
          No aliases. Add one to give this site a stable URL you can move to new uploads.
        </p>
      ) : (
        <Card className="divide-y divide-line">
          {deployment.aliases.map((alias) => (
            <div key={alias.name} className="flex items-center gap-3 px-4 py-2.5">
              <div className="grid min-w-0 flex-1 gap-0.5">
                <Mono className="truncate font-medium">/{alias.name}</Mono>
                <Mono className="truncate text-muted">{alias.url}</Mono>
              </div>
              <AliasAccessBadge alias={alias} />
              <AliasMenu alias={alias} />
            </div>
          ))}
        </Card>
      )}
    </section>
  )
}

function FilesSection({ deployment: d }: { deployment: DeploymentDetail }) {
  return (
    <section className="grid gap-2">
      <h2 className="text-[13px] font-semibold">
        Files <span className="font-normal text-muted">({d.files.length.toLocaleString()})</span>
      </h2>
      <Card className="overflow-x-auto">
        <table className="w-full text-[13px]">
          <thead className="text-left text-xs text-muted">
            <tr className="border-b border-line">
              <th className="px-4 py-2 font-medium">Path</th>
              <th className="px-4 py-2 text-right font-medium">Size</th>
              <th className="hidden px-4 py-2 font-medium sm:table-cell">Type</th>
              <th className="w-px px-2 py-2">
                <span className="sr-only">Download</span>
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {d.files.map((file) => (
              <tr key={file.path} className="hover:bg-subtle/60">
                <td className="max-w-0 px-4 py-1.5">
                  <a
                    href={fileHref(d.url, d.access, file.path)}
                    target="_blank"
                    rel="noreferrer"
                    className="block truncate font-mono text-[12.5px] hover:text-accent hover:underline"
                    title={file.path}
                  >
                    {file.path}
                    {file.path === d.entrypoint && (
                      <span className="ml-2 rounded bg-accent/10 px-1 font-sans text-[11px] text-accent">
                        entry
                      </span>
                    )}
                  </a>
                </td>
                <td className="px-4 py-1.5 text-right whitespace-nowrap text-muted tabular-nums">
                  {formatBytes(file.size)}
                </td>
                <td className="hidden max-w-48 truncate px-4 py-1.5 text-muted sm:table-cell">
                  {file.contentType.split(";")[0]}
                </td>
                <td className="px-2 py-1">
                  <a
                    href={downloadHref(d.id, file.path)}
                    download
                    className={buttonClass("ghost", "icon")}
                    aria-label={`Download ${file.path}`}
                    title="Download"
                  >
                    <Download className="size-3.5" />
                  </a>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </section>
  )
}
