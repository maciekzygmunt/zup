import { UploadCloud } from "lucide-react"
import {
  createContext,
  type ReactNode,
  use,
  useEffect,
  useEffectEvent,
  useRef,
  useState,
} from "react"
import { toast } from "sonner"
import {
  filesFromDrop,
  filesFromFolderInput,
  filesFromInput,
  hasFiles,
  type Picked,
} from "../../lib/files.ts"
import { UploadDialog } from "./UploadDialog.tsx"

type UploadContext = { pickFiles: () => void; pickFolder: () => void }

const Context = createContext<UploadContext>({ pickFiles() {}, pickFolder() {} })

export const useUpload = () => use(Context)

// Owns the file inputs, the window-wide drop target and the upload dialog.
export function UploadProvider({ children }: { children: ReactNode }) {
  const [picked, setPicked] = useState<Picked | null>(null)
  const [open, setOpen] = useState(false)
  const [dragging, setDragging] = useState(false)
  const filesInput = useRef<HTMLInputElement>(null)
  const folderInput = useRef<HTMLInputElement>(null)

  const start = (next: Picked) => {
    if (!next.files.length) {
      toast.error("No files to upload. Hidden folders like .git and node_modules are skipped.")
      return
    }
    setPicked(next)
    setOpen(true)
  }

  const onDrop = useEffectEvent(async (data: DataTransfer) => {
    try {
      start(await filesFromDrop(data))
    } catch {
      toast.error("Could not read the dropped files.")
    }
  })

  useEffect(() => {
    // Counts nested enter/leave events so the overlay does not flicker over children.
    let depth = 0
    // Open dialogs (like a running upload) keep their state; drops wait until they close.
    const accepts = (event: DragEvent) =>
      hasFiles(event.dataTransfer) && !document.querySelector("[role=dialog]")
    const enter = (event: DragEvent) => {
      if (!accepts(event)) return
      event.preventDefault()
      depth++
      setDragging(true)
    }
    const over = (event: DragEvent) => {
      // Without this the browser opens dropped files itself.
      if (hasFiles(event.dataTransfer)) event.preventDefault()
    }
    const leave = () => {
      depth = Math.max(0, depth - 1)
      if (!depth) setDragging(false)
    }
    const drop = (event: DragEvent) => {
      if (!event.dataTransfer || !hasFiles(event.dataTransfer)) return
      event.preventDefault()
      depth = 0
      setDragging(false)
      if (accepts(event)) onDrop(event.dataTransfer)
    }
    window.addEventListener("dragenter", enter)
    window.addEventListener("dragover", over)
    window.addEventListener("dragleave", leave)
    window.addEventListener("drop", drop)
    return () => {
      window.removeEventListener("dragenter", enter)
      window.removeEventListener("dragover", over)
      window.removeEventListener("dragleave", leave)
      window.removeEventListener("drop", drop)
    }
  }, [])

  return (
    <Context
      value={{
        pickFiles: () => filesInput.current?.click(),
        pickFolder: () => folderInput.current?.click(),
      }}
    >
      {children}
      <input
        ref={filesInput}
        type="file"
        multiple
        hidden
        onChange={(e) => {
          if (e.target.files) start(filesFromInput(e.target.files))
          e.target.value = ""
        }}
      />
      <input
        ref={(el) => {
          folderInput.current = el
          if (el) el.webkitdirectory = true
        }}
        type="file"
        hidden
        onChange={(e) => {
          if (e.target.files) start(filesFromFolderInput(e.target.files))
          e.target.value = ""
        }}
      />
      {dragging && (
        <div className="pointer-events-none fixed inset-0 z-50 grid place-items-center bg-bg/80 p-6 backdrop-blur-sm">
          <div className="grid w-full max-w-lg place-items-center gap-3 rounded-2xl border-2 border-dashed border-accent bg-card/80 px-6 py-16 text-center">
            <UploadCloud className="size-8 text-accent" aria-hidden />
            <p className="text-base font-semibold">Drop to upload</p>
            <p className="text-[13px] text-muted">
              Files or one folder. A dropped folder becomes the site root.
            </p>
          </div>
        </div>
      )}
      {picked && <UploadDialog picked={picked} open={open} onOpenChange={setOpen} />}
    </Context>
  )
}
