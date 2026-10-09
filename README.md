# zup

Self-hosted publishing for static files and sites. Run `zup ./dist` and get a URL.

- **CLI** — `zup <files or folder>` uploads only new content (content-addressed), prints the URL.
- **Three access levels** — private (only you), public (anyone with the URL), password (anyone with the password; a share link opens it without typing).
- **Aliases** — stable names like `https://preview.example.com/report/` that you move to a new upload.
- **Expiry** — `--expires 7d`; expired uploads are deleted.
- **Dashboard** — list, search, upload by drag and drop, change access, aliases, share links, sessions, passkeys.
- **MCP** — Claude Code / Claude Desktop can publish pages for you, with OAuth login.
- **Pull and source view** — `zup pull` downloads a site; `<site>/_src/` is a file browser for you.

One owner account (the first one created). Built with Bun, Hono, Better Auth, SQLite and React.

## How it works

One container serves two hosts:

| Host | Example | Serves |
| --- | --- | --- |
| `APP_URL` | `https://zup.example.com` | Dashboard, REST API, CLI login, MCP endpoint, `install.sh` |
| `PREVIEW_URL` | `https://preview.example.com` | Uploaded sites: `/u/<id>/` and `/<alias>/` |

Uploaded HTML runs JavaScript. Because it is served from a different host, it cannot use your
dashboard session. Data lives in one volume at `/data`:

```text
/data/zup.db        SQLite: account, sessions, OAuth clients, deployments, aliases
/data/blobs/ab/cd/… file contents, named by SHA-256 (shared between uploads)
```

## Deploy on Coolify

1. **DNS** — point both domains (e.g. `zup.example.com` and `preview.example.com`) to your Coolify server.
2. **New resource** — *Public/Private Repository* with this repo, build pack **Dockerfile**.
3. **Domains** — `https://zup.example.com,https://preview.example.com`. Port: `3000`.
4. **Persistent storage** — add a volume mounted at `/data`.
5. **Environment variables**:

   ```env
   APP_URL=https://zup.example.com
   PREVIEW_URL=https://preview.example.com
   BETTER_AUTH_SECRET=<output of: openssl rand -hex 32>
   ```

6. **Deploy**, then open `https://zup.example.com` and create your account. Sign-up closes after that.

You can also use the **Docker Compose** build pack with `docker-compose.yml`, or run it anywhere:

```sh
docker build -t zup .
docker run -d -p 3000:3000 -v zup-data:/data \
  -e APP_URL=https://zup.example.com -e PREVIEW_URL=https://preview.example.com \
  -e BETTER_AUTH_SECRET=$(openssl rand -hex 32) zup
```

Keep `BETTER_AUTH_SECRET` stable: changing it logs everyone out and invalidates MCP signing keys.
The container runs as user `bun` (uid 1000); a bind mount for `/data` must be writable by it.

### Backups

Back up the `/data` volume. For a consistent copy while the server runs, copy the database with
`sqlite3 /data/zup.db ".backup /backup/zup.db"` and then copy `/data/blobs`.

## CLI

Install it from your server (needs Node.js 20+):

```sh
curl -fsSL https://zup.example.com/install.sh | sh
zup login https://zup.example.com
```

`zup login` opens the dashboard and asks you to approve a code (OAuth device flow). The token is
saved in `~/.config/zup/config.json`. Logins show up under *Settings → Sessions*, where you can revoke them.
`zup upgrade` installs the latest CLI from your server.

```sh
zup ./dist                          # private site
zup report.html --public            # anyone with the URL
zup report.html --protect           # generated password, printed once with a share link
zup report.html --password 'correct horse battery'
zup ./dist --alias demo --public    # also at https://preview.example.com/demo/
zup ./dist --alias demo --update    # move the alias to the new upload (keeps its access/password)
zup notes.md -e 7d                  # delete after 7 days
zup photo.png                       # any file works; one file is served at its own name

zup ls [search]                     # list (--access public|private|password, --json)
zup info demo                       # details and files
zup open demo
zup share demo                      # new share link for a password-protected site
zup access demo --private           # --public, --protect, --password <key>
zup alias <id> demo                 # point an alias at an existing upload
zup unalias demo
zup expire demo never               # or 30m, 12h, 7d, 2w, a date
zup rename <id> "Q3 report"
zup rm <id> demo                    # deletes the deployment (and its aliases) and the alias
zup pull demo ./copy                # download files, verified by SHA-256
```

`<site>` is a deployment id, an alias, or a site URL. Run `zup --help` for every option.

What gets uploaded from a folder:

- `.git`, `node_modules`, `.env*` (except `.env.example`), `.npmrc`, `.DS_Store` are always skipped.
- `.gitignore` rules apply, unless the folder itself is ignored (a gitignored `dist/` uploads normally).
- Add a `.zupignore` (gitignore syntax) for more.
- `index.html` (or `index.md`) is the root. A single page or a single file is the root too.
  Without one, the root shows a file listing.
- Unknown paths without an extension serve the root page (single-page apps). Turn off with `--no-spa`.

Environment: `ZUP_SERVER`, `ZUP_TOKEN` (for CI), `ZUP_PASSWORD` (used by `--protect`).

## Access

| Access | Who can open it | Set with |
| --- | --- | --- |
| private | Only you (logged in) | default, `--private` |
| public | Anyone with the URL | `--public` |
| password | Anyone with the password | `--protect`, `--password <key>` |

A deployment and each alias have their own access. `zup ./dist --public --alias demo` sets both.

**Password sites.** Visitors get a password form. A correct password is remembered for 30 days
(a cookie for that one site). Share links (`…/#key=…` or `…/#share=…`) unlock without typing; the
part after `#` never reaches the server or its logs. Only a hash of the password is stored, so a
lost password cannot be shown again — `zup share` (or *Copy share link* in the dashboard) makes a
working link at any time. Setting a new password ends all old links and cookies.

**Private sites.** When you open one, zup logs the preview host in through your dashboard session.
Logging out of the dashboard (or revoking the session) ends that access too.

## MCP (Claude Code, Claude Desktop)

```sh
claude mcp add --transport http zup https://zup.example.com/mcp
```

Then run `/mcp` in Claude Code to log in. In Claude Desktop add a custom connector with the same URL.
You approve each client once on a consent page. Tools: `deploy_site`, `list_sites`, `get_site`,
`read_site_file`, `update_site`, `delete_site`, `list_aliases`, `set_alias`, `delete_alias`,
`get_share_link`. Passwords for password access are always generated by the server.

## Sites built for `/`

Sites live under a path (`/u/<id>/` or `/<alias>/`). Build tools that emit root-relative URLs
(`/assets/app.js`) still work: zup sees which site the request came from (the `Referer`) and
redirects into it. For best results build with relative paths (Vite: `base: "./"`).

## Security notes

- One owner. Sign-up is closed once the account exists. Passkeys are supported.
- Dashboard writes need same-origin requests (CSRF check); the CLI uses bearer tokens.
- All sites share the preview host. A page you upload can read other sites that the *same
  visitor* can open (for you: all of them). Upload third-party HTML with that in mind.
- Login, unlock and sign-up endpoints are rate limited.

## Configuration

| Variable | Default | |
| --- | --- | --- |
| `APP_URL` | required | Dashboard/API URL |
| `PREVIEW_URL` | required | Sites URL, different host |
| `BETTER_AUTH_SECRET` | required | 32+ random characters |
| `DATA_DIR` | `/data` (Docker) | Database and files |
| `MAX_FILE_BYTES` | 1 GiB | Per file |
| `MAX_DEPLOYMENT_BYTES` | 4 GiB | Per upload |
| `MAX_FILES` | 10000 | Per upload |
| `MCP_MAX_BODY_BYTES` | 64 MiB | Per MCP request |
| `CLIENT_IP_HEADER` | `x-forwarded-for` | Client IP for rate limits |

## Development

```sh
bun install
cp .env.example .env   # set APP_URL=http://localhost:5173, PREVIEW_URL=http://127.0.0.1:3000
bun --env-file=.env apps/server/src/index.ts   # API + sites on :3000
bun run --filter @zup/web dev                  # dashboard on :5173 (proxies the API)
bun packages/cli/src/index.ts --help           # CLI from source
```

Checks: `bun run typecheck`, `bun run lint`, `bun test`. Schema changes: edit
`apps/server/src/db/schema.ts`, then `bun run --filter @zup/server db:generate`
(Better Auth tables migrate themselves at startup).

## License

[MIT](LICENSE)
