"use client"

import { Check, CircleDashed, CircleSlash, Clock, ExternalLink, Forward, History, Loader2, RotateCcw, X } from "lucide-react"
import Link from "next/link"
import { useParams } from "next/navigation"
import { useState } from "react"
import { toast } from "sonner"
import { LoadingRows, UserAvatar } from "@/components/common"
import { ConfirmAction } from "@/components/confirm"
import { FormAlert, TextField } from "@/components/form"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import { Spinner } from "@/components/ui/spinner"
import { Textarea } from "@/components/ui/textarea"
import { useWorkspace } from "@/components/workspace/workspace-context"
import { ApiError, errorMessage } from "@/lib/api"
import { describeCondition } from "@/lib/conditions"
import { formatDateTime, timeAgo } from "@/lib/datetime"
import type { ApprovalRequestDetail, ApprovalStepDetail } from "@/lib/types"
import { cn } from "@/lib/utils"
import { LoadError, ModuleHeader, StatusBadge } from "../shared"
import { useApprovalAction, useApprovalRequest } from "./use-approvals"

const ACTION_LABELS: Record<string, string> = {
  submitted: "submitted the request",
  resubmitted: "resubmitted with changes",
  step_started: "Step started",
  approved: "approved",
  rejected: "rejected",
  returned: "returned it for changes",
  skipped: "Step skipped",
  completed: "Request completed",
  cancelled: "withdrew the request",
  reminded: "Reminder sent (time limit passed)",
  escalated: "Escalated (overdue)",
  delegated: "delegated their approval",
  approver_removed: "An approver left the workspace; step reassigned",
}

export function RequestDetailView() {
  const { requestId } = useParams<{ requestId: string }>()
  const id = Number(requestId)
  const { slug, href } = useWorkspace()
  const request = useApprovalRequest(slug, id)

  if (request.isPending) {
    return (
      <div className="mx-auto max-w-5xl p-4 md:p-8">
        <LoadingRows rows={6} />
      </div>
    )
  }
  if (request.error) {
    return (
      <div className="mx-auto max-w-5xl p-4 md:p-8">
        <LoadError error={request.error} onRetry={() => request.refetch()} what="Request" />
      </div>
    )
  }

  const r = request.data
  const current = r.rounds.find((round) => round.round === r.round)
  const previous = r.rounds.filter((round) => round.round !== r.round).reverse()

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-4 md:p-8">
      <ModuleHeader
        app="approval"
        title={r.title}
        back={{ href: href("/apps/approval"), label: "Approval" }}
        description={
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <StatusBadge status={r.status} />
            <span>
              {r.requester.name} · {r.workflow?.name ?? "Workflow removed"}
              {r.round > 1 ? ` · round ${r.round}` : ""}
            </span>
          </span>
        }
        actions={
          r.link ? (
            <Button asChild variant="outline">
              <Link href={href(r.link)}>
                <ExternalLink aria-hidden /> Open item
              </Link>
            </Button>
          ) : null
        }
      />

      <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
        <div className="min-w-0 space-y-6">
          <Details request={r} />
          <Card>
            <CardHeader>
              <CardTitle>Approval steps</CardTitle>
              {r.round > 1 ? <CardDescription>Round {r.round}. Earlier rounds are listed below.</CardDescription> : null}
            </CardHeader>
            <CardContent>{current ? <StepList steps={current.steps} overdueStepId={r.current_step?.overdue ? r.current_step.id : undefined} /> :<p className="text-sm text-muted-foreground">No steps.</p>}</CardContent>
          </Card>
          {previous.map((round) => (
            <details key={round.round} className="rounded-xl border p-4">
              <summary className="cursor-pointer text-sm font-medium">Round {round.round}</summary>
              <div className="mt-4">
                <StepList steps={round.steps} />
              </div>
            </details>
          ))}
          <HistoryCard request={r} />
        </div>
        <div className="space-y-4">
          {r.permissions.decide ? <DecisionPanel request={r} /> : null}
          {r.permissions.resubmit ? <ResubmitPanel request={r} /> : null}
          {r.permissions.cancel ? <WithdrawPanel request={r} /> : null}
          {!r.permissions.decide && r.status === "pending" && r.current_step ? (
            <Card>
              <CardContent className="space-y-1 text-sm">
                <p className="font-medium">Waiting on {r.current_step.waiting_on.join(", ") || "approvers"}</p>
                {r.current_step.due_at ? <DueText dueAt={r.current_step.due_at} overdue={r.current_step.overdue} /> : null}
              </CardContent>
            </Card>
          ) : null}
        </div>
      </div>
    </div>
  )
}

function Details({ request: r }: { request: ApprovalRequestDetail }) {
  const { org } = useWorkspace()
  const entries = Object.entries(r.data ?? {})
  return (
    <Card>
      <CardHeader>
        <CardTitle>Details</CardTitle>
        <CardDescription>
          Submitted {formatDateTime(r.submitted_at, org.timezone)}
          {r.completed_at ? ` · completed ${formatDateTime(r.completed_at, org.timezone)}` : ""}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {r.summary ? <p className="text-sm whitespace-pre-wrap">{r.summary}</p> : null}
        {entries.length ? (
          <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-[10rem_1fr]">
            {entries.map(([key, value]) => (
              <div key={key} className="contents">
                <dt className="text-muted-foreground capitalize">{key.replaceAll("_", " ")}</dt>
                <dd className="break-words">{Array.isArray(value) ? value.join(", ") : typeof value === "number" ? value.toLocaleString() : String(value ?? "—")}</dd>
              </div>
            ))}
          </dl>
        ) : null}
        {!r.summary && !entries.length ? <p className="text-sm text-muted-foreground">No extra details.</p> : null}
      </CardContent>
    </Card>
  )
}

const STEP_ICON: Record<ApprovalStepDetail["status"], { icon: typeof Check; className: string; label: string }> = {
  waiting: { icon: CircleDashed, className: "text-muted-foreground", label: "Not started" },
  pending: { icon: Loader2, className: "text-amber-600 dark:text-amber-400", label: "In progress" },
  approved: { icon: Check, className: "text-emerald-600 dark:text-emerald-400", label: "Approved" },
  rejected: { icon: X, className: "text-red-600 dark:text-red-400", label: "Rejected" },
  returned: { icon: RotateCcw, className: "text-violet-600 dark:text-violet-400", label: "Returned" },
  skipped: { icon: Forward, className: "text-muted-foreground", label: "Skipped" },
  cancelled: { icon: CircleSlash, className: "text-muted-foreground", label: "Not needed" },
}

function StepList({ steps, overdueStepId }: { steps: ApprovalStepDetail[]; overdueStepId?: number }) {
  const { org } = useWorkspace()
  return (
    <ol className="space-y-4">
      {steps.map((step) => {
        const s = STEP_ICON[step.status]
        return (
          <li key={step.id} className="flex gap-3">
            <span className={cn("mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full border", s.className)} aria-hidden>
              <s.icon className={cn("size-4", step.status === "pending" && "motion-safe:animate-spin")} />
            </span>
            <div className="min-w-0 flex-1 space-y-1.5">
              <div className="flex flex-wrap items-center gap-2">
                <p className="font-medium">{step.name}</p>
                <Badge variant="outline">{s.label}</Badge>
                {step.mode === "all" && step.approvers.length > 1 ? <Badge variant="secondary">Everyone must approve</Badge> : null}
              </div>
              {step.condition ? <p className="text-xs text-muted-foreground">Only when {describeCondition(step.condition)}</p> : null}
              {step.status === "pending" && step.due_at ? <DueText dueAt={step.due_at} overdue={step.id === overdueStepId} /> : null}
              {step.approvers.length ? (
                <ul className="space-y-2">
                  {step.approvers.map((a, i) => (
                    <li key={i} className="flex items-start gap-2 text-sm">
                      <UserAvatar user={a.user} className="size-6" />
                      <div className="min-w-0">
                        <p>
                          {a.user?.name ?? "Former member"}{" "}
                          <span className="text-muted-foreground">
                            {a.decision ? `· ${a.decision}` : step.status === "pending" ? "· waiting" : ""}
                            {a.delegated_from ? ` · for ${a.delegated_from.name}` : ""}
                            {a.source === "escalation" ? " · escalation" : a.source === "fallback" ? " · admin cover" : ""}
                          </span>
                        </p>
                        {a.comment ? <p className="mt-0.5 rounded-md bg-muted px-2 py-1 text-sm whitespace-pre-wrap">{a.comment}</p> : null}
                        {a.decided_at ? <p className="text-xs text-muted-foreground">{formatDateTime(a.decided_at, org.timezone)}</p> : null}
                      </div>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          </li>
        )
      })}
    </ol>
  )
}

/** "overdue" comes from the server, so rendering stays pure. */
function DueText({ dueAt, overdue }: { dueAt: string; overdue: boolean }) {
  const { org } = useWorkspace()
  return (
    <p className={cn("flex items-center gap-1 text-xs", overdue ? "font-medium text-amber-700 dark:text-amber-400" : "text-muted-foreground")}>
      <Clock className="size-3" aria-hidden />
      {overdue ? "Overdue since" : "Due"} {formatDateTime(dueAt, org.timezone)}
    </p>
  )
}

function HistoryCard({ request: r }: { request: ApprovalRequestDetail }) {
  const { org } = useWorkspace()
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <History className="size-4" aria-hidden /> History
        </CardTitle>
      </CardHeader>
      <CardContent>
        <ol className="space-y-3 border-l pl-4">
          {r.history.map((h) => (
            <li key={h.id} className="text-sm">
              <p>
                {h.actor ? <span className="font-medium">{h.actor.name} </span> : null}
                {ACTION_LABELS[h.action] ?? h.action.replaceAll("_", " ")}
                {h.step ? <span className="text-muted-foreground"> · {h.step}</span> : null}
                {h.action === "completed" && h.properties?.status ? <span className="text-muted-foreground"> · {String(h.properties.status)}</span> : null}
              </p>
              {h.comment ? <p className="mt-0.5 text-muted-foreground whitespace-pre-wrap">“{h.comment}”</p> : null}
              <p className="text-xs text-muted-foreground" title={formatDateTime(h.created_at, org.timezone)}>
                {timeAgo(h.created_at)}
              </p>
            </li>
          ))}
        </ol>
      </CardContent>
    </Card>
  )
}

function DecisionPanel({ request: r }: { request: ApprovalRequestDetail }) {
  const { slug } = useWorkspace()
  const action = useApprovalAction(slug, r.id)
  const [comment, setComment] = useState("")
  const [error, setError] = useState<string | null>(null)

  async function decide(decision: "approve" | "reject" | "return") {
    setError(null)
    if (decision !== "approve" && !comment.trim()) {
      setError(decision === "reject" ? "Add a comment explaining why you are rejecting." : "Add a comment saying what needs to change.")
      return
    }
    try {
      await action.mutateAsync({ action: "decide", body: { decision, comment: comment.trim() || null } })
      setComment("")
      toast.success(decision === "approve" ? "Approved." : decision === "reject" ? "Rejected." : "Returned for changes.")
    } catch (e) {
      setError(e instanceof ApiError && e.field("comment") ? e.field("comment")! : errorMessage(e))
    }
  }

  return (
    <Card className="border-primary/40">
      <CardHeader>
        <CardTitle>Your decision</CardTitle>
        <CardDescription>{r.current_step?.name}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <FormAlert message={error} />
        <div className="space-y-2">
          <Label htmlFor="decision-comment">Comment</Label>
          <Textarea id="decision-comment" rows={3} maxLength={2000} value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Required when rejecting or returning" />
        </div>
        <div className="grid gap-2">
          <Button onClick={() => decide("approve")} disabled={action.isPending}>
            {action.isPending ? <Spinner /> : <Check aria-hidden />} Approve
          </Button>
          <div className="grid grid-cols-2 gap-2">
            <Button variant="outline" onClick={() => decide("return")} disabled={action.isPending}>
              <RotateCcw aria-hidden /> Return
            </Button>
            <Button variant="destructive" onClick={() => decide("reject")} disabled={action.isPending}>
              <X aria-hidden /> Reject
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

function ResubmitPanel({ request: r }: { request: ApprovalRequestDetail }) {
  const { slug, href } = useWorkspace()
  const action = useApprovalAction(slug, r.id)
  const [error, setError] = useState<string | null>(null)

  // Requests from another module are changed where they were created.
  if (r.entity_type !== "manual") {
    return (
      <Card className="border-violet-500/40">
        <CardHeader>
          <CardTitle>Changes requested</CardTitle>
          <CardDescription>Update your submission and send it again.</CardDescription>
        </CardHeader>
        <CardContent>
          {r.link ? (
            <Button asChild className="w-full">
              <Link href={href(r.link)}>Edit and resubmit</Link>
            </Button>
          ) : null}
        </CardContent>
      </Card>
    )
  }

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    const form = new FormData(e.currentTarget)
    const amount = String(form.get("amount") ?? "").trim()
    try {
      await action.mutateAsync({
        action: "resubmit",
        body: { title: String(form.get("title") ?? "").trim(), details: String(form.get("details") ?? "").trim() || null, amount: amount ? Number(amount) : null },
      })
      toast.success("Sent for approval again.")
    } catch (err) {
      setError(errorMessage(err))
    }
  }

  return (
    <Card className="border-violet-500/40">
      <CardHeader>
        <CardTitle>Changes requested</CardTitle>
        <CardDescription>Update the request and send it again. Approval restarts from the first step.</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} className="space-y-3" noValidate>
          <FormAlert message={error} />
          <TextField id="resubmit-title" name="title" label="Title" defaultValue={r.title} required maxLength={200} />
          <TextField id="resubmit-details" name="details" label="Details" textarea rows={3} defaultValue={r.summary ?? ""} maxLength={1000} />
          <TextField id="resubmit-amount" name="amount" label="Amount" type="number" min={0} step="0.01" defaultValue={typeof r.data.amount === "number" ? String(r.data.amount) : ""} />
          <Button type="submit" className="w-full" disabled={action.isPending}>
            {action.isPending ? <Spinner /> : null} Resubmit
          </Button>
        </form>
      </CardContent>
    </Card>
  )
}

function WithdrawPanel({ request: r }: { request: ApprovalRequestDetail }) {
  const { slug } = useWorkspace()
  const action = useApprovalAction(slug, r.id)
  return (
    <ConfirmAction
      trigger={
        <Button variant="outline" className="w-full">
          Withdraw request
        </Button>
      }
      title="Withdraw this request?"
      description="Approvers will no longer see it as waiting. This cannot be undone."
      confirmLabel="Withdraw"
      onConfirm={async () => {
        try {
          await action.mutateAsync({ action: "cancel" })
          toast.success("Request withdrawn.")
        } catch (e) {
          toast.error(errorMessage(e))
        }
      }}
    />
  )
}
