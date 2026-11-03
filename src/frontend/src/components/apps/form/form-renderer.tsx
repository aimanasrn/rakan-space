"use client"

import { Plus, Trash2 } from "lucide-react"
import { useId } from "react"
import { AttachmentChip, UploadButton } from "@/components/attachments"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { useWorkspace } from "@/components/workspace/workspace-context"
import { errorMessage, uploadAttachment } from "@/lib/api"
import { visibleFieldKeys } from "@/lib/conditions"
import type { Attachment, FormFieldDef, TableColumn } from "@/lib/types"
import { cn } from "@/lib/utils"
import { toast } from "sonner"
import { SignatureField } from "./signature-field"

export type FormValues = Record<string, unknown>
export type AttachmentMap = Record<number, Attachment>

/**
 * Renders a form's fields. Hidden fields (show/hide rules) are not rendered and
 * their values are dropped on submit, exactly like the server does.
 */
export function FormRenderer({
  fields,
  values,
  onChange,
  errors = {},
  attachments,
  onAttachment,
  disabled,
}: {
  fields: FormFieldDef[]
  values: FormValues
  onChange: (key: string, value: unknown) => void
  errors?: Record<string, string | undefined>
  attachments: AttachmentMap
  onAttachment: (attachment: Attachment) => void
  disabled?: boolean
}) {
  const visible = visibleFieldKeys(fields, values)
  return (
    <div className="space-y-6">
      {fields
        .filter((f) => visible.has(f.key))
        .map((field) => (
          <FieldInput
            key={field.key}
            field={field}
            value={values[field.key]}
            onChange={(v) => onChange(field.key, v)}
            error={errors[`values.${field.key}`]}
            attachments={attachments}
            onAttachment={onAttachment}
            disabled={disabled}
          />
        ))}
    </div>
  )
}

/** Only the values of visible fields, for submitting. */
export function visibleValues(fields: FormFieldDef[], values: FormValues): FormValues {
  const visible = visibleFieldKeys(fields, values)
  return Object.fromEntries(Object.entries(values).filter(([k]) => visible.has(k)))
}

const blank = (v: unknown) => v === undefined || v === null || v === "" || (Array.isArray(v) && v.length === 0)

/** Client-side checks mirroring the server (which always re-validates). */
export function validateValues(fields: FormFieldDef[], values: FormValues): Record<string, string> {
  const errors: Record<string, string> = {}
  const visible = visibleFieldKeys(fields, values)
  for (const f of fields) {
    if (!visible.has(f.key)) continue
    const v = values[f.key]
    const key = `values.${f.key}`
    const rules = f.validation ?? {}
    if (blank(v) || (f.type === "table" && Array.isArray(v) && !v.some((row) => Object.values(row as object).some((c) => !blank(c))))) {
      if (f.required) errors[key] = f.type === "table" ? `Add at least one row to ${f.label}.` : `${f.label} is required.`
      continue
    }
    if (f.type === "number") {
      const n = Number(v)
      if (!Number.isFinite(n)) errors[key] = `${f.label} must be a number.`
      else if (rules.min !== undefined && n < rules.min) errors[key] = `${f.label} must be at least ${rules.min}.`
      else if (rules.max !== undefined && n > rules.max) errors[key] = `${f.label} must be at most ${rules.max}.`
    }
    if ((f.type === "text" || f.type === "textarea") && typeof v === "string") {
      const max = rules.max_length ?? (f.type === "text" ? 255 : 5000)
      if (v.trim().length > max) errors[key] = `${f.label} must be at most ${max} characters.`
      if (rules.min_length && v.trim().length < rules.min_length) errors[key] = `${f.label} must be at least ${rules.min_length} characters.`
    }
    if (f.type === "file" && Array.isArray(v) && v.length > (rules.max_files ?? 5)) errors[key] = `${f.label} accepts at most ${rules.max_files ?? 5} files.`
    if (f.type === "table" && Array.isArray(v) && v.length > (rules.max_rows ?? 50)) errors[key] = `${f.label} accepts at most ${rules.max_rows ?? 50} rows.`
  }
  return errors
}

function FieldInput({
  field,
  value,
  onChange,
  error,
  attachments,
  onAttachment,
  disabled,
}: {
  field: FormFieldDef
  value: unknown
  onChange: (v: unknown) => void
  error?: string
  attachments: AttachmentMap
  onAttachment: (a: Attachment) => void
  disabled?: boolean
}) {
  const id = `field-${field.key}`
  const describedBy = [field.help_text ? `${id}-help` : null, error ? `${id}-error` : null].filter(Boolean).join(" ") || undefined
  const common = { id, "aria-invalid": !!error, "aria-describedby": describedBy, disabled }
  const choices = field.options?.choices ?? []
  const groupLabel = field.type === "radio" || field.type === "checkbox" || field.type === "file" || field.type === "table" || field.type === "signature"

  let control: React.ReactNode
  switch (field.type) {
    case "text":
      control = <Input {...common} value={String(value ?? "")} maxLength={field.validation?.max_length ?? 255} onChange={(e) => onChange(e.target.value)} />
      break
    case "textarea":
      control = <Textarea {...common} rows={4} value={String(value ?? "")} maxLength={field.validation?.max_length ?? 5000} onChange={(e) => onChange(e.target.value)} />
      break
    case "number":
      control = (
        <Input
          {...common}
          type="number"
          inputMode="decimal"
          step="any"
          min={field.validation?.min}
          max={field.validation?.max}
          value={value === undefined || value === null ? "" : String(value)}
          onChange={(e) => onChange(e.target.value === "" ? null : e.target.value)}
          className="max-w-xs"
        />
      )
      break
    case "date":
      control = <Input {...common} type="date" value={String(value ?? "")} onChange={(e) => onChange(e.target.value || null)} className="max-w-xs" />
      break
    case "dropdown":
      control = (
        <Select value={typeof value === "string" ? value : ""} onValueChange={(v) => onChange(v)} disabled={disabled}>
          <SelectTrigger {...common} className="w-full sm:w-80">
            <SelectValue placeholder="Choose…" />
          </SelectTrigger>
          <SelectContent>
            {choices.map((c) => (
              <SelectItem key={c} value={c}>
                {c}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )
      break
    case "radio":
      control = (
        <RadioGroup value={typeof value === "string" ? value : ""} onValueChange={onChange} aria-labelledby={`${id}-label`} aria-describedby={describedBy} disabled={disabled}>
          {choices.map((c, i) => (
            <label key={c} className="flex items-center gap-2 text-sm">
              <RadioGroupItem value={c} id={`${id}-${i}`} /> {c}
            </label>
          ))}
        </RadioGroup>
      )
      break
    case "checkbox": {
      const selected = Array.isArray(value) ? (value as string[]) : []
      control = (
        <div className="space-y-2" role="group" aria-labelledby={`${id}-label`} aria-describedby={describedBy}>
          {choices.map((c) => (
            <label key={c} className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={selected.includes(c)}
                disabled={disabled}
                onCheckedChange={(on) => onChange(on ? [...selected, c] : selected.filter((s) => s !== c))}
              />
              {c}
            </label>
          ))}
        </div>
      )
      break
    }
    case "file":
      control = (
        <FileField
          id={id}
          ids={Array.isArray(value) ? (value as number[]) : []}
          max={field.validation?.max_files ?? 5}
          attachments={attachments}
          onAttachment={onAttachment}
          onChange={onChange}
          disabled={disabled}
        />
      )
      break
    case "signature":
      control = (
        <SignatureField
          id={id}
          label={field.label}
          value={typeof value === "number" ? value : null}
          attachment={typeof value === "number" ? attachments[value] : undefined}
          onChange={(attachment) => {
            if (attachment) onAttachment(attachment)
            onChange(attachment?.id ?? null)
          }}
          disabled={disabled}
        />
      )
      break
    case "table":
      control = (
        <TableField
          id={id}
          columns={field.options?.columns ?? []}
          rows={Array.isArray(value) ? (value as Record<string, unknown>[]) : []}
          maxRows={field.validation?.max_rows ?? 50}
          onChange={onChange}
          disabled={disabled}
        />
      )
      break
  }

  return (
    <div className="space-y-2" data-invalid={error ? true : undefined}>
      {groupLabel ? (
        <p id={`${id}-label`} className="text-sm font-medium">
          {field.label}
          {field.required ? <RequiredMark /> : null}
        </p>
      ) : (
        <Label htmlFor={id} id={`${id}-label`}>
          {field.label}
          {field.required ? <RequiredMark /> : null}
        </Label>
      )}
      {control}
      {field.help_text ? (
        <p id={`${id}-help`} className="text-xs text-muted-foreground">
          {field.help_text}
        </p>
      ) : null}
      {error ? (
        <p id={`${id}-error`} className="text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  )
}

function RequiredMark() {
  return (
    <span className="ml-0.5 text-destructive" aria-hidden>
      *
    </span>
  )
}

function FileField({
  id,
  ids,
  max,
  attachments,
  onAttachment,
  onChange,
  disabled,
}: {
  id: string
  ids: number[]
  max: number
  attachments: AttachmentMap
  onAttachment: (a: Attachment) => void
  onChange: (v: unknown) => void
  disabled?: boolean
}) {
  const { slug } = useWorkspace()
  async function add(files: FileList) {
    let next = [...ids]
    for (const file of Array.from(files)) {
      if (next.length >= max) {
        toast.error(`You can attach at most ${max} files here.`)
        break
      }
      try {
        const { data } = await uploadAttachment(slug, file)
        onAttachment(data)
        next = [...next, data.id]
        onChange(next)
      } catch (e) {
        toast.error(`${file.name}: ${errorMessage(e)}`)
      }
    }
  }
  return (
    <div id={id} className="space-y-2">
      {ids.length ? (
        <div className="flex flex-wrap gap-2">
          {ids.map((fileId) =>
            attachments[fileId] ? (
              <AttachmentChip key={fileId} attachment={attachments[fileId]} onRemove={disabled ? undefined : () => onChange(ids.filter((i) => i !== fileId))} className="w-64" />
            ) : null,
          )}
        </div>
      ) : null}
      {!disabled && ids.length < max ? <UploadButton onFiles={add} label="Upload files" /> : null}
    </div>
  )
}

function TableField({
  id,
  columns,
  rows,
  maxRows,
  onChange,
  disabled,
}: {
  id: string
  columns: TableColumn[]
  rows: Record<string, unknown>[]
  maxRows: number
  onChange: (v: unknown) => void
  disabled?: boolean
}) {
  const uid = useId()
  const list = rows.length ? rows : [{}]
  const set = (r: number, key: string, v: unknown) => onChange(list.map((row, i) => (i === r ? { ...row, [key]: v } : row)))

  return (
    <div id={id} className="space-y-2">
      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50">
            <tr>
              {columns.map((c) => (
                <th key={c.key} scope="col" className="px-2 py-1.5 text-left font-medium">
                  {c.label}
                </th>
              ))}
              <th scope="col">
                <span className="sr-only">Remove</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {list.map((row, r) => (
              <tr key={r} className="border-t">
                {columns.map((c) => {
                  const cellId = `${uid}-${r}-${c.key}`
                  const label = `${c.label}, row ${r + 1}`
                  const v = row[c.key ?? ""]
                  return (
                    <td key={c.key} className="min-w-32 p-1">
                      {c.type === "dropdown" ? (
                        <Select value={typeof v === "string" ? v : ""} onValueChange={(val) => set(r, c.key!, val)} disabled={disabled}>
                          <SelectTrigger id={cellId} aria-label={label} className="w-full">
                            <SelectValue placeholder="—" />
                          </SelectTrigger>
                          <SelectContent>
                            {(c.choices ?? []).map((choice) => (
                              <SelectItem key={choice} value={choice}>
                                {choice}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      ) : (
                        <Input
                          id={cellId}
                          aria-label={label}
                          type={c.type === "number" ? "number" : c.type === "date" ? "date" : "text"}
                          step={c.type === "number" ? "any" : undefined}
                          value={v === undefined || v === null ? "" : String(v)}
                          onChange={(e) => set(r, c.key!, e.target.value === "" ? null : e.target.value)}
                          disabled={disabled}
                        />
                      )}
                    </td>
                  )
                })}
                <td className="w-10 p-1">
                  {!disabled && list.length > 1 ? (
                    <Button type="button" variant="ghost" size="icon-sm" onClick={() => onChange(list.filter((_, i) => i !== r))} aria-label={`Remove row ${r + 1}`}>
                      <Trash2 />
                    </Button>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!disabled ? (
        <Button type="button" variant="outline" size="sm" onClick={() => onChange([...list, {}])} disabled={list.length >= maxRows} className={cn(list.length >= maxRows && "opacity-50")}>
          <Plus aria-hidden /> Add row
        </Button>
      ) : null}
    </div>
  )
}
