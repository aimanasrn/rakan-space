"use client"

import { useQueryClient } from "@tanstack/react-query"
import { Pencil, Trash2 } from "lucide-react"
import Link from "next/link"
import { useParams, useRouter } from "next/navigation"
import { useState } from "react"
import { toast } from "sonner"
import { LoadingRows, UserAvatar } from "@/components/common"
import { ConfirmAction } from "@/components/confirm"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { orgPath, useWorkspace } from "@/components/workspace/workspace-context"
import { api, errorMessage } from "@/lib/api"
import { formatDateKey, formatDateTime, timeAgo } from "@/lib/datetime"
import type { CrmStage } from "@/lib/types"
import { cn } from "@/lib/utils"
import { LoadError, ModuleHeader } from "../shared"
import { ActivityFeed, LostReasonDialog, OpportunityDialog } from "./crm-forms"
import { crmKeys, formatMoney, useCrmSummary, useDeal } from "./use-crm"

export function DealDetailView() {
  const { dealId } = useParams<{ dealId: string }>()
  const id = Number(dealId)
  const { slug, href, org } = useWorkspace()
  const router = useRouter()
  const qc = useQueryClient()
  const deal = useDeal(slug, id)
  const summary = useCrmSummary(slug)
  const [editing, setEditing] = useState(false)
  const [losing, setLosing] = useState<CrmStage | null>(null)

  if (deal.isPending || summary.isPending) {
    return (
      <div className="mx-auto max-w-6xl p-4 md:p-8">
        <LoadingRows rows={6} />
      </div>
    )
  }
  if (deal.error || summary.error) {
    return (
      <div className="mx-auto max-w-6xl p-4 md:p-8">
        <LoadError error={deal.error ?? summary.error} onRetry={() => (deal.refetch(), summary.refetch())} what="Opportunity" />
      </div>
    )
  }

  const d = deal.data
  const stages = summary.data.stages
  const stage = stages.find((s) => s.id === d.stage_id)

  async function moveTo(s: CrmStage, lostReason?: string) {
    if (s.kind === "lost" && !lostReason) return setLosing(s)
    try {
      await api(orgPath(slug, `/crm/opportunities/${d.id}/move`), { method: "POST", body: { stage_id: s.id, lost_reason: lostReason } })
      qc.invalidateQueries({ queryKey: crmKeys.all(slug) })
      toast.success(s.kind === "won" ? "Marked as won 🎉" : `Moved to ${s.name}.`)
    } catch (e) {
      toast.error(errorMessage(e))
    }
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-4 md:p-8">
      <ModuleHeader
        app="opportunity"
        title={d.name}
        back={{ href: href("/apps/opportunity"), label: "Pipeline" }}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <span className="font-semibold text-foreground tabular-nums">{formatMoney(d.amount, true)}</span>
            {d.account ? (
              <Link href={href(`/apps/opportunity/accounts/${d.account.id}`)} className="hover:underline">
                · {d.account.name}
              </Link>
            ) : null}
            <span>· {stage?.name}</span>
          </span>
        }
        actions={
          <>
            {d.permissions.edit ? (
              <Button variant="outline" onClick={() => setEditing(true)}>
                <Pencil aria-hidden /> Edit
              </Button>
            ) : null}
            {d.permissions.delete ? (
              <ConfirmAction
                trigger={
                  <Button variant="outline" className="text-destructive">
                    <Trash2 aria-hidden /> Delete
                  </Button>
                }
                title="Delete this opportunity?"
                description="Its activities are deleted too. Mark it as lost instead if you want to keep the history."
                onConfirm={async () => {
                  try {
                    await api(orgPath(slug, `/crm/opportunities/${d.id}`), { method: "DELETE" })
                    qc.invalidateQueries({ queryKey: crmKeys.all(slug) })
                    router.push(href("/apps/opportunity"))
                  } catch (e) {
                    toast.error(errorMessage(e))
                  }
                }}
              />
            ) : null}
          </>
        }
      />

      {/* Stage steps: click to move (owner and sales managers). */}
      <nav aria-label="Stage" className="overflow-x-auto">
        <ol className="flex min-w-max gap-1">
          {stages.map((s) => {
            const current = s.id === d.stage_id
            return (
              <li key={s.id}>
                <button
                  type="button"
                  disabled={!d.permissions.edit || current}
                  aria-current={current ? "step" : undefined}
                  onClick={() => moveTo(s)}
                  className={cn(
                    "rounded-md border px-3 py-1.5 text-sm transition-colors enabled:hover:bg-muted disabled:cursor-default",
                    current && s.kind === "open" && "border-sky-500 bg-sky-500/10 font-medium",
                    current && s.kind === "won" && "border-emerald-500 bg-emerald-500/10 font-medium",
                    current && s.kind === "lost" && "border-muted-foreground/40 bg-muted font-medium",
                  )}
                >
                  {s.name}
                  {s.kind === "open" ? <span className="ml-1 text-xs text-muted-foreground">{s.probability}%</span> : null}
                </button>
              </li>
            )
          })}
        </ol>
      </nav>
      {d.lost_reason ? (
        <p className="rounded-lg border bg-muted/40 px-4 py-2 text-sm">
          <span className="font-medium">Lost:</span> {d.lost_reason}
        </p>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_18rem]">
        <section aria-labelledby="activity-heading" className="min-w-0 space-y-3">
          <h2 id="activity-heading" className="text-lg font-semibold">
            Activity
          </h2>
          <ActivityFeed activities={d.activities} opportunityId={d.id} canAdd={d.permissions.edit} />
        </section>
        <aside className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Details</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="space-y-3 text-sm">
                <Detail label="Owner">
                  <span className="flex items-center gap-2">
                    <UserAvatar user={d.owner} className="size-5" /> {d.owner?.name ?? "No owner"}
                  </span>
                </Detail>
                <Detail label="Expected close">{d.expected_close_date ? formatDateKey(d.expected_close_date) : "Not set"}</Detail>
                <Detail label="Contact">{d.contact?.name ?? "–"}</Detail>
                <Detail label="Weighted value">
                  {stage?.kind === "open" ? `${formatMoney((d.amount * (stage?.probability ?? 0)) / 100)} (${stage?.probability}%)` : "–"}
                </Detail>
                {d.closed_at ? <Detail label="Closed">{formatDateTime(d.closed_at, org.timezone)}</Detail> : null}
              </dl>
              {d.description ? <p className="mt-4 border-t pt-3 text-sm whitespace-pre-line">{d.description}</p> : null}
            </CardContent>
          </Card>
          {d.history.length ? (
            <Card>
              <CardHeader>
                <CardTitle>History</CardTitle>
              </CardHeader>
              <CardContent>
                <ol className="space-y-2 text-xs text-muted-foreground">
                  {d.history.map((h) => (
                    <li key={h.id}>
                      <span className="font-medium text-foreground">{h.actor ?? "System"}</span>{" "}
                      {h.event === "crm.stage_changed" ? `moved it from ${h.from} to ${h.to}` : "created it"}
                      <time dateTime={h.created_at} className="block">
                        {timeAgo(h.created_at)}
                      </time>
                    </li>
                  ))}
                </ol>
              </CardContent>
            </Card>
          ) : null}
        </aside>
      </div>

      {editing ? <OpportunityDialog open={editing} onOpenChange={setEditing} summary={summary.data} initial={d} /> : null}
      <LostReasonDialog
        opportunity={losing ? d : null}
        onCancel={() => setLosing(null)}
        onConfirm={async (reason) => {
          const s = losing
          setLosing(null)
          if (s) await moveTo(s, reason)
        }}
      />
    </div>
  )
}

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd>{children}</dd>
    </div>
  )
}
