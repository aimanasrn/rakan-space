"use client"

import { useQueryClient } from "@tanstack/react-query"
import { ArrowDown, ArrowRightLeft, ArrowUp, Building2, CalendarCheck, Contact as ContactIcon, Plus, Trash2, TrendingUp } from "lucide-react"
import Link from "next/link"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { useState } from "react"
import { toast } from "sonner"
import { EmptyState, ErrorState, LoadingRows, UserAvatar } from "@/components/common"
import { FormAlert } from "@/components/form"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Spinner } from "@/components/ui/spinner"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { orgPath, useWorkspace } from "@/components/workspace/workspace-context"
import { api, errorMessage } from "@/lib/api"
import { daysUntil, formatDateKey } from "@/lib/datetime"
import type { CrmOpportunity, CrmStage, CrmSummary, StageKind } from "@/lib/types"
import { cn } from "@/lib/utils"
import { LoadError, ModuleHeader, Pager } from "../shared"
import { AccountDialog, ActivityItem, ContactDialog, LostReasonDialog, OpportunityDialog } from "./crm-forms"
import { crmKeys, formatMoney, formatMonth, useAccounts, useBoard, useContacts, useCrmSummary, useForecast, useMyCrmTasks } from "./use-crm"

type Tab = "pipeline" | "accounts" | "contacts" | "forecast" | "tasks" | "settings"

export function OpportunityHomeView() {
  const { slug } = useWorkspace()
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()
  const summary = useCrmSummary(slug)

  if (summary.isPending) {
    return (
      <div className="mx-auto max-w-7xl p-4 md:p-8">
        <LoadingRows rows={5} />
      </div>
    )
  }
  if (summary.error) {
    return (
      <div className="mx-auto max-w-7xl p-4 md:p-8">
        <LoadError error={summary.error} onRetry={() => summary.refetch()} what="Opportunity app" />
      </div>
    )
  }

  const s = summary.data
  const tabs: { value: Tab; label: string; count?: number; show: boolean }[] = [
    { value: "pipeline", label: "Pipeline", show: true },
    { value: "forecast", label: "Forecast", show: true },
    { value: "tasks", label: "My follow-ups", count: s.open_tasks, show: true },
    { value: "accounts", label: "Accounts", show: true },
    { value: "contacts", label: "Contacts", show: true },
    { value: "settings", label: "Stages", show: s.can_manage_pipeline },
  ]
  const requested = params.get("tab") as Tab | null
  const tab: Tab = requested && tabs.some((t) => t.value === requested && t.show) ? requested : "pipeline"

  return (
    <div className="mx-auto max-w-7xl space-y-6 p-4 md:p-8">
      <ModuleHeader app="opportunity" title="Opportunity" description="Track deals from first contact to signed." />
      <Tabs value={tab} onValueChange={(v) => router.replace(`${pathname}?tab=${v}`, { scroll: false })}>
        <TabsList className="flex-wrap">
          {tabs
            .filter((t) => t.show)
            .map((t) => (
              <TabsTrigger key={t.value} value={t.value}>
                {t.label}
                {t.count ? <span className="ml-1.5 rounded-full bg-primary/10 px-1.5 text-xs tabular-nums">{t.count}</span> : null}
              </TabsTrigger>
            ))}
        </TabsList>
      </Tabs>
      {tab === "pipeline" ? <Pipeline summary={s} /> : null}
      {tab === "forecast" ? <Forecast summary={s} /> : null}
      {tab === "tasks" ? <MyTasks /> : null}
      {tab === "accounts" ? <Accounts summary={s} /> : null}
      {tab === "contacts" ? <Contacts summary={s} /> : null}
      {tab === "settings" ? <StageSettings key={JSON.stringify(s.stages)} stages={s.stages} /> : null}
    </div>
  )
}

// ---------------------------------------------------------------- pipeline

const KIND_STYLE: Record<StageKind, string> = {
  open: "border-t-sky-500",
  won: "border-t-emerald-500",
  lost: "border-t-muted-foreground/40",
}

function Pipeline({ summary }: { summary: CrmSummary }) {
  const { slug, me } = useWorkspace()
  const qc = useQueryClient()
  const [owner, setOwner] = useState<"me" | "all">("all")
  const [q, setQ] = useState("")
  const [creating, setCreating] = useState(false)
  const [lost, setLost] = useState<{ opportunity: CrmOpportunity; stageId: number } | null>(null)
  const [dragOver, setDragOver] = useState<number | null>(null)
  const params = { owner, q: q || undefined }
  const board = useBoard(slug, params)

  async function move(o: CrmOpportunity, stage: CrmStage, lostReason?: string) {
    if (o.stage_id === stage.id) return
    if (stage.kind === "lost" && !lostReason) return setLost({ opportunity: o, stageId: stage.id })
    const key = crmKeys.board(slug, params)
    const previous = qc.getQueryData<CrmOpportunity[]>(key)
    // Move the card straight away; roll back if the server says no.
    qc.setQueryData<CrmOpportunity[]>(key, (list) => list?.map((x) => (x.id === o.id ? { ...x, stage_id: stage.id } : x)))
    try {
      await api(orgPath(slug, `/crm/opportunities/${o.id}/move`), { method: "POST", body: { stage_id: stage.id, lost_reason: lostReason } })
      if (stage.kind === "won") toast.success(`Won: ${o.name} 🎉`)
      qc.invalidateQueries({ queryKey: crmKeys.all(slug) })
    } catch (e) {
      qc.setQueryData(key, previous)
      toast.error(errorMessage(e))
    }
  }

  const deals = board.data ?? []
  const openTotal = deals.filter((d) => summary.stages.find((s) => s.id === d.stage_id)?.kind === "open").reduce((sum, d) => sum + d.amount, 0)

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div role="search" aria-label="Filter opportunities" className="flex flex-wrap items-center gap-3">
          <Label htmlFor="deal-search" className="sr-only">
            Search opportunities
          </Label>
          <Input id="deal-search" placeholder="Search deals or accounts…" value={q} onChange={(e) => setQ(e.target.value)} className="w-64" />
          <Select value={owner} onValueChange={(v) => setOwner(v as "me" | "all")}>
            <SelectTrigger className="w-44" aria-label="Owner">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{summary.see_all ? "Everyone's deals" : "Deals I can see"}</SelectItem>
              <SelectItem value="me">My deals</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <p className="text-sm text-muted-foreground">
          Open pipeline: <span className="font-medium text-foreground tabular-nums">{formatMoney(openTotal)}</span>
        </p>
        {summary.can_create ? (
          <Button className="ml-auto" onClick={() => setCreating(true)}>
            <Plus aria-hidden /> New opportunity
          </Button>
        ) : null}
      </div>

      {board.isPending ? (
        <LoadingRows rows={4} />
      ) : board.error ? (
        <ErrorState error={board.error} onRetry={() => board.refetch()} />
      ) : (
        <>
          <p className="sr-only">Drag cards between stages, or use each card&apos;s &ldquo;Move to&rdquo; menu. Won and lost columns show the last 90 days.</p>
          <div className="flex gap-3 overflow-x-auto pb-2">
            {summary.stages.map((stage) => {
              const cards = deals.filter((d) => d.stage_id === stage.id)
              const total = cards.reduce((sum, d) => sum + d.amount, 0)
              return (
                <section
                  key={stage.id}
                  aria-label={`${stage.name}, ${cards.length} ${cards.length === 1 ? "deal" : "deals"}`}
                  className={cn(
                    "flex w-72 shrink-0 flex-col rounded-xl border border-t-4 bg-muted/30",
                    KIND_STYLE[stage.kind],
                    dragOver === stage.id && "ring-2 ring-primary",
                  )}
                  onDragOver={(e) => {
                    e.preventDefault()
                    setDragOver(stage.id)
                  }}
                  onDragLeave={() => setDragOver((v) => (v === stage.id ? null : v))}
                  onDrop={(e) => {
                    e.preventDefault()
                    setDragOver(null)
                    const card = deals.find((d) => String(d.id) === e.dataTransfer.getData("text/plain"))
                    if (card) move(card, stage)
                  }}
                >
                  <header className="flex items-baseline justify-between gap-2 px-3 pt-3 pb-2">
                    <h3 className="text-sm font-semibold">
                      {stage.name} <span className="font-normal text-muted-foreground">· {cards.length}</span>
                    </h3>
                    <span className="text-xs text-muted-foreground tabular-nums">
                      {formatMoney(total)}
                      {stage.kind === "open" ? ` · ${stage.probability}%` : ""}
                    </span>
                  </header>
                  <ul className="flex min-h-24 flex-col gap-2 px-2 pb-2">
                    {cards.map((d) => (
                      <li key={d.id}>
                        <DealCard deal={d} stages={summary.stages} onMove={(st) => move(d, st)} mine={d.owner?.id === me.id} />
                      </li>
                    ))}
                  </ul>
                </section>
              )
            })}
          </div>
          {deals.length === 0 ? (
            <EmptyState
              icon={TrendingUp}
              title={q || owner === "me" ? "No deals match" : "No deals yet"}
              description="Add an opportunity when a customer shows interest."
              action={summary.can_create && !q ? <Button onClick={() => setCreating(true)}>Add an opportunity</Button> : undefined}
            />
          ) : null}
        </>
      )}

      {creating ? <OpportunityDialog open={creating} onOpenChange={setCreating} summary={summary} /> : null}
      <LostReasonDialog
        opportunity={lost?.opportunity ?? null}
        onCancel={() => setLost(null)}
        onConfirm={async (reason) => {
          if (!lost) return
          const stage = summary.stages.find((s) => s.id === lost.stageId)!
          setLost(null)
          await move(lost.opportunity, stage, reason)
        }}
      />
    </div>
  )
}

function DealCard({ deal: d, stages, onMove, mine }: { deal: CrmOpportunity; stages: CrmStage[]; onMove: (s: CrmStage) => void; mine: boolean }) {
  const { href, org } = useWorkspace()
  const days = d.expected_close_date ? daysUntil(d.expected_close_date, org.timezone) : null
  const open = stages.find((s) => s.id === d.stage_id)?.kind === "open"
  return (
    <article
      draggable={d.permissions.edit}
      onDragStart={(e) => {
        e.dataTransfer.setData("text/plain", String(d.id))
        e.dataTransfer.effectAllowed = "move"
      }}
      className={cn("rounded-lg border bg-card p-3 shadow-xs", d.permissions.edit && "cursor-grab active:cursor-grabbing")}
    >
      <Link href={href(`/apps/opportunity/deals/${d.id}`)} className="block font-medium hover:underline">
        {d.name}
      </Link>
      {d.account ? <p className="truncate text-xs text-muted-foreground">{d.account.name}</p> : null}
      <div className="mt-2 flex items-center justify-between gap-2">
        <span className="text-sm font-semibold tabular-nums">{formatMoney(d.amount)}</span>
        {open && d.expected_close_date ? (
          <span className={cn("text-xs", days !== null && days < 0 ? "font-medium text-destructive" : "text-muted-foreground")}>
            {days !== null && days < 0 ? "Overdue · " : ""}
            {formatDateKey(d.expected_close_date, { year: undefined })}
          </span>
        ) : null}
        {d.lost_reason ? (
          <span className="truncate text-xs text-muted-foreground" title={d.lost_reason}>
            {d.lost_reason}
          </span>
        ) : null}
      </div>
      <div className="mt-2 flex items-center justify-between">
        <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <UserAvatar user={d.owner} className="size-5" />
          {mine ? "You" : (d.owner?.name ?? "No owner")}
        </span>
        {d.permissions.edit ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" aria-label={`Move ${d.name} to another stage`}>
                <ArrowRightLeft className="size-3.5" aria-hidden /> Move to
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel>Move to stage</DropdownMenuLabel>
              {stages
                .filter((s) => s.id !== d.stage_id)
                .map((s) => (
                  <DropdownMenuItem key={s.id} onSelect={() => onMove(s)}>
                    {s.name}
                  </DropdownMenuItem>
                ))}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </div>
    </article>
  )
}

// ---------------------------------------------------------------- forecast

function Forecast({ summary }: { summary: CrmSummary }) {
  const { slug } = useWorkspace()
  const [owner, setOwner] = useState<"me" | "all">("all")
  const forecast = useForecast(slug, { owner, months: 6 })
  if (forecast.isPending) return <LoadingRows rows={4} />
  if (forecast.error) return <ErrorState error={forecast.error} onRetry={() => forecast.refetch()} />
  const f = forecast.data
  const ahead = f.months.filter((m) => m.month >= f.current_month)
  const behind = f.months.filter((m) => m.month < f.current_month)
  const max = Math.max(1, ...ahead.map((m) => m.open_amount))
  const sum = (key: "weighted_amount" | "open_amount" | "won_amount", rows: typeof f.months) => rows.reduce((t, m) => t + m[key], 0)

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <Select value={owner} onValueChange={(v) => setOwner(v as "me" | "all")}>
          <SelectTrigger className="w-44" aria-label="Whose deals">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{summary.see_all ? "Whole team" : "Deals I can see"}</SelectItem>
            <SelectItem value="me">My deals</SelectItem>
          </SelectContent>
        </Select>
        <p className="text-sm text-muted-foreground">Weighted = value × stage probability.</p>
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        <Stat label="Weighted forecast (next 6 months)" value={formatMoney(sum("weighted_amount", ahead))} />
        <Stat label="Open pipeline (next 6 months)" value={formatMoney(sum("open_amount", ahead))} />
        <Stat label="Won (last 6 months)" value={formatMoney(sum("won_amount", behind) + (f.months.find((m) => m.month === f.current_month)?.won_amount ?? 0))} />
      </div>
      <Card>
        <CardHeader>
          <CardTitle>By expected close month</CardTitle>
          <CardDescription>Open deals; the darker bar is the weighted amount.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {f.overdue.count ? (
            <p className="text-sm text-destructive">
              {f.overdue.count} open {f.overdue.count === 1 ? "deal is" : "deals are"} past their expected close date ({formatMoney(f.overdue.open_amount)}). Update their dates.
            </p>
          ) : null}
          <ul className="space-y-3">
            {ahead.map((m) => (
              <li key={m.month} className="grid grid-cols-[5rem_minmax(0,1fr)_auto] items-center gap-3 text-sm">
                <span className="text-muted-foreground">{formatMonth(m.month)}</span>
                <span className="relative h-3 overflow-hidden rounded-full bg-muted" aria-hidden>
                  <span className="absolute inset-y-0 left-0 rounded-full bg-teal-500/30" style={{ width: `${(m.open_amount / max) * 100}%` }} />
                  <span className="absolute inset-y-0 left-0 rounded-full bg-teal-600" style={{ width: `${(m.weighted_amount / max) * 100}%` }} />
                </span>
                <span className="text-right tabular-nums">
                  {formatMoney(m.weighted_amount)}
                  <span className="ml-2 text-xs text-muted-foreground">
                    of {formatMoney(m.open_amount)} · {m.count}
                  </span>
                </span>
              </li>
            ))}
          </ul>
          {f.undated.count ? (
            <p className="text-xs text-muted-foreground">
              {f.undated.count} open {f.undated.count === 1 ? "deal has" : "deals have"} no expected close date ({formatMoney(f.undated.open_amount)}).
            </p>
          ) : null}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>By stage</CardTitle>
        </CardHeader>
        <CardContent>
          <table className="w-full text-sm">
            <caption className="sr-only">Deals and value by stage</caption>
            <thead className="text-left text-xs text-muted-foreground">
              <tr>
                <th scope="col" className="pb-2 font-medium">Stage</th>
                <th scope="col" className="pb-2 text-right font-medium">Deals</th>
                <th scope="col" className="pb-2 text-right font-medium">Value</th>
              </tr>
            </thead>
            <tbody>
              {f.stages.map((st) => (
                <tr key={st.id} className="border-t">
                  <th scope="row" className="py-2 text-left font-normal">
                    {st.name} {st.kind === "open" ? <span className="text-xs text-muted-foreground">· {st.probability}%</span> : null}
                  </th>
                  <td className="py-2 text-right tabular-nums">{st.count}</td>
                  <td className="py-2 text-right tabular-nums">{formatMoney(st.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <Card className="gap-1 py-4">
      <CardContent className="px-4">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="text-2xl font-semibold tabular-nums">{value}</p>
      </CardContent>
    </Card>
  )
}

// ------------------------------------------------------------ follow-ups

function MyTasks() {
  const { slug } = useWorkspace()
  const tasks = useMyCrmTasks(slug)
  if (tasks.isPending) return <LoadingRows rows={3} />
  if (tasks.error) return <ErrorState error={tasks.error} onRetry={() => tasks.refetch()} />
  return tasks.data.length ? (
    <ul className="max-w-3xl space-y-2">
      {tasks.data.map((t) => (
        <li key={t.id}>
          <ActivityItem activity={t} showParent />
        </li>
      ))}
    </ul>
  ) : (
    <EmptyState icon={CalendarCheck} title="No open follow-ups" description="Add a follow-up task on a deal or account to see it here." />
  )
}

// ---------------------------------------------------------- directory

function Accounts({ summary }: { summary: CrmSummary }) {
  const { slug, href } = useWorkspace()
  const [q, setQ] = useState("")
  const [page, setPage] = useState(1)
  const [creating, setCreating] = useState(false)
  const accounts = useAccounts(slug, { q: q || undefined, page })
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3" role="search" aria-label="Search accounts">
        <Label htmlFor="acct-q" className="sr-only">
          Search accounts
        </Label>
        <Input id="acct-q" placeholder="Search name or industry…" value={q} onChange={(e) => (setQ(e.target.value), setPage(1))} className="max-w-xs" />
        {summary.can_create ? (
          <Button className="ml-auto" onClick={() => setCreating(true)}>
            <Plus aria-hidden /> New account
          </Button>
        ) : null}
      </div>
      {accounts.isPending ? (
        <LoadingRows rows={4} />
      ) : accounts.error ? (
        <ErrorState error={accounts.error} onRetry={() => accounts.refetch()} />
      ) : accounts.data.data.length ? (
        <>
          <ul className="divide-y rounded-xl border">
            {accounts.data.data.map((a) => (
              <li key={a.id}>
                <Link href={href(`/apps/opportunity/accounts/${a.id}`)} className="flex flex-col gap-1 p-4 hover:bg-muted/40 sm:flex-row sm:items-center">
                  <span className="flex-1 font-medium">{a.name}</span>
                  <span className="text-sm text-muted-foreground sm:w-40">{a.industry ?? "–"}</span>
                  <span className="text-sm text-muted-foreground sm:w-28">
                    {a.contacts_count ?? 0} {a.contacts_count === 1 ? "contact" : "contacts"}
                  </span>
                  <span className="flex items-center gap-1.5 text-sm text-muted-foreground sm:w-44">
                    <UserAvatar user={a.owner} className="size-5" /> {a.owner?.name ?? "No owner"}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
          <Pager page={page} lastPage={accounts.data.meta.last_page} onPage={setPage} />
        </>
      ) : (
        <EmptyState icon={Building2} title={q ? "No accounts match" : "No accounts yet"} description="Accounts are the companies you sell to." />
      )}
      {creating ? <AccountDialog open={creating} onOpenChange={setCreating} /> : null}
    </div>
  )
}

function Contacts({ summary }: { summary: CrmSummary }) {
  const { slug, href } = useWorkspace()
  const [q, setQ] = useState("")
  const [page, setPage] = useState(1)
  const [creating, setCreating] = useState(false)
  const contacts = useContacts(slug, { q: q || undefined, page })
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3" role="search" aria-label="Search contacts">
        <Label htmlFor="contact-q" className="sr-only">
          Search contacts
        </Label>
        <Input id="contact-q" placeholder="Search name or email…" value={q} onChange={(e) => (setQ(e.target.value), setPage(1))} className="max-w-xs" />
        {summary.can_create ? (
          <Button className="ml-auto" onClick={() => setCreating(true)}>
            <Plus aria-hidden /> New contact
          </Button>
        ) : null}
      </div>
      {contacts.isPending ? (
        <LoadingRows rows={4} />
      ) : contacts.error ? (
        <ErrorState error={contacts.error} onRetry={() => contacts.refetch()} />
      ) : contacts.data.data.length ? (
        <>
          <ul className="divide-y rounded-xl border">
            {contacts.data.data.map((c) => (
              <li key={c.id} className="flex flex-col gap-1 p-4 text-sm sm:flex-row sm:items-center">
                <span className="flex-1">
                  <span className="font-medium">{c.name}</span>
                  {c.job_title ? <span className="text-muted-foreground"> · {c.job_title}</span> : null}
                </span>
                <span className="sm:w-56">
                  {c.email ? (
                    <a href={`mailto:${c.email}`} className="text-muted-foreground hover:underline">
                      {c.email}
                    </a>
                  ) : null}
                </span>
                <span className="text-muted-foreground sm:w-32">{c.phone}</span>
                <span className="sm:w-48">
                  {c.account ? (
                    <Link href={href(`/apps/opportunity/accounts/${c.account.id}`)} className="hover:underline">
                      {c.account.name}
                    </Link>
                  ) : (
                    <span className="text-muted-foreground">No account</span>
                  )}
                </span>
              </li>
            ))}
          </ul>
          <Pager page={page} lastPage={contacts.data.meta.last_page} onPage={setPage} />
        </>
      ) : (
        <EmptyState icon={ContactIcon} title={q ? "No contacts match" : "No contacts yet"} description="People you deal with at your customers." />
      )}
      {creating ? <ContactDialog open={creating} onOpenChange={setCreating} /> : null}
    </div>
  )
}

// ---------------------------------------------------------------- stages

interface StageRow {
  id?: number
  key: string
  name: string
  probability: number
  kind: StageKind
}

function StageSettings({ stages }: { stages: CrmStage[] }) {
  const { slug } = useWorkspace()
  const qc = useQueryClient()
  const [rows, setRows] = useState<StageRow[]>(stages.map((s) => ({ id: s.id, key: String(s.id), name: s.name, probability: s.probability, kind: s.kind })))
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const update = (i: number, patch: Partial<StageRow>) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)))
  const swap = (i: number, j: number) =>
    setRows((rs) => {
      const next = [...rs]
      ;[next[i], next[j]] = [next[j], next[i]]
      return next
    })

  async function save() {
    setError(null)
    setPending(true)
    try {
      await api(orgPath(slug, "/crm/stages"), {
        method: "PUT",
        body: { stages: rows.map((r) => ({ id: r.id ?? null, name: r.name.trim(), probability: r.probability, kind: r.kind })) },
      })
      qc.invalidateQueries({ queryKey: crmKeys.all(slug) })
      toast.success("Pipeline stages saved.")
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setPending(false)
    }
  }

  return (
    <Card className="max-w-3xl">
      <CardHeader>
        <CardTitle>Pipeline stages</CardTitle>
        <CardDescription>
          Order, names and win probabilities used for the forecast. Keep one Won and one Lost stage. A stage that still has deals cannot be removed.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <FormAlert message={error} />
        <ol className="space-y-2">
          {rows.map((r, i) => (
            <li key={r.key} className="flex flex-wrap items-center gap-2">
              <Label htmlFor={`stage-${r.key}`} className="sr-only">
                Stage {i + 1} name
              </Label>
              <Input id={`stage-${r.key}`} className="min-w-40 flex-1" maxLength={60} value={r.name} onChange={(e) => update(i, { name: e.target.value })} />
              <Label htmlFor={`stage-${r.key}-p`} className="sr-only">
                {r.name} probability (%)
              </Label>
              <div className="flex items-center gap-1">
                <Input
                  id={`stage-${r.key}-p`}
                  type="number"
                  min={0}
                  max={100}
                  className="w-20"
                  value={r.probability}
                  onChange={(e) => update(i, { probability: Math.max(0, Math.min(100, Number(e.target.value))) })}
                />
                <span className="text-sm text-muted-foreground">%</span>
              </div>
              <Select value={r.kind} onValueChange={(v) => update(i, { kind: v as StageKind })}>
                <SelectTrigger className="w-28" aria-label={`${r.name} type`}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="open">Open</SelectItem>
                  <SelectItem value="won">Won</SelectItem>
                  <SelectItem value="lost">Lost</SelectItem>
                </SelectContent>
              </Select>
              <Button variant="ghost" size="icon" className="size-8" aria-label={`Move ${r.name} up`} disabled={i === 0} onClick={() => swap(i, i - 1)}>
                <ArrowUp aria-hidden />
              </Button>
              <Button variant="ghost" size="icon" className="size-8" aria-label={`Move ${r.name} down`} disabled={i === rows.length - 1} onClick={() => swap(i, i + 1)}>
                <ArrowDown aria-hidden />
              </Button>
              <Button variant="ghost" size="icon" className="size-8" aria-label={`Remove ${r.name}`} onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))}>
                <Trash2 aria-hidden />
              </Button>
            </li>
          ))}
        </ol>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            onClick={() =>
              setRows((rs) => {
                // New stages go after the last open stage (before Won/Lost).
                const at = rs.findIndex((r) => r.kind !== "open")
                const next = [...rs]
                next.splice(at === -1 ? rs.length : at, 0, { key: `new-${Date.now()}`, name: "New stage", probability: 50, kind: "open" })
                return next
              })
            }
          >
            <Plus aria-hidden /> Add stage
          </Button>
          <Button onClick={save} disabled={pending}>
            {pending ? <Spinner /> : null} Save stages
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          <Badge variant="outline">Tip</Badge> Order the open stages from first contact to closing; Won and Lost usually go last.
        </p>
      </CardContent>
    </Card>
  )
}
