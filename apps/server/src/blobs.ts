import { mkdir, readdir, rename, rm, stat, utimes } from "node:fs/promises"
import { join } from "node:path"
import { HttpError } from "./errors.ts"

export type BlobStore = ReturnType<typeof createBlobStore>

// Content-addressed file storage: each blob lives at blobs/ab/cd/<sha256>.
export function createBlobStore(dataDir: string) {
  const root = join(dataDir, "blobs")
  const tmp = join(dataDir, "tmp")
  const pathFor = (hash: string) => join(root, hash.slice(0, 2), hash.slice(2, 4), hash)

  return {
    file: (hash: string) => Bun.file(pathFor(hash)),

    async size(hash: string): Promise<number | null> {
      try {
        return (await stat(pathFor(hash))).size
      } catch {
        return null
      }
    },

    // Streams a body to disk and keeps it only when it hashes to `hash`.
    async write(hash: string, body: ReadableStream<Uint8Array>, maxBytes: number): Promise<void> {
      await mkdir(tmp, { recursive: true })
      const tmpPath = join(tmp, `${hash}.${crypto.randomUUID()}`)
      const sink = Bun.file(tmpPath).writer()
      const hasher = new Bun.CryptoHasher("sha256")
      let written = 0
      try {
        for await (const chunk of body) {
          written += chunk.byteLength
          if (written > maxBytes) {
            throw new HttpError(413, "file_too_large", `File is larger than ${maxBytes} bytes`)
          }
          hasher.update(chunk)
          sink.write(chunk)
        }
        await sink.end()
        if (hasher.digest("hex") !== hash) {
          throw new HttpError(422, "hash_mismatch", "Uploaded content does not match its hash")
        }
        const target = pathFor(hash)
        await mkdir(join(target, ".."), { recursive: true })
        await rename(tmpPath, target)
      } catch (error) {
        await sink.end()
        await rm(tmpPath, { force: true })
        throw error
      }
    },

    // Marks a blob as recently used so garbage collection keeps it during an upload.
    async touch(hash: string) {
      const now = new Date()
      await utimes(pathFor(hash), now, now).catch(() => {})
    },

    async remove(hash: string) {
      await rm(pathFor(hash), { force: true })
    },

    // Yields every stored blob with its modification time (for garbage collection).
    async *list(): AsyncGenerator<{ hash: string; mtimeMs: number }> {
      for (const a of await readdir(root).catch(() => [])) {
        for (const b of await readdir(join(root, a)).catch(() => [])) {
          for (const hash of await readdir(join(root, a, b)).catch(() => [])) {
            const info = await stat(join(root, a, b, hash)).catch(() => null)
            if (info) yield { hash, mtimeMs: info.mtimeMs }
          }
        }
      }
    },

    // Removes abandoned partial uploads.
    async cleanTmp(olderThanMs: number) {
      const cutoff = Date.now() - olderThanMs
      for (const name of await readdir(tmp).catch(() => [])) {
        const info = await stat(join(tmp, name)).catch(() => null)
        if (info && info.mtimeMs < cutoff) await rm(join(tmp, name), { force: true })
      }
    },

    async usedBytes(): Promise<number> {
      let total = 0
      for await (const { hash } of this.list()) total += (await this.size(hash)) ?? 0
      return total
    },
  }
}
