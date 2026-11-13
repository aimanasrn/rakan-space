"use client"

import { useQueryClient } from "@tanstack/react-query"
import { useRouter } from "next/navigation"
import { useState } from "react"
import { toast } from "sonner"
import { FormAlert, TextField, useFormErrors } from "@/components/form"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Label } from "@/components/ui/label"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Spinner } from "@/components/ui/spinner"
import { orgPath, useWorkspace } from "@/components/workspace/workspace-context"
import { api } from "@/lib/api"
import { todayKey } from "@/lib/datetime"
import type { LeaveHalfDay, LeaveRequestDetail, LeaveStatus } from "@/lib/types"
import { cn } from "@/lib/utils"
import { StatusBadge } from "../shared"
import { countWorkingDays, formatDays, leaveKeys, useLeaveSummary } from "./use-leave"

export function TypeDot({ color, className }: { color: string; className?: string }) {
  return <span className={cn("inline-block size-2.5 shrink-0 rounded-full", className)} style={{ backgroundColor: color }} aria-hidden />
}

export function LeaveStatusBadge({ status, className }: { status: LeaveStatus; className?: string }) {
  if (status === "cancelled") return <Badge className={cn("border-transparent bg-muted text-muted-foreground", className)}>Cancelled</Badge>
  return <StatusBadge status={status} className={className} />
}

/** New application, or changes to one that was returned (pass `leave`). */
export function ApplyLeaveDialog({ open, onOpenChange, leave }: { open: boolean; onOpenChange: (open: boolean) => void; leave?: LeaveRequestDetail }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        {/* Remount on open so the form starts fresh. */}
        {open ? <ApplyForm leave={leave} onDone={() => onOpenChange(false)} /> : null}
      </DialogContent>
    </Dialog>
  )
}

function ApplyForm({ leave, onDone }: { leave?: LeaveRequestDetail; onDone: () => void }) {
  const { slug, href, org } = useWorkspace()
  const qc = useQueryClient()
  const router = useRouter()
  const today = todayKey(org.timezone)
  const [typeId, setTypeId] = useState<string>(leave?.type ? String(leave.type.id) : "")
  const [start, setStart] = useState(leave?.start_date ?? today)
  const [end, setEnd] = useState(leave?.end_date ?? today)
  const [halfDay, setHalfDay] = useState<LeaveHalfDay>(leave?.half_day ?? "none")
  const [reason, setReason] = useState(leave?.reason ?? "")
  const [pending, setPending] = useState(false)
  const { errors, formError, capture, reset } = useFormErrors()

  const year = Number((start || today).slice(0, 4))
  const summary = useLeaveSummary(slug, { year })
  const types = (summary.data?.types ?? []).filter((t) => t.is_active)
  const chosen = types.find((t) => String(t.id) === typeId)
  const single = !!start && start === end
  const days = countWorkingDays(start, end, single ? halfDay : "none")
  // Balance still free for this application (other applications waiting for a decision count too).
  const ownDays = leave && chosen && leave.type?.id === chosen.id && leave.start_date.slice(0, 4) === String(year) ? leave.days : 0
  const available = chosen && chosen.eligible !== null ? Math.round((chosen.eligible - chosen.taken - chosen.pending + ownDays) * 10) / 10 : null

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    reset()
    setPending(true)
    try {
      const body = { leave_type_id: Number(typeId) || null, start_date: start, end_date: end, half_day: single ? halfDay : "none", reason: reason.trim() || null }
      const { data } = await api<{ data: LeaveRequestDetail }>(orgPath(slug, leave ? `/leave/requests/${leave.id}` : "/leave/requests"), {
        method: leave ? "PUT" : "POST",
        body,
      })
      qc.invalidateQueries({ queryKey: leaveKeys.all(slug) })
      qc.setQueryData(leaveKeys.request(slug, data.id), data)
      toast.success(leave ? "Application sent again." : data.status === "approved" ? "Leave approved." : "Leave application sent for approval.")
      onDone()
      if (!leave) router.push(href(`/apps/leave/requests/${data.id}`))
    } catch (error) {
      capture(error)
      setPending(false)
    }
  }

  return (
    <form onSubmit={submit} noValidate>
      <DialogHeader>
        <DialogTitle>{leave ? "Change and resend application" : "Apply for leave"}</DialogTitle>
        <DialogDescription>Leave counts working days (Monday to Friday). Your reporting manager approves it.</DialogDescription>
      </DialogHeader>
      <FieldGroup className="my-5">
        <FormAlert message={formError} />
        <Field data-invalid={errors.leave_type_id ? true : undefined}>
          <FieldLabel htmlFor="lv-type">Leave type</FieldLabel>
          <Select value={typeId} onValueChange={setTypeId}>
            <SelectTrigger id="lv-type" aria-invalid={!!errors.leave_type_id} aria-describedby={errors.leave_type_id ? "lv-type-error" : undefined}>
              <SelectValue placeholder={summary.isPending ? "Loading…" : "Choose a leave type"} />
            </SelectTrigger>
            <SelectContent>
              {types.map((t) => (
                <SelectItem key={t.id} value={String(t.id)}>
                  <span className="flex items-center gap-2">
                    <TypeDot color={t.color} />
                    {t.name}
                    <span className="text-muted-foreground">· {t.balance === null ? "no limit" : `${Math.round(t.balance * 10) / 10} left`}</span>
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {errors.leave_type_id ? <FieldError id="lv-type-error">{errors.leave_type_id}</FieldError> : null}
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField
            id="lv-start"
            label="First day"
            type="date"
            value={start}
            onChange={(e) => {
              setStart(e.target.value)
              if (!end || e.target.value > end) setEnd(e.target.value)
            }}
            error={errors.start_date}
            required
          />
          <TextField id="lv-end" label="Last day" type="date" value={end} min={start} onChange={(e) => setEnd(e.target.value)} error={errors.end_date} required />
        </div>
        {single ? (
          <Field data-invalid={errors.half_day ? true : undefined}>
            <FieldLabel id="lv-half-label">Duration</FieldLabel>
            <RadioGroup value={halfDay} onValueChange={(v) => setHalfDay(v as LeaveHalfDay)} aria-labelledby="lv-half-label" className="flex flex-wrap gap-4">
              {(
                [
                  ["none", "Full day"],
                  ["am", "Morning"],
                  ["pm", "Afternoon"],
                ] as const
              ).map(([value, label]) => (
                <div key={value} className="flex items-center gap-2">
                  <RadioGroupItem value={value} id={`lv-half-${value}`} />
                  <Label htmlFor={`lv-half-${value}`} className="font-normal">
                    {label}
                  </Label>
                </div>
              ))}
            </RadioGroup>
            {errors.half_day ? <FieldError>{errors.half_day}</FieldError> : null}
          </Field>
        ) : null}
        <p className="rounded-lg bg-muted/60 px-3 py-2 text-sm" role="status">
          {days > 0 ? (
            <>
              <strong>{formatDays(days)}</strong>
              {available !== null ? (
                <span className={cn("text-muted-foreground", days > available && "font-medium text-destructive")}>
                  {" "}
                  · {Math.max(available, 0)} available
                  {days > available ? " — not enough balance" : ""}
                </span>
              ) : null}
            </>
          ) : (
            <span className="text-muted-foreground">These dates have no working days.</span>
          )}
        </p>
        <TextField id="lv-reason" label="Reason (optional)" textarea rows={3} maxLength={1000} value={reason} onChange={(e) => setReason(e.target.value)} error={errors.reason} />
      </FieldGroup>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" disabled={pending || !typeId}>
          {pending ? <Spinner /> : null} {leave ? "Send again" : "Apply"}
        </Button>
      </DialogFooter>
    </form>
  )
}
