import type { SiteSummary } from "@zup/shared"
import {
  ExternalLink,
  FilePlus2,
  FolderTree,
  FolderUp,
  Link as LinkIcon,
  MoreHorizontal,
  Pencil,
  Share2,
  ShieldCheck,
  Trash2,
} from "lucide-react"
import { useState } from "react"
import { toast } from "sonner"
import { api, errorMessage, parseResponse } from "../lib/api.ts"
import { browseHref, openHref } from "../lib/links.ts"
import { copyText } from "./copy.tsx"
import { Menu, MenuItem, MenuLink, MenuSeparator } from "./Menu.tsx"
import {
  ChangeAccessDialog,
  DeleteSiteDialog,
  EditDetailsDialog,
  siteName,
} from "./site-dialogs.tsx"
import { buttonClass } from "./ui.tsx"
import { useUpload } from "./upload/UploadProvider.tsx"

// Creates a fresh `#token=` link for a password-protected site and copies it.
export async function copyShareLink(slug: string) {
  try {
    const { shareUrl } = await parseResponse(
      api.sites[":slug"]["share-link"].$post({ param: { slug } }),
    )
    await copyText(shareUrl, "Share link copied")
  } catch (error) {
    toast.error(errorMessage(error))
  }
}

type DialogName = "access" | "details" | "delete"

// Row actions for one site, with the dialogs they open.
export function SiteMenu({ site }: { site: SiteSummary }) {
  const { pickFiles, pickFolder } = useUpload()
  const [dialog, setDialog] = useState<DialogName | null>(null)
  const control = (name: DialogName) => ({
    open: dialog === name,
    onOpenChange: (open: boolean) => setDialog(open ? name : null),
  })
  return (
    <>
      <Menu
        trigger={
          <button
            type="button"
            className={buttonClass("ghost", "icon")}
            aria-label={`Actions for ${siteName(site)}`}
          >
            <MoreHorizontal className="size-4" />
          </button>
        }
      >
        <MenuLink icon={ExternalLink} href={openHref(site.url, site.access)}>
          Open
        </MenuLink>
        <MenuItem icon={LinkIcon} onClick={() => copyText(site.url)}>
          Copy link
        </MenuItem>
        {site.access === "password" && (
          <MenuItem icon={Share2} onClick={() => copyShareLink(site.slug)}>
            Copy share link
          </MenuItem>
        )}
        <MenuLink icon={FolderTree} href={browseHref(site.url)}>
          Browse files
        </MenuLink>
        <MenuSeparator />
        <MenuItem icon={ShieldCheck} onClick={() => setDialog("access")}>
          Change access…
        </MenuItem>
        <MenuItem icon={Pencil} onClick={() => setDialog("details")}>
          Edit details…
        </MenuItem>
        <MenuItem icon={FilePlus2} onClick={() => pickFiles(site)}>
          Replace with files…
        </MenuItem>
        <MenuItem icon={FolderUp} onClick={() => pickFolder(site)}>
          Replace with folder…
        </MenuItem>
        <MenuSeparator />
        <MenuItem icon={Trash2} danger onClick={() => setDialog("delete")}>
          Delete…
        </MenuItem>
      </Menu>
      <ChangeAccessDialog site={site} {...control("access")} />
      <EditDetailsDialog site={site} {...control("details")} />
      <DeleteSiteDialog site={site} {...control("delete")} />
    </>
  )
}
