import type { AliasSummary } from "@zup/shared"
import {
  ExternalLink,
  Link as LinkIcon,
  MoreHorizontal,
  MoveRight,
  Share2,
  ShieldCheck,
  Trash2,
} from "lucide-react"
import { useState } from "react"
import { openHref } from "../lib/links.ts"
import { copyText } from "./copy.tsx"
import { Menu, MenuItem, MenuLink, MenuSeparator } from "./Menu.tsx"
import { copyShareLink } from "./SiteMenu.tsx"
import { ChangeAccessDialog, DeleteAliasDialog, MoveAliasDialog } from "./site-dialogs.tsx"
import { buttonClass } from "./ui.tsx"

type DialogName = "access" | "move" | "delete"

// Row actions for one alias, with the dialogs they open.
export function AliasMenu({ alias }: { alias: AliasSummary }) {
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
            aria-label={`Actions for /${alias.name}`}
          >
            <MoreHorizontal className="size-4" />
          </button>
        }
      >
        <MenuLink icon={ExternalLink} href={openHref(alias.url, alias.access)}>
          Open
        </MenuLink>
        <MenuItem icon={LinkIcon} onClick={() => copyText(alias.url)}>
          Copy link
        </MenuItem>
        {alias.access === "password" && (
          <MenuItem icon={Share2} onClick={() => copyShareLink({ alias: alias.name })}>
            Copy share link
          </MenuItem>
        )}
        <MenuSeparator />
        <MenuItem icon={ShieldCheck} onClick={() => setDialog("access")}>
          Change access…
        </MenuItem>
        <MenuItem icon={MoveRight} onClick={() => setDialog("move")}>
          Move to another deployment…
        </MenuItem>
        <MenuSeparator />
        <MenuItem icon={Trash2} danger onClick={() => setDialog("delete")}>
          Remove…
        </MenuItem>
      </Menu>
      <ChangeAccessDialog
        target={{
          kind: "alias",
          name: alias.name,
          access: alias.access,
          indexable: alias.indexable,
        }}
        {...control("access")}
      />
      <MoveAliasDialog alias={alias} {...control("move")} />
      <DeleteAliasDialog alias={alias} {...control("delete")} />
    </>
  )
}
