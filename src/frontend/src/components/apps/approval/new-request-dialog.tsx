"use client"

import { useQueryClient } from "@tanstack/react-query"
import { useRouter } from "next/navigation"
import { useState } from "react"
import { toast } from "sonner"
import { FormAlert, TextField, useFormErrors } from "@/components/form"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { FieldGroup } from "@/components/ui/field"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Spinner } from "@/components/ui/spinner"
import { orgPath, useWorkspace } from "@/components/workspace/workspace-context"
import { api } from "@/lib/api"
import type { ApprovalRequestDetail } from "@/lib/types"
import { approvalKeys, useWorkflowOptions } from "./use-approvals"

/** A request made directly in the Approval app (e.g. a budget sign-off). */
export function NewRequestDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { slug, href } = useWorkspace()
  const router = useRouter()
  const qc = useQueryClient()
  const workflows = useWorkflowOptions(slug, open)
  const { errors, formError, capture, reset, setErrors } = useFormErrors()
  const [workflowId, setWorkflowId] = useState("")
  const [pending, setPending] = useState(false)

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    reset()
    const form = new FormData(e.currentTarget)
    const title = String(form.get("title") ?? "").trim()
    const amount = String(form.get("amount") ?? "").trim()
    const clientErrors: Record<string, string> = {}
    if (!workflowId) clientErrors.workflow_id = "Choose a workflow."
    if (title.length < 3) clientErrors.title = "Give the request a title (at least 3 characters)."
    if (amount && (!Number.isFinite(Number(amount)) || Number(amount) < 0)) clientErrors.amount = "Enter a positive amount."
    if (Object.keys(clientErrors).length) return setErrors(clientErrors)

    setPending(true)
    try {
      const { data } = await api<{ data: ApprovalRequestDetail }>(orgPath(slug, "/approval/requests"), {
        method: "POST",
        body: { workflow_id: Number(workflowId), title, details: String(form.get("details") ?? "").trim() || null, amount: amount ? Number(amount) : null },
      })
      toast.success("Request sent for approval.")
      qc.invalidateQueries({ queryKey: approvalKeys.all(slug) })
      onOpenChange(false)
      router.push(href(`/apps/approval/requests/${data.id}`))
    } catch (error) {
      capture(error)
    } finally {
      setPending(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>New approval request</DialogTitle>
          <DialogDescription>The workflow decides who approves and in what order.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} noValidate>
          <FieldGroup>
            <FormAlert message={formError} />
            <div className="space-y-2">
              <Label htmlFor="request-workflow">Workflow</Label>
              <Select value={workflowId} onValueChange={setWorkflowId}>
                <SelectTrigger id="request-workflow" className="w-full" aria-invalid={!!errors.workflow_id}>
                  <SelectValue placeholder={workflows.isPending ? "Loading…" : "Choose a workflow"} />
                </SelectTrigger>
                <SelectContent>
                  {workflows.data?.map((w) => (
                    <SelectItem key={w.id} value={String(w.id)}>
                      {w.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {errors.workflow_id ? <p className="text-sm text-destructive">{errors.workflow_id}</p> : null}
              {workflows.data && !workflows.data.length ? <p className="text-sm text-muted-foreground">No active workflows yet. Ask an approval admin to create one.</p> : null}
            </div>
            <TextField id="title" label="Title" required maxLength={200} placeholder="e.g. Team offsite budget" error={errors.title} />
            <TextField id="details" label="Details" textarea rows={3} maxLength={1000} error={errors.details ?? errors.summary} />
            <TextField
              id="amount"
              label="Amount (optional)"
              type="number"
              min={0}
              step="0.01"
              inputMode="decimal"
              error={errors.amount}
              description="Some workflows add steps above a certain amount."
            />
          </FieldGroup>
          <DialogFooter className="mt-6">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? <Spinner /> : null}
              Send for approval
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
