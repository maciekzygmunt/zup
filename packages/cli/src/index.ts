import { realpath, rename, writeFile } from "node:fs/promises"
import { homedir } from "node:os"
import { join } from "node:path"
import { parseArgs } from "node:util"
import { session } from "./api.ts"
import { deploy } from "./commands/deploy.ts"
import { login, logout, whoami } from "./commands/login.ts"
import {
  alias,
  expire,
  list,
  open,
  remove,
  rename as renameSite,
  setAccess,
  share,
  show,
  unalias,
} from "./commands/manage.ts"
import { pull } from "./commands/pull.ts"
import { bold, CliError, dim, green, info, red } from "./ui.ts"

const version = "1.0.0"

const help = `${bold("zup")} — publish files and static sites to your zup server

${bold("Usage")}
  zup <path...> [options]         Publish files or a folder (same as \`zup deploy\`)
  zup login [server-url]          Log in with your browser
  zup logout                      Log out and end the session
  zup whoami                      Show the logged-in account

  zup ls [search]                 List deployments (--access, --limit, --json)
  zup info <site>                 Show details and files
  zup open <site>                 Open in the browser
  zup alias <site> <name>         Point an alias at a deployment (--update to move)
  zup unalias <name>              Delete an alias
  zup access <site> <flag>        Change access: --public, --private, --protect, --password
  zup expire <site> <when|never>  Set or clear expiry (30m, 12h, 7d, 2w or a date)
  zup rename <site> <title>       Change the title
  zup share <site>                Print a share link for a password-protected site
  zup rm <site...>                Delete deployments or aliases (-y to skip the prompt)
  zup pull <site> [dir]           Download the files (--force, --dry-run)
  zup upgrade                     Install the latest CLI from your server

  <site> is a deployment id, an alias, or a site URL.

${bold("Publish options")}
  -t, --title <text>       Title shown in the dashboard (default: folder or file name)
      --private            Only you can open it (default)
      --public             Anyone with the URL can open it
      --protect            Anyone with a generated password can open it
      --password <key>     Same, with your own password (8+ characters)
  -a, --alias <name>       Also serve it at <sites-url>/<name>/
  -u, --update             Move the alias if it already exists (old deployment expires in 7d)
  -e, --expires <when>     Delete after 30m, 12h, 7d, 2w or at a date
      --entrypoint <file>  File served at the root
      --no-spa             No fallback to the entrypoint for unknown paths
      --open               Open the result in the browser
      --dry-run            List the files without uploading
      --json               Print JSON
      --server <url>       Use another server than the saved one

${bold("Ignored files")}
  .git, node_modules, .env files and .DS_Store are never uploaded from folders.
  .gitignore rules apply (unless the folder itself is ignored, like dist/).
  Add a .zupignore (gitignore syntax) to the folder for more.

${bold("Environment")}
  ZUP_SERVER, ZUP_TOKEN    Server URL and token (override the saved login)
  ZUP_PASSWORD             Password used by --protect instead of a generated one
`

const commands = new Set([
  "deploy",
  "login",
  "logout",
  "whoami",
  "ls",
  "list",
  "info",
  "open",
  "alias",
  "unalias",
  "access",
  "expire",
  "rename",
  "share",
  "rm",
  "pull",
  "upgrade",
  "help",
])

// Replaces an install made by /install.sh with the server's current build.
async function upgrade(flags: { server?: string }) {
  const current = await session(flags.server)
  const installed = join(homedir(), ".local", "share", "zup", "zup.mjs")
  const self = await realpath(process.argv[1] ?? "")
  if (self !== (await realpath(installed).catch(() => installed))) {
    throw new CliError(
      `This copy is not managed by install.sh (${self}). Update it the way you installed it.`,
    )
  }
  const response = await fetch(`${current.server}/cli/zup.mjs`)
  if (!response.ok) throw new CliError(`Download failed with HTTP ${response.status}`)
  await writeFile(`${installed}.tmp`, await response.text(), { mode: 0o755 })
  await rename(`${installed}.tmp`, installed)
  info(`${green("✓")} Updated from ${current.server}`)
}

async function main(argv: string[]) {
  const { values: flags, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      title: { type: "string", short: "t" },
      alias: { type: "string", short: "a" },
      update: { type: "boolean", short: "u" },
      expires: { type: "string", short: "e" },
      entrypoint: { type: "string" },
      spa: { type: "boolean" },
      "no-spa": { type: "boolean" },
      "dry-run": { type: "boolean" },
      json: { type: "boolean" },
      open: { type: "boolean" },
      "no-open": { type: "boolean" },
      yes: { type: "boolean", short: "y" },
      public: { type: "boolean" },
      private: { type: "boolean" },
      protect: { type: "boolean" },
      password: { type: "string" },
      server: { type: "string" },
      force: { type: "boolean", short: "f" },
      access: { type: "string" },
      limit: { type: "string" },
      help: { type: "boolean", short: "h" },
      version: { type: "boolean", short: "v" },
    },
  })

  if (flags.version) return void process.stdout.write(`${version}\n`)
  const [first, ...rest] = positionals
  if (flags.help || first === "help" || (!first && !argv.length)) {
    return void process.stdout.write(help)
  }
  const command = first && commands.has(first) ? first : "deploy"
  const args = command === "deploy" && first !== "deploy" ? positionals : rest
  const need = (count: number, usage: string) => {
    if (args.length < count) throw new CliError(`Usage: zup ${usage}`)
  }

  switch (command) {
    case "deploy":
      return deploy(args, flags)
    case "login":
      return login(args[0], { open: !flags["no-open"] })
    case "logout":
      return logout()
    case "whoami":
      return whoami(flags)
    case "ls":
    case "list":
      return list(args[0], flags)
    case "info":
      need(1, "info <site>")
      return show(args[0]!, flags)
    case "open":
      need(1, "open <site>")
      return open(args[0]!, flags)
    case "alias":
      need(2, "alias <site> <name>")
      return alias(args[0]!, args[1]!, flags)
    case "unalias":
      need(1, "unalias <name>")
      return unalias(args[0]!, flags)
    case "access":
      need(1, "access <site> --public|--private|--protect|--password <key>")
      return setAccess(args[0]!, flags)
    case "expire":
      need(2, "expire <site> <30m|12h|7d|2w|date|never>")
      return expire(args[0]!, args[1]!, flags)
    case "rename":
      need(2, "rename <site> <title>")
      return renameSite(args[0]!, args.slice(1).join(" "), flags)
    case "share":
      need(1, "share <site>")
      return share(args[0]!, flags)
    case "rm":
      need(1, "rm <site...>")
      return remove(args, flags)
    case "pull":
      need(1, "pull <site> [dir]")
      return pull(args[0]!, args[1], flags)
    case "upgrade":
      return upgrade(flags)
  }
}

main(process.argv.slice(2)).catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error)
  process.stderr.write(`${red("✗")} ${message}\n`)
  if (process.env.ZUP_DEBUG && error instanceof Error && !(error instanceof CliError)) {
    process.stderr.write(dim(`${error.stack}\n`))
  }
  process.exitCode = 1
})
