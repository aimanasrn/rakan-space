"use client"

import { useQuery } from "@tanstack/react-query"
import { BarChart3, ShieldAlert } from "lucide-react"
import Link from "next/link"
import { useState } from "react"
import { EmptyState, ErrorState, LoadingRows, PageHeader, PriorityBadge } from "@/components/common"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Progress } from "@/components/ui/progress"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { orgPath, useWorkspace } from "@/components/workspace/workspace-context"
import { api } from "@/lib/api"
import { addDaysToKey, formatDateKey, todayKey } from "@/lib/datetime"
import type { TaskPriority } from "@/lib/types"

interface Report {
  range_days: number
  timezone: string
  totals: { tasks: number; completed: number; completed_in_range: number; overdue: number; projects: number }
  by_status: { status: string; label: string; total: number }[]
  completed_trend: { day: string; total: number }[]
  projects: { id: number; name: string; status: string; target_date: string | null; total: number; done: number; overdue: number; percent: number }[]
  overdue_tasks: { id: number; title: string; due_date: string; priority: TaskPriority; project_id: number; project_name: string; assignee_name: string | null }[]
}

export function ReportsView() {
  const { slug, org, href } = useWorkspace()
  const [days, setDays] = useState("30")
  const report = useQuery({
    queryKey: ["reports", slug, days],
    enabled: org.permissions.view_reports,
    queryFn: async () => (await api<{ data: Report }>(orgPath(slug, "/reports"), { query: { days } })).data,
  })

  if (!org.permissions.view_reports) {
    return (
      <div className="p-4 md:p-8">
        <EmptyState icon={ShieldAlert} title="Reports are for managers" description="Ask an admin if you need access to workspace reports." />
      </div>
    )
  }

  const r = report.data

  return (
    <div className="space-y-6 p-4 md:p-8">
      <PageHeader
        title="Reports"
        description={org.permissions.manage_members ? "All projects in this workspace." : "Projects you can access."}
        actions={
          <Select value={days} onValueChange={setDays}>
            <SelectTrigger className="w-40" aria-label="Date range">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="7">Last 7 days</SelectItem>
              <SelectItem value="30">Last 30 days</SelectItem>
              <SelectItem value="90">Last 90 days</SelectItem>
              <SelectItem value="365">Last 12 months</SelectItem>
            </SelectContent>
          </Select>
        }
      />
      {report.error ? <ErrorState error={report.error} onRetry={() => report.refetch()} /> : null}
      {report.isLoading || !r ? (
        <LoadingRows rows={6} />
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label="Total tasks" value={r.totals.tasks} />
            <Stat label={`Completed (last ${r.range_days} days)`} value={r.totals.completed_in_range} />
            <Stat label="Overdue" value={r.totals.overdue} danger={r.totals.overdue > 0} />
            <Stat label="Active projects" value={r.totals.projects} />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Tasks by status</CardTitle>
                <CardDescription>Across active (non-archived) projects.</CardDescription>
              </CardHeader>
              <CardContent>
                <StatusBars rows={r.by_status} />
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Tasks completed per day</CardTitle>
                <CardDescription>Last {r.range_days} days, {r.timezone.replace("_", " ")} time.</CardDescription>
              </CardHeader>
              <CardContent>
                <TrendColumns data={r.completed_trend} days={Math.min(r.range_days, 90)} timezone={r.timezone} />
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Project progress</CardTitle>
              <CardDescription>Progress = completed tasks ÷ all tasks in the project. Overdue = not done and past the due date.</CardDescription>
            </CardHeader>
            <CardContent>
              {r.projects.length ? (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Project</TableHead>
                        <TableHead className="w-48">Progress</TableHead>
                        <TableHead className="text-right">Done</TableHead>
                        <TableHead className="text-right">Total</TableHead>
                        <TableHead className="text-right">Overdue</TableHead>
                        <TableHead>Target</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {r.projects.map((p) => (
                        <TableRow key={p.id}>
                          <TableCell>
                            <Link href={href(`/projects/${p.id}`)} className="font-medium hover:underline">
                              {p.name}
                            </Link>
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center gap-2">
                              <Progress value={p.percent} className="flex-1" aria-label={`${p.name} ${p.percent}%`} />
                              <span className="w-10 text-right text-xs tabular-nums">{p.percent}%</span>
                            </div>
                          </TableCell>
                          <TableCell className="text-right tabular-nums">{p.done}</TableCell>
                          <TableCell className="text-right tabular-nums">{p.total}</TableCell>
                          <TableCell className={p.overdue ? "text-right font-medium text-destructive tabular-nums" : "text-right tabular-nums"}>{p.overdue}</TableCell>
                          <TableCell className="whitespace-nowrap text-muted-foreground">{p.target_date ? formatDateKey(p.target_date) : "—"}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              ) : (
                <EmptyState icon={BarChart3} title="No projects yet" className="py-8" />
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Overdue tasks</CardTitle>
              <CardDescription>Oldest first (up to 25).</CardDescription>
            </CardHeader>
            <CardContent>
              {r.overdue_tasks.length ? (
                <ul className="divide-y">
                  {r.overdue_tasks.map((t) => (
                    <li key={t.id}>
                      <Link href={href(`/projects/${t.project_id}?task=${t.id}`)} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 hover:bg-muted/50">
                        <span className="min-w-0 basis-full truncate font-medium sm:flex-1 sm:basis-auto">{t.title}</span>
                        <span className="text-xs text-muted-foreground">{t.project_name}</span>
                        <span className="text-xs text-muted-foreground">{t.assignee_name ?? "Unassigned"}</span>
                        <PriorityBadge priority={t.priority} />
                        <span className="text-xs font-medium text-destructive">Due {formatDateKey(t.due_date)}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="py-6 text-center text-sm text-muted-foreground">No overdue tasks. 🎉</p>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  )
}

function Stat({ label, value, danger }: { label: string; value: number; danger?: boolean }) {
  return (
    <Card>
      <CardContent>
        <p className={danger ? "text-3xl font-semibold text-destructive tabular-nums" : "text-3xl font-semibold tabular-nums"}>{value}</p>
        <p className="text-sm text-muted-foreground">{label}</p>
      </CardContent>
    </Card>
  )
}

/** Single-series horizontal bars: one hue, value labels in text ink, accessible as a list. */
function StatusBars({ rows }: { rows: { status: string; label: string; total: number }[] }) {
  const max = Math.max(1, ...rows.map((r) => r.total))
  return (
    <ul className="space-y-3" aria-label="Tasks by status">
      {rows.map((r) => (
        <li key={r.status} className="grid grid-cols-[6.5rem_1fr_2.5rem] items-center gap-3 text-sm" title={`${r.label}: ${r.total} tasks`}>
          <span className="text-muted-foreground">{r.label}</span>
          <span className="h-3 rounded-r-[4px] bg-muted" aria-hidden>
            <span className="block h-3 rounded-r-[4px] bg-chart-1 transition-[width]" style={{ width: `${(r.total / max) * 100}%`, minWidth: r.total ? 4 : 0 }} />
          </span>
          <span className="text-right font-medium tabular-nums">{r.total}</span>
        </li>
      ))}
    </ul>
  )
}

/** Single-series column chart with a hover/focus tooltip and a data table fallback. */
function TrendColumns({ data, days, timezone }: { data: { day: string; total: number }[]; days: number; timezone: string }) {
  const [active, setActive] = useState<number | null>(null)
  const end = todayKey(timezone)
  const byDay = new Map(data.map((d) => [d.day, d.total]))
  const series = Array.from({ length: days }, (_, i) => {
    const day = addDaysToKey(end, i - days + 1)
    return { day, total: byDay.get(day) ?? 0 }
  })
  const max = Math.max(1, ...series.map((s) => s.total))
  const total = series.reduce((s, d) => s + d.total, 0)

  if (!total) return <p className="py-10 text-center text-sm text-muted-foreground">No tasks completed in this period.</p>

  return (
    <figure>
      <div className="relative">
        <div className="flex h-40 items-end gap-[2px] border-b border-border" role="img" aria-label={`${total} tasks completed in the last ${days} days. Peak ${max} in a day.`}>
          {series.map((s, i) => (
            <button
              key={s.day}
              type="button"
              className="group relative flex h-full flex-1 items-end focus-visible:outline-none"
              onMouseEnter={() => setActive(i)}
              onMouseLeave={() => setActive(null)}
              onFocus={() => setActive(i)}
              onBlur={() => setActive(null)}
              aria-label={`${formatDateKey(s.day)}: ${s.total} completed`}
            >
              <span
                className="w-full rounded-t-[4px] bg-chart-1 group-hover:opacity-80 group-focus-visible:ring-2 group-focus-visible:ring-ring"
                style={{ height: `${(s.total / max) * 100}%`, minHeight: s.total ? 2 : 0 }}
              />
            </button>
          ))}
        </div>
        {active !== null ? (
          <div
            className="pointer-events-none absolute -top-2 z-10 -translate-x-1/2 -translate-y-full rounded-md border bg-popover px-2 py-1 text-xs shadow-sm"
            style={{ left: `${((active + 0.5) / series.length) * 100}%` }}
            role="status"
          >
            <span className="block font-medium">{series[active].total} completed</span>
            <span className="text-muted-foreground">{formatDateKey(series[active].day)}</span>
          </div>
        ) : null}
      </div>
      <figcaption className="mt-2 flex justify-between text-xs text-muted-foreground">
        <span>{formatDateKey(series[0].day, { year: undefined })}</span>
        <span>
          {total} total · max {max}/day
        </span>
        <span>{formatDateKey(series[series.length - 1].day, { year: undefined })}</span>
      </figcaption>
      <details className="mt-3 text-sm">
        <summary className="cursor-pointer text-muted-foreground">Show as table</summary>
        <table className="mt-2 w-full text-left text-xs">
          <thead>
            <tr>
              <th className="py-1 font-medium">Date</th>
              <th className="py-1 text-right font-medium">Completed</th>
            </tr>
          </thead>
          <tbody>
            {series
              .filter((s) => s.total)
              .map((s) => (
                <tr key={s.day} className="border-t">
                  <td className="py-1">{formatDateKey(s.day)}</td>
                  <td className="py-1 text-right tabular-nums">{s.total}</td>
                </tr>
              ))}
          </tbody>
        </table>
      </details>
    </figure>
  )
}
