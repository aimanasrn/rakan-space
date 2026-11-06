"use client"

import { useQueryClient } from "@tanstack/react-query"
import { Inbox, LifeBuoy, Plus, Trash2 } from "lucide-react"
import Link from "next/link"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { useState } from "react"
import { toast } from "sonner"
import { AttachmentList, UploadButton, useUploader } from "@/components/attachments"
import { EmptyState, ErrorState, LoadingRows, UserAvatar } from "@/components/common"
import { ConfirmAction } from "@/components/confirm"
import { FormAlert, TextField, useFormErrors } from "@/components/form"
import { PeoplePicker, PersonSelect } from "@/components/pickers"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Spinner } from "@/components/ui/spinner"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { orgPath, useWorkspace } from "@/components/workspace/workspace-context"
import { useMemberOptions } from "@/hooks/use-workspace-data"
import { api, errorMessage } from "@/lib/api"
import { timeAgo } from "@/lib/datetime"
import type { HelpdeskSettings, HelpdeskSummary, TicketDetail, TicketPriority } from "@/lib/types"
import { LoadError, ModuleHeader, Pager } from "../shared"
import {
  PRIORITIES,
  PriorityLabel,
  SlaChip,
  TICKET_STATUSES,
  TicketStatusBadge,
  type TicketScope,
  helpdeskKeys,
  useAgents,
  useCannedResponses,
  useHelpdeskSettings,
  useHelpdeskSummary,
  useTickets,
} from "./use-helpdesk"

type Tab = TicketScope | "settings"

export function HelpdeskHomeView() {
  const { slug } = useWorkspace()
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()
  const summary = useHelpdeskSummary(slug)
  const [creating, setCreating] = useState(false)

  if (summary.isPending) {
    return (
      <div className="mx-auto max-w-6xl p-4 md:p-8">
        <LoadingRows rows={5} />
      </div>
    )
  }
  if (summary.error) {
    return (
      <div className="mx-auto max-w-6xl p-4 md:p-8">
        <LoadError error={summary.error} onRetry={() => summary.refetch()} what="Helpdesk app" />
      </div>
    )
  }

  const s = summary.data
  const tabs: { value: Tab; label: string; count?: number | null; show: boolean }[] = [
    { value: "assigned", label: "Assigned to me", count: s.counts.assigned, show: s.is_agent },
    { value: "unassigned", label: "Unassigned", count: s.counts.unassigned, show: s.is_agent },
    { value: "all", label: "All tickets", show: s.is_agent },
    { value: "mine", label: "My requests", count: s.counts.my_open, show: true },
    { value: "settings", label: "Settings", show: s.can_manage },
  ]
  const requested = params.get("tab") as Tab | null
  const fallback: Tab = s.is_agent ? "assigned" : "mine"
  const tab: Tab = requested && tabs.some((t) => t.value === requested && t.show) ? requested : fallback

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-4 md:p-8">
      <ModuleHeader
        app="helpdesk"
        title="Helpdesk"
        description={s.is_agent ? "Work the queue and keep requesters in the loop." : "Ask for help and follow your requests."}
        actions={
          s.can_raise ? (
            <Button onClick={() => setCreating(true)}>
              <Plus aria-hidden /> New ticket
            </Button>
          ) : null
        }
      />
      {s.is_agent && s.counts.missed ? (
        <p role="status" className="rounded-lg border border-red-500/30 bg-red-500/5 px-4 py-2 text-sm text-red-800 dark:text-red-300">
          {s.counts.missed} active {s.counts.missed === 1 ? "ticket has" : "tickets have"} missed an SLA target.
        </p>
      ) : null}
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
      {tab === "settings" ? <Settings /> : <TicketList key={tab} scope={tab} summary={s} />}
      <NewTicketDialog open={creating} onOpenChange={setCreating} summary={s} />
    </div>
  )
}

function TicketList({ scope, summary }: { scope: TicketScope; summary: HelpdeskSummary }) {
  const { slug, href } = useWorkspace()
  const [q, setQ] = useState("")
  const [status, setStatus] = useState("active")
  const [priority, setPriority] = useState("all")
  const [category, setCategory] = useState("all")
  const [sort, setSort] = useState<"updated" | "due">(scope === "mine" ? "updated" : "due")
  const [page, setPage] = useState(1)
  const list = useTickets(slug, {
    scope,
    status,
    priority: priority === "all" ? undefined : priority,
    category: category === "all" ? undefined : category,
    q: q || undefined,
    sort,
    page,
  })
  const reset = <T,>(fn: (v: T) => void) => (v: T) => (fn(v), setPage(1))

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3" role="search" aria-label="Filter tickets">
        <Label htmlFor={`hd-q-${scope}`} className="sr-only">
          Search tickets
        </Label>
        <Input
          id={`hd-q-${scope}`}
          placeholder={scope === "mine" ? "Search your tickets…" : "Search subject, person or HD-…"}
          value={q}
          onChange={(e) => reset(setQ)(e.target.value)}
          className="max-w-xs"
        />
        <Select value={status} onValueChange={reset(setStatus)}>
          <SelectTrigger className="w-44" aria-label="Status">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="active">Open (not resolved)</SelectItem>
            <SelectItem value="all">Any status</SelectItem>
            {TICKET_STATUSES.map((s) => (
              <SelectItem key={s.value} value={s.value}>
                {s.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={priority} onValueChange={reset(setPriority)}>
          <SelectTrigger className="w-36" aria-label="Priority">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Any priority</SelectItem>
            {PRIORITIES.map((p) => (
              <SelectItem key={p.value} value={p.value}>
                {p.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={category} onValueChange={reset(setCategory)}>
          <SelectTrigger className="w-36" aria-label="Category">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Any category</SelectItem>
            {summary.categories.map((c) => (
              <SelectItem key={c} value={c}>
                {c}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {scope !== "mine" ? (
          <Select value={sort} onValueChange={(v) => setSort(v as "updated" | "due")}>
            <SelectTrigger className="w-40" aria-label="Sort">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="due">Due soonest</SelectItem>
              <SelectItem value="updated">Recently updated</SelectItem>
            </SelectContent>
          </Select>
        ) : null}
      </div>

      {list.isPending ? (
        <LoadingRows rows={4} />
      ) : list.error ? (
        <ErrorState error={list.error} onRetry={() => list.refetch()} />
      ) : list.data.data.length ? (
        <>
          <ul className="divide-y rounded-xl border">
            {list.data.data.map((t) => (
              <li key={t.id}>
                <Link href={href(`/apps/helpdesk/tickets/${t.id}`)} className="flex flex-col gap-2 p-4 hover:bg-muted/40 focus-visible:bg-muted/40 md:flex-row md:items-center">
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{t.subject}</span>
                      <SlaChip sla={t.sla.first_response} label="Response" />
                      <SlaChip sla={t.sla.resolution} label="Resolution" />
                    </span>
                    <span className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                      <span>{t.reference}</span>
                      {scope !== "mine" ? <span>· {t.requester.name}</span> : null}
                      {t.category ? <span>· {t.category}</span> : null}
                      <span>· updated {timeAgo(t.last_activity_at ?? t.created_at)}</span>
                    </span>
                  </span>
                  <span className="flex items-center gap-3 md:w-80 md:justify-end">
                    <PriorityLabel priority={t.priority} />
                    {t.assignee ? (
                      <span className="flex items-center gap-1.5 text-xs text-muted-foreground" title={`Assigned to ${t.assignee.name}`}>
                        <UserAvatar user={t.assignee} className="size-5" />
                        <span className="max-w-24 truncate">{t.assignee.name}</span>
                      </span>
                    ) : (
                      <span className="text-xs text-muted-foreground">Unassigned</span>
                    )}
                    <TicketStatusBadge status={t.status} />
                  </span>
                </Link>
              </li>
            ))}
          </ul>
          <Pager page={page} lastPage={list.data.meta.last_page} onPage={setPage} />
        </>
      ) : (
        <EmptyState
          icon={scope === "mine" ? LifeBuoy : Inbox}
          title={q || status !== "active" || priority !== "all" || category !== "all" ? "No tickets match" : scope === "mine" ? "No open requests" : "Queue is clear"}
          description={scope === "mine" ? "Raise a ticket when you need help from IT, Facilities, HR or Finance." : undefined}
        />
      )}
    </div>
  )
}

const NONE = "none"

function NewTicketDialog({ open, onOpenChange, summary }: { open: boolean; onOpenChange: (o: boolean) => void; summary: HelpdeskSummary }) {
  const { slug, href, me } = useWorkspace()
  const router = useRouter()
  const qc = useQueryClient()
  const files = useUploader(slug)
  const members = useMemberOptions(slug)
  const agents = useAgents(slug, summary.is_agent && open)
  const { errors, formError, capture, reset } = useFormErrors()
  const [pending, setPending] = useState(false)
  const [priority, setPriority] = useState<TicketPriority>("medium")
  const [category, setCategory] = useState<string>(NONE)
  const [requester, setRequester] = useState<number | null>(me.id)
  const [assignee, setAssignee] = useState<number | null>(null)

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    reset()
    const form = new FormData(e.currentTarget)
    setPending(true)
    try {
      const { data } = await api<{ data: TicketDetail }>(orgPath(slug, "/helpdesk/tickets"), {
        method: "POST",
        body: {
          subject: String(form.get("subject") ?? "").trim(),
          description: String(form.get("description") ?? "").trim(),
          priority,
          category: category === NONE ? null : category,
          requester_id: summary.is_agent && requester && requester !== me.id ? requester : undefined,
          assignee_id: summary.is_agent ? assignee : undefined,
          attachment_ids: files.ids,
        },
      })
      qc.invalidateQueries({ queryKey: helpdeskKeys.all(slug) })
      toast.success(`Ticket ${data.reference} raised.`)
      files.clear()
      onOpenChange(false)
      router.push(href(`/apps/helpdesk/tickets/${data.id}`))
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
            <DialogTitle>New ticket</DialogTitle>
            <DialogDescription>Describe the problem or request. You will be notified when someone replies.</DialogDescription>
          </DialogHeader>
          <FormAlert message={formError} />
          <TextField id="hd-subject" name="subject" label="Subject" required maxLength={200} error={errors.subject} placeholder="e.g. Laptop will not turn on" />
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="hd-category">Category</Label>
              <Select value={category} onValueChange={setCategory}>
                <SelectTrigger id="hd-category" className="w-full" aria-invalid={Boolean(errors.category) || undefined}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>Not sure</SelectItem>
                  {summary.categories.map((c) => (
                    <SelectItem key={c} value={c}>
                      {c}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {errors.category ? <p className="text-sm text-destructive">{errors.category}</p> : null}
            </div>
            <div className="space-y-2">
              <Label htmlFor="hd-priority">Priority</Label>
              <Select value={priority} onValueChange={(v) => setPriority(v as TicketPriority)}>
                <SelectTrigger id="hd-priority" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PRIORITIES.map((p) => (
                    <SelectItem key={p.value} value={p.value}>
                      {p.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <TextField
            id="hd-description"
            name="description"
            label="Details"
            textarea
            required
            rows={5}
            maxLength={20000}
            error={errors.description}
            placeholder="What happened, since when, and what you already tried."
          />
          {summary.is_agent ? (
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="hd-requester">On behalf of</Label>
                <PersonSelect
                  id="hd-requester"
                  people={(members.data ?? []).filter((m) => m.status === "active").map((m) => m.user)}
                  value={requester}
                  onChange={setRequester}
                  allowNone={false}
                  placeholder="Me"
                />
                {errors.requester_id ? <p className="text-sm text-destructive">{errors.requester_id}</p> : null}
              </div>
              <div className="space-y-2">
                <Label htmlFor="hd-assignee">Assign to</Label>
                <PersonSelect id="hd-assignee" people={agents.data ?? []} value={assignee} onChange={setAssignee} />
                {errors.assignee_id ? <p className="text-sm text-destructive">{errors.assignee_id}</p> : null}
              </div>
            </div>
          ) : null}
          <div className="space-y-2">
            <UploadButton onFiles={files.add} uploading={files.uploading} label="Attach screenshots or files" />
            <AttachmentList items={files.items} onRemove={(a) => files.remove(a.id)} />
            {errors.attachment_ids ? <p className="text-sm text-destructive">{errors.attachment_ids}</p> : null}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending || files.uploading}>
              {pending ? <Spinner /> : null} Raise ticket
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

// ---------------------------------------------------------------- settings

function Settings() {
  const { slug } = useWorkspace()
  const settings = useHelpdeskSettings(slug)
  if (settings.isPending) return <LoadingRows rows={4} />
  if (settings.error) return <ErrorState error={settings.error} onRetry={() => settings.refetch()} />
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <SettingsForm key={JSON.stringify(settings.data)} settings={settings.data} />
      <CannedResponses />
    </div>
  )
}

function SettingsForm({ settings }: { settings: HelpdeskSettings }) {
  const { slug } = useWorkspace()
  const qc = useQueryClient()
  const members = useMemberOptions(slug)
  const [agents, setAgents] = useState(settings.agents.map((a) => a.id))
  const [sla, setSla] = useState(settings.sla)
  const [categories, setCategories] = useState(settings.categories.join("\n"))
  const [autoClose, setAutoClose] = useState(String(settings.auto_close_days))
  const { errors, formError, capture, reset } = useFormErrors()
  const [pending, setPending] = useState(false)

  async function save(e: React.FormEvent) {
    e.preventDefault()
    reset()
    setPending(true)
    try {
      const { data } = await api<{ data: HelpdeskSettings }>(orgPath(slug, "/helpdesk/settings"), {
        method: "PUT",
        body: {
          agent_ids: agents,
          sla,
          categories: categories.split("\n").map((c) => c.trim()).filter(Boolean),
          auto_close_days: Number(autoClose),
        },
      })
      qc.setQueryData(helpdeskKeys.settings(slug), data)
      qc.invalidateQueries({ queryKey: helpdeskKeys.all(slug) })
      toast.success("Helpdesk settings saved.")
    } catch (error) {
      capture(error)
    } finally {
      setPending(false)
    }
  }

  const people = (members.data ?? []).filter((m) => m.status === "active").map((m) => m.user)
  const slaError = Object.entries(errors).find(([k]) => k.startsWith("sla."))?.[1]

  return (
    <Card>
      <CardHeader>
        <CardTitle>Desk settings</CardTitle>
        <CardDescription>Who works tickets, your response targets and categories.</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={save} className="space-y-5" noValidate>
          <FormAlert message={formError} />
          <div className="space-y-2">
            <Label htmlFor="hd-agents">Agents</Label>
            <PeoplePicker id="hd-agents" people={people} value={agents} onChange={setAgents} placeholder="Choose agents" />
            <p className="text-xs text-muted-foreground">
              Agents see and work every ticket and get new-ticket alerts. Roles with the Helpdesk &ldquo;edit&rdquo; ability (Owners and Admins by
              default) are agents too, and get alerts only when nobody is listed here.
            </p>
          </div>
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">SLA targets (hours)</legend>
            <div className="grid grid-cols-[1fr_auto_auto] items-center gap-2 text-sm">
              <span />
              <span className="w-24 text-xs text-muted-foreground">First response</span>
              <span className="w-24 text-xs text-muted-foreground">Resolution</span>
              {PRIORITIES.slice()
                .reverse()
                .map((p) => (
                  <div key={p.value} className="contents">
                    <span>{p.label}</span>
                    {(["first_response_hours", "resolution_hours"] as const).map((field) => (
                      <Input
                        key={field}
                        type="number"
                        min={1}
                        max={2160}
                        className="w-24"
                        aria-label={`${p.label} ${field === "first_response_hours" ? "first response" : "resolution"} hours`}
                        value={sla[p.value][field]}
                        onChange={(e) => setSla((s) => ({ ...s, [p.value]: { ...s[p.value], [field]: Number(e.target.value) } }))}
                      />
                    ))}
                  </div>
                ))}
            </div>
            {slaError ? <p className="text-sm text-destructive">{slaError}</p> : null}
            <p className="text-xs text-muted-foreground">Counted in calendar hours from when the ticket was raised. New targets apply to new tickets and priority changes.</p>
          </fieldset>
          <TextField
            id="hd-categories"
            label="Categories (one per line)"
            textarea
            rows={5}
            value={categories}
            onChange={(e) => setCategories(e.target.value)}
            error={errors.categories ?? Object.entries(errors).find(([k]) => k.startsWith("categories."))?.[1]}
          />
          <TextField
            id="hd-autoclose"
            label="Close resolved tickets after (days)"
            type="number"
            min={0}
            max={90}
            value={autoClose}
            onChange={(e) => setAutoClose(e.target.value)}
            description="0 keeps resolved tickets open for replies indefinitely."
            error={errors.auto_close_days}
          />
          <Button type="submit" disabled={pending}>
            {pending ? <Spinner /> : null} Save settings
          </Button>
        </form>
      </CardContent>
    </Card>
  )
}

function CannedResponses() {
  const { slug } = useWorkspace()
  const qc = useQueryClient()
  const canned = useCannedResponses(slug, true)
  const [editing, setEditing] = useState<{ id?: number; title: string; body: string } | null>(null)
  const { errors, formError, capture, reset } = useFormErrors()
  const [pending, setPending] = useState(false)

  async function save(e: React.FormEvent) {
    e.preventDefault()
    if (!editing) return
    reset()
    setPending(true)
    try {
      await api(orgPath(slug, editing.id ? `/helpdesk/canned-responses/${editing.id}` : "/helpdesk/canned-responses"), {
        method: editing.id ? "PUT" : "POST",
        body: { title: editing.title, body: editing.body },
      })
      qc.invalidateQueries({ queryKey: helpdeskKeys.canned(slug) })
      setEditing(null)
    } catch (error) {
      capture(error)
    } finally {
      setPending(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Canned responses</CardTitle>
        <CardDescription>Saved replies agents can insert. Use {"{name}"} for the requester&apos;s first name.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {canned.isPending ? (
          <LoadingRows rows={2} />
        ) : canned.data?.length ? (
          <ul className="divide-y rounded-lg border">
            {canned.data.map((c) => (
              <li key={c.id} className="flex items-start gap-2 p-3">
                <button type="button" className="min-w-0 flex-1 text-left" onClick={() => setEditing(c)}>
                  <span className="block font-medium hover:underline">{c.title}</span>
                  <span className="line-clamp-2 text-xs text-muted-foreground">{c.body}</span>
                </button>
                <ConfirmAction
                  trigger={
                    <Button variant="ghost" size="icon" className="size-8" aria-label={`Delete ${c.title}`}>
                      <Trash2 aria-hidden />
                    </Button>
                  }
                  title="Delete this canned response?"
                  description={c.title}
                  onConfirm={async () => {
                    try {
                      await api(orgPath(slug, `/helpdesk/canned-responses/${c.id}`), { method: "DELETE" })
                      qc.invalidateQueries({ queryKey: helpdeskKeys.canned(slug) })
                    } catch (e) {
                      toast.error(errorMessage(e))
                    }
                  }}
                />
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">No canned responses yet.</p>
        )}
        <Button variant="outline" onClick={() => setEditing({ title: "", body: "" })}>
          <Plus aria-hidden /> Add canned response
        </Button>
        <Dialog open={editing !== null} onOpenChange={(o) => !o && setEditing(null)}>
          <DialogContent>
            <form onSubmit={save} className="space-y-4" noValidate>
              <DialogHeader>
                <DialogTitle>{editing?.id ? "Edit canned response" : "New canned response"}</DialogTitle>
              </DialogHeader>
              <FormAlert message={formError} />
              <TextField
                id="cr-title"
                label="Title"
                maxLength={120}
                value={editing?.title ?? ""}
                onChange={(e) => setEditing((c) => c && { ...c, title: e.target.value })}
                error={errors.title}
              />
              <TextField
                id="cr-body"
                label="Reply"
                textarea
                rows={6}
                maxLength={5000}
                value={editing?.body ?? ""}
                onChange={(e) => setEditing((c) => c && { ...c, body: e.target.value })}
                error={errors.body}
              />
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setEditing(null)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={pending}>
                  {pending ? <Spinner /> : null} Save
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  )
}
