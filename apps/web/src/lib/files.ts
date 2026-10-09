// Turns drops and file inputs into a list of files with paths relative to the upload root.

export type PickedFile = { file: File; path: string }
export type Picked = { files: PickedFile[]; name: string }

const skipped = (path: string) => {
  const parts = path.split("/")
  return parts.at(-1) === ".DS_Store" || parts.some((p) => p === ".git" || p === "node_modules")
}

function finish(files: PickedFile[], name: string): Picked {
  return {
    files: files.filter((f) => !skipped(f.path)).sort((a, b) => a.path.localeCompare(b.path)),
    name,
  }
}

const readEntries = (reader: FileSystemDirectoryReader) =>
  new Promise<FileSystemEntry[]>((resolve, reject) => reader.readEntries(resolve, reject))

const entryFile = (entry: FileSystemFileEntry) =>
  new Promise<File>((resolve, reject) => entry.file(resolve, reject))

async function walk(entry: FileSystemEntry, prefix: string, out: PickedFile[]) {
  if (entry instanceof FileSystemFileEntry) {
    out.push({ file: await entryFile(entry), path: `${prefix}${entry.name}` })
    return
  }
  if (!(entry instanceof FileSystemDirectoryEntry) || skipped(entry.name)) return
  const reader = entry.createReader()
  // readEntries returns results in batches until it returns an empty list.
  for (let batch = await readEntries(reader); batch.length; batch = await readEntries(reader)) {
    for (const child of batch) await walk(child, `${prefix}${entry.name}/`, out)
  }
}

// A single dropped folder becomes the root; otherwise dropped items keep their names.
export async function filesFromDrop(data: DataTransfer): Promise<Picked> {
  const entries = [...data.items]
    .filter((item) => item.kind === "file")
    .map((item) => item.webkitGetAsEntry())
    .filter((entry) => entry !== null)
  // No entry API (or a synthetic drop): plain files only.
  if (!entries.length) return filesFromInput(data.files)
  const out: PickedFile[] = []
  const [only] = entries
  if (entries.length === 1 && only?.isDirectory) {
    await walk(only, "", out)
    const root = `${only.name}/`
    return finish(
      out.map((f) => ({ ...f, path: f.path.slice(root.length) })),
      only.name,
    )
  }
  for (const entry of entries) await walk(entry, "", out)
  return finish(out, only?.name ?? "Upload")
}

// From <input webkitdirectory>: paths start with the chosen folder's name.
export function filesFromFolderInput(list: FileList): Picked {
  const files = [...list]
  const name = files[0]?.webkitRelativePath.split("/")[0] ?? "Upload"
  return finish(
    files.map((file) => ({ file, path: file.webkitRelativePath.split("/").slice(1).join("/") })),
    name,
  )
}

export function filesFromInput(list: FileList): Picked {
  const files = [...list]
  const [first] = files
  const name = !first
    ? "Upload"
    : files.length === 1
      ? first.name
      : `${first.name} and ${files.length - 1} more`
  return finish(
    files.map((file) => ({ file, path: file.name })),
    name,
  )
}

// Allows dropping files only, not text or links.
export const hasFiles = (data: DataTransfer | null) => !!data?.types.includes("Files")
