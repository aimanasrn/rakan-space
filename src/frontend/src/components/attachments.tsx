"use client"

import { Download, Eye, FileIcon, FileImage, FileText, Loader2, Paperclip, X } from "lucide-react"
import { useRef, useState } from "react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { errorMessage, uploadAttachment } from "@/lib/api"
import { formatBytes } from "@/lib/datetime"
import type { Attachment } from "@/lib/types"
import { cn } from "@/lib/utils"

export const ACCEPTED_FILES = ".jpg,.jpeg,.png,.gif,.webp,.pdf,.txt,.csv,.md,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.odt,.ods,.odp,.zip"
export const MAX_FILE_MB = 20

export function FileTypeIcon({ attachment: a, className }: { attachment: Pick<Attachment, "is_image" | "extension">; className?: string }) {
  if (a.is_image) return <FileImage className={className} aria-hidden />
  if (["pdf", "doc", "docx", "txt", "md", "odt"].includes(a.extension)) return <FileText className={className} aria-hidden />
  return <FileIcon className={className} aria-hidden />
}

/** Downloads/previews go through the authorised API endpoint (no public URLs). */
export function AttachmentChip({ attachment, onRemove, className }: { attachment: Attachment; onRemove?: () => void; className?: string }) {
  return (
    <div className={cn("flex max-w-full items-center gap-2 rounded-lg border bg-card px-2.5 py-1.5 text-sm", className)}>
      <FileTypeIcon attachment={attachment} className="size-4 shrink-0 text-muted-foreground" />
      <span className="min-w-0 flex-1">
        <span className="block truncate">{attachment.name}</span>
        <span className="block text-xs text-muted-foreground">{formatBytes(attachment.size)}</span>
      </span>
      {attachment.preview_url ? (
        <Button variant="ghost" size="icon-xs" asChild>
          <a href={attachment.preview_url} target="_blank" rel="noopener noreferrer" aria-label={`Preview ${attachment.name}`}>
            <Eye />
          </a>
        </Button>
      ) : null}
      <Button variant="ghost" size="icon-xs" asChild>
        <a href={attachment.download_url} aria-label={`Download ${attachment.name}`}>
          <Download />
        </a>
      </Button>
      {onRemove ? (
        <Button variant="ghost" size="icon-xs" onClick={onRemove} aria-label={`Remove ${attachment.name}`}>
          <X />
        </Button>
      ) : null}
    </div>
  )
}

export function AttachmentList({ items, onRemove }: { items: Attachment[]; onRemove?: (a: Attachment) => void }) {
  if (!items.length) return null
  return (
    <div className="flex flex-wrap gap-2">
      {items.map((a) => (
        <AttachmentChip key={a.id} attachment={a} onRemove={onRemove ? () => onRemove(a) : undefined} className="w-64" />
      ))}
    </div>
  )
}

/**
 * Uploads files immediately as pending attachments and reports their IDs.
 * Pending uploads stay private to the uploader until linked.
 */
export function useUploader(slug: string) {
  const [items, setItems] = useState<Attachment[]>([])
  const [uploading, setUploading] = useState(0)

  async function add(files: FileList | File[]) {
    for (const file of Array.from(files)) {
      if (file.size > MAX_FILE_MB * 1024 * 1024) {
        toast.error(`${file.name} is larger than ${MAX_FILE_MB} MB.`)
        continue
      }
      setUploading((n) => n + 1)
      try {
        const { data } = await uploadAttachment(slug, file)
        setItems((list) => [...list, data])
      } catch (e) {
        toast.error(`${file.name}: ${errorMessage(e)}`)
      } finally {
        setUploading((n) => n - 1)
      }
    }
  }

  return {
    items,
    ids: items.map((i) => i.id),
    uploading: uploading > 0,
    add,
    remove: (id: number) => setItems((list) => list.filter((i) => i.id !== id)),
    clear: () => setItems([]),
  }
}

export function UploadButton({
  onFiles,
  uploading,
  label = "Attach files",
  iconOnly,
  size = "sm",
}: {
  onFiles: (files: FileList) => void
  uploading?: boolean
  label?: string
  iconOnly?: boolean
  size?: "sm" | "icon" | "default"
}) {
  const input = useRef<HTMLInputElement>(null)
  return (
    <>
      <input
        ref={input}
        type="file"
        multiple
        accept={ACCEPTED_FILES}
        className="sr-only"
        tabIndex={-1}
        aria-hidden
        onChange={(e) => {
          if (e.target.files?.length) onFiles(e.target.files)
          e.target.value = ""
        }}
      />
      <Button type="button" variant={iconOnly ? "ghost" : "outline"} size={iconOnly ? "icon" : size} onClick={() => input.current?.click()} disabled={uploading} aria-label={label}>
        {uploading ? <Loader2 className="animate-spin" /> : <Paperclip />}
        {iconOnly ? null : label}
      </Button>
    </>
  )
}
