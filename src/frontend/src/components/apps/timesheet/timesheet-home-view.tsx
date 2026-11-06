"use client"

import { useQueryClient } from "@tanstack/react-query"
import { CalendarClock, Download, Users } from "lucide-react"
import Link from "next/link"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { useState } from "react"
import { toast } from "sonner"
import { EmptyState, ErrorState, LoadingRows, UserAvatar } from "@/components/common"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Spinner } from "@/components/ui/spinner"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { orgPath, useWorkspace } from "@/components/workspace/workspace-context"
import { api, buildUrl, errorMessage } from "@/lib/api"
import { addDaysToKey, formatDateKey, todayKey } from "@/lib/datetime"
import type { TimesheetReportGroup, TimesheetSettings } from "@/lib/types"
import { useAppAbilities } from "../form/use-forms"
import { LoadError, ModuleHeader, Pager, StatusBadge } from "../shared"
import { formatDuration, mondayOf, timesheetKeys, useSheets, useTimesheetReport, useTimesheetSettings } from "./use-timesheets"
import { MyWeek } from "./week-editor"

type Tab = "week" | "history" | "team" | "all" | "reports" | "settings"

export function TimesheetHomeView() {
  const { slug, org } = useWorkspace()
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()
  const app = useAppAbilities(slug, "timesheet")
  const isAdmin = app.can("admin")

  const tabs: { value: Tab; label: string; show: boolean }[] = [
    { value: "week", label: "My week", show: true },
    { value: "history", label: "My timesheets", show: true },
    { value: "team", label: "Team", show: true },
    { value: "all", label: "All timesheets", show: isAdmin },
    { value: "reports", label: "Reports", show: true },
    { value: "settings", label: "Settings", show: isAdmin },
  ]
  const requested = params.get("tab") as Tab | null
  const tab: Tab = requested && tabs.some((t) => t.value === requested && t.show) ? requested : "week"
  const current = mondayOf(todayKey(org.timezone))
  const requestedWeek = params.get("week")
  const week = requestedWeek && /^\d{4}-\d{2}-\d{2}$/.test(requestedWeek) ? mondayOf(requestedWeek) : current

  const go = (next: Record<string, string | null>) => {
    const q = new URLSearchParams(params.toString())
    for (const [k, v] of Object.entries(next)) {
      if (v === null) q.delete(k)
      else q.set(k, v)
    }
    router.replace(`${pathname}?${q.toString()}`, { scroll: false })
  }

  if (app.error) {
    return (
      <div className="mx-auto max-w-6xl p-4 md:p-8">
        <LoadError error={app.error} onRetry={() => app.refetch()} what="Timesheet app" />
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-4 md:p-8">
      <ModuleHeader app="timesheet" title="Timesheet" description="Log your hours each week and send them for approval." />
      <Tabs value={tab} onValueChange={(v) => go({ tab: v, week: v === "week" ? week : null })}>
        <TabsList className="flex-wrap">
          {tabs
            .filter((t) => t.show)
            .map((t) => (
              <TabsTrigger key={t.value} value={t.value}>
                {t.label}
              </TabsTrigger>
            ))}
        </TabsList>
      </Tabs>
      {tab === "week" ? <MyWeek week={week > current ? current : week} onWeekChange={(w) => go({ tab: "week", week: w })} /> : null}
      {tab === "history" ? <SheetList scope="mine" /> : null}
      {tab === "team" ? <SheetList scope="team" /> : null}
      {tab === "all" ? <SheetList scope="all" /> : null}
      {tab === "reports" ? <Reports isAdmin={isAdmin} /> : null}
      {tab === "settings" ? <Settings /> : null}
    </div>
  )
}

function SheetList({ scope }: { scope: "mine" | "team" | "all" }) {
  const { slug, href } = useWorkspace()
  const [status, setStatus] = useState(scope === "mine" ? "all" : "submitted")
  const [q, setQ] = useState("")
  const [page, setPage] = useState(1)
  const list = useSheets(slug, { scope, status, q: scope === "mine" ? undefined : q || undefined, page })

  return (
    <div className="space-y-4">
      {scope === "team" ? (
        <p className="text-sm text-muted-foreground">Timesheets of people who report to you, and weeks you were asked to approve.</p>
      ) : null}
      <div className="flex flex-wrap items-center gap-3" role="search" aria-label="Filter timesheets">
        {scope !== "mine" ? (
          <>
            <Label htmlFor={`ts-search-${scope}`} className="sr-only">
              Search by person
            </Label>
            <Input
              id={`ts-search-${scope}`}
              placeholder="Search by person…"
              value={q}
              onChange={(e) => (setQ(e.target.value), setPage(1))}
              className="max-w-xs"
            />
          </>
        ) : null}
        <Select value={status} onValueChange={(v) => (setStatus(v), setPage(1))}>
          <SelectTrigger className="w-44" aria-label="Status">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Any status</SelectItem>
            <SelectItem value="submitted">Submitted (not drafts)</SelectItem>
            <SelectItem value="pending_approval">Pending approval</SelectItem>
            <SelectItem value="approved">Approved</SelectItem>
            <SelectItem value="returned">Returned</SelectItem>
            <SelectItem value="rejected">Rejected</SelectItem>
            <SelectItem value="draft">Draft</SelectItem>
          </SelectContent>
        </Select>
      </div>
      {list.isPending ? (
        <LoadingRows rows={4} />
      ) : list.error ? (
        <ErrorState error={list.error} onRetry={() => list.refetch()} />
      ) : list.data.data.length ? (
        <>
          <ul className="divide-y rounded-xl border">
            {list.data.data.map((s) => (
              <li key={s.id}>
                <Link
                  href={scope === "mine" && s.permissions.edit ? href(`/apps/timesheet?tab=week&week=${s.week_start}`) : href(`/apps/timesheet/sheets/${s.id}`)}
                  className="flex flex-col gap-2 p-4 hover:bg-muted/40 focus-visible:bg-muted/40 sm:flex-row sm:items-center"
                >
                  {scope !== "mine" && s.user ? (
                    <span className="flex min-w-0 items-center gap-2 sm:w-56">
                      <UserAvatar user={s.user} className="size-7" />
                      <span className="truncate font-medium">{s.user.name}</span>
                    </span>
                  ) : null}
                  <span className="flex-1 text-sm">
                    Week of {formatDateKey(s.week_start)}
                    <span className="text-muted-foreground"> · {formatDateKey(s.week_start, { year: undefined })} – {formatDateKey(s.week_end, { year: undefined })}</span>
                  </span>
                  <span className="text-sm font-medium tabular-nums sm:w-24 sm:text-right">{formatDuration(s.total_minutes)}</span>
                  <StatusBadge status={s.status} className="sm:w-32 sm:justify-center" />
                </Link>
              </li>
            ))}
          </ul>
          <Pager page={page} lastPage={list.data.meta.last_page} onPage={setPage} />
        </>
      ) : (
        <EmptyState
          icon={scope === "mine" ? CalendarClock : Users}
          title={scope === "mine" ? "No timesheets yet" : "Nothing to show"}
          description={
            scope === "mine"
              ? "Weeks you log time for appear here."
              : scope === "team"
                ? "When people who report to you submit their weeks, they appear here."
                : "No timesheets match these filters."
          }
        />
      )}
    </div>
  )
}

type Range = "this_month" | "last_month" | "last_4_weeks" | "custom"

function rangeFor(range: Range, today: string): { from: string; to: string } {
  const [y, m] = today.split("-").map(Number)
  const iso = (yy: number, mm: number, dd: number) => new Date(Date.UTC(yy, mm - 1, dd)).toISOString().slice(0, 10)
  if (range === "last_month") return { from: iso(y, m - 1, 1), to: iso(y, m, 0) }
  if (range === "last_4_weeks") {
    const monday = mondayOf(today)
    return { from: addDaysToKey(monday, -21), to: addDaysToKey(monday, 6) }
  }
  return { from: iso(y, m, 1), to: iso(y, m + 1, 0) }
}

const GROUPS: { value: TimesheetReportGroup; label: string }[] = [
  { value: "project", label: "Project" },
  { value: "member", label: "Person" },
  { value: "task", label: "Task" },
  { value: "week", label: "Week" },
]

function Reports({ isAdmin }: { isAdmin: boolean }) {
  const { slug, org } = useWorkspace()
  const today = todayKey(org.timezone)
  const [range, setRange] = useState<Range>("this_month")
  const [custom, setCustom] = useState(() => rangeFor("this_month", today))
  const [group, setGroup] = useState<TimesheetReportGroup>("project")
  const [status, setStatus] = useState<"submitted" | "approved">("submitted")
  const { from, to } = range === "custom" ? custom : rangeFor(range, today)
  const validRange = Boolean(from && to && from <= to)
  const report = useTimesheetReport(slug, { from, to, group_by: group, status })
  const max = Math.max(1, ...(report.data?.rows.map((r) => r.minutes) ?? [1]))
  const csvUrl = buildUrl(orgPath(slug, "/timesheet/report"), { from, to, status, format: "csv" })

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        {isAdmin
          ? "Hours from every submitted timesheet in the workspace. Drafts are not counted."
          : "Your own hours, your team's, and all hours on projects you manage. Drafts are not counted."}
      </p>
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <Label htmlFor="ts-range">Period</Label>
          <Select value={range} onValueChange={(v) => setRange(v as Range)}>
            <SelectTrigger id="ts-range" className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="this_month">This month</SelectItem>
              <SelectItem value="last_month">Last month</SelectItem>
              <SelectItem value="last_4_weeks">Last 4 weeks</SelectItem>
              <SelectItem value="custom">Custom dates</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {range === "custom" ? (
          <>
            <div className="space-y-1">
              <Label htmlFor="ts-from">From</Label>
              <Input id="ts-from" type="date" value={custom.from} onChange={(e) => setCustom((c) => ({ ...c, from: e.target.value }))} className="w-40" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="ts-to">To</Label>
              <Input id="ts-to" type="date" value={custom.to} onChange={(e) => setCustom((c) => ({ ...c, to: e.target.value }))} className="w-40" />
            </div>
          </>
        ) : null}
        <div className="space-y-1">
          <Label htmlFor="ts-group">Group by</Label>
          <Select value={group} onValueChange={(v) => setGroup(v as TimesheetReportGroup)}>
            <SelectTrigger id="ts-group" className="w-32">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {GROUPS.map((g) => (
                <SelectItem key={g.value} value={g.value}>
                  {g.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="ts-status">Include</Label>
          <Select value={status} onValueChange={(v) => setStatus(v as "submitted" | "approved")}>
            <SelectTrigger id="ts-status" className="w-48">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="submitted">Submitted and approved</SelectItem>
              <SelectItem value="approved">Approved only</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {validRange ? (
          <Button asChild variant="outline" className="sm:ml-auto">
            <a href={csvUrl}>
              <Download aria-hidden /> Export CSV
            </a>
          </Button>
        ) : null}
      </div>

      {!validRange ? (
        <p className="text-sm text-destructive" role="alert">
          Choose a start date on or before the end date.
        </p>
      ) : report.isPending ? (
        <LoadingRows rows={4} />
      ) : report.error ? (
        <ErrorState error={report.error} onRetry={() => report.refetch()} />
      ) : (
        <Card>
          <CardHeader>
            <CardTitle className="tabular-nums">{formatDuration(report.data.total_minutes)}</CardTitle>
            <CardDescription>
              {formatDateKey(report.data.from)} – {formatDateKey(report.data.to)} · {report.data.members}{" "}
              {report.data.members === 1 ? "person" : "people"}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {report.data.rows.length ? (
              <ul className="space-y-3" aria-label={`Hours by ${GROUPS.find((g) => g.value === group)?.label.toLowerCase()}`}>
                {report.data.rows.map((r) => (
                  <li key={r.key} className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-1 text-sm">
                    <span className="min-w-0 truncate">
                      <span className="font-medium">{r.label}</span>
                      {r.sublabel ? <span className="text-muted-foreground"> · {r.sublabel}</span> : null}
                    </span>
                    <span className="text-right tabular-nums">
                      {formatDuration(r.minutes)}
                      <span className="ml-2 text-xs text-muted-foreground">{Math.round((r.minutes / Math.max(1, report.data.total_minutes)) * 100)}%</span>
                    </span>
                    <span className="col-span-2 h-2 overflow-hidden rounded-full bg-muted" aria-hidden>
                      <span className="block h-full rounded-full bg-amber-500" style={{ width: `${(r.minutes / max) * 100}%` }} />
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="py-6 text-center text-sm text-muted-foreground">No submitted hours in this period.</p>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  )
}

const DEFAULT = "default"

function Settings() {
  const { slug } = useWorkspace()
  const qc = useQueryClient()
  const settings = useTimesheetSettings(slug, true)
  const [saving, setSaving] = useState(false)

  if (settings.isPending) return <LoadingRows rows={2} />
  if (settings.error) return <ErrorState error={settings.error} onRetry={() => settings.refetch()} />

  async function choose(value: string) {
    setSaving(true)
    try {
      const { data } = await api<{ data: TimesheetSettings }>(orgPath(slug, "/timesheet/settings"), {
        method: "PUT",
        body: { workflow_id: value === DEFAULT ? null : Number(value) },
      })
      qc.setQueryData(timesheetKeys.settings(slug), data)
      toast.success("Timesheet approval updated.")
    } catch (e) {
      toast.error(errorMessage(e))
    } finally {
      setSaving(false)
    }
  }

  const s = settings.data
  return (
    <Card className="max-w-2xl">
      <CardHeader>
        <CardTitle>Approval</CardTitle>
        <CardDescription>
          Submitted weeks go through this workflow. The default, &ldquo;Timesheet approval&rdquo;, sends each week to the person&apos;s reporting
          manager (or to Owners and Admins when they have none). Edit workflows in the Approval app.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        <Label htmlFor="ts-workflow">Workflow</Label>
        <div className="flex items-center gap-2">
          <Select value={s.workflow_id ? String(s.workflow_id) : DEFAULT} onValueChange={choose} disabled={saving}>
            <SelectTrigger id="ts-workflow" className="w-full max-w-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {s.workflow_id ? null : <SelectItem value={DEFAULT}>Timesheet approval (created on first submit)</SelectItem>}
              {s.workflows.map((w) => (
                <SelectItem key={w.id} value={String(w.id)}>
                  {w.name} · {w.steps_count} {w.steps_count === 1 ? "step" : "steps"}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {saving ? <Spinner /> : null}
        </div>
      </CardContent>
    </Card>
  )
}
