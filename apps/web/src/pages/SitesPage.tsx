import type { AccessType, SiteSummary } from "@zup/shared"
import { accessTypes, formatBytes } from "@zup/shared"
import { ChevronDown, Clock, FilePlus2, FolderUp, Search, Upload } from "lucide-react"
import { useEffect, useRef, useState } from "react"
import { Link, useSearchParams } from "react-router"
import { accessInfo, SiteAccessBadge } from "../components/access.tsx"
import { CopyRow } from "../components/copy.tsx"
import { Menu, MenuItem } from "../components/Menu.tsx"
import { SiteMenu } from "../components/SiteMenu.tsx"
import { siteName } from "../components/site-dialogs.tsx"
import {
  Button,
  buttonClass,
  Card,
  cx,
  ErrorNote,
  inputClass,
  Mono,
  Spinner,
} from "../components/ui.tsx"
import { useUpload } from "../components/upload/UploadProvider.tsx"
import { errorMessage } from "../lib/api.ts"
import { fullDate, plural, timeAgo } from "../lib/format.ts"
import { useDebounced } from "../lib/hooks.ts"
import { useInfo, useSites } from "../lib/queries.ts"

const filters: { value: AccessType | undefined; label: string }[] = [
  { value: undefined, label: "All" },
  ...accessTypes.map((value) => ({ value, label: accessInfo[value].label })),
]

const isAccess = (value: string | null): value is AccessType =>
  accessTypes.some((type) => type === value)

export function SitesPage() {
  const [params, setParams] = useSearchParams()
  const accessParam = params.get("access")
  const access = isAccess(accessParam) ? accessParam : undefined
  const [query, setQuery] = useState(params.get("q") ?? "")
  const q = useDebounced(query.trim(), 250)
  const list = useSites(q, access, { keepPrevious: true })
  const sites = list.data?.pages.flatMap((page) => page.sites) ?? []
  // The old total would not match the new filter, so hide it while the new results load.
  const total = list.isPlaceholderData ? undefined : list.data?.pages[0]?.total
  const filtered = !!q || !!access

  useEffect(() => {
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        if (q) next.set("q", q)
        else next.delete("q")
        return next
      },
      { replace: true },
    )
  }, [q, setParams])

  const setAccess = (value: AccessType | undefined) =>
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        if (value) next.set("access", value)
        else next.delete("access")
        return next
      },
      { replace: true },
    )

  return (
    <div className="grid gap-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Sites</h1>
          <p className="text-[13px] text-muted tabular-nums">
            {total === undefined
              ? "\u00a0"
              : filtered
                ? `${plural(total, "match", "matches")}`
                : plural(total, "site")}
          </p>
        </div>
        <UploadButton />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <SearchBox value={query} onChange={setQuery} />
        <fieldset className="flex rounded-md border border-line bg-card p-0.5">
          <legend className="sr-only">Access filter</legend>
          {filters.map((filter) => (
            <label
              key={filter.label}
              className={cx(
                "cursor-pointer rounded px-2.5 py-1 text-[13px] has-focus-visible:outline-2 has-focus-visible:outline-accent",
                access === filter.value
                  ? "bg-subtle font-medium text-fg"
                  : "text-muted hover:text-fg",
              )}
            >
              <input
                type="radio"
                name="access-filter"
                className="sr-only"
                checked={access === filter.value}
                onChange={() => setAccess(filter.value)}
              />
              {filter.label}
            </label>
          ))}
        </fieldset>
      </div>

      {list.error && <ErrorNote>{errorMessage(list.error)}</ErrorNote>}
      {list.isPending ? (
        <Spinner className="mx-auto my-16" />
      ) : sites.length === 0 ? (
        filtered ? (
          <p className="py-16 text-center text-[13px] text-muted">No sites match.</p>
        ) : (
          <EmptyState />
        )
      ) : (
        <Card
          className={cx(
            "divide-y divide-line overflow-hidden transition-opacity",
            list.isPlaceholderData && "opacity-60",
          )}
        >
          {sites.map((site) => (
            <SiteRow key={site.slug} site={site} />
          ))}
        </Card>
      )}
      {list.hasNextPage && (
        <Button
          className="mx-auto"
          onClick={() => list.fetchNextPage()}
          pending={list.isFetchingNextPage}
        >
          Load more
        </Button>
      )}
    </div>
  )
}

// Search field; "/" focuses it from anywhere on the page.
function SearchBox({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target
      const typing =
        target instanceof HTMLElement &&
        (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName))
      if (event.key === "/" && !typing && !event.metaKey && !event.ctrlKey) {
        event.preventDefault()
        ref.current?.focus()
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [])
  return (
    <div className="relative min-w-0 basis-full sm:max-w-xs sm:flex-1 sm:basis-auto">
      <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted" />
      <input
        ref={ref}
        type="search"
        aria-label="Search sites"
        placeholder="Search title or slug"
        className={cx(inputClass, "pr-8 pl-8")}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            onChange("")
            e.currentTarget.blur()
          }
        }}
      />
      <kbd className="pointer-events-none absolute top-1/2 right-2 hidden -translate-y-1/2 rounded border border-line px-1.5 font-mono text-[11px] text-muted sm:block">
        /
      </kbd>
    </div>
  )
}

function UploadButton() {
  const { pickFiles, pickFolder } = useUpload()
  return (
    <Menu
      trigger={
        <button type="button" className={buttonClass("accent")}>
          <Upload className="size-4" aria-hidden />
          Upload
          <ChevronDown className="size-3.5 opacity-70" aria-hidden />
        </button>
      }
    >
      <MenuItem icon={FilePlus2} onClick={() => pickFiles()}>
        Files…
      </MenuItem>
      <MenuItem icon={FolderUp} onClick={() => pickFolder()}>
        Folder…
      </MenuItem>
      <p className="px-2 pt-1.5 pb-1 text-xs text-muted">Or drop files anywhere.</p>
    </Menu>
  )
}

function SiteRow({ site }: { site: SiteSummary }) {
  return (
    <div className="relative flex items-center gap-3 px-4 py-3 transition-colors hover:bg-subtle/60 sm:gap-4">
      <div className="grid min-w-0 flex-1 gap-1.5 md:grid-cols-[minmax(0,1fr)_8rem_8rem_7rem] md:items-center md:gap-4">
        <div className="grid min-w-0">
          <Link
            to={`/sites/${site.slug}`}
            className="truncate font-medium after:absolute after:inset-0 focus-visible:outline-none focus-visible:after:outline-2 focus-visible:after:-outline-offset-2 focus-visible:after:outline-accent"
          >
            {siteName(site)}
          </Link>
          <Mono className="truncate text-muted">/{site.slug}</Mono>
        </div>
        <div className="flex min-w-0 items-center">
          {/* Above the row link so hovering the badge shows its tooltip. */}
          <SiteAccessBadge site={site} />
        </div>
        <div className="flex gap-3 text-[12.5px] text-muted tabular-nums md:grid md:gap-0">
          <span>{plural(site.fileCount, "file")}</span>
          <span>{formatBytes(site.totalBytes)}</span>
        </div>
        <div className="flex gap-3 text-[12.5px] text-muted md:grid md:gap-0">
          <span title={`Updated ${fullDate(site.updatedAt)}`}>{timeAgo(site.updatedAt)}</span>
          {site.expiresAt && (
            <span
              title={fullDate(site.expiresAt)}
              className="inline-flex items-center gap-1 text-warn"
            >
              <Clock className="size-3" aria-hidden />
              {timeAgo(site.expiresAt)}
            </span>
          )}
        </div>
      </div>
      <div className="relative z-10">
        <SiteMenu site={site} />
      </div>
    </div>
  )
}

function EmptyState() {
  const info = useInfo()
  const { pickFiles, pickFolder } = useUpload()
  return (
    <Card className="grid justify-items-center gap-4 border-dashed px-6 py-14 text-center">
      <Upload className="size-8 text-muted" aria-hidden />
      <div className="grid gap-1">
        <h2 className="text-base font-semibold">Publish your first site</h2>
        <p className="max-w-md text-[13px] text-muted text-pretty">
          Drop a folder or files anywhere on this page. A folder with an index.html becomes a
          website; other files get a clean file listing.
        </p>
      </div>
      <div className="flex gap-2">
        <Button variant="accent" onClick={() => pickFolder()}>
          <FolderUp className="size-4" aria-hidden /> Upload folder
        </Button>
        <Button onClick={() => pickFiles()}>
          <FilePlus2 className="size-4" aria-hidden /> Upload files
        </Button>
      </div>
      {info && (
        <div className="grid w-full max-w-md gap-2 pt-4 text-left">
          <p className="text-xs text-muted">Or publish from your terminal:</p>
          <CopyRow label="Log in" value={`zup login ${info.appUrl}`} />
          <CopyRow label="Publish a folder" value="zup ./dist" />
        </div>
      )}
    </Card>
  )
}
