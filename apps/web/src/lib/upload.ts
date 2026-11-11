import {
  type AccessInput,
  contentTypeFor,
  type GrantedKey,
  type ManifestFile,
  type ServerInfo,
  type SiteSummary,
  toManifestPath,
} from "@zup/shared"
import { createSHA256 } from "hash-wasm"
import { api, errorFromResponse, parseResponse } from "./api.ts"
import type { PickedFile } from "./files.ts"

export type UploadProgress =
  | { phase: "hashing"; done: number; total: number }
  | { phase: "uploading"; done: number; total: number }
  | { phase: "publishing" }

// A new site, or with `update` new files for the site at `slug` (other settings stay).
export type UploadRequest = {
  files: PickedFile[]
  slug?: string
  update?: boolean
  title?: string
  access?: AccessInput
  expiresAt?: string
}

export type UploadResult = {
  site: SiteSummary
  key?: GrantedKey
  created: boolean
  skippedBytes: number
}

// Streams the file through SHA-256 so large files never sit in memory.
async function sha256(file: File) {
  const hasher = await createSHA256()
  hasher.init()
  const reader = file.stream().getReader()
  for (let chunk = await reader.read(); !chunk.done; chunk = await reader.read()) {
    hasher.update(chunk.value)
  }
  return hasher.digest("hex")
}

// Runs `work` over `items` with at most `limit` running at once.
async function pool<T>(items: T[], limit: number, work: (item: T) => Promise<void>) {
  let next = 0
  const run = async () => {
    while (next < items.length) await work(items[next++]!)
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run))
}

// XMLHttpRequest because fetch has no upload progress.
function putBlob(hash: string, file: File, onProgress: (loaded: number) => void) {
  return new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open("PUT", `/api/blobs/${hash}`)
    xhr.setRequestHeader("Content-Type", "application/octet-stream")
    xhr.upload.onprogress = (event) => onProgress(event.loaded)
    xhr.onload = async () => {
      if (xhr.status >= 200 && xhr.status < 300) return resolve()
      reject(
        await errorFromResponse(
          new Response(xhr.responseText, { status: xhr.status, statusText: xhr.statusText }),
        ),
      )
    }
    xhr.onerror = () => reject(new Error(`Network error while uploading ${file.name}`))
    xhr.send(file)
  })
}

// Checks the server limits before any work starts.
export function checkLimits(files: PickedFile[], limits: ServerInfo["limits"]): string | null {
  if (!files.length) return "There are no files to upload."
  if (files.length > limits.maxFiles) return `A site can have at most ${limits.maxFiles} files.`
  const big = files.find((f) => f.file.size > limits.maxFileBytes)
  if (big) return `${big.path} is larger than the per-file limit.`
  const total = files.reduce((sum, f) => sum + f.file.size, 0)
  if (total > limits.maxSiteBytes) return "These files are larger than the per-site limit."
  return null
}

export async function upload(
  request: UploadRequest,
  onProgress: (progress: UploadProgress) => void,
): Promise<UploadResult> {
  const { files } = request
  const manifest: ManifestFile[] = new Array(files.length)
  let hashed = 0
  onProgress({ phase: "hashing", done: 0, total: files.length })
  await pool(
    files.map((file, index) => ({ file, index })),
    4,
    async ({ file, index }) => {
      const path = toManifestPath(file.path)
      manifest[index] = {
        path,
        hash: await sha256(file.file),
        size: file.file.size,
        contentType: file.file.type || contentTypeFor(path),
      }
      onProgress({ phase: "hashing", done: ++hashed, total: files.length })
    },
  )

  const byHash = new Map(manifest.map((entry, index) => [entry.hash, files[index]!.file]))
  const { missing } = await parseResponse(
    api.blobs.missing.$post({ json: { hashes: [...byHash.keys()] } }),
  )
  const missingBytes = missing.reduce((sum, hash) => sum + byHash.get(hash)!.size, 0)
  const loaded = new Map<string, number>()
  const report = () => {
    const done = [...loaded.values()].reduce((sum, n) => sum + n, 0)
    onProgress({ phase: "uploading", done, total: missingBytes })
  }
  report()
  await pool(missing, 4, async (hash) => {
    const file = byHash.get(hash)!
    await putBlob(hash, file, (bytes) => {
      loaded.set(hash, bytes)
      report()
    })
    loaded.set(hash, file.size)
    report()
  })

  onProgress({ phase: "publishing" })
  const { files: _, ...fields } = request
  const result = await parseResponse(
    api.sites.$post({ json: { ...fields, files: manifest, source: "web" } }),
  )
  return { ...result, skippedBytes: manifest.reduce((sum, f) => sum + f.size, 0) - missingBytes }
}
