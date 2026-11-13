"use client"

import { useQueryClient } from "@tanstack/react-query"
import { ExternalLink, Pencil, XCircle } from "lucide-react"
import Link from "next/link"
import { useParams } from "next/navigation"
import { useState } from "react"
import { toast } from "sonner"
import { LoadingRows, UserAvatar } from "@/components/common"
import { ConfirmAction } from "@/components/confirm"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { orgPath, useWorkspace } from "@/components/workspace/workspace-context"
import { api, errorMessage } from "@/lib/api"
import { formatDateTime } from "@/lib/datetime"
import type { LeaveRequestDetail } from "@/lib/types"
import { LoadError, ModuleHeader } from "../shared"
import { BalanceTable } from "./leave-home-view"
import { ApplyLeaveDialog, LeaveStatusBadge, TypeDot } from "./leave-parts"
import { formatDays, formatLeaveDates, leaveKeys, useLeaveRequest, useLeaveSummary } from "./use-leave"

/** One application, for the applicant, their manager, approvers and Leave admins. */
export function LeaveRequestDetailView() {
  const { requestId } = useParams<{ requestId: string }>()
  const id = Number(requestId)
  const { slug, href, org, me } = useWorkspace()
  const qc = useQueryClient()
  const leave = useLeaveRequest(slug, id)
  const [editing, setEditing] = useState(false)
  const [confirm, setConfirm] = useState(false)
  const l = leave.data
  // Managers and admins see the applicant's balance next to the application.
  const balances = useLeaveSummary(slug, { user_id: l?.user?.id, year: l ? Number(l.start_date.slice(0, 4)) : undefined }, !!l?.user)

  if (leave.isPending) {
    return (
      <div className="mx-auto max-w-4xl p-4 md:p-8">
        <LoadingRows rows={6} />
      </div>
    )
  }
  if (leave.error || !l) {
    return (
      <div className="mx-auto max-w-4xl p-4 md:p-8">
        <LoadError error={leave.error} onRetry={() => leave.refetch()} what="Leave application" />
      </div>
    )
  }

  const mine = l.user?.id === me.id

  async function cancel() {
    try {
      const { data } = await api<{ data: LeaveRequestDetail }>(orgPath(slug, `/leave/requests/${id}/cancel`), { method: "POST" })
      qc.setQueryData(leaveKeys.request(slug, id), data)
      qc.invalidateQueries({ queryKey: leaveKeys.all(slug) })
      toast.success("Leave cancelled.")
    } catch (e) {
      toast.error(errorMessage(e))
    }
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-4 md:p-8">
      <ModuleHeader
        app="leave"
        title={l.type?.name ?? "Leave"}
        back={{ href: href(mine ? "/apps/leave" : "/apps/leave?tab=team"), label: "Leave" }}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <LeaveStatusBadge status={l.status} />
            {l.user ? (
              <span className="flex items-center gap-1.5">
                <UserAvatar user={l.user} className="size-5" /> {l.user.name}
              </span>
            ) : null}
          </span>
        }
        actions={
          <>
            {l.permissions.edit ? (
              <Button onClick={() => setEditing(true)}>
                <Pencil aria-hidden /> Change and resend
              </Button>
            ) : null}
            {l.permissions.cancel ? (
              <Button variant="outline" onClick={() => setConfirm(true)}>
                <XCircle aria-hidden /> {l.status === "approved" ? "Cancel leave" : "Withdraw"}
              </Button>
            ) : null}
            {l.approval?.can_view ? (
              <Button asChild variant="outline">
                <Link href={href(`/apps/approval/requests/${l.approval.id}`)}>
                  <ExternalLink aria-hidden /> View approval
                </Link>
              </Button>
            ) : null}
          </>
        }
      />

      <Card>
        <CardContent className="grid gap-4 pt-6 sm:grid-cols-2">
          <Detail label="Leave type">
            <span className="flex items-center gap-2">
              <TypeDot color={l.type?.color ?? "#71717a"} /> {l.type?.name}
            </span>
          </Detail>
          <Detail label="Dates">{formatLeaveDates(l)}</Detail>
          <Detail label="Working days">{formatDays(l.days)}</Detail>
          <Detail label="Submitted">{l.submitted_at ? formatDateTime(l.submitted_at, org.timezone) : "—"}</Detail>
          <div className="sm:col-span-2">
            <Detail label="Reason">{l.reason ? <span className="whitespace-pre-wrap">{l.reason}</span> : <span className="text-muted-foreground">No reason given</span>}</Detail>
          </div>
        </CardContent>
      </Card>

      {l.status === "pending_approval" && l.approval?.current_step ? (
        <p className="text-sm text-muted-foreground">Waiting for: {l.approval.current_step}.</p>
      ) : null}
      {l.approval?.comment && l.status !== "pending_approval" ? (
        <div className="rounded-lg border bg-muted/40 px-4 py-3 text-sm" role="note">
          <p className="font-medium">{l.approval.decided_by ?? "Approver"} wrote:</p>
          <p className="mt-1 whitespace-pre-wrap">{l.approval.comment}</p>
        </div>
      ) : null}

      {balances.data ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              {mine ? "Your" : `${l.user?.name}'s`} balances for {balances.data.year}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <BalanceTable summary={balances.data} />
          </CardContent>
        </Card>
      ) : null}

      <ApplyLeaveDialog open={editing} onOpenChange={setEditing} leave={l} />
      <ConfirmAction
        open={confirm}
        onOpenChange={setConfirm}
        title={l.status === "approved" ? "Cancel this leave?" : "Withdraw this application?"}
        description={l.status === "approved" ? "The days go back to your balance and your manager is told." : "It will no longer wait for approval."}
        confirmLabel={l.status === "approved" ? "Cancel leave" : "Withdraw"}
        onConfirm={cancel}
      />
    </div>
  )
}

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <p className="text-xs font-medium text-muted-foreground uppercase">{label}</p>
      <div className="text-sm">{children}</div>
    </div>
  )
}
