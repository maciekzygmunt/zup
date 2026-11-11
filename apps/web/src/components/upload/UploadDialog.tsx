import { useMutation } from "@tanstack/react-query"
import { formatBytes, type SiteSummary } from "@zup/shared"
import { CheckCircle2, FileIcon } from "lucide-react"
import { useState } from "react"
import { useNavigate } from "react-router"
import { ApiError, errorMessage } from "../../lib/api.ts"
import { type ExpiryChoice, expiryToIso, noExpiry } from "../../lib/expiry.ts"
import type { Picked } from "../../lib/files.ts"
import { plural } from "../../lib/format.ts"
import { openHref } from "../../lib/links.ts"
import { useInfo, useInvalidateSites } from "../../lib/queries.ts"
import { checkLimits, type UploadProgress, type UploadRequest, upload } from "../../lib/upload.ts"
import { AccessPicker, accessDraft, draftError, draftToInput } from "../access.tsx"
import { CopyRow, KeyReveal } from "../copy.tsx"
import { CancelButton, Dialog, DialogBody, DialogFooter, DialogHeader } from "../Dialog.tsx"
import { ExpiryField } from "../ExpiryField.tsx"
import { SlugInput, slugError } from "../site-dialogs.tsx"
import { Button, ErrorNote, Field, inputClass, Mono } from "../ui.tsx"

const shownFiles = 200

type UploadProps = { picked: Picked; site?: SiteSummary }

// Publishes picked files as a new site, or replaces the files of `site`.
export function UploadDialog({
  open,
  onOpenChange,
  ...props
}: UploadProps & { open: boolean; onOpenChange: (open: boolean) => void }) {
  const [busy, setBusy] = useState(false)
  return (
    // A running upload cannot be dismissed by Esc or an outside click.
    <Dialog open={open} onOpenChange={(next) => (busy ? null : onOpenChange(next))} wide>
      <UploadFlow {...props} setBusy={setBusy} close={() => onOpenChange(false)} />
    </Dialog>
  )
}

function UploadFlow({
  picked,
  site,
  setBusy,
  close,
}: UploadProps & { setBusy: (busy: boolean) => void; close: () => void }) {
  const info = useInfo()
  const invalidate = useInvalidateSites()
  const navigate = useNavigate()
  const [title, setTitle] = useState(picked.name)
  const [draft, setDraft] = useState(() => accessDraft())
  const [slug, setSlug] = useState("")
  const [expiry, setExpiry] = useState<ExpiryChoice>(noExpiry)
  const [progress, setProgress] = useState<UploadProgress>()
  const [formError, setFormError] = useState<string | null>(null)

  const totalBytes = picked.files.reduce((sum, f) => sum + f.file.size, 0)
  const limitError = info ? checkLimits(picked.files, info.limits) : null
  const invalidSlug = slug ? slugError(slug) : null

  const mutation = useMutation({
    mutationFn: (request: Omit<UploadRequest, "files">) =>
      upload({ files: picked.files, ...request }, setProgress),
    onMutate: () => setBusy(true),
    onSettled: () => {
      setBusy(false)
      invalidate()
    },
  })

  const submit = () => {
    setFormError(null)
    if (limitError) return
    if (site) return mutation.mutate({ slug: site.slug, update: true })
    if (invalidSlug || draftError(draft)) return
    let expiresAt: string | null
    try {
      expiresAt = expiryToIso(expiry)
    } catch (error) {
      setFormError(errorMessage(error))
      return
    }
    mutation.mutate({
      slug: slug || undefined,
      title: title.trim() || undefined,
      access: draftToInput(draft),
      expiresAt: expiresAt ?? undefined,
    })
  }

  if (mutation.data) {
    const result = mutation.data
    return (
      <>
        <DialogHeader
          title={
            <span className="flex items-center gap-2">
              <CheckCircle2 className="size-5 text-ok" aria-hidden />{" "}
              {result.created ? "Published" : "Files replaced"}
            </span>
          }
          description={`${plural(result.site.fileCount, "file")} · ${formatBytes(result.site.totalBytes)}${result.skippedBytes ? ` · ${formatBytes(result.skippedBytes)} already on the server` : ""}`}
        />
        <DialogBody>
          <CopyRow
            label="URL"
            value={result.site.url}
            href={openHref(result.site.url, result.site.access)}
          />
          {result.key && <KeyReveal grant={result.key} />}
        </DialogBody>
        <DialogFooter>
          <Button
            onClick={() => {
              close()
              navigate(`/sites/${result.site.slug}`)
            }}
          >
            View details
          </Button>
          <Button variant="primary" onClick={close}>
            Done
          </Button>
        </DialogFooter>
      </>
    )
  }

  if (mutation.isPending) {
    return (
      <>
        <DialogHeader title="Uploading…" description="Keep this tab open until it finishes." />
        <DialogBody>
          <ProgressView progress={progress} />
        </DialogBody>
      </>
    )
  }

  const uploadError =
    mutation.error instanceof ApiError && mutation.error.code === "slug_taken"
      ? `/${slug} is in use. Pick another slug, or use "Replace with files" in that site's menu.`
      : mutation.error && errorMessage(mutation.error)
  const size = `${plural(picked.files.length, "file")} · ${formatBytes(totalBytes)}`

  return (
    <form
      className="contents"
      onSubmit={(event) => {
        event.preventDefault()
        submit()
      }}
    >
      {site ? (
        <DialogHeader
          title={
            <>
              Replace the files of <span className="font-mono">/{site.slug}</span>
            </>
          }
          description={`${size}. These files replace all current files, which are deleted. The URL, access and other settings stay the same.`}
        />
      ) : (
        <DialogHeader title="Upload" description={size} />
      )}
      <DialogBody>
        <FileList picked={picked} />
        {limitError && <ErrorNote>{limitError}</ErrorNote>}
        {!site && (
          <>
            <Field label="Title">
              <input
                className={inputClass}
                data-autofocus
                value={title}
                maxLength={200}
                onChange={(e) => setTitle(e.target.value)}
              />
            </Field>
            <div className="grid gap-1.5">
              <span className="text-[13px] font-medium">Access</span>
              <AccessPicker value={draft} onChange={setDraft} />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field
                label="Slug (optional)"
                error={invalidSlug}
                hint="The name in the URL. Empty: a random one."
              >
                <SlugInput value={slug} onChange={setSlug} placeholder="random" />
              </Field>
              <ExpiryField value={expiry} onChange={setExpiry} />
            </div>
          </>
        )}
        {formError && <ErrorNote>{formError}</ErrorNote>}
        {uploadError && <ErrorNote>{uploadError}</ErrorNote>}
      </DialogBody>
      <DialogFooter>
        <CancelButton />
        <Button variant="accent" type="submit" disabled={!!limitError || !info}>
          {site ? "Replace files" : "Upload"}
        </Button>
      </DialogFooter>
    </form>
  )
}

function FileList({ picked }: { picked: Picked }) {
  const rest = picked.files.length - shownFiles
  return (
    <ul className="max-h-44 overflow-y-auto rounded-lg border border-line bg-subtle py-1 text-[12.5px]">
      {picked.files.slice(0, shownFiles).map(({ path, file }) => (
        <li key={path} className="flex items-center gap-2 px-3 py-0.5">
          <FileIcon className="size-3 shrink-0 text-muted" aria-hidden />
          <Mono className="min-w-0 flex-1 truncate" title={path}>
            {path}
          </Mono>
          <span className="text-muted tabular-nums">{formatBytes(file.size)}</span>
        </li>
      ))}
      {rest > 0 && <li className="px-3 py-1 text-muted">and {plural(rest, "more file")}</li>}
    </ul>
  )
}

function ProgressView({ progress }: { progress?: UploadProgress }) {
  const [label, ratio] = !progress
    ? ["Preparing…", 0]
    : progress.phase === "hashing"
      ? [`Checking files ${progress.done} / ${progress.total}`, progress.done / progress.total]
      : progress.phase === "uploading"
        ? [
            progress.total
              ? `Uploading ${formatBytes(progress.done)} / ${formatBytes(progress.total)}`
              : "All content is already on the server",
            progress.total ? progress.done / progress.total : 1,
          ]
        : ["Publishing…", 1]
  return (
    <div className="grid gap-2 py-2">
      <div className="flex justify-between text-[13px]">
        <span>{label}</span>
        <span className="text-muted tabular-nums">{Math.round(ratio * 100)}%</span>
      </div>
      <div
        className="h-1.5 overflow-hidden rounded-full bg-subtle ring-1 ring-line"
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(ratio * 100)}
      >
        <div
          className="h-full rounded-full bg-accent transition-[width] duration-200"
          style={{ width: `${ratio * 100}%` }}
        />
      </div>
    </div>
  )
}
