import { useMutation } from "@tanstack/react-query"
import { formatBytes } from "@zup/shared"
import { CheckCircle2, FileIcon } from "lucide-react"
import { useState } from "react"
import { useNavigate } from "react-router"
import { errorMessage } from "../../lib/api.ts"
import { type ExpiryChoice, expiryToIso, noExpiry } from "../../lib/expiry.ts"
import type { Picked } from "../../lib/files.ts"
import { plural } from "../../lib/format.ts"
import { openHref } from "../../lib/links.ts"
import { useAliases, useInfo, useInvalidateSites } from "../../lib/queries.ts"
import { checkLimits, type UploadProgress, upload } from "../../lib/upload.ts"
import { AccessPicker, accessDraft, draftError, draftToInput } from "../access.tsx"
import { CopyRow, KeyReveal } from "../copy.tsx"
import { CancelButton, Dialog, DialogBody, DialogFooter, DialogHeader } from "../Dialog.tsx"
import { ExpiryField } from "../ExpiryField.tsx"
import { AliasNameInput, aliasNameError } from "../site-dialogs.tsx"
import { Button, ErrorNote, Field, inputClass, Mono } from "../ui.tsx"

const shownFiles = 200

export function UploadDialog({
  picked,
  open,
  onOpenChange,
}: {
  picked: Picked
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const [busy, setBusy] = useState(false)
  return (
    // A running upload cannot be dismissed by Esc or an outside click.
    <Dialog open={open} onOpenChange={(next) => (busy ? null : onOpenChange(next))} wide>
      <UploadFlow picked={picked} setBusy={setBusy} close={() => onOpenChange(false)} />
    </Dialog>
  )
}

function UploadFlow({
  picked,
  setBusy,
  close,
}: {
  picked: Picked
  setBusy: (busy: boolean) => void
  close: () => void
}) {
  const info = useInfo()
  const aliases = useAliases().data ?? []
  const invalidate = useInvalidateSites()
  const navigate = useNavigate()
  const [title, setTitle] = useState(picked.name)
  const [draft, setDraft] = useState(() => accessDraft())
  const [aliasName, setAliasName] = useState("")
  const [moveAlias, setMoveAlias] = useState(false)
  const [expiry, setExpiry] = useState<ExpiryChoice>(noExpiry)
  const [progress, setProgress] = useState<UploadProgress>()
  const [formError, setFormError] = useState<string | null>(null)

  const totalBytes = picked.files.reduce((sum, f) => sum + f.file.size, 0)
  const limitError = info ? checkLimits(picked.files, info.limits) : null
  const existingAlias = aliases.find((alias) => alias.name === aliasName)
  const aliasError = aliasName ? aliasNameError(aliasName) : null

  const mutation = useMutation({
    mutationFn: (expiresAt: string | null) =>
      upload(
        {
          files: picked.files,
          title: title.trim(),
          access: draftToInput(draft),
          alias: aliasName
            ? { name: aliasName, mode: existingAlias ? "upsert" : "create" }
            : undefined,
          expiresAt,
        },
        setProgress,
      ),
    onMutate: () => setBusy(true),
    onSettled: () => {
      setBusy(false)
      invalidate()
    },
  })

  const submit = () => {
    setFormError(null)
    if (limitError || aliasError || draftError(draft)) return
    if (existingAlias && !moveAlias) {
      setFormError(`Confirm that /${aliasName} should move to this upload.`)
      return
    }
    let expiresAt: string | null
    try {
      expiresAt = expiryToIso(expiry)
    } catch (error) {
      setFormError(errorMessage(error))
      return
    }
    mutation.mutate(expiresAt)
  }

  if (mutation.data) {
    const result = mutation.data
    const { deployment } = result
    return (
      <>
        <DialogHeader
          title={
            <span className="flex items-center gap-2">
              <CheckCircle2 className="size-5 text-ok" aria-hidden /> Published
            </span>
          }
          description={`${plural(deployment.fileCount, "file")} · ${formatBytes(deployment.totalBytes)}${result.skippedBytes ? ` · ${formatBytes(result.skippedBytes)} already on the server` : ""}`}
        />
        <DialogBody>
          <CopyRow
            label="Deployment URL"
            value={deployment.url}
            href={openHref(deployment.url, deployment.access)}
          />
          {result.alias && (
            <CopyRow
              label="Alias URL"
              value={result.alias.url}
              href={openHref(result.alias.url, result.alias.access)}
            />
          )}
          {result.aliasError && (
            <ErrorNote>The site is published, but the alias failed: {result.aliasError}</ErrorNote>
          )}
          {result.key && <KeyReveal grant={result.key} />}
          {result.aliasKey && <CopyRow label="Alias share link" value={result.aliasKey.shareUrl} />}
        </DialogBody>
        <DialogFooter>
          <Button
            onClick={() => {
              close()
              navigate(`/sites/${deployment.id}`)
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

  return (
    <form
      className="contents"
      onSubmit={(event) => {
        event.preventDefault()
        submit()
      }}
    >
      <DialogHeader
        title="Upload"
        description={`${plural(picked.files.length, "file")} · ${formatBytes(totalBytes)}`}
      />
      <DialogBody>
        <FileList picked={picked} />
        {limitError && <ErrorNote>{limitError}</ErrorNote>}
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
            label="Alias (optional)"
            error={aliasError}
            hint={aliasName ? undefined : "Also serve it at a stable name."}
          >
            <AliasNameInput
              value={aliasName}
              onChange={(value) => {
                setAliasName(value)
                setMoveAlias(false)
              }}
            />
          </Field>
          <ExpiryField value={expiry} onChange={setExpiry} />
        </div>
        {existingAlias && (
          <label className="flex items-start gap-2 rounded-lg border border-warn/40 bg-warn/5 p-3 text-[13px]">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={moveAlias}
              onChange={(e) => setMoveAlias(e.target.checked)}
            />
            <span>
              <Mono>/{aliasName}</Mono> already exists. Move it to this upload. It gets the access
              you chose above.
            </span>
          </label>
        )}
        {formError && <ErrorNote>{formError}</ErrorNote>}
        {mutation.error && <ErrorNote>{errorMessage(mutation.error)}</ErrorNote>}
      </DialogBody>
      <DialogFooter>
        <CancelButton />
        <Button variant="accent" type="submit" disabled={!!limitError || !info}>
          Upload
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
