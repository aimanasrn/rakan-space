"use client"

import { useQueryClient } from "@tanstack/react-query"
import { CalendarCheck, Mail, MessageSquareText, Phone, Plus, StickyNote, Trash2, Users } from "lucide-react"
import Link from "next/link"
import { useState } from "react"
import { toast } from "sonner"
import { UserAvatar } from "@/components/common"
import { ConfirmAction } from "@/components/confirm"
import { FormAlert, TextField, useFormErrors } from "@/components/form"
import { PersonSelect } from "@/components/pickers"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Spinner } from "@/components/ui/spinner"
import { orgPath, useWorkspace } from "@/components/workspace/workspace-context"
import { useMemberOptions } from "@/hooks/use-workspace-data"
import { api, errorMessage } from "@/lib/api"
import { formatDateTime, timeAgo, zonedToUtc } from "@/lib/datetime"
import type { CrmAccount, CrmActivity, CrmActivityType, CrmContact, CrmOpportunity, CrmOpportunityDetail, CrmSummary } from "@/lib/types"
import { cn } from "@/lib/utils"
import { crmKeys, useAccounts, useContacts } from "./use-crm"

const NONE = "none"

function FieldError({ message }: { message?: string }) {
  return message ? <p className="text-sm text-destructive">{message}</p> : null
}

/** Create or edit an opportunity. */
export function OpportunityDialog({
  open,
  onOpenChange,
  summary,
  initial,
  defaultAccountId,
  onSaved,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  summary: CrmSummary
  initial?: CrmOpportunityDetail
  defaultAccountId?: number
  onSaved?: (o: CrmOpportunityDetail) => void
}) {
  const { slug, me } = useWorkspace()
  const qc = useQueryClient()
  const accounts = useAccounts(slug, { per_page: 100 }, open)
  const members = useMemberOptions(slug)
  const [accountId, setAccountId] = useState<string>(String(initial?.account?.id ?? defaultAccountId ?? NONE))
  const contacts = useContacts(slug, { account_id: accountId === NONE ? undefined : Number(accountId), per_page: 200 }, open && accountId !== NONE)
  const [contactId, setContactId] = useState<string>(String(initial?.contact?.id ?? NONE))
  const firstOpen = summary.stages.find((s) => s.kind === "open")
  const [stageId, setStageId] = useState<string>(String(initial?.stage_id ?? firstOpen?.id ?? ""))
  const [ownerId, setOwnerId] = useState<number | null>(initial?.owner?.id ?? me.id)
  const { errors, formError, capture, reset } = useFormErrors()
  const [pending, setPending] = useState(false)
  const stage = summary.stages.find((s) => String(s.id) === stageId)

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    reset()
    const form = new FormData(e.currentTarget)
    const body: Record<string, unknown> = {
      name: String(form.get("name") ?? "").trim(),
      amount: Number(form.get("amount") || 0),
      account_id: accountId === NONE ? null : Number(accountId),
      contact_id: contactId === NONE ? null : Number(contactId),
      stage_id: Number(stageId),
      expected_close_date: String(form.get("expected_close_date") ?? "") || null,
      description: String(form.get("description") ?? "").trim() || null,
    }
    if (stage?.kind === "lost") body.lost_reason = String(form.get("lost_reason") ?? "").trim()
    if (summary.see_all && ownerId) body.owner_id = ownerId
    setPending(true)
    try {
      const { data } = await api<{ data: CrmOpportunityDetail }>(orgPath(slug, initial ? `/crm/opportunities/${initial.id}` : "/crm/opportunities"), {
        method: initial ? "PATCH" : "POST",
        body,
      })
      qc.invalidateQueries({ queryKey: crmKeys.all(slug) })
      toast.success(initial ? "Opportunity saved." : "Opportunity added.")
      onOpenChange(false)
      onSaved?.(data)
    } catch (error) {
      capture(error)
    } finally {
      setPending(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <form onSubmit={submit} className="space-y-4" noValidate>
          <DialogHeader>
            <DialogTitle>{initial ? "Edit opportunity" : "New opportunity"}</DialogTitle>
            <DialogDescription>A deal you are working on, its value and when you expect to close it.</DialogDescription>
          </DialogHeader>
          <FormAlert message={formError} />
          <TextField id="op-name" name="name" label="Name" required maxLength={200} defaultValue={initial?.name} error={errors.name} placeholder="e.g. Online shop for Kedai Maju" />
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField id="op-amount" name="amount" label="Value (RM)" type="number" min={0} step="0.01" defaultValue={initial?.amount ?? ""} error={errors.amount} />
            <TextField
              id="op-close"
              name="expected_close_date"
              label="Expected close"
              type="date"
              defaultValue={initial?.expected_close_date ?? ""}
              error={errors.expected_close_date}
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="op-account">Account</Label>
              <Select
                value={accountId}
                onValueChange={(v) => {
                  setAccountId(v)
                  setContactId(NONE)
                }}
              >
                <SelectTrigger id="op-account" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>No account</SelectItem>
                  {initial?.account && !accounts.data?.data.some((a) => a.id === initial.account?.id) ? (
                    <SelectItem value={String(initial.account.id)}>{initial.account.name}</SelectItem>
                  ) : null}
                  {accounts.data?.data.map((a) => (
                    <SelectItem key={a.id} value={String(a.id)}>
                      {a.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FieldError message={errors.account_id} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="op-contact">Contact</Label>
              <Select value={contactId} onValueChange={setContactId} disabled={accountId === NONE}>
                <SelectTrigger id="op-contact" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>No contact</SelectItem>
                  {initial?.contact && !contacts.data?.data.some((c) => c.id === initial.contact?.id) ? (
                    <SelectItem value={String(initial.contact.id)}>{initial.contact.name}</SelectItem>
                  ) : null}
                  {contacts.data?.data.map((c) => (
                    <SelectItem key={c.id} value={String(c.id)}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FieldError message={errors.contact_id} />
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="op-stage">Stage</Label>
              <Select value={stageId} onValueChange={setStageId}>
                <SelectTrigger id="op-stage" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {summary.stages.map((s) => (
                    <SelectItem key={s.id} value={String(s.id)}>
                      {s.name} · {s.probability}%
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FieldError message={errors.stage_id} />
            </div>
            {summary.see_all ? (
              <div className="space-y-2">
                <Label htmlFor="op-owner">Owner</Label>
                <PersonSelect
                  id="op-owner"
                  people={(members.data ?? []).filter((m) => m.status === "active").map((m) => m.user)}
                  value={ownerId}
                  onChange={setOwnerId}
                  allowNone={false}
                />
                <FieldError message={errors.owner_id} />
              </div>
            ) : null}
          </div>
          {stage?.kind === "lost" ? (
            <TextField id="op-lost" name="lost_reason" label="Why was it lost?" required maxLength={300} defaultValue={initial?.lost_reason ?? ""} error={errors.lost_reason} />
          ) : null}
          <TextField id="op-desc" name="description" label="Notes" textarea rows={3} maxLength={10000} defaultValue={initial?.description ?? ""} error={errors.description} />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? <Spinner /> : null} {initial ? "Save" : "Add opportunity"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/** Asked when a card is moved to a Lost stage. */
export function LostReasonDialog({
  opportunity,
  onCancel,
  onConfirm,
}: {
  opportunity: CrmOpportunity | null
  onCancel: () => void
  onConfirm: (reason: string) => Promise<void>
}) {
  const [reason, setReason] = useState("")
  const [pending, setPending] = useState(false)
  return (
    <Dialog open={opportunity !== null} onOpenChange={(o) => !o && onCancel()}>
      <DialogContent>
        <form
          onSubmit={async (e) => {
            e.preventDefault()
            if (!reason.trim()) return
            setPending(true)
            await onConfirm(reason.trim())
            setPending(false)
            setReason("")
          }}
          className="space-y-4"
        >
          <DialogHeader>
            <DialogTitle>Mark as lost</DialogTitle>
            <DialogDescription>{opportunity?.name}: what happened? This helps the team learn from lost deals.</DialogDescription>
          </DialogHeader>
          <Label htmlFor="lost-reason" className="sr-only">
            Reason
          </Label>
          <Input id="lost-reason" autoFocus maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Chose a cheaper vendor" />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onCancel}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending || !reason.trim()}>
              {pending ? <Spinner /> : null} Mark lost
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export function AccountDialog({
  open,
  onOpenChange,
  initial,
  onSaved,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  initial?: CrmAccount
  onSaved?: (a: CrmAccount) => void
}) {
  const { slug } = useWorkspace()
  const qc = useQueryClient()
  const { errors, formError, capture, reset } = useFormErrors()
  const [pending, setPending] = useState(false)

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    reset()
    const form = new FormData(e.currentTarget)
    const value = (k: string) => String(form.get(k) ?? "").trim() || null
    setPending(true)
    try {
      const { data } = await api<{ data: CrmAccount }>(orgPath(slug, initial ? `/crm/accounts/${initial.id}` : "/crm/accounts"), {
        method: initial ? "PATCH" : "POST",
        body: { name: value("name") ?? "", industry: value("industry"), website: value("website"), phone: value("phone"), address: value("address"), notes: value("notes") },
      })
      qc.invalidateQueries({ queryKey: crmKeys.all(slug) })
      toast.success(initial ? "Account saved." : "Account added.")
      onOpenChange(false)
      onSaved?.(data)
    } catch (error) {
      capture(error)
    } finally {
      setPending(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <form onSubmit={submit} className="space-y-4" noValidate>
          <DialogHeader>
            <DialogTitle>{initial ? "Edit account" : "New account"}</DialogTitle>
            <DialogDescription>A customer company. Everyone using the Opportunity app can see accounts.</DialogDescription>
          </DialogHeader>
          <FormAlert message={formError} />
          <TextField id="ac-name" name="name" label="Company name" required maxLength={160} defaultValue={initial?.name} error={errors.name} />
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField id="ac-industry" name="industry" label="Industry" maxLength={80} defaultValue={initial?.industry ?? ""} error={errors.industry} />
            <TextField id="ac-phone" name="phone" label="Phone" maxLength={40} defaultValue={initial?.phone ?? ""} error={errors.phone} />
          </div>
          <TextField id="ac-website" name="website" label="Website" type="url" placeholder="https://" defaultValue={initial?.website ?? ""} error={errors.website} />
          <TextField id="ac-address" name="address" label="Address" maxLength={500} defaultValue={initial?.address ?? ""} error={errors.address} />
          <TextField id="ac-notes" name="notes" label="Notes" textarea rows={3} defaultValue={initial?.notes ?? ""} error={errors.notes} />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? <Spinner /> : null} {initial ? "Save" : "Add account"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export function ContactDialog({
  open,
  onOpenChange,
  initial,
  accountId,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  initial?: CrmContact
  accountId?: number
}) {
  const { slug } = useWorkspace()
  const qc = useQueryClient()
  const accounts = useAccounts(slug, { per_page: 100 }, open && accountId === undefined)
  const [account, setAccount] = useState<string>(String(initial?.account?.id ?? accountId ?? NONE))
  const { errors, formError, capture, reset } = useFormErrors()
  const [pending, setPending] = useState(false)

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    reset()
    const form = new FormData(e.currentTarget)
    const value = (k: string) => String(form.get(k) ?? "").trim() || null
    setPending(true)
    try {
      await api(orgPath(slug, initial ? `/crm/contacts/${initial.id}` : "/crm/contacts"), {
        method: initial ? "PATCH" : "POST",
        body: { name: value("name") ?? "", email: value("email"), phone: value("phone"), job_title: value("job_title"), account_id: account === NONE ? null : Number(account) },
      })
      qc.invalidateQueries({ queryKey: crmKeys.all(slug) })
      toast.success(initial ? "Contact saved." : "Contact added.")
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
        <form onSubmit={submit} className="space-y-4" noValidate>
          <DialogHeader>
            <DialogTitle>{initial ? "Edit contact" : "New contact"}</DialogTitle>
          </DialogHeader>
          <FormAlert message={formError} />
          <TextField id="ct-name" name="name" label="Name" required maxLength={160} defaultValue={initial?.name} error={errors.name} />
          <TextField id="ct-title" name="job_title" label="Job title" maxLength={120} defaultValue={initial?.job_title ?? ""} error={errors.job_title} />
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField id="ct-email" name="email" label="Email" type="email" defaultValue={initial?.email ?? ""} error={errors.email} />
            <TextField id="ct-phone" name="phone" label="Phone" maxLength={40} defaultValue={initial?.phone ?? ""} error={errors.phone} />
          </div>
          {accountId === undefined ? (
            <div className="space-y-2">
              <Label htmlFor="ct-account">Account</Label>
              <Select value={account} onValueChange={setAccount}>
                <SelectTrigger id="ct-account" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>No account</SelectItem>
                  {initial?.account && !accounts.data?.data.some((a) => a.id === initial.account?.id) ? (
                    <SelectItem value={String(initial.account.id)}>{initial.account.name}</SelectItem>
                  ) : null}
                  {accounts.data?.data.map((a) => (
                    <SelectItem key={a.id} value={String(a.id)}>
                      {a.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FieldError message={errors.account_id} />
            </div>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? <Spinner /> : null} {initial ? "Save" : "Add contact"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

// ------------------------------------------------------------- activities

export const ACTIVITY_TYPES: { value: CrmActivityType; label: string; icon: typeof Phone }[] = [
  { value: "note", label: "Note", icon: StickyNote },
  { value: "call", label: "Call", icon: Phone },
  { value: "meeting", label: "Meeting", icon: Users },
  { value: "email", label: "Email", icon: Mail },
  { value: "task", label: "Follow-up task", icon: CalendarCheck },
]

/** Timeline of activities with a form to log a new one. */
export function ActivityFeed({
  activities,
  opportunityId,
  accountId,
  canAdd,
  showParent,
}: {
  activities: CrmActivity[]
  opportunityId?: number
  accountId?: number
  canAdd: boolean
  showParent?: boolean
}) {
  return (
    <div className="space-y-4">
      {canAdd ? <ActivityComposer opportunityId={opportunityId} accountId={accountId} /> : null}
      {activities.length ? (
        <ol className="space-y-3" aria-label="Activities">
          {activities.map((a) => (
            <li key={a.id}>
              <ActivityItem activity={a} showParent={showParent} />
            </li>
          ))}
        </ol>
      ) : (
        <p className="text-sm text-muted-foreground">No activity yet.</p>
      )}
    </div>
  )
}

function ActivityComposer({ opportunityId, accountId }: { opportunityId?: number; accountId?: number }) {
  const { slug, org } = useWorkspace()
  const qc = useQueryClient()
  const [type, setType] = useState<CrmActivityType>("note")
  const [subject, setSubject] = useState("")
  const [body, setBody] = useState("")
  const [due, setDue] = useState("")
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!subject.trim()) return setError("Add a short subject.")
    setError(null)
    setPending(true)
    try {
      await api(orgPath(slug, "/crm/activities"), {
        method: "POST",
        body: {
          type,
          subject: subject.trim(),
          body: body.trim() || null,
          // Due dates are picked in the organisation's time zone, at 9am.
          due_at: type === "task" && due ? zonedToUtc(due, "09:00", org.timezone).toISOString() : null,
          opportunity_id: opportunityId ?? null,
          account_id: opportunityId ? null : (accountId ?? null),
        },
      })
      qc.invalidateQueries({ queryKey: crmKeys.all(slug) })
      setSubject("")
      setBody("")
      setDue("")
      toast.success(type === "task" ? "Follow-up added." : "Activity logged.")
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setPending(false)
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3 rounded-xl border p-4">
      <div className="flex flex-wrap gap-2">
        <Label htmlFor="act-type" className="sr-only">
          Activity type
        </Label>
        <Select value={type} onValueChange={(v) => setType(v as CrmActivityType)}>
          <SelectTrigger id="act-type" className="w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {ACTIVITY_TYPES.map((t) => (
              <SelectItem key={t.value} value={t.value}>
                {t.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Label htmlFor="act-subject" className="sr-only">
          Subject
        </Label>
        <Input
          id="act-subject"
          className="min-w-48 flex-1"
          maxLength={200}
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          placeholder={type === "task" ? "What needs doing?" : "Summary, e.g. Discussed pricing"}
        />
        {type === "task" ? (
          <>
            <Label htmlFor="act-due" className="sr-only">
              Due date
            </Label>
            <Input id="act-due" type="date" className="w-40" value={due} onChange={(e) => setDue(e.target.value)} />
          </>
        ) : null}
      </div>
      <Label htmlFor="act-body" className="sr-only">
        Details
      </Label>
      <textarea
        id="act-body"
        rows={2}
        maxLength={10000}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder="Details (optional)"
        className="w-full rounded-md border bg-transparent px-3 py-2 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
      />
      <FormAlert message={error} />
      <div className="flex justify-end">
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? <Spinner /> : <Plus aria-hidden />} {type === "task" ? "Add follow-up" : "Log activity"}
        </Button>
      </div>
    </form>
  )
}

export function ActivityItem({ activity: a, showParent }: { activity: CrmActivity; showParent?: boolean }) {
  const { slug, org, href } = useWorkspace()
  const qc = useQueryClient()
  const Icon = ACTIVITY_TYPES.find((t) => t.value === a.type)?.icon ?? MessageSquareText
  const overdue = a.type === "task" && !a.done_at && a.due_at && new Date(a.due_at) < new Date()

  async function toggle(done: boolean) {
    try {
      await api(orgPath(slug, `/crm/activities/${a.id}`), { method: "PATCH", body: { done } })
      qc.invalidateQueries({ queryKey: crmKeys.all(slug) })
    } catch (e) {
      toast.error(errorMessage(e))
    }
  }

  return (
    <article className={cn("flex gap-3 rounded-lg border p-3", a.done_at && "opacity-70")}>
      {a.type === "task" ? (
        <Checkbox
          checked={Boolean(a.done_at)}
          onCheckedChange={(v) => toggle(v === true)}
          disabled={!a.permissions.edit}
          aria-label={a.done_at ? `Mark "${a.subject}" not done` : `Mark "${a.subject}" done`}
          className="mt-0.5"
        />
      ) : (
        <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
      )}
      <div className="min-w-0 flex-1 text-sm">
        <p className={cn("font-medium", a.done_at && "line-through")}>{a.subject}</p>
        {a.body ? <p className="mt-0.5 whitespace-pre-line text-muted-foreground">{a.body}</p> : null}
        <p className="mt-1 flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
          <UserAvatar user={a.user} className="size-4" /> {a.user?.name ?? "Former member"}
          <span>· {ACTIVITY_TYPES.find((t) => t.value === a.type)?.label}</span>
          {a.due_at ? (
            <span className={cn(overdue && "font-medium text-destructive")}>· due {formatDateTime(a.due_at, org.timezone, { hour: undefined, minute: undefined })}</span>
          ) : null}
          <time dateTime={a.created_at} title={formatDateTime(a.created_at, org.timezone)}>
            · {timeAgo(a.created_at)}
          </time>
          {showParent && a.opportunity ? (
            <Link className="underline-offset-2 hover:underline" href={href(`/apps/opportunity/deals/${a.opportunity.id}`)}>
              · {a.opportunity.name}
            </Link>
          ) : showParent && a.account ? (
            <Link className="underline-offset-2 hover:underline" href={href(`/apps/opportunity/accounts/${a.account.id}`)}>
              · {a.account.name}
            </Link>
          ) : null}
        </p>
      </div>
      {a.permissions.edit ? (
        <ConfirmAction
          trigger={
            <Button variant="ghost" size="icon" className="size-7" aria-label={`Delete "${a.subject}"`}>
              <Trash2 aria-hidden />
            </Button>
          }
          title="Delete this activity?"
          description={a.subject}
          onConfirm={async () => {
            try {
              await api(orgPath(slug, `/crm/activities/${a.id}`), { method: "DELETE" })
              qc.invalidateQueries({ queryKey: crmKeys.all(slug) })
            } catch (e) {
              toast.error(errorMessage(e))
            }
          }}
        />
      ) : null}
    </article>
  )
}
