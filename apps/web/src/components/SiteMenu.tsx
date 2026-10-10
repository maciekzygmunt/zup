import type { DeploymentSummary } from "@zup/shared"
import {
  ExternalLink,
  FolderTree,
  Link as LinkIcon,
  MoreHorizontal,
  Pencil,
  Plus,
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
  AddAliasDialog,
  ChangeAccessDialog,
  DeleteDeploymentDialog,
  EditDetailsDialog,
} from "./site-dialogs.tsx"
import { buttonClass } from "./ui.tsx"

// Creates a fresh `#token=` link for a password-protected deployment or alias and copies it.
export async function copyShareLink(target: { deploymentId: string } | { alias: string }) {
  try {
    const { shareUrl } = await parseResponse(api["share-links"].$post({ json: target }))
    await copyText(shareUrl, "Share link copied")
  } catch (error) {
    toast.error(errorMessage(error))
  }
}

type DialogName = "access" | "details" | "alias" | "delete"

// Row actions for one deployment, with the dialogs they open.
export function SiteMenu({ deployment }: { deployment: DeploymentSummary }) {
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
            aria-label={`Actions for ${deployment.title || deployment.id}`}
          >
            <MoreHorizontal className="size-4" />
          </button>
        }
      >
        <MenuLink icon={ExternalLink} href={openHref(deployment.url, deployment.access)}>
          Open
        </MenuLink>
        <MenuItem icon={LinkIcon} onClick={() => copyText(deployment.url)}>
          Copy link
        </MenuItem>
        {deployment.access === "password" && (
          <MenuItem icon={Share2} onClick={() => copyShareLink({ deploymentId: deployment.id })}>
            Copy share link
          </MenuItem>
        )}
        <MenuLink icon={FolderTree} href={browseHref(deployment.url)}>
          Browse files
        </MenuLink>
        <MenuSeparator />
        <MenuItem icon={ShieldCheck} onClick={() => setDialog("access")}>
          Change access…
        </MenuItem>
        <MenuItem icon={Pencil} onClick={() => setDialog("details")}>
          Edit details…
        </MenuItem>
        <MenuItem icon={Plus} onClick={() => setDialog("alias")}>
          Add alias…
        </MenuItem>
        <MenuSeparator />
        <MenuItem icon={Trash2} danger onClick={() => setDialog("delete")}>
          Delete…
        </MenuItem>
      </Menu>
      <ChangeAccessDialog
        target={{ kind: "deployment", id: deployment.id, access: deployment.access }}
        {...control("access")}
      />
      <EditDetailsDialog deployment={deployment} {...control("details")} />
      <AddAliasDialog deployment={deployment} {...control("alias")} />
      <DeleteDeploymentDialog deployment={deployment} {...control("delete")} />
    </>
  )
}
