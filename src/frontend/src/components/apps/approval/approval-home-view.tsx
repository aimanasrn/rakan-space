"use client"

import { AlarmClock, CheckCheck, Clock, Inbox, Plus, Undo2 } from "lucide-react"
import Link from "next/link"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { useState } from "react"
import { EmptyState, ErrorState, LoadingRows, UserAvatar } from "@/components/common"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { useWorkspace } from "@/components/workspace/workspace-context"
import { formatDateTime, timeAgo } from "@/lib/datetime"
import type { ApprovalRequestSummary } from "@/lib/types"
import { cn } from "@/lib/utils"
import { ModuleHeader, ModuleNav, Pager, StatusBadge } from "../shared"
import { NewRequestDialog } from "./new-request-dialog"
import { type RequestListParams, useApprovalRequests, useApprovalSummary } from "./use-approvals"

const BOXES: { value: RequestListParams["box"]; label: string }[] = [
  { value: "inbox", label: "Waiting for me" },
  { value: "mine", label: "My requests" },
  { value: "decided", label: "Decided by me" },
  { value: "all", label: "All requests" },
]

export function ApprovalNav() {
  const { slug, href } = useWorkspace()
  const summary = useApprovalSummary(slug)
  return (
    <ModuleNav
      items={[
        { href: href("/apps/approval"), label: "Requests", badge: summary.data?.inbox },
        { href: href("/apps/approval/workflows"), label: "Workflows", show: !!summary.data?.can_manage },
        { href: href("/apps/approval/delegations"), label: "Out of office" },
      ]}
    />
  )
}

export function ApprovalHomeView() {
  const { slug } = useWorkspace()
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()
  const summary = useApprovalSummary(slug)
  const [creating, setCreating] = useState(false)
  const [status, setStatus] = useState("all")
  const [q, setQ] = useState("")
  const [page, setPage] = useState(1)

  const requested = params.get("box") as RequestListParams["box"] | null
  const box: RequestListParams["box"] = requested && BOXES.some((b) => b.value === requested) ? requested : "inbox"
  const setBox = (value: string) => {
    setPage(1)
    router.replace(`${pathname}?box=${value}`, { scroll: false })
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-4 md:p-8">
      <ModuleHeader
        app="approval"
        title="Approval"
        description="Requests waiting for you, and the ones you sent."
        actions={
          summary.data?.can_create ? (
            <Button onClick={() => setCreating(true)}>
              <Plus aria-hidden /> New request
            </Button>
          ) : null
        }
      />
      <ApprovalNav />

      {summary.error ? <ErrorState error={summary.error} onRetry={() => summary.refetch()} /> : null}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat icon={Inbox} label="Waiting for you" value={summary.data?.inbox} onClick={() => setBox("inbox")} />
        <Stat icon={AlarmClock} label="Overdue" value={summary.data?.overdue} tone={summary.data?.overdue ? "warn" : undefined} onClick={() => setBox("inbox")} />
        <Stat icon={Clock} label="Your requests in progress" value={summary.data?.my_pending} onClick={() => setBox("mine")} />
        <Stat icon={Undo2} label="Returned to you" value={summary.data?.my_returned} tone={summary.data?.my_returned ? "warn" : undefined} onClick={() => setBox("mine")} />
      </div>

      <div className="space-y-4">
        <Tabs value={box} onValueChange={setBox}>
          <TabsList className="flex-wrap">
            {BOXES.filter((b) => b.value !== "all" || summary.data?.can_manage).map((b) => (
              <TabsTrigger key={b.value} value={b.value}>
                {b.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        <div className="flex flex-wrap items-center gap-3" role="search" aria-label="Filter requests">
          <Label htmlFor="approval-search" className="sr-only">
            Search requests
          </Label>
          <Input id="approval-search" placeholder="Search by title…" value={q} onChange={(e) => (setQ(e.target.value), setPage(1))} className="max-w-xs" />
          {box !== "inbox" ? (
            <Select value={status} onValueChange={(v) => (setStatus(v), setPage(1))}>
              <SelectTrigger className="w-40" aria-label="Status">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Any status</SelectItem>
                <SelectItem value="pending">Pending</SelectItem>
                <SelectItem value="approved">Approved</SelectItem>
                <SelectItem value="rejected">Rejected</SelectItem>
                <SelectItem value="returned">Returned</SelectItem>
                <SelectItem value="cancelled">Withdrawn</SelectItem>
              </SelectContent>
            </Select>
          ) : null}
        </div>
        <RequestList params={{ box, status: box === "inbox" ? undefined : status, q: q || undefined, page }} onPage={setPage} />
      </div>

      <NewRequestDialog open={creating} onOpenChange={setCreating} />
    </div>
  )
}

function Stat({ icon: Icon, label, value, tone, onClick }: { icon: typeof Inbox; label: string; value?: number; tone?: "warn"; onClick: () => void }) {
  return (
    <Card className="py-0">
      <CardContent className="p-0">
        <button type="button" onClick={onClick} className="flex w-full items-center gap-3 rounded-xl p-4 text-left hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">
          <Icon className={cn("size-5 shrink-0", tone === "warn" ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground")} aria-hidden />
          <span className="min-w-0">
            <span className="block text-2xl font-semibold tabular-nums">{value ?? "–"}</span>
            <span className="block text-xs text-muted-foreground">{label}</span>
          </span>
        </button>
      </CardContent>
    </Card>
  )
}

function RequestList({ params, onPage }: { params: RequestListParams; onPage: (p: number) => void }) {
  const { slug } = useWorkspace()
  const list = useApprovalRequests(slug, params)

  if (list.isPending) return <LoadingRows rows={4} />
  if (list.error) return <ErrorState error={list.error} onRetry={() => list.refetch()} />
  if (!list.data.data.length) {
    return (
      <EmptyState
        icon={CheckCheck}
        title={params.box === "inbox" && !params.q ? "Nothing waiting for you" : "No requests found"}
        description={params.box === "inbox" && !params.q ? "You're all caught up." : "Try a different filter or search."}
      />
    )
  }

  return (
    <div className="space-y-3">
      <ul className="divide-y rounded-xl border">
        {list.data.data.map((r) => (
          <RequestRow key={r.id} request={r} />
        ))}
      </ul>
      <Pager page={params.page ?? 1} lastPage={list.data.meta.last_page} onPage={onPage} />
    </div>
  )
}

function RequestRow({ request: r }: { request: ApprovalRequestSummary }) {
  const { href, org } = useWorkspace()
  return (
    <li className={cn("relative flex flex-col gap-2 p-4 hover:bg-muted/40 sm:flex-row sm:items-center", r.my_turn && "bg-primary/5")}>
      <div className="flex min-w-0 flex-1 items-start gap-3">
        <UserAvatar user={r.requester} className="mt-0.5" />
        <div className="min-w-0">
          <Link href={href(`/apps/approval/requests/${r.id}`)} className="font-medium after:absolute after:inset-0 hover:underline focus-visible:outline-none">
            {r.title}
          </Link>
          <p className="text-xs text-muted-foreground">
            {r.requester.name} · {r.workflow?.name ?? "Workflow removed"} ·{" "}
            <time dateTime={r.submitted_at} title={formatDateTime(r.submitted_at, org.timezone)}>
              {timeAgo(r.submitted_at)}
            </time>
          </p>
          {r.current_step ? (
            <p className="mt-1 text-xs">
              <span className="text-muted-foreground">At </span>
              {r.current_step.name}
              {r.current_step.waiting_on.length ? <span className="text-muted-foreground"> · waiting on {r.current_step.waiting_on.join(", ")}</span> : null}
              {r.current_step.overdue ? <span className="ml-1 font-medium text-amber-700 dark:text-amber-400">· overdue</span> : null}
            </p>
          ) : null}
        </div>
      </div>
      <div className="flex items-center gap-2 sm:justify-end">
        {r.my_turn ? <span className="text-xs font-medium text-primary">Your turn</span> : null}
        <StatusBadge status={r.status} />
      </div>
    </li>
  )
}
