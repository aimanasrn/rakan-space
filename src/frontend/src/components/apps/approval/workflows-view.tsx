"use client"

import { GitBranch, Lock, Plus } from "lucide-react"
import Link from "next/link"
import { useState } from "react"
import { EmptyState, ErrorState, LoadingRows } from "@/components/common"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useWorkspace } from "@/components/workspace/workspace-context"
import { timeAgo } from "@/lib/datetime"
import { ModuleHeader, Pager } from "../shared"
import { ApprovalNav } from "./approval-home-view"
import { useApprovalSummary, useWorkflows } from "./use-approvals"

export function WorkflowsView() {
  const { slug, href } = useWorkspace()
  const summary = useApprovalSummary(slug)
  const [q, setQ] = useState("")
  const [status, setStatus] = useState("all")
  const [page, setPage] = useState(1)
  const canManage = summary.data?.can_manage
  const workflows = useWorkflows(slug, { q: q || undefined, status, page })

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-4 md:p-8">
      <ModuleHeader
        app="approval"
        title="Workflows"
        description="Who approves what, in which order."
        actions={
          canManage ? (
            <Button asChild>
              <Link href={href("/apps/approval/workflows/new")}>
                <Plus aria-hidden /> New workflow
              </Link>
            </Button>
          ) : null
        }
      />
      <ApprovalNav />

      {summary.data && !canManage ? (
        <EmptyState icon={Lock} title="Only approval admins can manage workflows" />
      ) : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-3" role="search" aria-label="Filter workflows">
            <Label htmlFor="workflow-search" className="sr-only">
              Search workflows
            </Label>
            <Input id="workflow-search" placeholder="Search workflows…" value={q} onChange={(e) => (setQ(e.target.value), setPage(1))} className="max-w-xs" />
            <Select value={status} onValueChange={(v) => (setStatus(v), setPage(1))}>
              <SelectTrigger className="w-36" aria-label="Status">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                <SelectItem value="active">Active</SelectItem>
                <SelectItem value="inactive">Turned off</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {workflows.isPending ? (
            <LoadingRows rows={3} />
          ) : workflows.error ? (
            <ErrorState error={workflows.error} onRetry={() => workflows.refetch()} />
          ) : workflows.data.data.length ? (
            <>
              <ul className="divide-y rounded-xl border">
                {workflows.data.data.map((w) => (
                  <li key={w.id} className="relative flex flex-col gap-1 p-4 hover:bg-muted/40 sm:flex-row sm:items-center sm:gap-4">
                    <div className="min-w-0 flex-1">
                      <Link href={href(`/apps/approval/workflows/${w.id}`)} className="font-medium after:absolute after:inset-0 hover:underline">
                        {w.name}
                      </Link>
                      {w.description ? <p className="line-clamp-1 text-sm text-muted-foreground">{w.description}</p> : null}
                    </div>
                    <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      <span>
                        {w.steps_count} step{w.steps_count === 1 ? "" : "s"}
                      </span>
                      <span>·</span>
                      <span>{w.requests_count ?? 0} requests</span>
                      <span>·</span>
                      <span>updated {timeAgo(w.updated_at)}</span>
                      {w.is_active ? <Badge>Active</Badge> : <Badge variant="outline">Off</Badge>}
                    </div>
                  </li>
                ))}
              </ul>
              <Pager page={page} lastPage={workflows.data.meta.last_page} onPage={setPage} />
            </>
          ) : (
            <EmptyState
              icon={GitBranch}
              title={q || status !== "all" ? "No workflows match" : "No workflows yet"}
              description="A workflow lists the approval steps a request goes through."
            />
          )}
        </div>
      )}
    </div>
  )
}
