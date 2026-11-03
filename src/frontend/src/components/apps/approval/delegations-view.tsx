"use client"

import { useQueryClient } from "@tanstack/react-query"
import { ArrowRight, Plane, Plus } from "lucide-react"
import { useState } from "react"
import { toast } from "sonner"
import { EmptyState, ErrorState, LoadingRows, UserAvatar } from "@/components/common"
import { ConfirmAction } from "@/components/confirm"
import { FormAlert, TextField, useFormErrors } from "@/components/form"
import { PersonSelect } from "@/components/pickers"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { FieldGroup } from "@/components/ui/field"
import { Label } from "@/components/ui/label"
import { Spinner } from "@/components/ui/spinner"
import { orgPath, useWorkspace } from "@/components/workspace/workspace-context"
import { useMemberOptions } from "@/hooks/use-workspace-data"
import { api, errorMessage } from "@/lib/api"
import { formatDateTime, zonedToUtc } from "@/lib/datetime"
import type { ApprovalDelegation } from "@/lib/types"
import { ModuleHeader } from "../shared"
import { ApprovalNav } from "./approval-home-view"
import { approvalKeys, useDelegations } from "./use-approvals"

export function DelegationsView() {
  const [creating, setCreating] = useState(false)
  return (
    <div className="mx-auto max-w-4xl space-y-6 p-4 md:p-8">
      <ModuleHeader
        app="approval"
        title="Out of office"
        description="While you are away, someone else approves on your behalf."
        actions={
          <Button onClick={() => setCreating(true)}>
            <Plus aria-hidden /> Delegate my approvals
          </Button>
        }
      />
      <ApprovalNav />
      <DelegationList scope="mine" title="Your delegations" description="Approvals that reach you during these periods go to the person you chose. Approvals already waiting for you move to them as soon as the period starts." />
      <DelegationList scope="to_me" title="Delegated to you" description="You approve on behalf of these people." />
      <CreateDelegationDialog open={creating} onOpenChange={setCreating} />
    </div>
  )
}

const STATUS_LABEL: Record<ApprovalDelegation["status"], string> = { active: "Active now", scheduled: "Scheduled", ended: "Ended", revoked: "Cancelled" }

function DelegationList({ scope, title, description }: { scope: "mine" | "to_me"; title: string; description: string }) {
  const { slug, org } = useWorkspace()
  const qc = useQueryClient()
  const list = useDelegations(slug, scope)

  async function revoke(d: ApprovalDelegation) {
    try {
      await api(orgPath(slug, `/approval/delegations/${d.id}`), { method: "DELETE" })
      toast.success("Delegation cancelled.")
      qc.invalidateQueries({ queryKey: approvalKeys.all(slug) })
    } catch (e) {
      toast.error(errorMessage(e))
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>
        {list.isPending ? (
          <LoadingRows rows={2} />
        ) : list.error ? (
          <ErrorState error={list.error} onRetry={() => list.refetch()} />
        ) : list.data.length ? (
          <ul className="divide-y">
            {list.data.map((d) => (
              <li key={d.id} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center">
                <div className="flex min-w-0 flex-1 items-center gap-2 text-sm">
                  <UserAvatar user={d.delegator} className="size-6" />
                  <span className="truncate">{d.delegator.name}</span>
                  <ArrowRight className="size-4 shrink-0 text-muted-foreground" aria-label="to" />
                  <UserAvatar user={d.delegate} className="size-6" />
                  <span className="truncate">{d.delegate.name}</span>
                </div>
                <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <span>
                    {formatDateTime(d.starts_at, org.timezone)} – {formatDateTime(d.ends_at, org.timezone)}
                  </span>
                  {d.reason ? <span>· {d.reason}</span> : null}
                  <Badge variant={d.status === "active" ? "default" : "outline"}>{STATUS_LABEL[d.status]}</Badge>
                  {d.can_revoke ? (
                    <ConfirmAction
                      trigger={
                        <Button variant="ghost" size="sm">
                          Cancel
                        </Button>
                      }
                      title="Cancel this delegation?"
                      description="New approvals will come to you again. Approvals already handed over stay with the delegate."
                      confirmLabel="Cancel delegation"
                      onConfirm={() => revoke(d)}
                    />
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState icon={Plane} title="None" className="border-none" />
        )}
      </CardContent>
    </Card>
  )
}

function CreateDelegationDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { slug, me, org } = useWorkspace()
  const qc = useQueryClient()
  const members = useMemberOptions(slug)
  const people = (members.data ?? []).map((m) => m.user).filter((u) => u.id !== me.id)
  const { errors, formError, capture, reset, setErrors } = useFormErrors()
  const [delegateId, setDelegateId] = useState<number | null>(null)
  const [pending, setPending] = useState(false)

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    reset()
    const form = new FormData(e.currentTarget)
    const start = String(form.get("starts_at") ?? "")
    const end = String(form.get("ends_at") ?? "")
    const clientErrors: Record<string, string> = {}
    if (!delegateId) clientErrors.delegate_id = "Choose who approves for you."
    if (!start) clientErrors.starts_at = "Choose when it starts."
    if (!end) clientErrors.ends_at = "Choose when it ends."
    if (start && end && end <= start) clientErrors.ends_at = "The end must be after the start."
    if (Object.keys(clientErrors).length) return setErrors(clientErrors)

    const toUtc = (value: string) => {
      const [date, time] = value.split("T")
      return zonedToUtc(date, time, org.timezone).toISOString()
    }
    setPending(true)
    try {
      await api(orgPath(slug, "/approval/delegations"), {
        method: "POST",
        body: { delegate_id: delegateId, starts_at: toUtc(start), ends_at: toUtc(end), reason: String(form.get("reason") ?? "").trim() || null },
      })
      toast.success("Your approvals will be delegated.")
      qc.invalidateQueries({ queryKey: approvalKeys.all(slug) })
      setDelegateId(null)
      onOpenChange(false)
    } catch (error) {
      capture(error)
    } finally {
      setPending(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delegate my approvals</DialogTitle>
          <DialogDescription>Times are in the workspace time zone ({org.timezone}).</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} noValidate>
          <FieldGroup>
            <FormAlert message={formError} />
            <div className="space-y-2">
              <Label htmlFor="delegate">Approve on my behalf</Label>
              <PersonSelect id="delegate" people={people} value={delegateId} onChange={setDelegateId} placeholder="Choose a person" allowNone={false} />
              {errors.delegate_id ? <p className="text-sm text-destructive">{errors.delegate_id}</p> : null}
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <TextField id="starts_at" label="From" type="datetime-local" required error={errors.starts_at} />
              <TextField id="ends_at" label="Until" type="datetime-local" required error={errors.ends_at} />
            </div>
            <TextField id="reason" label="Reason (optional)" maxLength={255} placeholder="e.g. Annual leave" error={errors.reason} />
          </FieldGroup>
          <DialogFooter className="mt-6">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? <Spinner /> : null} Delegate
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
