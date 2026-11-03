"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { CalendarDays, Plus, Trash2 } from "lucide-react"
import Link from "next/link"
import { useEffect, useState } from "react"
import { toast } from "sonner"
import { AttachmentList, UploadButton, useUploader } from "@/components/attachments"
import { ErrorState, LoadingRows, RichText, UserAvatar } from "@/components/common"
import { ConfirmAction } from "@/components/confirm"
import { PersonSelect } from "@/components/pickers"
import { ActivityFeed } from "@/components/views/activity-feed"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Separator } from "@/components/ui/separator"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Spinner } from "@/components/ui/spinner"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"
import { orgPath, useWorkspace } from "@/components/workspace/workspace-context"
import { keys } from "@/hooks/use-workspace-data"
import { api, errorMessage } from "@/lib/api"
import { daysUntil, relativeDue, timeAgo } from "@/lib/datetime"
import { t } from "@/lib/i18n"
import type { Activity, Paginated, Project, Task, TaskComment, TaskPriority, TaskStatus } from "@/lib/types"
import { cn } from "@/lib/utils"
import { STATUSES, useInvalidateTasks, useUpdateTask } from "./task-hooks"

export function TaskSheet({ taskId, onClose }: { taskId: number | null; onClose: () => void }) {
  return (
    <Sheet open={taskId !== null} onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="w-full gap-0 overflow-y-auto sm:max-w-xl">
        {taskId !== null ? <TaskDetail taskId={taskId} onDeleted={onClose} /> : null}
      </SheetContent>
    </Sheet>
  )
}

function TaskDetail({ taskId, onDeleted }: { taskId: number; onDeleted: () => void }) {
  const { slug, org, href } = useWorkspace()
  const qc = useQueryClient()
  const update = useUpdateTask(slug)
  const invalidate = useInvalidateTasks(slug)
  const tz = org.timezone

  const task = useQuery({
    queryKey: keys.task(slug, taskId),
    queryFn: async () => (await api<{ data: Task }>(orgPath(slug, `/tasks/${taskId}`))).data,
  })
  const project = useQuery({
    queryKey: keys.project(slug, task.data?.project_id ?? 0),
    enabled: !!task.data,
    queryFn: async () => (await api<{ data: Project }>(orgPath(slug, `/projects/${task.data!.project_id}`))).data,
  })

  if (task.isLoading)
    return (
      <div className="p-6">
        <SheetHeader className="sr-only">
          <SheetTitle>Loading task</SheetTitle>
        </SheetHeader>
        <LoadingRows rows={6} />
      </div>
    )
  if (task.error || !task.data)
    return (
      <div className="p-6">
        <SheetHeader>
          <SheetTitle>Task unavailable</SheetTitle>
        </SheetHeader>
        <ErrorState error={task.error} />
      </div>
    )

  const data = task.data
  const canEdit = !!data.permissions?.update
  const people = (project.data?.members ?? []).map((m) => m.user)
  const save = (body: Parameters<typeof update.mutate>[0]) => update.mutate(body)

  return (
    <>
      <SheetHeader className="gap-3 border-b p-6">
        <SheetDescription>
          <Link href={href(`/projects/${data.project_id}`)} className="hover:underline">
            {data.project?.name}
          </Link>
        </SheetDescription>
        <SheetTitle className="sr-only">{data.title}</SheetTitle>
        {canEdit ? (
          <TitleInput key={data.title} initial={data.title} onSave={(title) => save({ id: data.id, title })} />
        ) : (
          <p className="text-lg font-semibold">{data.title}</p>
        )}
      </SheetHeader>

      <div className="space-y-6 p-6">
        <dl className="grid grid-cols-[7rem_1fr] items-center gap-x-4 gap-y-3 text-sm">
          <dt className="text-muted-foreground">
            <Label htmlFor="task-status">Status</Label>
          </dt>
          <dd>
            <Select value={data.status} disabled={!canEdit} onValueChange={(v) => save({ id: data.id, status: v as TaskStatus })}>
              <SelectTrigger id="task-status" className="w-full">
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
          </dd>
          <dt className="text-muted-foreground">
            <Label htmlFor="task-priority">Priority</Label>
          </dt>
          <dd>
            <Select value={data.priority} disabled={!canEdit} onValueChange={(v) => save({ id: data.id, priority: v as TaskPriority })}>
              <SelectTrigger id="task-priority" className="w-full">
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
          </dd>
          <dt className="text-muted-foreground">
            <Label htmlFor="task-assignee">Assignee</Label>
          </dt>
          <dd>
            <PersonSelect id="task-assignee" people={people} value={data.assignee?.id ?? null} disabled={!canEdit} onChange={(id) => save({ id: data.id, assignee_id: id })} />
          </dd>
          <dt className="text-muted-foreground">
            <Label htmlFor="task-due">Due date</Label>
          </dt>
          <dd className="space-y-1">
            <Input
              id="task-due"
              type="date"
              value={data.due_date ?? ""}
              disabled={!canEdit}
              onChange={(e) => save({ id: data.id, due_date: e.target.value || null })}
            />
            {data.due_date && data.status !== "done" ? (
              <p className={cn("flex items-center gap-1 text-xs", daysUntil(data.due_date, tz) < 0 ? "text-destructive" : "text-muted-foreground")}>
                <CalendarDays className="size-3" aria-hidden /> {relativeDue(data.due_date, tz)}
              </p>
            ) : null}
          </dd>
          <dt className="text-muted-foreground">Created by</dt>
          <dd className="flex items-center gap-2">
            <UserAvatar user={data.creator} className="size-5" /> {data.creator?.name ?? "Former member"} · {timeAgo(data.created_at)}
          </dd>
        </dl>

        <section className="space-y-2">
          <Label htmlFor="task-description">Description</Label>
          {canEdit ? (
            <DescriptionEditor key={data.description ?? ""} initial={data.description ?? ""} saving={update.isPending} onSave={(description) => save({ id: data.id, description: description || null })} />
          ) : (
            <p className="text-sm whitespace-pre-wrap">{data.description ? <RichText text={data.description} /> : <span className="text-muted-foreground">No description.</span>}</p>
          )}
        </section>

        <Checklist task={data} canEdit={canEdit} />
        <TaskFiles task={data} canAdd={!!project.data?.permissions?.contribute} />

        <Separator />

        <Tabs defaultValue="comments">
          <TabsList>
            <TabsTrigger value="comments">Comments ({data.comments_count ?? 0})</TabsTrigger>
            <TabsTrigger value="activity">Activity</TabsTrigger>
          </TabsList>
          <TabsContent value="comments" className="pt-3">
            <Comments task={data} canComment={!!project.data?.permissions?.contribute} />
          </TabsContent>
          <TabsContent value="activity" className="pt-3">
            <TaskActivity taskId={data.id} />
          </TabsContent>
        </Tabs>

        {data.permissions?.delete ? (
          <div className="border-t pt-4">
            <ConfirmAction
              trigger={
                <Button variant="destructive" size="sm">
                  <Trash2 /> Delete task
                </Button>
              }
              title="Delete this task?"
              description="The task, its checklist and comments will be permanently deleted."
              onConfirm={async () => {
                try {
                  await api(orgPath(slug, `/tasks/${data.id}`), { method: "DELETE" })
                  toast.success("Task deleted.")
                  qc.removeQueries({ queryKey: keys.task(slug, data.id) })
                  invalidate()
                  onDeleted()
                } catch (e) {
                  toast.error(errorMessage(e))
                }
              }}
            />
          </div>
        ) : null}
      </div>
    </>
  )
}

/** Keyed by the saved value, so it resets whenever the server copy changes. */
function TitleInput({ initial, onSave }: { initial: string; onSave: (title: string) => void }) {
  const [title, setTitle] = useState(initial)
  return (
    <Input
      aria-label="Task title"
      value={title}
      onChange={(e) => setTitle(e.target.value)}
      onBlur={() => title.trim() && title !== initial && onSave(title.trim())}
      onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
      className="h-auto border-transparent px-0 text-lg font-semibold shadow-none focus-visible:border-input focus-visible:px-2"
    />
  )
}

function DescriptionEditor({ initial, saving, onSave }: { initial: string; saving: boolean; onSave: (value: string) => void }) {
  const [description, setDescription] = useState(initial)
  return (
    <>
      <Textarea id="task-description" rows={4} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Add more detail…" />
      {description !== initial ? (
        <div className="flex gap-2">
          <Button size="sm" onClick={() => onSave(description)} disabled={saving}>
            Save description
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setDescription(initial)}>
            Cancel
          </Button>
        </div>
      ) : null}
    </>
  )
}

function Checklist({ task, canEdit }: { task: Task; canEdit: boolean }) {
  const { slug } = useWorkspace()
  const qc = useQueryClient()
  const [body, setBody] = useState("")
  const items = task.checklist ?? []
  const done = items.filter((i) => i.is_done).length

  const mutate = useMutation({
    mutationFn: (req: { method: "POST" | "PATCH" | "DELETE"; path: string; body?: unknown }) =>
      api<{ data: Task }>(orgPath(slug, `/tasks/${task.id}/checklist${req.path}`), { method: req.method, body: req.body }),
    onSuccess: ({ data }) => {
      qc.setQueryData(keys.task(slug, task.id), data)
      qc.invalidateQueries({ queryKey: ["tasks", slug] })
    },
    onError: (e) => toast.error(errorMessage(e)),
  })

  return (
    <section className="space-y-2" aria-labelledby="checklist-heading">
      <h3 id="checklist-heading" className="text-sm font-medium">
        Checklist {items.length ? <span className="text-muted-foreground">({done}/{items.length})</span> : null}
      </h3>
      <ul className="space-y-1">
        {items.map((item) => (
          <li key={item.id} className="group flex items-center gap-2 rounded-md px-1 py-1 hover:bg-muted/60">
            <Checkbox
              id={`check-${item.id}`}
              checked={item.is_done}
              disabled={!canEdit}
              onCheckedChange={(v) => mutate.mutate({ method: "PATCH", path: `/${item.id}`, body: { is_done: v === true } })}
            />
            <Label htmlFor={`check-${item.id}`} className={cn("flex-1 font-normal", item.is_done && "text-muted-foreground line-through")}>
              {item.body}
            </Label>
            {canEdit ? (
              <Button
                variant="ghost"
                size="icon-xs"
                className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
                aria-label={`Delete checklist item ${item.body}`}
                onClick={() => mutate.mutate({ method: "DELETE", path: `/${item.id}` })}
              >
                <Trash2 />
              </Button>
            ) : null}
          </li>
        ))}
      </ul>
      {canEdit ? (
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            if (!body.trim()) return
            mutate.mutate({ method: "POST", path: "", body: { body: body.trim() } }, { onSuccess: () => setBody("") })
          }}
        >
          <Input value={body} onChange={(e) => setBody(e.target.value)} placeholder="Add an item" aria-label="New checklist item" />
          <Button type="submit" variant="outline" size="icon" aria-label="Add checklist item" disabled={mutate.isPending}>
            <Plus />
          </Button>
        </form>
      ) : null}
    </section>
  )
}

function TaskFiles({ task, canAdd }: { task: Task; canAdd: boolean }) {
  const { slug } = useWorkspace()
  const qc = useQueryClient()
  const uploader = useUploader(slug)

  async function upload(files: FileList) {
    await uploader.add(files)
  }

  useEffect(() => {
    if (!uploader.ids.length || uploader.uploading) return
    const ids = uploader.ids
    uploader.clear()
    api<{ data: Task }>(orgPath(slug, `/tasks/${task.id}/files`), { method: "POST", body: { attachment_ids: ids } })
      .then(({ data }) => {
        qc.setQueryData(keys.task(slug, task.id), data)
        toast.success("File added.")
      })
      .catch((e) => toast.error(errorMessage(e)))
  }, [uploader.ids.join(","), uploader.uploading]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <section className="space-y-2" aria-labelledby="files-heading">
      <div className="flex items-center justify-between">
        <h3 id="files-heading" className="text-sm font-medium">
          Attachments
        </h3>
        {canAdd ? <UploadButton onFiles={upload} uploading={uploader.uploading} label="Add file" /> : null}
      </div>
      {task.attachments?.length ? <AttachmentList items={task.attachments} /> : <p className="text-sm text-muted-foreground">No files attached.</p>}
    </section>
  )
}

function Comments({ task, canComment }: { task: Task; canComment: boolean }) {
  const { slug } = useWorkspace()
  const qc = useQueryClient()
  const [body, setBody] = useState("")
  const comments = useQuery({
    queryKey: ["task-comments", slug, task.id],
    queryFn: async () => (await api<{ data: TaskComment[] }>(orgPath(slug, `/tasks/${task.id}/comments`))).data,
  })
  const add = useMutation({
    mutationFn: () => api(orgPath(slug, `/tasks/${task.id}/comments`), { method: "POST", body: { body } }),
    onSuccess: () => {
      setBody("")
      qc.invalidateQueries({ queryKey: ["task-comments", slug, task.id] })
      qc.invalidateQueries({ queryKey: keys.task(slug, task.id) })
    },
    onError: (e) => toast.error(errorMessage(e)),
  })
  const remove = useMutation({
    mutationFn: (id: number) => api(orgPath(slug, `/tasks/${task.id}/comments/${id}`), { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["task-comments", slug, task.id] }),
    onError: (e) => toast.error(errorMessage(e)),
  })

  return (
    <div className="space-y-4">
      {comments.isLoading ? <LoadingRows rows={2} /> : null}
      <ul className="space-y-4">
        {comments.data?.map((c) => (
          <li key={c.id} className="flex gap-3">
            <UserAvatar user={c.user} className="size-7" />
            <div className="min-w-0 flex-1">
              <p className="text-sm">
                <span className="font-medium">{c.user?.name ?? "Former member"}</span>{" "}
                <span className="text-xs text-muted-foreground">{timeAgo(c.created_at)}</span>
              </p>
              <p className="text-sm break-words whitespace-pre-wrap">
                <RichText text={c.body} />
              </p>
            </div>
            {c.can_delete ? (
              <Button variant="ghost" size="icon-xs" aria-label="Delete comment" onClick={() => remove.mutate(c.id)}>
                <Trash2 />
              </Button>
            ) : null}
          </li>
        ))}
      </ul>
      {!comments.isLoading && !comments.data?.length ? <p className="text-sm text-muted-foreground">No comments yet.</p> : null}
      {canComment ? (
        <form
          className="space-y-2"
          onSubmit={(e) => {
            e.preventDefault()
            if (body.trim()) add.mutate()
          }}
        >
          <Label htmlFor="new-comment" className="sr-only">
            Add a comment
          </Label>
          <Textarea id="new-comment" rows={2} placeholder="Write a comment…" value={body} onChange={(e) => setBody(e.target.value)} />
          <Button type="submit" size="sm" disabled={add.isPending || !body.trim()}>
            {add.isPending ? <Spinner /> : null}
            Comment
          </Button>
        </form>
      ) : null}
    </div>
  )
}

function TaskActivity({ taskId }: { taskId: number }) {
  const { slug } = useWorkspace()
  const activity = useQuery({
    queryKey: ["task-activity", slug, taskId],
    queryFn: async () => (await api<Paginated<Activity>>(orgPath(slug, `/tasks/${taskId}/activity`))).data,
  })
  if (activity.isLoading) return <LoadingRows rows={3} />
  return <ActivityFeed items={activity.data ?? []} />
}
