"use client"

import { Eraser, PenLine, Type } from "lucide-react"
import { useEffect, useRef, useState } from "react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Spinner } from "@/components/ui/spinner"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { useWorkspace } from "@/components/workspace/workspace-context"
import { errorMessage, uploadAttachment } from "@/lib/api"
import type { Attachment } from "@/lib/types"

const WIDTH = 480
const HEIGHT = 160

/**
 * Draw (mouse, pen, touch) or type a signature. It is uploaded as a private
 * PNG attachment and the field stores the attachment id.
 */
export function SignatureField({
  id,
  label,
  value,
  attachment,
  onChange,
  disabled,
}: {
  id: string
  label: string
  value: number | null
  attachment?: Attachment
  onChange: (attachment: Attachment | null) => void
  disabled?: boolean
}) {
  const { slug } = useWorkspace()
  const canvas = useRef<HTMLCanvasElement>(null)
  const drawing = useRef(false)
  const [mode, setMode] = useState<"draw" | "type">("draw")
  const [typed, setTyped] = useState("")
  const [hasInk, setHasInk] = useState(false)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    const ctx = canvas.current?.getContext("2d")
    if (!ctx) return
    ctx.lineWidth = 2.5
    ctx.lineCap = "round"
    ctx.lineJoin = "round"
    ctx.strokeStyle = "#111827"
  }, [mode, value])

  // Typed signatures are rendered onto the same canvas.
  useEffect(() => {
    if (mode !== "type") return
    const ctx = canvas.current?.getContext("2d")
    if (!ctx) return
    ctx.clearRect(0, 0, WIDTH, HEIGHT)
    ctx.fillStyle = "#111827"
    ctx.font = "italic 44px 'Brush Script MT', 'Segoe Script', cursive, serif"
    ctx.textBaseline = "middle"
    ctx.fillText(typed, 24, HEIGHT / 2, WIDTH - 48)
  }, [typed, mode])

  const ready = mode === "type" ? typed.trim().length > 0 : hasInk

  const point = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    return { x: ((e.clientX - rect.left) / rect.width) * WIDTH, y: ((e.clientY - rect.top) / rect.height) * HEIGHT }
  }

  function clear() {
    canvas.current?.getContext("2d")?.clearRect(0, 0, WIDTH, HEIGHT)
    setHasInk(false)
    setTyped("")
  }

  async function save() {
    const el = canvas.current
    if (!el || !ready) return
    setSaving(true)
    try {
      const blob = await new Promise<Blob | null>((resolve) => el.toBlob(resolve, "image/png"))
      if (!blob) throw new Error("Could not capture the signature.")
      const { data } = await uploadAttachment(slug, new File([blob], "signature.png", { type: "image/png" }))
      onChange(data)
      clear()
    } catch (e) {
      toast.error(errorMessage(e))
    } finally {
      setSaving(false)
    }
  }

  if (value) {
    return (
      <div id={id} className="flex flex-wrap items-center gap-3">
        <div className="flex h-24 w-72 items-center justify-center rounded-lg border bg-white">
          {attachment?.preview_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={attachment.preview_url} alt={`${label}: saved signature`} className="max-h-20 max-w-64 object-contain" />
          ) : (
            <span className="text-sm text-muted-foreground">Signature saved</span>
          )}
        </div>
        {!disabled ? (
          <Button type="button" variant="outline" size="sm" onClick={() => onChange(null)}>
            Sign again
          </Button>
        ) : null}
      </div>
    )
  }

  if (disabled) return <p className="text-sm text-muted-foreground">Not signed.</p>

  return (
    <div id={id} className="space-y-2">
      <ToggleGroup type="single" value={mode} onValueChange={(v) => v && (clear(), setMode(v as "draw" | "type"))} variant="outline" size="sm" aria-label="How to sign">
        <ToggleGroupItem value="draw">
          <PenLine aria-hidden /> Draw
        </ToggleGroupItem>
        <ToggleGroupItem value="type">
          <Type aria-hidden /> Type
        </ToggleGroupItem>
      </ToggleGroup>
      {mode === "type" ? (
        <div className="max-w-sm space-y-1">
          <Label htmlFor={`${id}-typed`} className="text-xs text-muted-foreground">
            Type your full name
          </Label>
          <Input id={`${id}-typed`} value={typed} maxLength={60} onChange={(e) => setTyped(e.target.value)} />
        </div>
      ) : null}
      <canvas
        ref={canvas}
        width={WIDTH}
        height={HEIGHT}
        role="img"
        aria-label={mode === "draw" ? `${label}: drawing area. Use Type if you cannot draw.` : `${label}: preview`}
        className="block h-32 w-full max-w-md touch-none rounded-lg border bg-white"
        onPointerDown={(e) => {
          if (mode !== "draw") return
          drawing.current = true
          e.currentTarget.setPointerCapture(e.pointerId)
          const ctx = e.currentTarget.getContext("2d")!
          const p = point(e)
          ctx.beginPath()
          ctx.moveTo(p.x, p.y)
        }}
        onPointerMove={(e) => {
          if (!drawing.current || mode !== "draw") return
          const ctx = e.currentTarget.getContext("2d")!
          const p = point(e)
          ctx.lineTo(p.x, p.y)
          ctx.stroke()
          setHasInk(true)
        }}
        onPointerUp={() => (drawing.current = false)}
        onPointerCancel={() => (drawing.current = false)}
      />
      <div className="flex gap-2">
        <Button type="button" size="sm" onClick={save} disabled={!ready || saving}>
          {saving ? <Spinner /> : null} Use this signature
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={clear} disabled={!ready}>
          <Eraser aria-hidden /> Clear
        </Button>
      </div>
    </div>
  )
}
