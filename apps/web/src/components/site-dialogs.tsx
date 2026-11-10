import { useMutation } from "@tanstack/react-query"
import {
  type AccessType,
  type AliasSummary,
  aliasNameSchema,
  type DeploymentSummary,
  type GrantedKey,
} from "@zup/shared"
import { useState } from "react"
import { useNavigate } from "react-router"
import { toast } from "sonner"
import { api, errorMessage, parseResponse } from "../lib/api.ts"
import { type ExpiryChoice, expiryToIso, noExpiry, toLocalInput } from "../lib/expiry.ts"
import { timeAgo } from "../lib/format.ts"
import { useDebounced } from "../lib/hooks.ts"
import { useAliases, useDeployments, useInvalidateSites } from "../lib/queries.ts"
import {
  AccessBadge,
  AccessPicker,
  accessDraft,
  accessInfo,
  draftError,
  draftToInput,
} from "./access.tsx"
import { CopyRow, KeyReveal } from "./copy.tsx"
import { CancelButton, Dialog, DialogBody, DialogFooter, DialogHeader } from "./Dialog.tsx"
import { ExpiryField } from "./ExpiryField.tsx"
import { Button, cx, ErrorNote, Field, inputClass, Mono, Spinner } from "./ui.tsx"

type OpenProps = { open: boolean; onOpenChange: (open: boolean) => void }
type CloseProps = { close: () => void }

export type AccessTarget =
  | { kind: "deployment"; id: string; access: AccessType; aliases: AliasSummary[] }
  | { kind: "alias"; name: string; access: AccessType; indexable: boolean }

export const siteName = (d: Pick<DeploymentSummary, "title" | "id">) => d.title || d.id

// Validates an alias name against the shared schema; null when valid.
export function aliasNameError(name: string) {
  const result = aliasNameSchema.safeParse(name)
  return result.success ? null : (result.error.issues[0]?.message ?? "Invalid name")
}

export function ChangeAccessDialog({ target, ...props }: OpenProps & { target: AccessTarget }) {
  return (
    <Dialog {...props}>
      <ChangeAccess target={target} close={() => props.onOpenChange(false)} />
    </Dialog>
  )
}

function ChangeAccess({ target, close }: CloseProps & { target: AccessTarget }) {
  const invalidate = useInvalidateSites()
  const [draft, setDraft] = useState(() => accessDraft(target.access))
  const [indexable, setIndexable] = useState(target.kind === "alias" && target.indexable)
  // Search engine switch per public alias, shown in the deployment dialog.
  const publicAliases =
    target.kind === "deployment" ? target.aliases.filter((alias) => alias.access === "public") : []
  const [crawl, setCrawl] = useState(() =>
    Object.fromEntries(publicAliases.map((alias) => [alias.name, alias.indexable])),
  )
  const [granted, setGranted] = useState<GrantedKey>()
  const mutation = useMutation({
    mutationFn: async () => {
      const access = draftToInput(draft)
      if (target.kind === "alias") {
        const result = await parseResponse(
          api.aliases[":name"].$patch({
            param: { name: target.name },
            // The server allows indexing only on public aliases.
            json: { access, indexable: draft.type === "public" && indexable },
          }),
        )
        return result.key
      }
      const result = await parseResponse(
        api.deployments[":id"].$patch({ param: { id: target.id }, json: { access } }),
      )
      await Promise.all(
        publicAliases
          .filter((alias) => crawl[alias.name] !== alias.indexable)
          .map((alias) =>
            parseResponse(
              api.aliases[":name"].$patch({
                param: { name: alias.name },
                json: { indexable: crawl[alias.name] },
              }),
            ),
          ),
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
  const what = target.kind === "alias" ? `/${target.name}` : "this deployment"

  if (granted) {
    return (
      <>
        <DialogHeader
          title="Password set"
          description={`Share it with the people who should open ${what}.`}
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
      <DialogHeader
        title="Change access"
        description={
          target.kind === "alias"
            ? `Who can open ${what}. An alias has its own access, separate from its deployment.`
            : `Who can open ${what}. Aliases keep their own access.`
        }
      />
      <DialogBody>
        <AccessPicker
          value={draft}
          onChange={setDraft}
          passwordHint={
            target.access === "password"
              ? "Saving sets a new password. The old password and share links stop working."
              : undefined
          }
        />
        {target.kind === "alias" && draft.type === "public" && (
          <CrawlCheckbox
            name={target.name}
            checked={indexable}
            onChange={setIndexable}
            label="Allow search engines"
          />
        )}
        {target.kind === "deployment" && (
          <div className="grid gap-2 border-t border-line pt-3 text-[13px]">
            <p className="font-medium">Search engines</p>
            {publicAliases.length === 0 ? (
              <p className="text-xs text-muted">
                Only public aliases can be crawled. The deployment URL stays hidden.{" "}
                {target.aliases.length === 0
                  ? "Add an alias to allow it."
                  : "Make an alias public on the Aliases page to allow it."}
              </p>
            ) : (
              <>
                {/* A non-public deployment can still be open through its public aliases. */}
                {draft.type !== "public" && (
                  <p className="text-xs text-muted">
                    Each alias below stays public. Anyone can open it.
                  </p>
                )}
                {publicAliases.map((alias) => (
                  <CrawlCheckbox
                    key={alias.name}
                    name={alias.name}
                    checked={crawl[alias.name] ?? false}
                    onChange={(checked) => setCrawl({ ...crawl, [alias.name]: checked })}
                    label={`Allow search engines on /${alias.name}`}
                  />
                ))}
              </>
            )}
          </div>
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

function CrawlCheckbox({
  name,
  checked,
  onChange,
  label,
}: {
  name: string
  checked: boolean
  onChange: (checked: boolean) => void
  label: string
}) {
  return (
    <label className="flex items-start gap-2 text-[13px]">
      <input
        type="checkbox"
        className="mt-0.5"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span>
        {label}
        <span className="block text-xs text-muted">
          Google, Bing and link previews can crawl /{name}.
        </span>
      </span>
    </label>
  )
}

export function EditDetailsDialog({
  deployment,
  ...props
}: OpenProps & { deployment: DeploymentSummary }) {
  return (
    <Dialog {...props}>
      <EditDetails deployment={deployment} close={() => props.onOpenChange(false)} />
    </Dialog>
  )
}

function EditDetails({ deployment, close }: CloseProps & { deployment: DeploymentSummary }) {
  const invalidate = useInvalidateSites()
  const [title, setTitle] = useState(deployment.title ?? "")
  const [expiry, setExpiry] = useState<ExpiryChoice>(() =>
    deployment.expiresAt
      ? { preset: "custom", custom: toLocalInput(deployment.expiresAt) }
      : noExpiry,
  )
  const mutation = useMutation({
    mutationFn: () =>
      parseResponse(
        api.deployments[":id"].$patch({
          param: { id: deployment.id },
          json: { title: title.trim() || null, expiresAt: expiryToIso(expiry) },
        }),
      ),
    onSuccess: () => {
      invalidate()
      toast.success("Details saved")
      close()
    },
  })
  return (
    <form
      className="contents"
      onSubmit={(event) => {
        event.preventDefault()
        mutation.mutate()
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
            placeholder={deployment.id}
            onChange={(e) => setTitle(e.target.value)}
          />
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

// Input with a leading "/" for alias names.
export function AliasNameInput({
  value,
  onChange,
  onBlur,
  autoFocus,
}: {
  value: string
  onChange: (value: string) => void
  onBlur?: () => void
  autoFocus?: boolean
}) {
  return (
    <div className="flex items-center rounded-md border border-line bg-card focus-within:border-accent focus-within:ring-3 focus-within:ring-accent/20">
      <span className="pl-3 font-mono text-[13px] text-muted">/</span>
      <input
        className="h-9 min-w-0 flex-1 bg-transparent pr-3 font-mono text-[13px] outline-none"
        value={value}
        autoComplete="off"
        spellCheck={false}
        data-autofocus={autoFocus || undefined}
        placeholder="my-site"
        onBlur={onBlur}
        onChange={(e) => onChange(e.target.value.toLowerCase())}
      />
    </div>
  )
}

export function AddAliasDialog({
  deployment,
  ...props
}: OpenProps & { deployment: DeploymentSummary }) {
  return (
    <Dialog {...props}>
      <AddAlias deployment={deployment} close={() => props.onOpenChange(false)} />
    </Dialog>
  )
}

function AddAlias({ deployment, close }: CloseProps & { deployment: DeploymentSummary }) {
  const invalidate = useInvalidateSites()
  const aliases = useAliases().data ?? []
  const [name, setName] = useState("")
  const [touched, setTouched] = useState(false)
  const [keepAccess, setKeepAccess] = useState(true)
  const [draft, setDraft] = useState(() => accessDraft(deployment.access))
  const [result, setResult] = useState<{ alias: AliasSummary; key?: GrantedKey }>()
  const existing = aliases.find((alias) => alias.name === name)
  const nameError = aliasNameError(name)
  const sameTarget = existing?.deploymentId === deployment.id
  const pickAccess = !(existing && keepAccess)

  const mutation = useMutation({
    mutationFn: () =>
      parseResponse(
        api.aliases[":name"].$put({
          param: { name },
          json: {
            deploymentId: deployment.id,
            mode: existing ? "upsert" : "create",
            access: pickAccess ? draftToInput(draft) : undefined,
          },
        }),
      ),
    onSuccess: (data) => {
      invalidate()
      setResult({ alias: data.alias, key: data.key })
    },
  })

  if (result) {
    return (
      <>
        <DialogHeader title={`/${result.alias.name} is ready`} />
        <DialogBody>
          <CopyRow label="Alias URL" value={result.alias.url} />
          {result.key && <KeyReveal grant={result.key} />}
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
        setTouched(true)
        if (nameError || sameTarget || (pickAccess && draftError(draft))) return
        mutation.mutate()
      }}
    >
      <DialogHeader
        title="Add alias"
        description="A stable name that points to this deployment. You can move it later."
      />
      <DialogBody>
        <Field
          label="Name"
          error={touched && name ? nameError : null}
          hint="Lowercase letters, digits and dashes."
        >
          <AliasNameInput
            value={name}
            onChange={setName}
            onBlur={() => setTouched(true)}
            autoFocus
          />
        </Field>
        {existing &&
          (sameTarget ? (
            <ErrorNote>/{name} already points to this deployment.</ErrorNote>
          ) : (
            <div className="grid gap-2 rounded-lg border border-warn/40 bg-warn/5 p-3 text-[13px]">
              <p>
                <Mono>/{name}</Mono> already exists and points to{" "}
                <Mono>{existing.deploymentId}</Mono>. Saving moves it here.
              </p>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={keepAccess}
                  onChange={(e) => setKeepAccess(e.target.checked)}
                />
                Keep its current access <AccessBadge access={existing.access} />
              </label>
            </div>
          ))}
        {pickAccess && <AccessPicker value={draft} onChange={setDraft} />}
        {mutation.error && <ErrorNote>{errorMessage(mutation.error)}</ErrorNote>}
      </DialogBody>
      <DialogFooter>
        <CancelButton />
        <Button variant="primary" type="submit" pending={mutation.isPending}>
          {existing ? "Move alias" : "Add alias"}
        </Button>
      </DialogFooter>
    </form>
  )
}

export function DeleteDeploymentDialog({
  deployment,
  afterDelete,
  ...props
}: OpenProps & { deployment: DeploymentSummary; afterDelete?: string }) {
  return (
    <Dialog {...props}>
      <DeleteDeployment
        deployment={deployment}
        afterDelete={afterDelete}
        close={() => props.onOpenChange(false)}
      />
    </Dialog>
  )
}

function DeleteDeployment({
  deployment,
  afterDelete,
  close,
}: CloseProps & { deployment: DeploymentSummary; afterDelete?: string }) {
  const invalidate = useInvalidateSites()
  const navigate = useNavigate()
  const mutation = useMutation({
    mutationFn: () =>
      parseResponse(api.deployments[":id"].$delete({ param: { id: deployment.id } })),
    onSuccess: () => {
      invalidate()
      toast.success(`Deleted ${siteName(deployment)}`)
      close()
      if (afterDelete) navigate(afterDelete)
    },
  })
  const { aliases } = deployment
  return (
    <>
      <DialogHeader
        title={`Delete ${siteName(deployment)}?`}
        description="Its files and URL stop working at once. You cannot undo this."
      />
      <DialogBody>
        {aliases.length > 0 && (
          <div className="rounded-lg border border-danger/30 bg-danger/5 p-3 text-[13px]">
            <p className="font-medium text-danger">
              {aliases.length === 1 ? "This alias is" : "These aliases are"} also deleted:
            </p>
            <ul className="mt-1 flex flex-wrap gap-1.5">
              {aliases.map((alias) => (
                <li key={alias.name}>
                  <Mono>/{alias.name}</Mono>
                </li>
              ))}
            </ul>
            <p className="mt-2 text-muted">To keep them, move them to another deployment first.</p>
          </div>
        )}
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

export function DeleteAliasDialog({ alias, ...props }: OpenProps & { alias: AliasSummary }) {
  return (
    <Dialog {...props}>
      <DeleteAlias alias={alias} close={() => props.onOpenChange(false)} />
    </Dialog>
  )
}

function DeleteAlias({ alias, close }: CloseProps & { alias: AliasSummary }) {
  const invalidate = useInvalidateSites()
  const mutation = useMutation({
    mutationFn: () => parseResponse(api.aliases[":name"].$delete({ param: { name: alias.name } })),
    onSuccess: () => {
      invalidate()
      toast.success(`Removed /${alias.name}`)
      close()
    },
  })
  return (
    <>
      <DialogHeader
        title={`Remove /${alias.name}?`}
        description="The alias URL stops working. The deployment it points to stays."
      />
      <DialogBody>
        {mutation.error && <ErrorNote>{errorMessage(mutation.error)}</ErrorNote>}
      </DialogBody>
      <DialogFooter>
        <CancelButton />
        <Button variant="danger" pending={mutation.isPending} onClick={() => mutation.mutate()}>
          Remove alias
        </Button>
      </DialogFooter>
    </>
  )
}

export function MoveAliasDialog({ alias, ...props }: OpenProps & { alias: AliasSummary }) {
  return (
    <Dialog {...props} wide>
      <MoveAlias alias={alias} close={() => props.onOpenChange(false)} />
    </Dialog>
  )
}

// Points an alias at another deployment, chosen from a searchable list.
function MoveAlias({ alias, close }: CloseProps & { alias: AliasSummary }) {
  const invalidate = useInvalidateSites()
  const [query, setQuery] = useState("")
  const search = useDebounced(query.trim(), 200)
  const list = useDeployments(search, undefined)
  const deployments = list.data?.pages.flatMap((page) => page.deployments) ?? []
  const [selected, setSelected] = useState<string>()
  const mutation = useMutation({
    mutationFn: (deploymentId: string) =>
      parseResponse(
        api.aliases[":name"].$put({
          param: { name: alias.name },
          json: { deploymentId, mode: "upsert" },
        }),
      ),
    onSuccess: () => {
      invalidate()
      toast.success(`/${alias.name} moved`)
      close()
    },
  })
  return (
    <form
      className="contents"
      onSubmit={(event) => {
        event.preventDefault()
        if (selected) mutation.mutate(selected)
      }}
    >
      <DialogHeader
        title={`Move /${alias.name}`}
        description="Pick the deployment the alias should serve. Its access and password stay the same."
      />
      <DialogBody>
        <input
          className={inputClass}
          data-autofocus
          type="search"
          placeholder="Search by title, id or alias"
          aria-label="Search deployments"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <fieldset className="grid max-h-80 gap-1 overflow-y-auto">
          <legend className="sr-only">Deployment</legend>
          {list.isPending && <Spinner className="m-4" />}
          {!list.isPending && deployments.length === 0 && (
            <p className="p-3 text-[13px] text-muted">No deployments match.</p>
          )}
          {deployments.map((d) => (
            <label
              key={d.id}
              className={cx(
                "flex cursor-pointer items-center gap-3 rounded-md border px-3 py-2 transition-colors has-focus-visible:outline-2 has-focus-visible:outline-accent",
                selected === d.id
                  ? "border-accent bg-accent/5"
                  : "border-transparent hover:bg-hover",
              )}
            >
              <input
                type="radio"
                name="deployment"
                className="sr-only"
                checked={selected === d.id}
                onChange={() => setSelected(d.id)}
              />
              <span className="grid min-w-0 flex-1">
                <span className="truncate font-medium">{siteName(d)}</span>
                <Mono className="truncate text-muted">
                  {d.id} · {timeAgo(d.createdAt)}
                </Mono>
              </span>
              {d.id === alias.deploymentId && <span className="text-xs text-muted">current</span>}
            </label>
          ))}
        </fieldset>
        {mutation.error && <ErrorNote>{errorMessage(mutation.error)}</ErrorNote>}
      </DialogBody>
      <DialogFooter>
        <CancelButton />
        <Button
          variant="primary"
          type="submit"
          disabled={!selected || selected === alias.deploymentId}
          pending={mutation.isPending}
        >
          Move alias
        </Button>
      </DialogFooter>
    </form>
  )
}
