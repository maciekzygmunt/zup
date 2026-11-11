import { useMutation } from "@tanstack/react-query"
import { type GrantedKey, type SiteSummary, slugSchema } from "@zup/shared"
import { useState } from "react"
import { useLocation, useNavigate } from "react-router"
import { toast } from "sonner"
import { api, errorMessage, parseResponse } from "../lib/api.ts"
import { type ExpiryChoice, expiryToIso, noExpiry, toLocalInput } from "../lib/expiry.ts"
import { useInvalidateSites } from "../lib/queries.ts"
import { AccessPicker, accessDraft, accessInfo, draftError, draftToInput } from "./access.tsx"
import { KeyReveal } from "./copy.tsx"
import { CancelButton, Dialog, DialogBody, DialogFooter, DialogHeader } from "./Dialog.tsx"
import { ExpiryField } from "./ExpiryField.tsx"
import { Button, ErrorNote, Field, inputClass, Mono } from "./ui.tsx"

type OpenProps = { open: boolean; onOpenChange: (open: boolean) => void }
type CloseProps = { close: () => void }

export const siteName = (site: Pick<SiteSummary, "title" | "slug">) => site.title || site.slug

// Validates a slug against the shared schema; null when valid.
export function slugError(slug: string) {
  const result = slugSchema.safeParse(slug)
  return result.success ? null : (result.error.issues[0]?.message ?? "Invalid slug")
}

export function ChangeAccessDialog({ site, ...props }: OpenProps & { site: SiteSummary }) {
  return (
    <Dialog {...props}>
      <ChangeAccess site={site} close={() => props.onOpenChange(false)} />
    </Dialog>
  )
}

function ChangeAccess({ site, close }: CloseProps & { site: SiteSummary }) {
  const invalidate = useInvalidateSites()
  const [draft, setDraft] = useState(() => accessDraft(site.access))
  const [indexable, setIndexable] = useState(site.indexable)
  const [granted, setGranted] = useState<GrantedKey>()
  const mutation = useMutation({
    mutationFn: async () => {
      const result = await parseResponse(
        api.sites[":slug"].$patch({
          param: { slug: site.slug },
          // The server allows indexing only on public sites.
          json: { access: draftToInput(draft), indexable: draft.type === "public" && indexable },
        }),
      )
      return result.key
    },
    onSuccess: (key) => {
      invalidate()
      if (key) return setGranted(key)
      toast.success(`Access set to ${accessInfo[draft.type].label.toLowerCase()}`)
      close()
    },
  })

  if (granted) {
    return (
      <>
        <DialogHeader
          title="Password set"
          description={`Share it with the people who should open /${site.slug}.`}
        />
        <DialogBody>
          <KeyReveal grant={granted} />
        </DialogBody>
        <DialogFooter>
          <Button variant="primary" onClick={close}>
            Done
          </Button>
        </DialogFooter>
      </>
    )
  }
  return (
    <form
      className="contents"
      onSubmit={(event) => {
        event.preventDefault()
        if (!draftError(draft)) mutation.mutate()
      }}
    >
      <DialogHeader title="Change access" description={`Who can open /${site.slug}.`} />
      <DialogBody>
        <AccessPicker
          value={draft}
          onChange={setDraft}
          passwordHint={
            site.access === "password"
              ? "Saving sets a new password. The old password and share links stop working."
              : undefined
          }
        />
        {draft.type === "public" && (
          <label className="flex items-start gap-2 border-t border-line pt-3 text-[13px]">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={indexable}
              onChange={(e) => setIndexable(e.target.checked)}
            />
            <span>
              Allow search engines
              <span className="block text-xs text-muted">
                Google, Bing and link previews can crawl /{site.slug}.
              </span>
            </span>
          </label>
        )}
        {mutation.error && <ErrorNote>{errorMessage(mutation.error)}</ErrorNote>}
      </DialogBody>
      <DialogFooter>
        <CancelButton />
        <Button variant="primary" type="submit" pending={mutation.isPending}>
          Save
        </Button>
      </DialogFooter>
    </form>
  )
}

export function EditDetailsDialog({ site, ...props }: OpenProps & { site: SiteSummary }) {
  return (
    <Dialog {...props}>
      <EditDetails site={site} close={() => props.onOpenChange(false)} />
    </Dialog>
  )
}

function EditDetails({ site, close }: CloseProps & { site: SiteSummary }) {
  const invalidate = useInvalidateSites()
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const [title, setTitle] = useState(site.title ?? "")
  const [slug, setSlug] = useState(site.slug)
  const [expiry, setExpiry] = useState<ExpiryChoice>(() =>
    site.expiresAt ? { preset: "custom", custom: toLocalInput(site.expiresAt) } : noExpiry,
  )
  const slugChanged = slug !== site.slug
  const invalidSlug = slugError(slug)
  const mutation = useMutation({
    mutationFn: () =>
      parseResponse(
        api.sites[":slug"].$patch({
          param: { slug: site.slug },
          json: {
            slug: slugChanged ? slug : undefined,
            title: title.trim() || null,
            expiresAt: expiryToIso(expiry),
          },
        }),
      ),
    onSuccess: () => {
      invalidate()
      toast.success("Details saved")
      close()
      // The detail page lives at the slug, so it moves too.
      if (slugChanged && pathname === `/sites/${site.slug}`) {
        navigate(`/sites/${slug}`, { replace: true })
      }
    },
  })
  return (
    <form
      className="contents"
      onSubmit={(event) => {
        event.preventDefault()
        if (!invalidSlug) mutation.mutate()
      }}
    >
      <DialogHeader title="Edit details" />
      <DialogBody>
        <Field label="Title">
          <input
            className={inputClass}
            data-autofocus
            value={title}
            maxLength={200}
            placeholder={site.slug}
            onChange={(e) => setTitle(e.target.value)}
          />
        </Field>
        <Field
          label="Slug"
          error={invalidSlug}
          hint={
            slugChanged ? (
              <span className="text-warn">
                The URL changes. Links to <Mono>/{site.slug}</Mono> stop working.
              </span>
            ) : (
              "The name in the URL."
            )
          }
        >
          <SlugInput value={slug} onChange={setSlug} />
        </Field>
        <ExpiryField value={expiry} onChange={setExpiry} />
        {mutation.error && <ErrorNote>{errorMessage(mutation.error)}</ErrorNote>}
      </DialogBody>
      <DialogFooter>
        <CancelButton />
        <Button variant="primary" type="submit" pending={mutation.isPending}>
          Save
        </Button>
      </DialogFooter>
    </form>
  )
}

// Input with a leading "/" for slugs.
export function SlugInput({
  value,
  onChange,
  placeholder = "my-site",
}: {
  value: string
  onChange: (value: string) => void
  placeholder?: string
}) {
  return (
    <div className="flex items-center rounded-md border border-line bg-card focus-within:border-accent focus-within:ring-3 focus-within:ring-accent/20">
      <span className="pl-3 font-mono text-[13px] text-muted">/</span>
      <input
        className="h-9 min-w-0 flex-1 bg-transparent pr-3 font-mono text-[13px] outline-none"
        value={value}
        autoComplete="off"
        spellCheck={false}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value.toLowerCase())}
      />
    </div>
  )
}

export function DeleteSiteDialog({
  site,
  afterDelete,
  ...props
}: OpenProps & { site: SiteSummary; afterDelete?: string }) {
  return (
    <Dialog {...props}>
      <DeleteSite site={site} afterDelete={afterDelete} close={() => props.onOpenChange(false)} />
    </Dialog>
  )
}

function DeleteSite({
  site,
  afterDelete,
  close,
}: CloseProps & { site: SiteSummary; afterDelete?: string }) {
  const invalidate = useInvalidateSites()
  const navigate = useNavigate()
  const mutation = useMutation({
    mutationFn: () => parseResponse(api.sites[":slug"].$delete({ param: { slug: site.slug } })),
    onSuccess: () => {
      invalidate()
      toast.success(`Deleted ${siteName(site)}`)
      close()
      if (afterDelete) navigate(afterDelete)
    },
  })
  return (
    <>
      <DialogHeader
        title={`Delete ${siteName(site)}?`}
        description="Its files and URL stop working at once. You cannot undo this."
      />
      <DialogBody>
        {mutation.error && <ErrorNote>{errorMessage(mutation.error)}</ErrorNote>}
      </DialogBody>
      <DialogFooter>
        <CancelButton />
        <Button variant="danger" pending={mutation.isPending} onClick={() => mutation.mutate()}>
          Delete
        </Button>
      </DialogFooter>
    </>
  )
}
