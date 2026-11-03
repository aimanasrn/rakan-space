"use client"

import { ArrowRightLeft, CheckSquare, GripVertical, MessageSquare, MoreHorizontal } from "lucide-react"
import { useState } from "react"
import { PriorityBadge, TaskStatusBadge, UserAvatar } from "@/components/common"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { useWorkspace } from "@/components/workspace/workspace-context"
import { daysUntil, formatDateKey, relativeDue } from "@/lib/datetime"
import { t } from "@/lib/i18n"
import type { Task, TaskStatus } from "@/lib/types"
import { cn } from "@/lib/utils"
import { STATUSES, useMoveTask } from "./task-hooks"

export interface TaskFilterState {
  q: string
  status: string
  priority: string
  due: string
  sort: string
}

export const defaultFilters: TaskFilterState = { q: "", status: "all", priority: "all", due: "all", sort: "due_date" }

export function filtersToQuery(f: TaskFilterState) {
  return {
    q: f.q || undefined,
    status: f.status === "all" ? undefined : f.status === "open" ? "todo,in_progress,in_review" : f.status,
    priority: f.priority === "all" ? undefined : f.priority,
    due: f.due === "all" ? undefined : f.due,
    sort: f.sort,
    direction: f.sort === "updated_at" || f.sort === "created_at" ? "desc" : "asc",
  }
}

export function TaskFilters({ value, onChange, hideStatus }: { value: TaskFilterState; onChange: (v: TaskFilterState) => void; hideStatus?: boolean }) {
  const set = (patch: Partial<TaskFilterState>) => onChange({ ...value, ...patch })
  return (
    <div className="flex flex-wrap items-end gap-2" role="search" aria-label="Filter tasks">
      <div className="min-w-48 flex-1">
        <Label htmlFor="task-search" className="sr-only">
          Search tasks
        </Label>
        <Input id="task-search" placeholder="Search tasks…" value={value.q} onChange={(e) => set({ q: e.target.value })} />
      </div>
      {!hideStatus ? (
        <FilterSelect
          label="Status"
          value={value.status}
          onChange={(status) => set({ status })}
          options={[["all", "All statuses"], ["open", "Open"], ...STATUSES.map((s) => [s, t(`status.${s}`)] as [string, string])]}
        />
      ) : null}
      <FilterSelect
        label="Priority"
        value={value.priority}
        onChange={(priority) => set({ priority })}
        options={[["all", "All priorities"], ["urgent", "Urgent"], ["high", "High"], ["medium", "Medium"], ["low", "Low"]]}
      />
      <FilterSelect
        label="Due"
        value={value.due}
        onChange={(due) => set({ due })}
        options={[["all", "Any due date"], ["overdue", "Overdue"], ["today", "Due today"], ["week", "Next 7 days"], ["none", "No due date"]]}
      />
      <FilterSelect
        label="Sort"
        value={value.sort}
        onChange={(sort) => set({ sort })}
        options={[["due_date", "Sort: Due date"], ["priority", "Sort: Priority"], ["updated_at", "Sort: Recently updated"], ["title", "Sort: Title"]]}
      />
    </div>
  )
}

function FilterSelect({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: [string, string][] }) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="w-auto min-w-36" aria-label={label}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map(([v, l]) => (
          <SelectItem key={v} value={v}>
            {l}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

function DueLabel({ task }: { task: Task }) {
  const { org } = useWorkspace()
  if (!task.due_date) return <span className="text-muted-foreground">—</span>
  const overdue = task.status !== "done" && daysUntil(task.due_date, org.timezone) < 0
  return (
    <span className={cn("whitespace-nowrap", overdue ? "font-medium text-destructive" : "text-muted-foreground")} title={formatDateKey(task.due_date)}>
      {task.status === "done" ? formatDateKey(task.due_date) : relativeDue(task.due_date, org.timezone)}
    </span>
  )
}

/** Keyboard-friendly alternative to drag-and-drop. */
export function MoveTaskMenu({ task, disabled }: { task: Task; disabled?: boolean }) {
  const { slug } = useWorkspace()
  const move = useMoveTask(slug)
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-xs" aria-label={`Change status of ${task.title}`} disabled={disabled} onClick={(e) => e.stopPropagation()}>
          <MoreHorizontal />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
        <DropdownMenuLabel className="flex items-center gap-2">
          <ArrowRightLeft className="size-3.5" aria-hidden /> Move to
        </DropdownMenuLabel>
        <DropdownMenuRadioGroup value={task.status} onValueChange={(v) => move.mutate({ id: task.id, status: v as TaskStatus })}>
          {STATUSES.map((s) => (
            <DropdownMenuRadioItem key={s} value={s}>
              {t(`status.${s}`)}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export function TaskTable({ tasks, onOpen, showProject }: { tasks: Task[]; onOpen: (task: Task) => void; showProject?: boolean }) {
  return (
    <div className="overflow-x-auto rounded-xl border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="min-w-56">Task</TableHead>
            {showProject ? <TableHead>Project</TableHead> : null}
            <TableHead>Status</TableHead>
            <TableHead>Priority</TableHead>
            <TableHead>Assignee</TableHead>
            <TableHead>Due</TableHead>
            <TableHead className="w-10">
              <span className="sr-only">Actions</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {tasks.map((task) => (
            <TableRow key={task.id} className="cursor-pointer" onClick={() => onOpen(task)}>
              <TableCell>
                <button type="button" className="text-left font-medium hover:underline" onClick={(e) => (e.stopPropagation(), onOpen(task))}>
                  {task.title}
                </button>
                {task.checklist_total ? (
                  <span className="ml-2 inline-flex items-center gap-1 text-xs text-muted-foreground">
                    <CheckSquare className="size-3" aria-hidden />
                    {task.checklist_done}/{task.checklist_total}
                  </span>
                ) : null}
              </TableCell>
              {showProject ? <TableCell className="text-muted-foreground">{task.project?.name}</TableCell> : null}
              <TableCell>
                <TaskStatusBadge status={task.status} />
              </TableCell>
              <TableCell>
                <PriorityBadge priority={task.priority} />
              </TableCell>
              <TableCell>
                {task.assignee ? (
                  <span className="flex items-center gap-2 whitespace-nowrap">
                    <UserAvatar user={task.assignee} className="size-6" /> {task.assignee.name}
                  </span>
                ) : (
                  <span className="text-muted-foreground">Unassigned</span>
                )}
              </TableCell>
              <TableCell>
                <DueLabel task={task} />
              </TableCell>
              <TableCell>
                <MoveTaskMenu task={task} disabled={!task.permissions?.update} />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}

/**
 * Kanban board. Drag-and-drop with the mouse; every card also has a
 * "Move to" menu so status changes work with keyboard and touch.
 */
export function KanbanBoard({ tasks, onOpen }: { tasks: Task[]; onOpen: (task: Task) => void }) {
  const { slug } = useWorkspace()
  const move = useMoveTask(slug)
  const [dragging, setDragging] = useState<Task | null>(null)
  const [over, setOver] = useState<{ status: TaskStatus; index: number } | null>(null)

  const columns = STATUSES.map((status) => ({ status, tasks: tasks.filter((t) => t.status === status).sort((a, b) => a.position - b.position || a.id - b.id) }))

  function drop(status: TaskStatus, index: number) {
    if (!dragging) return
    const column = columns.find((c) => c.status === status)!.tasks.filter((t) => t.id !== dragging.id)
    column.splice(index, 0, dragging)
    move.mutate({ id: dragging.id, status, ordered_ids: column.map((t) => t.id) })
    setDragging(null)
    setOver(null)
  }

  return (
    <div className="grid auto-cols-[minmax(16rem,1fr)] grid-flow-col gap-3 overflow-x-auto pb-2" aria-label="Task board">
      {columns.map((col) => (
        <section
          key={col.status}
          aria-labelledby={`col-${col.status}`}
          className={cn("flex min-h-64 flex-col rounded-xl border bg-muted/40 p-2", over?.status === col.status && "ring-2 ring-ring/50")}
          onDragOver={(e) => {
            if (!dragging) return
            e.preventDefault()
            if (over?.status !== col.status) setOver({ status: col.status, index: col.tasks.length })
          }}
          onDragLeave={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget as Node)) setOver(null)
          }}
          onDrop={(e) => {
            e.preventDefault()
            drop(col.status, over?.status === col.status ? over.index : col.tasks.length)
          }}
        >
          <h3 id={`col-${col.status}`} className="flex items-center justify-between px-2 py-1.5 text-sm font-medium">
            {t(`status.${col.status}`)}
            <span className="rounded-full bg-background px-2 text-xs text-muted-foreground">{col.tasks.length}</span>
          </h3>
          <ol className="flex flex-1 flex-col gap-2">
            {col.tasks.map((task, index) => (
              <li
                key={task.id}
                draggable={!!task.permissions?.update}
                onDragStart={(e) => {
                  setDragging(task)
                  e.dataTransfer.effectAllowed = "move"
                  e.dataTransfer.setData("text/plain", String(task.id))
                }}
                onDragEnd={() => {
                  setDragging(null)
                  setOver(null)
                }}
                onDragOver={(e) => {
                  if (!dragging) return
                  e.preventDefault()
                  e.stopPropagation()
                  const rect = e.currentTarget.getBoundingClientRect()
                  const after = e.clientY > rect.top + rect.height / 2
                  setOver({ status: col.status, index: index + (after ? 1 : 0) })
                }}
                className={cn(
                  "group rounded-lg border bg-card p-3 shadow-xs transition-shadow hover:shadow-sm",
                  dragging?.id === task.id && "opacity-50",
                  over?.status === col.status && over.index === index && dragging && "border-t-2 border-t-primary",
                )}
              >
                <div className="flex items-start gap-1">
                  {task.permissions?.update ? <GripVertical className="mt-0.5 size-4 shrink-0 cursor-grab text-muted-foreground/60" aria-hidden /> : null}
                  <button type="button" onClick={() => onOpen(task)} className="flex-1 text-left text-sm font-medium hover:underline">
                    {task.title}
                  </button>
                  <MoveTaskMenu task={task} disabled={!task.permissions?.update} />
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                  <PriorityBadge priority={task.priority} />
                  <DueLabel task={task} />
                  {task.comments_count ? (
                    <span className="flex items-center gap-0.5 text-muted-foreground">
                      <MessageSquare className="size-3" aria-hidden />
                      {task.comments_count}
                      <span className="sr-only">comments</span>
                    </span>
                  ) : null}
                  {task.checklist_total ? (
                    <span className="flex items-center gap-0.5 text-muted-foreground">
                      <CheckSquare className="size-3" aria-hidden />
                      {task.checklist_done}/{task.checklist_total}
                    </span>
                  ) : null}
                  {task.assignee ? <UserAvatar user={task.assignee} className="ml-auto size-6" /> : null}
                </div>
              </li>
            ))}
          </ol>
        </section>
      ))}
    </div>
  )
}
