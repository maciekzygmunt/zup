import { useMutation } from "@tanstack/react-query"
import { useState } from "react"
import { toast } from "sonner"
import { Button, Card, ErrorNote, Field, Input } from "../../components/ui.tsx"
import { authClient, unwrap } from "../../lib/auth.ts"
import { Section } from "../SettingsPage.tsx"

export function Profile() {
  const session = authClient.useSession()
  const user = session.data?.user
  return (
    <Section title="Profile" description="Your owner account.">
      <div className="grid gap-4">
        {user && <NameForm key={user.name} name={user.name} email={user.email} />}
        <PasswordForm />
      </div>
    </Section>
  )
}

function NameForm({ name: initial, email }: { name: string; email: string }) {
  const [name, setName] = useState(initial)
  const save = useMutation({
    mutationFn: () => unwrap(authClient.updateUser({ name: name.trim() })),
    onSuccess: () => toast.success("Name saved"),
  })
  return (
    <Card className="grid gap-4 p-4">
      <form
        className="grid gap-4 sm:grid-cols-2"
        onSubmit={(event) => {
          event.preventDefault()
          save.mutate()
        }}
      >
        <Field label="Name">
          <div className="flex gap-2">
            <Input required value={name} onChange={(e) => setName(e.target.value)} />
            <Button type="submit" disabled={name.trim() === initial} pending={save.isPending}>
              Save
            </Button>
          </div>
        </Field>
        <Field label="Email" hint="Used to sign in.">
          <Input value={email} readOnly disabled />
        </Field>
      </form>
      {save.error && <ErrorNote>{save.error.message}</ErrorNote>}
    </Card>
  )
}

function PasswordForm() {
  const [form, setForm] = useState({ current: "", next: "", confirm: "", revokeOthers: true })
  const [error, setError] = useState<string | null>(null)
  const change = useMutation({
    mutationFn: () =>
      unwrap(
        authClient.changePassword({
          currentPassword: form.current,
          newPassword: form.next,
          revokeOtherSessions: form.revokeOthers,
        }),
      ),
    onSuccess: () => {
      toast.success("Password changed")
      setForm({ current: "", next: "", confirm: "", revokeOthers: true })
    },
  })
  return (
    <Card className="p-4">
      <form
        className="grid gap-4"
        onSubmit={(event) => {
          event.preventDefault()
          setError(null)
          if (form.next.length < 10) return setError("Use at least 10 characters.")
          if (form.next !== form.confirm) return setError("The new passwords do not match.")
          change.mutate()
        }}
      >
        <h3 className="text-[13px] font-semibold">Change password</h3>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Current password">
            <Input
              required
              type="password"
              autoComplete="current-password"
              value={form.current}
              onChange={(e) => setForm({ ...form, current: e.target.value })}
            />
          </Field>
          <Field label="New password">
            <Input
              required
              type="password"
              autoComplete="new-password"
              minLength={10}
              value={form.next}
              onChange={(e) => setForm({ ...form, next: e.target.value })}
            />
          </Field>
          <Field label="Confirm new password">
            <Input
              required
              type="password"
              autoComplete="new-password"
              value={form.confirm}
              onChange={(e) => setForm({ ...form, confirm: e.target.value })}
            />
          </Field>
        </div>
        <label className="flex items-center gap-2 text-[13px]">
          <input
            type="checkbox"
            checked={form.revokeOthers}
            onChange={(e) => setForm({ ...form, revokeOthers: e.target.checked })}
          />
          Sign out all other sessions, including CLI logins
        </label>
        {(error || change.error) && <ErrorNote>{error ?? change.error?.message}</ErrorNote>}
        <div>
          <Button variant="primary" type="submit" pending={change.isPending}>
            Change password
          </Button>
        </div>
      </form>
    </Card>
  )
}
