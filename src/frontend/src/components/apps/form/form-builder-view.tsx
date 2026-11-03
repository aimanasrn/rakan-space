"use client"

import { useQueryClient } from "@tanstack/react-query"
import { ArrowDown, ArrowUp, Copy, Eye, GripVertical, Inbox, Lock, Settings2, Trash2, Undo2, Wrench } from "lucide-react"
import Link from "next/link"
import { useParams } from "next/navigation"
import { useState } from "react"
import { toast } from "sonner"
import { EmptyState, LoadingRows } from "@/components/common"
import { ConfirmAction } from "@/components/confirm"
import { FormAlert } from "@/components/form"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Spinner } from "@/components/ui/spinner"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { orgPath, useWorkspace } from "@/components/workspace/workspace-context"
import { api, ApiError, errorMessage } from "@/lib/api"
import { describeCondition } from "@/lib/conditions"
import type { FieldType, FormDetail, FormFieldDef } from "@/lib/types"
import { cn } from "@/lib/utils"
import { LoadError, ModuleHeader } from "../shared"
import { FieldProperties } from "./field-properties"
import { FIELD_TYPES, KEY_PATTERN, newField, typeInfo, uniqueKey } from "./field-types"
import { type AttachmentMap, FormRenderer, type FormValues } from "./form-renderer"
import { FormSettingsDialog } from "./form-settings-dialog"
import { formKeys, useForm } from "./use-forms"

const DRAG_TYPE = "application/x-rakan-field-type"
const DRAG_INDEX = "application/x-rakan-field-index"

export function FormBuilderView() {
  const { formId } = useParams<{ formId: string }>()
  const id = Number(formId)
  const { slug } = useWorkspace()
  const form = useForm(slug, id)

  if (form.isPending) {
    return (
      <div className="p-4 md:p-8">
        <LoadingRows rows={8} />
      </div>
    )
  }
  if (form.error) {
    return (
      <div className="mx-auto max-w-4xl p-4 md:p-8">
        <LoadError error={form.error} onRetry={() => form.refetch()} what="Form" />
      </div>
    )
  }
  if (!form.data.permissions.manage) {
    return (
      <div className="mx-auto max-w-4xl p-4 md:p-8">
        <EmptyState icon={Lock} title="You can't edit this form" description="Ask the person who created it, or an admin." />
      </div>
    )
  }
  // Keyed by id only: refreshed form data (status, version) must not reset unsaved field edits.
  return <Builder key={form.data.id} form={form.data} />
}

function Builder({ form }: { form: FormDetail }) {
  const { slug, href } = useWorkspace()
  const qc = useQueryClient()
  const [fields, setFields] = useState<FormFieldDef[]>(form.draft_fields ?? form.fields)
  const [selected, setSelected] = useState<number | null>(fields.length ? 0 : null)
  const [dirty, setDirty] = useState(false)
  const [mode, setMode] = useState<"build" | "preview">("build")
  const [settings, setSettings] = useState(false)
  const [saving, setSaving] = useState(false)
  const [serverErrors, setServerErrors] = useState<Record<string, string>>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [dropAt, setDropAt] = useState<number | null>(null)
  const [previewValues, setPreviewValues] = useState<FormValues>({})
  const [previewFiles, setPreviewFiles] = useState<AttachmentMap>({})

  const change = (next: FormFieldDef[]) => {
    setFields(next)
    setDirty(true)
  }

  function insert(type: FieldType, at = selected !== null ? selected + 1 : fields.length) {
    const field = newField(type, fields.map((f) => f.key))
    const next = [...fields]
    next.splice(at, 0, field)
    change(next)
    setSelected(at)
  }

  function move(from: number, to: number) {
    if (to < 0 || to > fields.length || from === to || from + 1 === to) return
    const next = [...fields]
    const [item] = next.splice(from, 1)
    const target = to > from ? to - 1 : to
    next.splice(target, 0, item)
    change(next)
    setSelected(target)
  }

  function update(index: number, patch: Partial<FormFieldDef>) {
    const before = fields[index]
    let next = fields.map((f, i) => (i === index ? { ...f, ...patch } : f))
    // Renamed key: keep conditions that point at it working.
    if (patch.key && patch.key !== before.key) {
      next = next.map((f) => (f.visibility?.field === before.key ? { ...f, visibility: { ...f.visibility, field: patch.key! } } : f))
    }
    change(next)
  }

  function remove(index: number) {
    const key = fields[index].key
    const dependants = fields.filter((f) => f.visibility?.field === key).length
    change(fields.filter((_, i) => i !== index).map((f) => (f.visibility?.field === key ? { ...f, visibility: null } : f)))
    setSelected(fields.length > 1 ? Math.max(0, index - 1) : null)
    if (dependants) toast.message(`Removed the show/hide rule from ${dependants} field${dependants === 1 ? "" : "s"} that depended on it.`)
  }

  function duplicate(index: number) {
    const source = fields[index]
    const copy = { ...structuredClone(source), key: uniqueKey(source.key, fields.map((f) => f.key)), label: `${source.label} (copy)` }
    const next = [...fields]
    next.splice(index + 1, 0, copy)
    change(next)
    setSelected(index + 1)
  }

  /** Problems the server would also reject, shown before saving. */
  function clientCheck(): Record<string, string> {
    const errors: Record<string, string> = {}
    const seen: string[] = []
    fields.forEach((f, i) => {
      if (!f.label.trim()) errors[`fields.${i}.label`] = "Every field needs a label."
      if (!KEY_PATTERN.test(f.key)) errors[`fields.${i}.key`] = "Keys use lowercase letters, numbers and _ and start with a letter."
      else if (seen.includes(f.key)) errors[`fields.${i}.key`] = "Another field already uses this key."
      if (["dropdown", "radio", "checkbox"].includes(f.type) && !(f.options?.choices ?? []).some((c) => c.trim())) errors[`fields.${i}.options.choices`] = "Add at least one choice."
      if (f.type === "table" && !(f.options?.columns ?? []).length) errors[`fields.${i}.options.columns`] = "Add at least one column."
      if (f.visibility && !seen.includes(f.visibility.field)) errors[`fields.${i}.visibility.field`] = "Show/hide rules can only use a field above this one."
      seen.push(f.key)
    })
    return errors
  }

  async function save(): Promise<boolean> {
    setFormError(null)
    const errors = clientCheck()
    setServerErrors(errors)
    if (Object.keys(errors).length) {
      const first = Number(Object.keys(errors)[0].split(".")[1])
      setSelected(first)
      setMode("build")
      setFormError("Some fields need attention before saving.")
      return false
    }
    setSaving(true)
    try {
      const { data } = await api<{ data: FormDetail }>(orgPath(slug, `/forms/${form.id}/draft`), { method: "PUT", body: { fields } })
      setDirty(false)
      // Keys may be normalised by the server; keep the editor in sync.
      setFields(data.draft_fields ?? fields)
      qc.setQueryData(formKeys.form(slug, form.id), data)
      qc.invalidateQueries({ queryKey: formKeys.all(slug), predicate: (q) => q.queryKey[2] !== "form" })
      return true
    } catch (e) {
      if (e instanceof ApiError && e.status === 422 && Object.keys(e.errors).length) {
        setServerErrors(Object.fromEntries(Object.entries(e.errors).map(([k, v]) => [k, v[0]])))
        setFormError("Some fields need attention before saving.")
      } else setFormError(errorMessage(e))
      return false
    } finally {
      setSaving(false)
    }
  }

  async function action(path: "publish" | "unpublish" | "draft", method: "POST" | "DELETE" = "POST", success: string) {
    if (path === "publish" && dirty && !(await save())) return
    setSaving(true)
    try {
      const { data } = await api<{ data: FormDetail }>(orgPath(slug, `/forms/${form.id}/${path}`), { method })
      qc.setQueryData(formKeys.form(slug, form.id), data)
      if (path === "draft") {
        // Discarded: back to the published fields.
        setFields(data.draft_fields ?? data.fields)
        setDirty(false)
        setServerErrors({})
      }
      toast.success(success)
      qc.invalidateQueries({ queryKey: formKeys.all(slug), predicate: (q) => q.queryKey[2] !== "form" })
    } catch (e) {
      if (e instanceof ApiError && e.field("fields")) setFormError(e.field("fields")!)
      else toast.error(errorMessage(e))
    } finally {
      setSaving(false)
    }
  }

  const fieldErrors = (i: number) => Object.entries(serverErrors).filter(([k]) => k.startsWith(`fields.${i}.`) || k === `fields.${i}`)
  const hasDraftChanges = dirty || !!form.has_unpublished_changes || form.status === "draft"

  return (
    <div className="space-y-4 p-4 md:p-6">
      <ModuleHeader
        app="form"
        title={form.name}
        back={{ href: href("/apps/form?tab=manage"), label: "Manage forms" }}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <Badge variant={form.status === "published" ? "default" : "outline"} className="capitalize">
              {form.status}
            </Badge>
            {form.version ? <span>Live version {form.version}</span> : <span>Not published yet</span>}
            {hasDraftChanges && form.version ? <span>· unpublished changes</span> : null}
            {dirty ? <span className="font-medium text-amber-700 dark:text-amber-400">· not saved</span> : null}
          </span>
        }
        actions={
          <>
            <Button variant="outline" onClick={() => setSettings(true)}>
              <Settings2 aria-hidden /> Settings
            </Button>
            <Button asChild variant="outline">
              <Link href={href(`/apps/form/${form.id}/responses`)}>
                <Inbox aria-hidden /> Responses
              </Link>
            </Button>
            {form.version && form.has_unpublished_changes && !dirty ? (
              <ConfirmAction
                trigger={
                  <Button variant="ghost">
                    <Undo2 aria-hidden /> Discard changes
                  </Button>
                }
                title="Discard unpublished changes?"
                description={`The form goes back to live version ${form.version}.`}
                confirmLabel="Discard"
                onConfirm={() => action("draft", "DELETE", "Changes discarded.")}
              />
            ) : null}
            {form.status === "published" ? (
              <ConfirmAction
                trigger={<Button variant="ghost">Close form</Button>}
                title="Stop accepting responses?"
                description="Existing responses and approvals are kept. You can publish again later."
                confirmLabel="Close form"
                destructive={false}
                onConfirm={() => action("unpublish", "POST", "Form closed.")}
              />
            ) : null}
            <Button variant="outline" onClick={save} disabled={saving || !dirty}>
              {saving ? <Spinner /> : null} Save draft
            </Button>
            <Button onClick={() => action("publish", "POST", "Published. New responses use this version.")} disabled={saving || !fields.length || (!hasDraftChanges && form.status === "published")}>
              {form.status === "closed" && !hasDraftChanges ? "Reopen" : "Publish"}
            </Button>
          </>
        }
      />
      <FormAlert message={formError} />

      <ToggleGroup type="single" value={mode} onValueChange={(v) => v && setMode(v as "build" | "preview")} variant="outline" size="sm" aria-label="Builder view">
        <ToggleGroupItem value="build">
          <Wrench aria-hidden /> Build
        </ToggleGroupItem>
        <ToggleGroupItem value="preview">
          <Eye aria-hidden /> Preview
        </ToggleGroupItem>
      </ToggleGroup>

      {mode === "preview" ? (
        <Card className="mx-auto max-w-3xl">
          <CardHeader>
            <CardTitle>{form.name}</CardTitle>
            {form.description ? <p className="text-sm text-muted-foreground">{form.description}</p> : null}
          </CardHeader>
          <CardContent>
            {fields.length ? (
              <FormRenderer
                fields={fields}
                values={previewValues}
                onChange={(k, v) => setPreviewValues((p) => ({ ...p, [k]: v }))}
                attachments={previewFiles}
                onAttachment={(a) => setPreviewFiles((m) => ({ ...m, [a.id]: a }))}
              />
            ) : (
              <p className="text-sm text-muted-foreground">Add fields to preview the form.</p>
            )}
            <p className="mt-6 text-xs text-muted-foreground">Preview only: nothing is submitted. Try the show/hide rules here.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[13rem_1fr_20rem]">
          <Card className="h-fit lg:sticky lg:top-20">
            <CardHeader>
              <CardTitle className="text-sm">Add a field</CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="grid grid-cols-2 gap-1.5 lg:grid-cols-1">
                {FIELD_TYPES.map((t) => (
                  <li key={t.type}>
                    <button
                      type="button"
                      draggable
                      onDragStart={(e) => {
                        e.dataTransfer.effectAllowed = "copy"
                        e.dataTransfer.setData(DRAG_TYPE, t.type)
                      }}
                      onClick={() => insert(t.type)}
                      className="flex w-full items-center gap-2 rounded-lg border px-2.5 py-2 text-left text-sm hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                    >
                      <t.icon className="size-4 text-muted-foreground" aria-hidden />
                      {t.label}
                    </button>
                  </li>
                ))}
              </ul>
              <p className="mt-3 text-xs text-muted-foreground">Click to add below the selected field, or drag onto the form.</p>
            </CardContent>
          </Card>

          <section aria-label="Form fields" className="min-w-0 space-y-2">
            {fields.length ? null : (
              <DropZone active={dropAt === 0} onOver={() => setDropAt(0)} onLeave={() => setDropAt(null)} onDrop={(e) => handleDrop(e, 0)} big>
                Drag a field here, or click one on the left.
              </DropZone>
            )}
            <ol className="space-y-2">
              {fields.map((field, i) => {
                const info = typeInfo(field.type)
                const errs = fieldErrors(i)
                return (
                  <li
                    key={`${field.key}-${i}`}
                    onDragOver={(e) => {
                      e.preventDefault()
                      setDropAt(i)
                    }}
                    onDragLeave={() => setDropAt(null)}
                    onDrop={(e) => handleDrop(e, i)}
                  >
                    {dropAt === i ? <div className="mb-2 h-1 rounded-full bg-primary" aria-hidden /> : null}
                    <div
                      className={cn(
                        "group flex items-start gap-2 rounded-xl border bg-card p-3 transition-colors",
                        selected === i ? "border-primary ring-1 ring-primary" : "hover:border-foreground/20",
                        errs.length && "border-destructive",
                      )}
                    >
                      <span
                        draggable
                        onDragStart={(e) => {
                          e.dataTransfer.effectAllowed = "move"
                          e.dataTransfer.setData(DRAG_INDEX, String(i))
                        }}
                        className="mt-1 cursor-grab text-muted-foreground"
                        aria-hidden
                      >
                        <GripVertical className="size-4" />
                      </span>
                      <button type="button" onClick={() => setSelected(i)} className="min-w-0 flex-1 text-left focus-visible:outline-none" aria-pressed={selected === i}>
                        <span className="flex flex-wrap items-center gap-2">
                          <info.icon className="size-4 text-muted-foreground" aria-hidden />
                          <span className="font-medium">{field.label || "Untitled field"}</span>
                          {field.required ? <span className="text-destructive" aria-label="required">*</span> : null}
                          <Badge variant="outline" className="font-mono text-[10px]">
                            {field.key}
                          </Badge>
                        </span>
                        <span className="mt-0.5 block text-xs text-muted-foreground">
                          {info.label}
                          {field.visibility ? ` · shown when ${describeCondition(field.visibility, fields.find((f) => f.key === field.visibility!.field)?.label)}` : ""}
                        </span>
                        {errs.map(([k, msg]) => (
                          <span key={k} className="mt-1 block text-xs text-destructive">
                            {msg}
                          </span>
                        ))}
                      </button>
                      <div className="flex shrink-0 gap-0.5 opacity-100 sm:opacity-60 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100">
                        <Button variant="ghost" size="icon-xs" onClick={() => move(i, i - 1)} disabled={i === 0} aria-label={`Move ${field.label} up`}>
                          <ArrowUp />
                        </Button>
                        <Button variant="ghost" size="icon-xs" onClick={() => move(i, i + 2)} disabled={i === fields.length - 1} aria-label={`Move ${field.label} down`}>
                          <ArrowDown />
                        </Button>
                        <Button variant="ghost" size="icon-xs" onClick={() => duplicate(i)} aria-label={`Duplicate ${field.label}`}>
                          <Copy />
                        </Button>
                        <Button variant="ghost" size="icon-xs" onClick={() => remove(i)} aria-label={`Delete ${field.label}`}>
                          <Trash2 />
                        </Button>
                      </div>
                    </div>
                  </li>
                )
              })}
            </ol>
            {fields.length ? (
              <DropZone active={dropAt === fields.length} onOver={() => setDropAt(fields.length)} onLeave={() => setDropAt(null)} onDrop={(e) => handleDrop(e, fields.length)}>
                Drop here to add at the end
              </DropZone>
            ) : null}
          </section>

          <Card className="h-fit lg:sticky lg:top-20">
            <CardHeader>
              <CardTitle className="text-sm">Field settings</CardTitle>
            </CardHeader>
            <CardContent>
              {selected !== null && fields[selected] ? (
                <FieldProperties
                  key={selected}
                  field={fields[selected]}
                  earlierFields={fields.slice(0, selected)}
                  takenKeys={fields.filter((_, i) => i !== selected).map((f) => f.key)}
                  onChange={(patch) => update(selected, patch)}
                />
              ) : (
                <p className="text-sm text-muted-foreground">Select a field to edit its label, rules and show/hide logic.</p>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      <FormSettingsDialog form={form} open={settings} onOpenChange={setSettings} fieldKeys={fields.map((f) => f.key)} />
    </div>
  )

  function handleDrop(e: React.DragEvent, at: number) {
    e.preventDefault()
    setDropAt(null)
    const type = e.dataTransfer.getData(DRAG_TYPE) as FieldType
    const from = e.dataTransfer.getData(DRAG_INDEX)
    if (type) insert(type, at)
    else if (from !== "") move(Number(from), at)
  }
}

function DropZone({
  active,
  onOver,
  onLeave,
  onDrop,
  children,
  big,
}: {
  active: boolean
  onOver: () => void
  onLeave: () => void
  onDrop: (e: React.DragEvent) => void
  children: React.ReactNode
  big?: boolean
}) {
  return (
    <div
      onDragOver={(e) => {
        e.preventDefault()
        onOver()
      }}
      onDragLeave={onLeave}
      onDrop={onDrop}
      className={cn(
        "flex items-center justify-center rounded-xl border-2 border-dashed text-sm text-muted-foreground",
        big ? "h-48" : "h-12",
        active && "border-primary bg-primary/5 text-foreground",
      )}
    >
      {children}
    </div>
  )
}
