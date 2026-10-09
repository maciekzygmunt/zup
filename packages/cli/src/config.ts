import { chmod, mkdir, readFile, rm, writeFile } from "node:fs/promises"
import { homedir } from "node:os"
import { join } from "node:path"

// Saved login: ${XDG_CONFIG_HOME:-~/.config}/zup/config.json (mode 0600).
export type SavedConfig = { server?: string; token?: string; email?: string }

const dir = join(process.env.XDG_CONFIG_HOME || join(homedir(), ".config"), "zup")
const file = join(dir, "config.json")

export async function readConfig(): Promise<SavedConfig> {
  try {
    return JSON.parse(await readFile(file, "utf8")) as SavedConfig
  } catch {
    return {}
  }
}

export async function writeConfig(config: SavedConfig) {
  await mkdir(dir, { recursive: true, mode: 0o700 })
  await writeFile(file, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 })
  await chmod(file, 0o600)
}

export const clearConfig = () => rm(file, { force: true })

export const configPath = file

// Server URL without a trailing slash; accepts "zup.example.com".
export function normalizeServer(input: string): string {
  const withScheme = /^https?:\/\//.test(input) ? input : `https://${input}`
  return new URL(withScheme).origin
}
