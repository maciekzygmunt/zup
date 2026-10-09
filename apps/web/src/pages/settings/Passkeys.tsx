import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Fingerprint, Pencil, Plus, Trash2 } from "lucide-react"
import { useState } from "react"
import { toast } from "sonner"
import {
  CancelButton,
  Dialog,
  DialogBody,
  DialogFooter,
  DialogHeader,
} from "../../components/Dialog.tsx"
import { Button, Card, ErrorNote, Field, Input, Spinner } from "../../components/ui.tsx"
import { authClient, unwrap } from "../../lib/auth.ts"
import { describeAgent, fullDate, timeAgo } from "../../lib/format.ts"
import { Section } from "../SettingsPage.tsx"

const passkeysKey = ["passkeys"]

type Passkey = typeof authClient.$Infer.Passkey

export function Passkeys() {
  const queryClient = useQueryClient()
  const list = useQuery({
    queryKey: passkeysKey,
    queryFn: () => unwrap(authClient.passkey.listUserPasskeys()),
  })
  const refresh = () => queryClient.invalidateQueries({ queryKey: passkeysKey })
  const add = useMutation({
    mutationFn: () =>
      unwrap(authClient.passkey.addPasskey({ name: describeAgent(navigator.userAgent) })),
    onSuccess: () => {
      toast.success("Passkey added")
      refresh()
    },
    onError: (error) => toast.error(error.message),
  })
  const remove = useMutation({
    mutationFn: (id: string) => unwrap(authClient.passkey.deletePasskey({ id })),
    onSuccess: () => {
      toast.success("Passkey removed")
      refresh()
    },
    onError: (error) => toast.error(error.message),
  })
  const [renaming, setRenaming] = useState<Passkey | null>(null)

  return (
    <Section
      title="Passkeys"
      description="Sign in with Touch ID, Windows Hello, a phone or a security key."
      action={
        <Button size="sm" onClick={() => add.mutate()} pending={add.isPending}>
          <Plus className="size-3.5" aria-hidden /> Add passkey
        </Button>
      }
    >
      <Card className="divide-y divide-line">
        {list.isPending && <Spinner className="m-4" />}
        {list.error && <ErrorNote>{list.error.message}</ErrorNote>}
        {list.data?.length === 0 && <p className="p-4 text-[13px] text-muted">No passkeys yet.</p>}
        {list.data?.map((passkey) => (
          <div key={passkey.id} className="flex items-center gap-3 px-4 py-2.5">
            <Fingerprint className="size-4 text-muted" aria-hidden />
            <div className="grid min-w-0 flex-1">
              <span className="truncate text-[13px] font-medium">{passkey.name || "Passkey"}</span>
              <span className="text-xs text-muted" title={fullDate(passkey.createdAt)}>
                Added {timeAgo(passkey.createdAt)}
                {passkey.backedUp ? " · synced" : ""}
              </span>
            </div>
            <Button
              size="icon"
              variant="ghost"
              aria-label="Rename"
              onClick={() => setRenaming(passkey)}
            >
              <Pencil className="size-3.5" />
            </Button>
            <Button
              size="icon"
              variant="ghost"
              aria-label="Remove"
              pending={remove.isPending && remove.variables === passkey.id}
              onClick={() => remove.mutate(passkey.id)}
            >
              <Trash2 className="size-3.5" />
            </Button>
          </div>
        ))}
      </Card>
      <Dialog open={!!renaming} onOpenChange={(open) => !open && setRenaming(null)}>
        {renaming && <Rename passkey={renaming} close={() => setRenaming(null)} onDone={refresh} />}
      </Dialog>
    </Section>
  )
}

function Rename({
  passkey,
  close,
  onDone,
}: {
  passkey: Passkey
  close: () => void
  onDone: () => void
}) {
  const [name, setName] = useState(passkey.name ?? "")
  const save = useMutation({
    mutationFn: () =>
      unwrap(authClient.passkey.updatePasskey({ id: passkey.id, name: name.trim() })),
    onSuccess: () => {
      onDone()
      close()
    },
  })
  return (
    <form
      className="contents"
      onSubmit={(event) => {
        event.preventDefault()
        save.mutate()
      }}
    >
      <DialogHeader title="Rename passkey" />
      <DialogBody>
        <Field label="Name">
          <Input
            required
            data-autofocus
            value={name}
            maxLength={100}
            onChange={(e) => setName(e.target.value)}
          />
        </Field>
        {save.error && <ErrorNote>{save.error.message}</ErrorNote>}
      </DialogBody>
      <DialogFooter>
        <CancelButton />
        <Button variant="primary" type="submit" pending={save.isPending}>
          Save
        </Button>
      </DialogFooter>
    </form>
  )
}
