import { Link } from "react-router"
import { buttonClass } from "../components/ui.tsx"

export function NotFoundPage() {
  return (
    <div className="grid place-items-center gap-3 py-24 text-center">
      <p className="font-mono text-[13px] text-muted">404</p>
      <h1 className="text-xl font-semibold">Nothing here</h1>
      <Link to="/" className={buttonClass()}>
        Back to sites
      </Link>
    </div>
  )
}
