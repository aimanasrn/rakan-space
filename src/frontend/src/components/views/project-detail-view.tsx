"use client"

import { useQuery, useQueryClient } from "@tanstack/react-query"
import { Archive, ArchiveRestore, ArrowLeft, Columns3, List, Lock, MoreHorizontal, Pencil, Plus, Trash2, Users } from "lucide-react"
import Link from "next/link"
import { useParams, usePathname, useRouter, useSearchParams } from "next/navigation"
import { useState } from "react"
import { toast } from "sonner"
import { AttachmentChip, UploadButton, useUploader } from "@/components/attachments"
import { EmptyState, ErrorState, LoadingRows, ProjectStatusBadge, RichText, UserAvatar } from "@/components/common"
import { ConfirmAction } from "@/components/confirm"
import { ProjectFormDialog, ProjectMembersDialog } from "@/components/projects/project-form-dialog"
import { CreateTaskDialog } from "@/components/tasks/create-task-dialog"
import { TaskSheet } from "@/components/tasks/task-sheet"
import { defaultFilters, filtersToQuery, KanbanBoard, TaskFilters, TaskTable, type TaskFilterState } from "@/components/tasks/task-views"
import { ActivityFeed } from "@/components/views/activity-feed"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Progress } from "@/components/ui/progress"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { orgPath, useWorkspace } from "@/components/workspace/workspace-context"
import { keys } from "@/hooks/use-workspace-data"
import { api, ApiError, errorMessage } from "@/lib/api"
import { formatDateKey } from "@/lib/datetime"
import type { Activity, Attachment, Paginated, Project, Task } from "@/lib/types"

export function ProjectDetailView() {
  const { projectId } = useParams<{ projectId: string }>()
  const id = Number(projectId)
  const { slug, href } = useWorkspace()
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()
  const qc = useQueryClient()
  const [view, setView] = useState<"list" | "board">("board")
  const [filters, setFilters] = useState<TaskFilterState>(defaultFilters)
  const [creating, setCreating] = useState(false)
  const [editing, setEditing] = useState(false)
  const [managingMembers, setManagingMembers] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const openTaskId = params.get("task") ? Number(params.get("task")) : null
  const openTask = (task: Task | null) => router.replace(task ? `${pathname}?task=${task.id}` : pathname, { scroll: false })

  const project = useQuery({
    queryKey: keys.project(slug, id),
    queryFn: async () => (await api<{ data: Project }>(orgPath(slug, `/projects/${id}`))).data,
  })
  const taskQuery = { project_id: id, per_page: 500, ...filtersToQuery(filters), sort: view === "board" ? "position" : filtersToQuery(filters).sort }
  const tasks = useQuery({
    queryKey: keys.tasks(slug, taskQuery),
    enabled: project.isSuccess,
    queryFn: async () => (await api<Paginated<Task>>(orgPath(slug, "/tasks"), { query: taskQuery })).data,
    placeholderData: (prev) => prev,
  })

  if (project.isLoading) return <div className="p-4 md:p-8"><LoadingRows rows={6} /></div>
  if (project.error || !project.data) {
    return (
      <div className="p-4 md:p-8">
        {project.error instanceof ApiError && project.error.status === 404 ? (
          <EmptyState title="Project not found" description="It may have been deleted, or you don't have access." action={<Button asChild><Link href={href("/projects")}>Back to projects</Link></Button>} />
        ) : (
          <ErrorState error={project.error} onRetry={() => project.refetch()} />
        )}
      </div>
    )
  }

  const p = project.data
  const canManage = !!p.permissions?.manage
  const canContribute = !!p.permissions?.contribute

  async function action(path: string, method: "POST" | "DELETE", message: string) {
    try {
      await api(orgPath(slug, `/projects/${id}${path}`), { method })
      toast.success(message)
      qc.invalidateQueries({ queryKey: ["projects", slug] })
      if (method === "DELETE") router.replace(href("/projects"))
      else qc.invalidateQueries({ queryKey: keys.project(slug, id) })
    } catch (e) {
      toast.error(errorMessage(e))
    }
  }

  return (
    <div className="space-y-6 p-4 md:p-8">
      <div className="space-y-3">
        <Button variant="ghost" size="sm" asChild className="-ml-2">
          <Link href={href("/projects")}>
            <ArrowLeft /> Projects
          </Link>
        </Button>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0 space-y-2">
            <h1 className="flex flex-wrap items-center gap-2 text-2xl font-semibold tracking-tight">
              {p.name}
              <ProjectStatusBadge status={p.status} />
              {p.visibility === "restricted" ? (
                <Badge variant="outline" className="gap-1">
                  <Lock className="size-3" aria-hidden /> Members only
                </Badge>
              ) : null}
              {p.archived ? <Badge variant="secondary">Archived</Badge> : null}
            </h1>
            <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
              {p.manager ? (
                <span className="flex items-center gap-1.5">
                  <UserAvatar user={p.manager} className="size-5" /> Managed by {p.manager.name}
                </span>
              ) : null}
              {p.start_date ? <span>Start {formatDateKey(p.start_date)}</span> : null}
              {p.target_date ? <span>Target {formatDateKey(p.target_date)}</span> : null}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {canContribute ? (
              <Button onClick={() => setCreating(true)}>
                <Plus /> New task
              </Button>
            ) : null}
            {canManage ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="icon" aria-label="Project actions">
                    <MoreHorizontal />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onSelect={() => setEditing(true)}>
                    <Pencil /> Edit project
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => setManagingMembers(true)}>
                    <Users /> Manage members
                  </DropdownMenuItem>
                  {p.archived ? (
                    <DropdownMenuItem onSelect={() => action("/unarchive", "POST", "Project restored.")}>
                      <ArchiveRestore /> Restore project
                    </DropdownMenuItem>
                  ) : (
                    <DropdownMenuItem onSelect={() => action("/archive", "POST", "Project archived.")}>
                      <Archive /> Archive project
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuSeparator />
                  <DropdownMenuItem variant="destructive" onSelect={() => setConfirmDelete(true)}>
                    <Trash2 /> Delete project
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            ) : null}
          </div>
        </div>
        {p.archived ? (
          <p role="status" className="rounded-lg border bg-muted/50 px-3 py-2 text-sm text-muted-foreground">
            This project is archived and read-only.
          </p>
        ) : null}
      </div>

      <Tabs defaultValue="tasks">
        <TabsList>
          <TabsTrigger value="tasks">Tasks</TabsTrigger>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="files">Files</TabsTrigger>
          <TabsTrigger value="activity">Activity</TabsTrigger>
        </TabsList>

        <TabsContent value="tasks" className="space-y-4 pt-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <TaskFilters value={filters} onChange={setFilters} hideStatus={view === "board"} />
            <ToggleGroup type="single" value={view} onValueChange={(v) => v && setView(v as "list" | "board")} variant="outline" aria-label="Task view">
              <ToggleGroupItem value="board" aria-label="Board view">
                <Columns3 /> Board
              </ToggleGroupItem>
              <ToggleGroupItem value="list" aria-label="List view">
                <List /> List
              </ToggleGroupItem>
            </ToggleGroup>
          </div>
          {tasks.isLoading ? (
            <LoadingRows rows={4} />
          ) : tasks.error ? (
            <ErrorState error={tasks.error} onRetry={() => tasks.refetch()} />
          ) : view === "board" ? (
            <KanbanBoard tasks={tasks.data ?? []} onOpen={openTask} />
          ) : tasks.data?.length ? (
            <TaskTable tasks={tasks.data} onOpen={openTask} />
          ) : (
            <EmptyState title="No tasks match" description={canContribute ? "Create a task to get started." : undefined} />
          )}
        </TabsContent>

        <TabsContent value="overview" className="grid gap-4 pt-4 lg:grid-cols-3">
          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle>About this project</CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              <p className="text-sm whitespace-pre-wrap">{p.description ? <RichText text={p.description} /> : <span className="text-muted-foreground">No description yet.</span>}</p>
              <div className="space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="font-medium">Progress</span>
                  <span>{p.progress?.percent ?? 0}%</span>
                </div>
                <Progress value={p.progress?.percent ?? 0} aria-label="Project progress" />
                <p className="text-xs text-muted-foreground">
                  {p.progress?.done ?? 0} of {p.progress?.total ?? 0} tasks done · {p.progress?.open ?? 0} open · {p.progress?.overdue ?? 0} overdue. Progress = completed tasks ÷ all tasks.
                </p>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Members ({p.members?.length ?? 0})</CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="space-y-2">
                {p.members?.map((m) => (
                  <li key={m.user.id} className="flex items-center gap-2 text-sm">
                    <UserAvatar user={m.user} className="size-7" />
                    <span className="min-w-0 flex-1 truncate">{m.user.name}</span>
                    {m.role === "manager" ? <Badge variant="secondary">Manager</Badge> : null}
                  </li>
                ))}
              </ul>
              {canManage ? (
                <Button variant="outline" size="sm" className="mt-4 w-full" onClick={() => setManagingMembers(true)}>
                  <Users /> Manage members
                </Button>
              ) : null}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="files" className="pt-4">
          <ProjectFiles project={p} />
        </TabsContent>

        <TabsContent value="activity" className="pt-4">
          <ProjectActivity projectId={id} />
        </TabsContent>
      </Tabs>

      {canContribute ? <CreateTaskDialog project={p} open={creating} onOpenChange={setCreating} /> : null}
      {canManage ? (
        <>
          <ProjectFormDialog key={`edit-${p.updated_at}`} open={editing} onOpenChange={setEditing} project={p} />
          <ProjectMembersDialog key={`members-${p.updated_at}`} open={managingMembers} onOpenChange={setManagingMembers} project={p} />
          <ConfirmAction
            open={confirmDelete}
            onOpenChange={setConfirmDelete}
            title={`Delete ${p.name}?`}
            description="This permanently deletes the project and all its tasks. Only owners and admins can delete projects — consider archiving instead."
            onConfirm={() => action("", "DELETE", "Project deleted.")}
          />
        </>
      ) : null}
      <TaskSheet taskId={openTaskId} onClose={() => openTask(null)} />
    </div>
  )
}

function ProjectFiles({ project }: { project: Project }) {
  const { slug } = useWorkspace()
  const qc = useQueryClient()
  const uploader = useUploader(slug)
  const files = useQuery({
    queryKey: ["files", slug, { project_id: project.id }],
    queryFn: () => api<Paginated<Attachment>>(orgPath(slug, "/files"), { query: { project_id: project.id, per_page: 100 } }),
  })

  async function addFiles(list: FileList) {
    await uploader.add(list)
  }

  async function attachUploaded() {
    try {
      await api(orgPath(slug, `/projects/${project.id}/files`), { method: "POST", body: { attachment_ids: uploader.ids } })
      uploader.clear()
      toast.success("Files added to project.")
      qc.invalidateQueries({ queryKey: ["files", slug] })
    } catch (e) {
      toast.error(errorMessage(e))
    }
  }

  return (
    <div className="space-y-4">
      {project.permissions?.contribute ? (
        <div className="flex flex-wrap items-center gap-2">
          <UploadButton onFiles={addFiles} uploading={uploader.uploading} label="Upload files" />
          {uploader.items.length ? (
            <Button size="sm" onClick={attachUploaded} disabled={uploader.uploading}>
              Add {uploader.items.length} file{uploader.items.length > 1 ? "s" : ""} to project
            </Button>
          ) : null}
        </div>
      ) : null}
      {uploader.items.length ? (
        <div className="flex flex-wrap gap-2">
          {uploader.items.map((a) => (
            <AttachmentChip key={a.id} attachment={a} onRemove={() => uploader.remove(a.id)} className="w-64 border-dashed" />
          ))}
        </div>
      ) : null}
      {files.isLoading ? (
        <LoadingRows rows={3} />
      ) : files.data?.data.length ? (
        <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {files.data.data.map((a) => (
            <li key={a.id}>
              <AttachmentChip attachment={a} />
              {a.context?.type === "task" ? <p className="mt-1 truncate px-1 text-xs text-muted-foreground">On task: {a.context.label}</p> : null}
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState title="No files yet" description="Files attached to this project and its tasks appear here." />
      )}
    </div>
  )
}

function ProjectActivity({ projectId }: { projectId: number }) {
  const { slug } = useWorkspace()
  const activity = useQuery({
    queryKey: ["project-activity", slug, projectId],
    queryFn: async () => (await api<Paginated<Activity>>(orgPath(slug, `/projects/${projectId}/activity`))).data,
  })
  if (activity.isLoading) return <LoadingRows rows={4} />
  return <ActivityFeed items={activity.data ?? []} />
}
