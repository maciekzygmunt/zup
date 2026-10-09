import { createReadStream } from "node:fs"
import { Readable } from "node:stream"
import { formatBytes } from "@zup/shared"
import { authHeaders, type Client, errorFrom, type Session, unwrap } from "./api.ts"
import { mapLimit } from "./pool.ts"
import type { LocalFile } from "./scan.ts"
import { CliError, progress } from "./ui.ts"

const attempts = 3

async function putBlob(session: Session, file: LocalFile, onBytes: (count: number) => void) {
  for (let attempt = 1; ; attempt++) {
    let sent = 0
    const counted = createReadStream(file.absolutePath).on("data", (chunk) => {
      sent += chunk.length
      onBytes(chunk.length)
    })
    let response: Response | undefined
    try {
      response = await fetch(`${session.server}/api/blobs/${file.hash}`, {
        method: "PUT",
        headers: {
          ...authHeaders(session),
          "content-type": "application/octet-stream",
          "content-length": String(file.size),
        },
        body: Readable.toWeb(counted) as ReadableStream,
        duplex: "half",
      } as RequestInit)
    } catch (error) {
      if (attempt === attempts) {
        throw new CliError(`Upload of ${file.path} failed: ${(error as Error).message}`)
      }
    }
    if (response?.ok) return
    // Client errors (bad hash, too large, auth) will not fix themselves.
    if (response && (response.status < 500 || attempt === attempts)) throw await errorFrom(response)
    counted.destroy()
    onBytes(-sent)
    await new Promise((done) => setTimeout(done, 500 * 2 ** attempt))
  }
}

// Uploads the content the server does not have yet. Returns what was sent.
export async function uploadMissing(session: Session, api: Client, files: LocalFile[]) {
  const { missing } = await unwrap(
    api.blobs.missing.$post({ json: { hashes: [...new Set(files.map((file) => file.hash))] } }),
  )
  const wanted = new Set(missing)
  const toSend = files.filter((file) => wanted.delete(file.hash))
  const totalBytes = toSend.reduce((sum, file) => sum + file.size, 0)
  if (!toSend.length) return { count: 0, bytes: 0 }

  const bar = progress(`Uploading ${toSend.length} file(s), ${formatBytes(totalBytes)}`)
  let done = 0
  try {
    await mapLimit(toSend, 4, (file) =>
      putBlob(session, file, (count) => {
        done += count
        bar.update(done, totalBytes)
      }),
    )
  } finally {
    bar.done()
  }
  return { count: toSend.length, bytes: totalBytes }
}
