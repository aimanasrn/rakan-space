"use client"

import { useState } from "react"
import { toast } from "sonner"
import { AttachmentList, UploadButton, useUploader } from "@/components/attachments"
import { FormAlert, TextField, useFormErrors } from "@/components/form"
import { PersonSelect } from "@/components/pickers"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { FieldGroup } from "@/components/ui/field"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Spinner } from "@/components/ui/spinner"
import { orgPath, useWorkspace } from "@/components/workspace/workspace-context"
import { api } from "@/lib/api"
import { t } from "@/lib/i18n"
import type { Project, Task, TaskPriority, TaskStatus } from "@/lib/types"
import { STATUSES, useInvalidateTasks } from "./task-hooks"

export function CreateTaskDialog({
  project,
  open,
  onOpenChange,
  defaultStatus = "todo",
}: {
  project: Project
  open: boolean
  onOpenChange: (open: boolean) => void
  defaultStatus?: TaskStatus
}) {
  const { slug } = useWorkspace()
  const invalidate = useInvalidateTasks(slug)
  const { errors, formError, capture, reset } = useFormErrors()
  const [pending, setPending] = useState(false)
  const [status, setStatus] = useState<TaskStatus>(defaultStatus)
  const [priority, setPriority] = useState<TaskPriority>("medium")
  const [assignee, setAssignee] = useState<number | null>(null)
  const uploader = useUploader(slug)
  const people = (project.members ?? []).map((m) => m.user)

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    reset()
    setPending(true)
    const form = new FormData(e.currentTarget)
    const checklist = String(form.get("checklist") ?? "")
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean)
    try {
      await api<{ data: Task }>(orgPath(slug, `/projects/${project.id}/tasks`), {
        method: "POST",
        body: {
          title: form.get("title"),
          description: form.get("description") || null,
          due_date: form.get("due_date") || null,
          status,
          priority,
          assignee_id: assignee,
          checklist,
          attachment_ids: uploader.ids,
        },
      })
      toast.success("Task created.")
      invalidate()
      uploader.clear()
      setAssignee(null)
      onOpenChange(false)
    } catch (error) {
      capture(error)
    } finally {
      setPending(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>New task</DialogTitle>
          <DialogDescription>in {project.name}</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} noValidate>
          <FieldGroup>
            <FormAlert message={formError} />
            <TextField id="title" label="Title" required error={errors.title} autoFocus />
            <TextField id="description" label="Description" textarea rows={3} error={errors.description} />
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="new-task-status">Status</Label>
                <Select value={status} onValueChange={(v) => setStatus(v as TaskStatus)}>
                  <SelectTrigger id="new-task-status" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {STATUSES.map((s) => (
                      <SelectItem key={s} value={s}>
                        {t(`status.${s}`)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="new-task-priority">Priority</Label>
                <Select value={priority} onValueChange={(v) => setPriority(v as TaskPriority)}>
                  <SelectTrigger id="new-task-priority" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(["low", "medium", "high", "urgent"] as const).map((p) => (
                      <SelectItem key={p} value={p}>
                        {t(`priority.${p}`)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="new-task-assignee">Assignee</Label>
                <PersonSelect id="new-task-assignee" people={people} value={assignee} onChange={setAssignee} />
                {errors.assignee_id ? <p className="text-sm text-destructive">{errors.assignee_id}</p> : null}
              </div>
              <TextField id="due_date" label="Due date" type="date" error={errors.due_date} />
            </div>
            <TextField id="checklist" label="Checklist" textarea rows={3} description="One item per line (optional)." />
            <div className="space-y-2">
              <UploadButton onFiles={uploader.add} uploading={uploader.uploading} />
              <AttachmentList items={uploader.items} onRemove={(a) => uploader.remove(a.id)} />
              {errors.attachment_ids ? <p className="text-sm text-destructive">{errors.attachment_ids}</p> : null}
            </div>
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
                {t("actions.cancel")}
              </Button>
              <Button type="submit" disabled={pending || uploader.uploading}>
                {pending ? <Spinner /> : null}
                Create task
              </Button>
            </DialogFooter>
          </FieldGroup>
        </form>
      </DialogContent>
    </Dialog>
  )
}
