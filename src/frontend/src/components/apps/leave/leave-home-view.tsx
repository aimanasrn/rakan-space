"use client"

import { useQueryClient } from "@tanstack/react-query"
import { CalendarDays, ChevronLeft, ChevronRight, Plus } from "lucide-react"
import Link from "next/link"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { useMemo, useState } from "react"
import { toast } from "sonner"
import { EmptyState, ErrorState, LoadingRows, UserAvatar } from "@/components/common"
import { PersonSelect } from "@/components/pickers"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Spinner } from "@/components/ui/spinner"
import { Switch } from "@/components/ui/switch"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { orgPath, useWorkspace } from "@/components/workspace/workspace-context"
import { useMemberOptions } from "@/hooks/use-workspace-data"
import { api, errorMessage } from "@/lib/api"
import { formatDateKey, todayKey } from "@/lib/datetime"
import type { LeaveBalance, LeaveCalendarEntry, LeaveSettings, LeaveSummary } from "@/lib/types"
import { cn } from "@/lib/utils"
import { useAppAbilities } from "../form/use-forms"
import { LoadError, ModuleHeader, Pager } from "../shared"
import { ApplyLeaveDialog, LeaveStatusBadge, TypeDot } from "./leave-parts"
import {
  addMonths,
  formatDays,
  formatLeaveDates,
  leaveKeys,
  monthGrid,
  useLeaveCalendar,
  useLeaveRequests,
  useLeaveSettings,
  useLeaveSummary,
} from "./use-leave"

type Tab = "mine" | "calendar" | "team" | "all" | "settings"

export function LeaveHomeView() {
  const { slug, org } = useWorkspace()
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()
  const app = useAppAbilities(slug, "leave")
  const isAdmin = app.can("admin")
  const [applying, setApplying] = useState(false)

  const tabs: { value: Tab; label: string; show: boolean }[] = [
    { value: "mine", label: "My leave", show: true },
    { value: "calendar", label: "Leave calendar", show: true },
    { value: "team", label: "Team", show: true },
    { value: "all", label: "All applications", show: isAdmin },
    { value: "settings", label: "Settings", show: isAdmin },
  ]
  const requested = params.get("tab") as Tab | null
  const tab: Tab = requested && tabs.some((t) => t.value === requested && t.show) ? requested : "mine"
  const thisMonth = todayKey(org.timezone).slice(0, 7)
  const requestedMonth = params.get("month")
  const month = requestedMonth && /^\d{4}-\d{2}$/.test(requestedMonth) ? requestedMonth : thisMonth

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
        <LoadError error={app.error} onRetry={() => app.refetch()} what="Leave app" />
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-4 md:p-8">
      <ModuleHeader
        app="leave"
        title="Leave"
        description="Apply for leave, check your balances and see who is away."
        actions={
          <Button onClick={() => setApplying(true)}>
            <Plus aria-hidden /> Apply for leave
          </Button>
        }
      />
      <Tabs value={tab} onValueChange={(v) => go({ tab: v, month: v === "calendar" ? month : null })}>
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
      {tab === "mine" ? <MyLeave /> : null}
      {tab === "calendar" ? <LeaveCalendarPanel month={month} onMonth={(m) => go({ tab: "calendar", month: m })} /> : null}
      {tab === "team" ? <RequestList scope="team" /> : null}
      {tab === "all" ? <RequestList scope="all" /> : null}
      {tab === "settings" ? <Settings /> : null}
      <ApplyLeaveDialog open={applying} onOpenChange={setApplying} />
    </div>
  )
}

// ------------------------------------------------------------------ My leave

function MyLeave() {
  const { slug } = useWorkspace()
  const [year, setYear] = useState<number | undefined>(undefined)
  const summary = useLeaveSummary(slug, { year })

  return (
    <div className="space-y-8">
      <section className="space-y-3" aria-labelledby="balances-title">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="balances-title" className="text-lg font-semibold">
            Leave balances
          </h2>
          {summary.data ? <YearSelect year={summary.data.year} onChange={setYear} /> : null}
        </div>
        {summary.isPending ? (
          <LoadingRows rows={6} />
        ) : summary.error ? (
          <ErrorState error={summary.error} onRetry={() => summary.refetch()} />
        ) : (
          <BalanceTable summary={summary.data} />
        )}
      </section>
      <section className="space-y-3" aria-labelledby="my-apps-title">
        <h2 id="my-apps-title" className="text-lg font-semibold">
          My applications
        </h2>
        <RequestList scope="mine" year={summary.data?.year} />
      </section>
    </div>
  )
}

function YearSelect({ year, onChange }: { year: number; onChange: (y: number) => void }) {
  const { org } = useWorkspace()
  const current = Number(todayKey(org.timezone).slice(0, 4))
  return (
    <Select value={String(year)} onValueChange={(v) => onChange(Number(v))}>
      <SelectTrigger className="w-28" aria-label="Year">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {[current - 1, current, current + 1].map((y) => (
          <SelectItem key={y} value={String(y)}>
            {y}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

function num(n: number | null) {
  return n === null ? "—" : String(Math.round(n * 10) / 10)
}

/** Eligible, taken, pending and balance per leave type. */
export function BalanceTable({ summary }: { summary: LeaveSummary }) {
  const rows = summary.types.filter((t) => t.is_active || t.taken > 0 || t.pending > 0)
  return (
    <div className="overflow-x-auto rounded-xl border">
      <table className="w-full min-w-[34rem] text-sm">
        <caption className="sr-only">Leave balances for {summary.year}</caption>
        <thead className="bg-muted/50 text-left text-xs text-muted-foreground uppercase">
          <tr>
            <th scope="col" className="px-4 py-2.5 font-medium">
              Leave type
            </th>
            <th scope="col" className="px-4 py-2.5 text-right font-medium">
              Eligible
            </th>
            <th scope="col" className="px-4 py-2.5 text-right font-medium">
              Taken
            </th>
            <th scope="col" className="px-4 py-2.5 text-right font-medium">
              Pending
            </th>
            <th scope="col" className="px-4 py-2.5 text-right font-medium">
              Balance
            </th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {rows.map((t) => (
            <BalanceRow key={t.id} t={t} />
          ))}
        </tbody>
      </table>
    </div>
  )
}

function BalanceRow({ t }: { t: LeaveBalance }) {
  const low = t.balance !== null && t.eligible !== null && t.eligible > 0 && t.balance / t.eligible <= 0.2
  return (
    <tr>
      <th scope="row" className="px-4 py-2.5 text-left font-medium">
        <span className="flex items-center gap-2">
          <TypeDot color={t.color} />
          {t.name}
          {t.adjusted ? <span className="text-xs font-normal text-muted-foreground">(adjusted)</span> : null}
          {!t.is_active ? <span className="text-xs font-normal text-muted-foreground">(no longer offered)</span> : null}
        </span>
      </th>
      <td className="px-4 py-2.5 text-right tabular-nums">{t.eligible === null ? "No limit" : num(t.eligible)}</td>
      <td className="px-4 py-2.5 text-right tabular-nums">{num(t.taken)}</td>
      <td className={cn("px-4 py-2.5 text-right tabular-nums", t.pending ? "text-amber-700 dark:text-amber-300" : "text-muted-foreground")}>{num(t.pending)}</td>
      <td className={cn("px-4 py-2.5 text-right font-semibold tabular-nums", low && "text-destructive")}>{t.balance === null ? "—" : num(t.balance)}</td>
    </tr>
  )
}

// ------------------------------------------------------------- Applications

function RequestList({ scope, year }: { scope: "mine" | "team" | "all"; year?: number }) {
  const { slug, href } = useWorkspace()
  const [status, setStatus] = useState(scope === "team" ? "open" : "all")
  const [q, setQ] = useState("")
  const [page, setPage] = useState(1)
  const list = useLeaveRequests(slug, { scope, status, year, q: scope === "mine" ? undefined : q || undefined, page })

  return (
    <div className="space-y-4">
      {scope === "team" ? <p className="text-sm text-muted-foreground">Leave of people who report to you, and applications you were asked to approve.</p> : null}
      <div className="flex flex-wrap items-center gap-3" role="search" aria-label="Filter applications">
        {scope !== "mine" ? (
          <>
            <Label htmlFor={`lv-search-${scope}`} className="sr-only">
              Search by person
            </Label>
            <Input id={`lv-search-${scope}`} placeholder="Search by person…" value={q} onChange={(e) => (setQ(e.target.value), setPage(1))} className="max-w-xs" />
          </>
        ) : null}
        <Select value={status} onValueChange={(v) => (setStatus(v), setPage(1))}>
          <SelectTrigger className="w-48" aria-label="Status">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Any status</SelectItem>
            <SelectItem value="open">Waiting for a decision</SelectItem>
            <SelectItem value="approved">Approved</SelectItem>
            <SelectItem value="returned">Returned</SelectItem>
            <SelectItem value="rejected">Rejected</SelectItem>
            <SelectItem value="cancelled">Cancelled</SelectItem>
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
            {list.data.data.map((l) => (
              <li key={l.id}>
                <Link href={href(`/apps/leave/requests/${l.id}`)} className="flex flex-wrap items-center gap-3 px-4 py-3 hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:outline-none">
                  {scope !== "mine" && l.user ? <UserAvatar user={l.user} /> : <TypeDot color={l.type?.color ?? "#71717a"} className="size-3" />}
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">
                      {scope !== "mine" && l.user ? `${l.user.name} · ` : ""}
                      {l.type?.name ?? "Leave"}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {formatLeaveDates(l)} · {formatDays(l.days)}
                    </p>
                  </div>
                  <LeaveStatusBadge status={l.status} />
                </Link>
              </li>
            ))}
          </ul>
          <Pager page={list.data.meta.current_page} lastPage={list.data.meta.last_page} onPage={setPage} />
        </>
      ) : (
        <EmptyState
          icon={CalendarDays}
          title={scope === "mine" ? "No applications yet" : "Nothing here"}
          description={scope === "mine" ? "Use “Apply for leave” to send your first application." : "No applications match these filters."}
        />
      )}
    </div>
  )
}

// ----------------------------------------------------------------- Calendar

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]

function LeaveCalendarPanel({ month, onMonth }: { month: string; onMonth: (m: string) => void }) {
  const { slug, href, org } = useWorkspace()
  const [scope, setScope] = useState<"everyone" | "team" | "mine">("everyone")
  const cal = useLeaveCalendar(slug, { month, scope })
  const days = useMemo(() => monthGrid(month), [month])
  const today = todayKey(org.timezone)
  const thisMonth = today.slice(0, 7)
  const entries = useMemo(() => (cal.data?.month === month ? cal.data.entries : []), [cal.data, month])

  // Entries per date (weekends skipped: leave only counts working days).
  const byDay = useMemo(() => {
    const map = new Map<string, LeaveCalendarEntry[]>()
    for (const day of days) {
      const dow = new Date(`${day}T00:00:00Z`).getUTCDay()
      if (dow === 0 || dow === 6) continue
      map.set(
        day,
        entries.filter((e) => e.start_date <= day && e.end_date >= day),
      )
    }
    return map
  }, [days, entries])

  const label = formatDateKey(`${month}-01`, { day: undefined, month: "long", year: "numeric" })

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon" onClick={() => onMonth(addMonths(month, -1))} aria-label="Previous month">
            <ChevronLeft />
          </Button>
          <h2 className="min-w-40 text-center text-lg font-semibold" aria-live="polite">
            {label}
          </h2>
          <Button variant="outline" size="icon" onClick={() => onMonth(addMonths(month, 1))} aria-label="Next month">
            <ChevronRight />
          </Button>
          {month !== thisMonth ? (
            <Button variant="ghost" size="sm" onClick={() => onMonth(thisMonth)}>
              Today
            </Button>
          ) : null}
          {cal.isFetching ? <Spinner /> : null}
        </div>
        <Select value={scope} onValueChange={(v) => setScope(v as typeof scope)}>
          <SelectTrigger className="w-44" aria-label="Show">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="everyone">Everyone</SelectItem>
            <SelectItem value="team">Me and my team</SelectItem>
            <SelectItem value="mine">Only me</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {cal.error ? (
        <ErrorState error={cal.error} onRetry={() => cal.refetch()} />
      ) : (
        <>
          {/* Month grid (decorative for screen readers: the list below has the same information). */}
          <div className="overflow-x-auto rounded-xl border" aria-hidden>
            <div className="grid min-w-[42rem] grid-cols-7 border-b bg-muted/50 text-xs font-medium text-muted-foreground">
              {WEEKDAYS.map((d) => (
                <div key={d} className="px-2 py-2 text-center">
                  {d}
                </div>
              ))}
            </div>
            <div className="grid min-w-[42rem] grid-cols-7">
              {days.map((day) => {
                const inMonth = day.slice(0, 7) === month
                const people = byDay.get(day)
                const weekend = people === undefined
                return (
                  <div
                    key={day}
                    className={cn(
                      "min-h-24 border-r border-b p-1.5 text-xs [&:nth-child(7n)]:border-r-0",
                      (!inMonth || weekend) && "bg-muted/30",
                      !inMonth && "text-muted-foreground/60",
                    )}
                  >
                    <div className={cn("mb-1 flex size-6 items-center justify-center rounded-full", day === today && "bg-primary font-semibold text-primary-foreground")}>
                      {Number(day.slice(8))}
                    </div>
                    {inMonth && people ? (
                      <ul className="space-y-0.5">
                        {people.slice(0, 3).map((e) => (
                          <li
                            key={e.id}
                            className={cn("truncate rounded px-1 py-0.5", e.status !== "approved" && "border border-dashed")}
                            style={{ backgroundColor: `${e.type?.color ?? "#71717a"}22`, borderColor: e.type?.color }}
                            title={`${e.user.name} · ${e.type?.name ?? "On leave"}${e.half_day !== "none" ? " (half day)" : ""}${e.status !== "approved" ? " · pending" : ""}`}
                          >
                            {e.user.name.split(" ")[0]}
                            {e.half_day !== "none" ? " ½" : ""}
                          </li>
                        ))}
                        {people.length > 3 ? <li className="px-1 text-muted-foreground">+{people.length - 3} more</li> : null}
                      </ul>
                    ) : null}
                  </div>
                )
              })}
            </div>
          </div>

          {/* Who is on leave this month. */}
          <section className="space-y-3" aria-labelledby="on-leave-title">
            <h3 id="on-leave-title" className="font-semibold">
              On leave in {label}
              {entries.length ? <span className="ml-2 text-sm font-normal text-muted-foreground">({new Set(entries.map((e) => e.user.id)).size} people)</span> : null}
            </h3>
            {cal.isPending ? (
              <LoadingRows rows={3} />
            ) : entries.length ? (
              <ul className="divide-y rounded-xl border">
                {entries.map((e) => {
                  const body = (
                    <>
                      <UserAvatar user={e.user} />
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-medium">{e.user.name}</p>
                        <p className="text-sm text-muted-foreground">
                          {formatLeaveDates(e)} · {formatDays(e.days)}
                        </p>
                      </div>
                      <span className="flex items-center gap-1.5 text-sm">
                        <TypeDot color={e.type?.color ?? "#71717a"} />
                        {e.type?.name ?? "On leave"}
                      </span>
                      {e.status !== "approved" ? <LeaveStatusBadge status={e.status} /> : null}
                    </>
                  )
                  return (
                    <li key={e.id}>
                      {e.can_view ? (
                        <Link href={href(`/apps/leave/requests/${e.id}`)} className="flex flex-wrap items-center gap-3 px-4 py-3 hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:outline-none">
                          {body}
                        </Link>
                      ) : (
                        <div className="flex flex-wrap items-center gap-3 px-4 py-3">{body}</div>
                      )}
                    </li>
                  )
                })}
              </ul>
            ) : (
              <EmptyState icon={CalendarDays} title="No one is on leave" description="Approved leave in this month will show here." />
            )}
          </section>
        </>
      )}
    </div>
  )
}

// ----------------------------------------------------------------- Settings

const DEFAULT = "__default__"

function Settings() {
  const { slug } = useWorkspace()
  const qc = useQueryClient()
  const settings = useLeaveSettings(slug, true)
  const [saving, setSaving] = useState(false)

  if (settings.isPending) return <LoadingRows rows={4} />
  if (settings.error) return <ErrorState error={settings.error} onRetry={() => settings.refetch()} />

  async function save(body: object, message: string) {
    setSaving(true)
    try {
      const { data } = await api<{ data: LeaveSettings }>(orgPath(slug, "/leave/settings"), { method: "PUT", body })
      qc.setQueryData(leaveKeys.settings(slug), data)
      qc.invalidateQueries({ queryKey: leaveKeys.all(slug) })
      toast.success(message)
    } catch (e) {
      toast.error(errorMessage(e))
    } finally {
      setSaving(false)
    }
  }

  const s = settings.data
  return (
    <div className="space-y-6">
      <TypeSettings key={JSON.stringify(s.types)} settings={s} saving={saving} onSave={(types) => save({ types }, "Leave types updated.")} />
      <MemberEntitlements />
      <Card className="max-w-2xl">
        <CardHeader>
          <CardTitle>Approval</CardTitle>
          <CardDescription>
            Applications go through this workflow. The default, &ldquo;Leave app approval&rdquo;, sends each application to the person&apos;s reporting manager (or to
            Owners and Admins when they have none). Edit workflows in the Approval app.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          <Label htmlFor="lv-workflow">Workflow</Label>
          <Select
            value={s.workflow_id ? String(s.workflow_id) : DEFAULT}
            onValueChange={(v) => save({ workflow_id: v === DEFAULT ? null : Number(v) }, "Leave approval updated.")}
            disabled={saving}
          >
            <SelectTrigger id="lv-workflow" className="w-full max-w-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {s.workflow_id ? null : <SelectItem value={DEFAULT}>Leave app approval (created on first application)</SelectItem>}
              {s.workflows.map((w) => (
                <SelectItem key={w.id} value={String(w.id)}>
                  {w.name} · {w.steps_count} {w.steps_count === 1 ? "step" : "steps"}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </CardContent>
      </Card>
    </div>
  )
}

function TypeSettings({ settings, saving, onSave }: { settings: LeaveSettings; saving: boolean; onSave: (types: object[]) => void }) {
  const [rows, setRows] = useState(settings.types.map((t) => ({ ...t, input: t.entitlement_days === null ? "" : String(t.entitlement_days) })))
  const invalid = rows.some((r) => r.input.trim() !== "" && !(Number(r.input) >= 0 && Number(r.input) <= 365 && Number.isInteger(Number(r.input) * 2)))

  return (
    <Card>
      <CardHeader>
        <CardTitle>Leave types</CardTitle>
        <CardDescription>Days each member is eligible for per year. Leave a box empty for no limit. Give individual members a different number below.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <ul className="divide-y rounded-xl border">
          {rows.map((r, i) => (
            <li key={r.id} className="flex flex-wrap items-center gap-3 px-4 py-2.5">
              <TypeDot color={r.color} />
              <span className={cn("min-w-0 flex-1 font-medium", !r.is_active && "text-muted-foreground")}>{r.name}</span>
              <Label htmlFor={`lt-days-${r.id}`} className="sr-only">
                Days per year for {r.name}
              </Label>
              <Input
                id={`lt-days-${r.id}`}
                inputMode="decimal"
                placeholder="No limit"
                className="w-28 text-right"
                value={r.input}
                onChange={(e) => setRows((all) => all.map((x, j) => (j === i ? { ...x, input: e.target.value } : x)))}
              />
              <span className="w-16 text-sm text-muted-foreground">days/yr</span>
              <Switch
                checked={r.is_active}
                onCheckedChange={(v) => setRows((all) => all.map((x, j) => (j === i ? { ...x, is_active: v } : x)))}
                aria-label={`Offer ${r.name}`}
              />
            </li>
          ))}
        </ul>
        {invalid ? <p className="text-sm text-destructive">Use whole or half days between 0 and 365.</p> : null}
        <Button
          disabled={saving || invalid}
          onClick={() => onSave(rows.map((r) => ({ id: r.id, is_active: r.is_active, entitlement_days: r.input.trim() === "" ? null : Number(r.input) })))}
        >
          {saving ? <Spinner /> : null} Save leave types
        </Button>
      </CardContent>
    </Card>
  )
}

function MemberEntitlements() {
  const { slug, org } = useWorkspace()
  const qc = useQueryClient()
  const members = useMemberOptions(slug)
  const people = (members.data ?? []).map((m) => m.user)
  const [userId, setUserId] = useState<number | null>(null)
  const [year, setYear] = useState(Number(todayKey(org.timezone).slice(0, 4)))
  const summary = useLeaveSummary(slug, { user_id: userId ?? undefined, year }, userId !== null)

  return (
    <Card>
      <CardHeader>
        <CardTitle>Member entitlements</CardTitle>
        <CardDescription>Give one person a different number of days for a year, e.g. to grant off-in-lieu days or carry forward annual leave.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="w-full max-w-xs space-y-1.5">
            <Label htmlFor="ent-member">Member</Label>
            <PersonSelect id="ent-member" people={people} value={userId} onChange={setUserId} placeholder="Choose a member" allowNone={false} />
          </div>
          <div className="space-y-1.5">
            <Label>Year</Label>
            <YearSelect year={year} onChange={setYear} />
          </div>
        </div>
        {userId === null ? null : summary.isPending ? (
          <LoadingRows rows={4} />
        ) : summary.error ? (
          <ErrorState error={summary.error} onRetry={() => summary.refetch()} />
        ) : (
          <EntitlementEditor
            key={`${userId}:${year}:${summary.dataUpdatedAt}`}
            summary={summary.data}
            onSaved={() => qc.invalidateQueries({ queryKey: leaveKeys.all(slug) })}
          />
        )}
      </CardContent>
    </Card>
  )
}

function EntitlementEditor({ summary, onSaved }: { summary: LeaveSummary; onSaved: () => void }) {
  const { slug } = useWorkspace()
  const [inputs, setInputs] = useState<Record<number, string>>(() =>
    Object.fromEntries(summary.types.filter((t) => t.adjusted).map((t) => [t.id, String(t.eligible ?? "")])),
  )
  const [saving, setSaving] = useState(false)

  async function save() {
    setSaving(true)
    try {
      await api(orgPath(slug, "/leave/entitlements"), {
        method: "PUT",
        body: {
          user_id: summary.user.id,
          year: summary.year,
          entitlements: summary.types.map((t) => ({ leave_type_id: t.id, days: inputs[t.id]?.trim() ? Number(inputs[t.id]) : null })),
        },
      })
      toast.success(`Entitlements for ${summary.user.name} saved.`)
      onSaved()
    } catch (e) {
      toast.error(errorMessage(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-3">
      <ul className="divide-y rounded-xl border">
        {summary.types.map((t) => (
          <li key={t.id} className="flex flex-wrap items-center gap-3 px-4 py-2.5 text-sm">
            <TypeDot color={t.color} />
            <span className="min-w-0 flex-1 font-medium">{t.name}</span>
            <span className="text-muted-foreground tabular-nums">
              taken {num(t.taken)}
              {t.pending ? ` · pending ${num(t.pending)}` : ""}
            </span>
            <Label htmlFor={`ent-${t.id}`} className="sr-only">
              Days for {t.name}
            </Label>
            <Input
              id={`ent-${t.id}`}
              inputMode="decimal"
              className="w-28 text-right"
              placeholder="Default"
              value={inputs[t.id] ?? ""}
              onChange={(e) => setInputs((all) => ({ ...all, [t.id]: e.target.value }))}
            />
          </li>
        ))}
      </ul>
      <p className="text-xs text-muted-foreground">Leave a box empty to use the leave type&apos;s default.</p>
      <Button onClick={save} disabled={saving}>
        {saving ? <Spinner /> : null} Save for {summary.user.name}
      </Button>
    </div>
  )
}
