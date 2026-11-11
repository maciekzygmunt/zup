import { formatBytes } from "@zup/shared"
import { CopyRow } from "../../components/copy.tsx"
import { Card } from "../../components/ui.tsx"
import { plural } from "../../lib/format.ts"
import { useInfo, useStats } from "../../lib/queries.ts"
import { Section } from "../SettingsPage.tsx"

export function SetupHelp() {
  const info = useInfo()
  const stats = useStats().data
  return (
    <>
      <Section
        title="Command line"
        description="Publish folders from your terminal. The login opens this dashboard to approve it."
      >
        {info && (
          <Card className="grid gap-3 p-4">
            <CopyRow label="Install" value={`curl -fsSL ${info.appUrl}/install.sh | sh`} />
            <CopyRow label="Log in" value={`zup login ${info.appUrl}`} />
            <CopyRow label="Publish" value="zup ./dist --slug my-site" />
          </Card>
        )}
      </Section>
      <Section
        title="MCP"
        description="Let AI agents publish and manage sites. You approve each app once."
      >
        {info && (
          <Card className="grid gap-3 p-4">
            <CopyRow
              label="Claude Code"
              value={`claude mcp add --transport http zup ${info.appUrl}/mcp`}
            />
            <CopyRow label="Server URL (other clients)" value={`${info.appUrl}/mcp`} />
          </Card>
        )}
      </Section>
      <Section title="Server" description={info ? `zup ${info.version}` : undefined}>
        <Card className="grid gap-x-6 gap-y-2 p-4 text-[13px] sm:grid-cols-2">
          <Stat label="Dashboard" value={info?.appUrl} mono />
          <Stat label="Sites" value={info?.previewUrl} mono />
          <Stat label="Published" value={stats && plural(stats.sites, "site")} />
          <Stat
            label="Storage"
            value={
              stats &&
              `${formatBytes(stats.storedBytes)} on disk (${formatBytes(stats.uploadedBytes)} in sites)`
            }
          />
          <Stat
            label="Limits"
            value={
              info &&
              `${formatBytes(info.limits.maxFileBytes)} per file · ${formatBytes(info.limits.maxSiteBytes)} per site · ${info.limits.maxFiles.toLocaleString()} files`
            }
          />
        </Card>
      </Section>
    </>
  )
}

function Stat({ label, value, mono }: { label: string; value?: string; mono?: boolean }) {
  return (
    <div className="grid min-w-0">
      <span className="text-xs text-muted">{label}</span>
      <span className={mono ? "truncate font-mono text-[12.5px]" : "tabular-nums"}>
        {value ?? "…"}
      </span>
    </div>
  )
}
