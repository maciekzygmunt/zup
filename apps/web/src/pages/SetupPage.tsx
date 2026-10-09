import { useQueryClient } from "@tanstack/react-query"
import { type ChangeEvent, type FormEvent, useState } from "react"
import { useNavigate } from "react-router"
import { toast } from "sonner"
import { CenteredPage } from "../components/AppShell.tsx"
import { Button, ErrorNote, Field, Input } from "../components/ui.tsx"
import { authClient } from "../lib/auth.ts"
import { setupQuery } from "../lib/queries.ts"

export function SetupPage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [form, setForm] = useState({ name: "", email: "", password: "", confirm: "" })
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const set = (key: keyof typeof form) => (e: ChangeEvent<HTMLInputElement>) =>
    setForm({ ...form, [key]: e.target.value })

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setError(null)
    if (form.password.length < 10) return setError("Use at least 10 characters for the password.")
    if (form.password !== form.confirm) return setError("The passwords do not match.")
    setPending(true)
    const { error } = await authClient.signUp.email({
      name: form.name.trim(),
      email: form.email.trim(),
      password: form.password,
    })
    setPending(false)
    if (error) return setError(error.message ?? "Could not create the account.")
    queryClient.setQueryData(setupQuery.queryKey, { needsSetup: false })
    toast.success("Welcome to zup", {
      description: "Add a passkey in Settings to sign in faster.",
      action: { label: "Settings", onClick: () => navigate("/settings") },
      duration: 10_000,
    })
    navigate("/", { replace: true })
  }

  return (
    <CenteredPage>
      <div className="grid gap-1">
        <h1 className="text-xl font-semibold">Set up zup</h1>
        <p className="text-[13px] text-muted text-pretty">
          Create the owner account. zup has one account; sign-up closes after this.
        </p>
      </div>
      <form onSubmit={submit} className="grid gap-4">
        <Field label="Name">
          <Input required autoComplete="name" value={form.name} onChange={set("name")} />
        </Field>
        <Field label="Email">
          <Input
            required
            type="email"
            autoComplete="email"
            value={form.email}
            onChange={set("email")}
          />
        </Field>
        <Field label="Password" hint="At least 10 characters.">
          <Input
            required
            type="password"
            autoComplete="new-password"
            minLength={10}
            value={form.password}
            onChange={set("password")}
          />
        </Field>
        <Field label="Confirm password">
          <Input
            required
            type="password"
            autoComplete="new-password"
            value={form.confirm}
            onChange={set("confirm")}
          />
        </Field>
        {error && <ErrorNote>{error}</ErrorNote>}
        <Button variant="primary" type="submit" pending={pending} className="h-9">
          Create account
        </Button>
      </form>
    </CenteredPage>
  )
}
