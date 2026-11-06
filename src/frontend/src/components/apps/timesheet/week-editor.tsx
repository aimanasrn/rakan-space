"use client"

import { useQueryClient } from "@tanstack/react-query"
import { ChevronLeft, ChevronRight, CopyPlus, ExternalLink, MessageSquareText, Plus, Save, Send, Trash2, Undo2 } from "lucide-react"
import Link from "next/link"
import { useMemo, useState } from "react"
import { toast } from "sonner"
import { LoadingRows } from "@/components/common"
import { ConfirmAction } from "@/components/confirm"
import { FormAlert } from "@/components/form"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Spinner } from "@/components/ui/spinner"
import { orgPath, useWorkspace } from "@/components/workspace/workspace-context"
import { ApiError, api, errorMessage } from "@/lib/api"
import { addDaysToKey, formatDateKey, todayKey } from "@/lib/datetime"
import type { TimesheetDetail, TimesheetEntry } from "@/lib/types"
import { cn } from "@/lib/utils"
import { LoadError, StatusBadge } from "../shared"
import {
  formatDuration,
  formatHours,
  mondayOf,
  parseHours,
  timesheetKeys,
  useLoggableProjects,
  useProjectTasks,
  useWeek,
  weekDays,
} from "./use-timesheets"

interface Row {
  key: string
  project_id: number | null
  task_id: number | null
  project_name: string | null
  task_title: string | null
  note: string
  /** What is typed in each day's cell, Monday → Sunday. */
  cells: string[]
}

const rowKey = (projectId: number | null, taskId: number | null) => `${projectId ?? 0}:${taskId ?? 0}`

function rowsFrom(sheet: TimesheetDetail): Row[] {
  const days = weekDays(sheet.week_start)
  const rows = new Map<string, Row>()
  for (const e of sheet.entries) {
    const key = rowKey(e.project_id, e.task_id)
    let row = rows.get(key)
    if (!row) {
      row = { key, project_id: e.project_id, task_id: e.task_id, project_name: e.project_name, task_title: e.task_title, note: "", cells: Array(7).fill("") }
      rows.set(key, row)
    }
    const i = days.indexOf(e.work_date)
    if (i >= 0) row.cells[i] = formatHours(e.minutes)
    if (!row.note && e.note) row.note = e.note
  }
  return [...rows.values()]
}

/** "My week": the signed-in member's grid for one week. */
export function MyWeek({ week, onWeekChange }: { week: string; onWeekChange: (week: string) => void }) {
  const { slug, org } = useWorkspace()
  const current = mondayOf(todayKey(org.timezone))
  const sheet = useWeek(slug, week)

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" size="icon" aria-label="Previous week" onClick={() => onWeekChange(addDaysToKey(week, -7))}>
          <ChevronLeft aria-hidden />
        </Button>
        <Button variant="outline" size="icon" aria-label="Next week" disabled={week >= current} onClick={() => onWeekChange(addDaysToKey(week, 7))}>
          <ChevronRight aria-hidden />
        </Button>
        <h2 className="text-lg font-semibold" aria-live="polite">
          {formatDateKey(week, { year: undefined })} – {formatDateKey(addDaysToKey(week, 6))}
        </h2>
        {week !== current ? (
          <Button variant="ghost" size="sm" onClick={() => onWeekChange(current)}>
            This week
          </Button>
        ) : null}
        {sheet.data ? <StatusBadge status={sheet.data.status} className="ml-auto" /> : null}
      </div>
      {sheet.isPending ? (
        <LoadingRows rows={4} />
      ) : sheet.error ? (
        <LoadError error={sheet.error} onRetry={() => sheet.refetch()} what="Week" />
      ) : (
        // Re-created when the server copy changes, so local edits always start from it.
        <WeekEditor key={`${sheet.data.week_start}:${sheet.data.updated_at ?? "new"}:${sheet.data.status}`} sheet={sheet.data} />
      )}
    </div>
  )
}

export function WeekEditor({ sheet }: { sheet: TimesheetDetail }) {
  const { slug, org, href } = useWorkspace()
  const qc = useQueryClient()
  const days = useMemo(() => weekDays(sheet.week_start), [sheet.week_start])
  const today = todayKey(org.timezone)
  const editable = sheet.permissions.edit
  const [rows, setRows] = useState<Row[]>(() => rowsFrom(sheet))
  const [dirty, setDirty] = useState(false)
  const [adding, setAdding] = useState(false)
  const [noteFor, setNoteFor] = useState<string | null>(null)
  const [busy, setBusy] = useState<"save" | "submit" | "copy" | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [cellErrors, setCellErrors] = useState<Record<string, string>>({})

  const parsed = rows.map((r) => r.cells.map(parseHours))
  const invalid = parsed.some((cells) => cells.some((m) => m === null || m > 1440))
  const rowTotal = (i: number) => parsed[i].reduce<number>((sum, m) => sum + (m ?? 0), 0)
  const dayTotal = (d: number) => parsed.reduce<number>((sum, cells) => sum + (cells[d] ?? 0), 0)
  const total = days.reduce((sum, _, d) => sum + dayTotal(d), 0)

  function update(fn: (rows: Row[]) => Row[]) {
    setRows(fn)
    setDirty(true)
    setError(null)
  }

  function setCell(rowIndex: number, day: number, value: string) {
    update((rs) => rs.map((r, i) => (i === rowIndex ? { ...r, cells: r.cells.map((c, d) => (d === day ? value : c)) } : r)))
  }

  /** Entries to send, plus where each one sits in the grid (for server errors). */
  function payload() {
    const entries: Omit<TimesheetEntry, "id" | "project_name" | "task_title">[] = []
    const where: string[] = []
    rows.forEach((r, i) =>
      parsed[i].forEach((minutes, d) => {
        if (minutes) {
          entries.push({ project_id: r.project_id, task_id: r.task_id, work_date: days[d], minutes, note: r.note.trim() || null })
          where.push(`${r.key}|${d}`)
        }
      }),
    )
    return { entries, where }
  }

  function showError(e: unknown, where: string[]) {
    if (e instanceof ApiError && e.status === 422) {
      const mapped: Record<string, string> = {}
      for (const [field, messages] of Object.entries(e.errors)) {
        const m = field.match(/^entries\.(\d+)\./)
        if (m && where[Number(m[1])]) mapped[where[Number(m[1])]] = messages[0]
      }
      setCellErrors(mapped)
    }
    setError(errorMessage(e))
  }

  async function save(): Promise<TimesheetDetail | null> {
    const { entries, where } = payload()
    try {
      const { data } = await api<{ data: TimesheetDetail }>(orgPath(slug, `/timesheet/weeks/${sheet.week_start}`), { method: "PUT", body: { entries } })
      setCellErrors({})
      return data
    } catch (e) {
      showError(e, where)
      return null
    }
  }

  function refresh(data: TimesheetDetail) {
    qc.setQueryData(timesheetKeys.week(slug, sheet.week_start), data)
    qc.invalidateQueries({ queryKey: ["timesheet", slug, "sheets"] })
    if (data.id) qc.setQueryData(timesheetKeys.sheet(slug, data.id), data)
  }

  async function onSave() {
    setBusy("save")
    const data = await save()
    setBusy(null)
    if (data) {
      toast.success("Week saved.")
      refresh(data)
    }
  }

  async function onSubmit() {
    setBusy("submit")
    try {
      if (dirty || !sheet.id) {
        const saved = await save()
        if (!saved) return
      }
      const { data } = await api<{ data: TimesheetDetail }>(orgPath(slug, `/timesheet/weeks/${sheet.week_start}/submit`), { method: "POST" })
      toast.success(data.status === "approved" ? "Week submitted and approved." : "Week submitted for approval.")
      refresh(data)
      qc.invalidateQueries({ queryKey: ["approval", slug] })
    } catch (e) {
      showError(e, [])
    } finally {
      setBusy(null)
    }
  }

  async function copyLastWeek() {
    setBusy("copy")
    try {
      const prev = addDaysToKey(sheet.week_start, -7)
      const last = await qc.fetchQuery({
        queryKey: timesheetKeys.week(slug, prev),
        queryFn: async () => (await api<{ data: TimesheetDetail }>(orgPath(slug, `/timesheet/weeks/${prev}`))).data,
      })
      const have = new Set(rows.map((r) => r.key))
      const extra = rowsFrom(last)
        .filter((r) => !have.has(r.key) && (r.project_id === null || r.project_name))
        .map((r) => ({ ...r, cells: Array(7).fill("") }))
      if (!extra.length) toast.info(last.entries.length ? "Last week's rows are already here." : "Nothing was logged last week.")
      else {
        update((rs) => [...rs, ...extra])
        toast.success(`Added ${extra.length} ${extra.length === 1 ? "row" : "rows"} from last week.`)
      }
    } catch (e) {
      toast.error(errorMessage(e))
    } finally {
      setBusy(null)
    }
  }

  const label = (r: Row) => (r.project_id === null && !r.project_name ? "General" : (r.project_name ?? "Project"))
  const noteRow = rows.find((r) => r.key === noteFor)

  return (
    <div className="space-y-4">
      {sheet.status === "returned" && sheet.approval?.comment ? (
        <div role="status" className="rounded-lg border border-violet-500/40 bg-violet-500/5 px-4 py-3 text-sm">
          <p className="font-medium">Changes requested{sheet.approval.decided_by ? ` by ${sheet.approval.decided_by}` : ""}</p>
          <p className="mt-1 whitespace-pre-line text-muted-foreground">{sheet.approval.comment}</p>
        </div>
      ) : null}
      {sheet.status === "rejected" ? (
        <div role="status" className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm">
          <p className="font-medium">Rejected{sheet.approval?.decided_by ? ` by ${sheet.approval.decided_by}` : ""}</p>
          {sheet.approval?.comment ? <p className="mt-1 whitespace-pre-line text-muted-foreground">{sheet.approval.comment}</p> : null}
          <p className="mt-1 text-muted-foreground">Correct the week and save it to start a new submission.</p>
        </div>
      ) : null}
      <FormAlert message={error} />

      <Card className="gap-0 py-0">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[46rem] border-collapse text-sm">
            <caption className="sr-only">Hours for the week of {formatDateKey(sheet.week_start)}</caption>
            <thead>
              <tr className="border-b bg-muted/40 text-left">
                <th scope="col" className="px-3 py-2 font-medium">
                  Project / task
                </th>
                {days.map((d) => (
                  <th
                    key={d}
                    scope="col"
                    className={cn("w-16 px-1 py-2 text-center font-medium", d === today && "text-primary")}
                    aria-label={formatDateKey(d, { weekday: "long", year: undefined })}
                  >
                    <span className="block text-xs text-muted-foreground">{formatDateKey(d, { weekday: "short", day: undefined, month: undefined, year: undefined })}</span>
                    {formatDateKey(d, { year: undefined, month: undefined })}
                  </th>
                ))}
                <th scope="col" className="w-16 px-2 py-2 text-right font-medium">
                  Total
                </th>
                {editable ? (
                  <th scope="col" className="w-20">
                    <span className="sr-only">Actions</span>
                  </th>
                ) : null}
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={editable ? 10 : 9} className="px-3 py-8 text-center text-muted-foreground">
                    {editable ? "No time logged yet. Add a project row to start." : "No time logged for this week."}
                  </td>
                </tr>
              ) : null}
              {rows.map((r, i) => (
                <tr key={r.key} className="border-b last:border-b-0">
                  <th scope="row" className="max-w-56 px-3 py-2 text-left font-normal">
                    <span className="block truncate font-medium" title={label(r)}>
                      {label(r)}
                    </span>
                    {r.task_title ? (
                      <span className="block truncate text-xs text-muted-foreground" title={r.task_title}>
                        {r.task_title}
                      </span>
                    ) : null}
                    {r.note ? (
                      <span className="block truncate text-xs text-muted-foreground italic" title={r.note}>
                        {r.note}
                      </span>
                    ) : null}
                  </th>
                  {days.map((d, di) => {
                    const cellKey = `${r.key}|${di}`
                    const bad = parsed[i][di] === null || (parsed[i][di] ?? 0) > 1440 || Boolean(cellErrors[cellKey])
                    return (
                      <td key={d} className="px-1 py-1.5 text-center">
                        {editable ? (
                          <Input
                            inputMode="decimal"
                            value={r.cells[di]}
                            onChange={(e) => setCell(i, di, e.target.value)}
                            onBlur={() => {
                              const m = parseHours(r.cells[di])
                              if (m !== null && r.cells[di] !== formatHours(m)) setCell(i, di, formatHours(m))
                            }}
                            aria-label={`${label(r)}${r.task_title ? `, ${r.task_title}` : ""}, ${formatDateKey(d, { weekday: "long", year: undefined })}, hours`}
                            aria-invalid={bad || undefined}
                            title={cellErrors[cellKey] ?? (parsed[i][di] === null ? "Use hours like 7.5 or 7:30" : undefined)}
                            className={cn("h-8 px-1 text-center tabular-nums", bad && "border-destructive")}
                          />
                        ) : (
                          <span className="tabular-nums">{r.cells[di]}</span>
                        )}
                      </td>
                    )
                  })}
                  <td className="px-2 py-1.5 text-right font-medium tabular-nums">{formatHours(rowTotal(i)) || "0"}</td>
                  {editable ? (
                    <td className="px-1 py-1.5">
                      <div className="flex justify-end">
                        <Button variant="ghost" size="icon" className="size-8" aria-label={`Note for ${label(r)}`} onClick={() => setNoteFor(r.key)}>
                          <MessageSquareText aria-hidden className={cn(r.note && "text-primary")} />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-8"
                          aria-label={`Remove ${label(r)}${r.task_title ? `, ${r.task_title}` : ""}`}
                          onClick={() => update((rs) => rs.filter((x) => x.key !== r.key))}
                        >
                          <Trash2 aria-hidden />
                        </Button>
                      </div>
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t bg-muted/40">
                <th scope="row" className="px-3 py-2 text-left font-medium">
                  Daily total
                </th>
                {days.map((d, di) => (
                  <td key={d} className={cn("px-1 py-2 text-center tabular-nums", dayTotal(di) > 1440 && "font-semibold text-destructive")}>
                    {formatHours(dayTotal(di)) || "–"}
                  </td>
                ))}
                <td className="px-2 py-2 text-right font-semibold tabular-nums">{formatHours(total) || "0"}</td>
                {editable ? <td /> : null}
              </tr>
            </tfoot>
          </table>
        </div>
      </Card>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-muted-foreground">
          {formatDuration(total)} this week
          {invalid ? <span className="text-destructive"> · fix the highlighted cells (use hours like 7.5 or 7:30)</span> : null}
          {dirty && !invalid ? " · unsaved changes" : null}
        </p>
        <div className="flex flex-wrap gap-2">
          {editable ? (
            <>
              <Button variant="outline" onClick={() => setAdding(true)}>
                <Plus aria-hidden /> Add row
              </Button>
              <Button variant="outline" onClick={copyLastWeek} disabled={busy !== null}>
                {busy === "copy" ? <Spinner /> : <CopyPlus aria-hidden />} Copy last week&apos;s rows
              </Button>
              <Button variant="outline" onClick={onSave} disabled={busy !== null || invalid || !dirty}>
                {busy === "save" ? <Spinner /> : <Save aria-hidden />} Save
              </Button>
              {/* A rejected week is saved first (it becomes a draft), then submitted again. */}
              {sheet.status !== "rejected" ? (
                <Button onClick={onSubmit} disabled={busy !== null || invalid || total === 0}>
                  {busy === "submit" ? <Spinner /> : <Send aria-hidden />} {sheet.status === "returned" ? "Resubmit week" : "Submit week"}
                </Button>
              ) : null}
            </>
          ) : null}
          {sheet.permissions.withdraw && sheet.id ? <WithdrawButton sheet={sheet} /> : null}
          {sheet.approval?.can_view ? (
            <Button asChild variant="outline">
              <Link href={href(`/apps/approval/requests/${sheet.approval.id}`)}>
                <ExternalLink aria-hidden /> View approval
              </Link>
            </Button>
          ) : null}
        </div>
      </div>
      {sheet.status === "pending_approval" && sheet.approval?.current_step ? (
        <p className="text-sm text-muted-foreground">Waiting for: {sheet.approval.current_step}. Withdraw it if you need to make changes.</p>
      ) : null}

      <AddRowDialog
        open={adding}
        onOpenChange={setAdding}
        existing={new Set(rows.map((r) => r.key))}
        onAdd={(row) => update((rs) => [...rs, row])}
      />
      <Dialog open={noteRow !== undefined} onOpenChange={(o) => !o && setNoteFor(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Note</DialogTitle>
            <DialogDescription>
              What you worked on for {noteRow ? label(noteRow) : ""}
              {noteRow?.task_title ? ` · ${noteRow.task_title}` : ""} this week. Your approver sees it.
            </DialogDescription>
          </DialogHeader>
          {noteRow ? (
            <Input
              autoFocus
              maxLength={500}
              aria-label="Note"
              value={noteRow.note}
              onChange={(e) => update((rs) => rs.map((r) => (r.key === noteRow.key ? { ...r, note: e.target.value } : r)))}
              onKeyDown={(e) => e.key === "Enter" && setNoteFor(null)}
            />
          ) : null}
          <DialogFooter>
            <Button onClick={() => setNoteFor(null)}>Done</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function WithdrawButton({ sheet }: { sheet: TimesheetDetail }) {
  const { slug } = useWorkspace()
  const qc = useQueryClient()
  return (
    <ConfirmAction
      trigger={
        <Button variant="outline">
          <Undo2 aria-hidden /> Withdraw
        </Button>
      }
      title="Withdraw this week?"
      description="It goes back to a draft so you can change it. You will need to submit it again."
      confirmLabel="Withdraw"
      destructive={false}
      onConfirm={async () => {
        try {
          const { data } = await api<{ data: TimesheetDetail }>(orgPath(slug, `/timesheet/sheets/${sheet.id}/withdraw`), { method: "POST" })
          qc.setQueryData(timesheetKeys.week(slug, sheet.week_start), data)
          qc.setQueryData(timesheetKeys.sheet(slug, data.id!), data)
          qc.invalidateQueries({ queryKey: ["timesheet", slug, "sheets"] })
          qc.invalidateQueries({ queryKey: ["approval", slug] })
          toast.success("Week withdrawn. It is a draft again.")
        } catch (e) {
          toast.error(errorMessage(e))
        }
      }}
    />
  )
}

const GENERAL = "general"
const NO_TASK = "none"

function AddRowDialog({
  open,
  onOpenChange,
  existing,
  onAdd,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  existing: Set<string>
  onAdd: (row: Row) => void
}) {
  const { slug } = useWorkspace()
  const projects = useLoggableProjects(slug)
  const [project, setProject] = useState<string>(GENERAL)
  const [task, setTask] = useState<string>(NO_TASK)
  const projectId = project === GENERAL ? null : Number(project)
  const tasks = useProjectTasks(slug, projectId)
  const taskId = task === NO_TASK ? null : Number(task)
  const duplicate = existing.has(rowKey(projectId, taskId))

  function add(e: React.FormEvent) {
    e.preventDefault()
    if (duplicate) return
    onAdd({
      key: rowKey(projectId, taskId),
      project_id: projectId,
      task_id: taskId,
      project_name: projects.data?.find((p) => p.id === projectId)?.name ?? null,
      task_title: tasks.data?.find((t) => t.id === taskId)?.title ?? null,
      note: "",
      cells: Array(7).fill(""),
    })
    setTask(NO_TASK)
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={add} className="space-y-4">
          <DialogHeader>
            <DialogTitle>Add a row</DialogTitle>
            <DialogDescription>Pick a project you work on, or General for time outside projects (training, meetings, admin).</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="ts-project">Project</Label>
            <Select
              value={project}
              onValueChange={(v) => {
                setProject(v)
                setTask(NO_TASK)
              }}
            >
              <SelectTrigger id="ts-project" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={GENERAL}>General (no project)</SelectItem>
                {projects.data?.map((p) => (
                  <SelectItem key={p.id} value={String(p.id)}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {projects.isPending ? <p className="text-xs text-muted-foreground">Loading projects…</p> : null}
            {projects.data && projects.data.length === 0 ? (
              <p className="text-xs text-muted-foreground">You are not a member of any active project yet.</p>
            ) : null}
          </div>
          {projectId !== null ? (
            <div className="space-y-2">
              <Label htmlFor="ts-task">Task (optional)</Label>
              <Select value={task} onValueChange={setTask} disabled={tasks.isPending}>
                <SelectTrigger id="ts-task" className="w-full">
                  <SelectValue placeholder={tasks.isPending ? "Loading tasks…" : undefined} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_TASK}>No specific task</SelectItem>
                  {tasks.data?.map((t) => (
                    <SelectItem key={t.id} value={String(t.id)}>
                      {t.title}
                      {t.assigned_to_me ? " · yours" : ""}
                      {t.status === "done" ? " · done" : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : null}
          {duplicate ? <p className="text-sm text-destructive">This row is already on your timesheet.</p> : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={duplicate}>
              Add row
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
