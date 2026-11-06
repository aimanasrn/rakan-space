"use client"

import { useQueryClient } from "@tanstack/react-query"
import { CheckCircle2, Lock, MessageSquareReply, Trash2 } from "lucide-react"
import { useParams, useRouter } from "next/navigation"
import { useState } from "react"
import { toast } from "sonner"
import { AttachmentList, UploadButton, useUploader } from "@/components/attachments"
import { LoadingRows, UserAvatar } from "@/components/common"
import { ConfirmAction } from "@/components/confirm"
import { FormAlert } from "@/components/form"
import { PersonSelect } from "@/components/pickers"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Spinner } from "@/components/ui/spinner"
import { Textarea } from "@/components/ui/textarea"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { orgPath, useWorkspace } from "@/components/workspace/workspace-context"
import { api, errorMessage } from "@/lib/api"
import { formatDateTime, timeAgo } from "@/lib/datetime"
import type { SlaTarget, TicketDetail, TicketStatus } from "@/lib/types"
import { cn } from "@/lib/utils"
import { LoadError, ModuleHeader } from "../shared"
import {
  PRIORITIES,
  PriorityLabel,
  TICKET_STATUSES,
  TicketStatusBadge,
  helpdeskKeys,
  useAgents,
  useCannedResponses,
  useHelpdeskSummary,
  useTicket,
} from "./use-helpdesk"

export function TicketDetailView() {
  const { ticketId } = useParams<{ ticketId: string }>()
  const id = Number(ticketId)
  const { slug, href, org } = useWorkspace()
  const ticket = useTicket(slug, id)

  if (ticket.isPending) {
    return (
      <div className="mx-auto max-w-6xl p-4 md:p-8">
        <LoadingRows rows={6} />
      </div>
    )
  }
  if (ticket.error) {
    return (
      <div className="mx-auto max-w-6xl p-4 md:p-8">
        <LoadError error={ticket.error} onRetry={() => ticket.refetch()} what="Ticket" />
      </div>
    )
  }

  const t = ticket.data
  return (
    <div className="mx-auto max-w-6xl space-y-6 p-4 md:p-8">
      <ModuleHeader
        app="helpdesk"
        title={t.subject}
        back={{ href: href(t.permissions.work ? "/apps/helpdesk" : "/apps/helpdesk?tab=mine"), label: "Helpdesk" }}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <TicketStatusBadge status={t.status} />
            <span>{t.reference}</span>
            <span>·</span>
            <PriorityLabel priority={t.priority} />
            {t.category ? <span>· {t.category}</span> : null}
          </span>
        }
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_18rem]">
        <div className="min-w-0 space-y-4">
          <ol className="space-y-4" aria-label="Conversation">
            <li>
              <Bubble
                author={t.requester}
                when={t.created_at}
                timezone={org.timezone}
                body={t.description}
                attachments={t.attachments}
                tone="requester"
                label="raised this ticket"
              />
            </li>
            {t.messages.map((m) => (
              <li key={m.id}>
                <Bubble
                  author={m.author}
                  when={m.created_at}
                  timezone={org.timezone}
                  body={m.body}
                  attachments={m.attachments}
                  tone={m.internal ? "internal" : m.from_requester ? "requester" : "agent"}
                />
              </li>
            ))}
          </ol>
          {t.permissions.reply ? (
            <ReplyBox ticket={t} />
          ) : (
            <p className="rounded-lg border bg-muted/40 px-4 py-3 text-sm text-muted-foreground">This ticket is closed. Raise a new ticket if you still need help.</p>
          )}
        </div>

        <aside className="space-y-4" aria-label="Ticket details">
          {t.permissions.work ? <AgentPanel ticket={t} /> : <RequesterPanel ticket={t} />}
          <SlaCard ticket={t} />
          <ActivityCard ticket={t} />
        </aside>
      </div>
    </div>
  )
}

function Bubble({
  author,
  when,
  timezone,
  body,
  attachments,
  tone,
  label,
}: {
  author: TicketDetail["requester"] | null
  when: string
  timezone: string
  body: string
  attachments: TicketDetail["attachments"]
  tone: "requester" | "agent" | "internal"
  label?: string
}) {
  return (
    <article
      className={cn(
        "rounded-xl border p-4",
        tone === "agent" && "border-primary/30 bg-primary/5",
        tone === "internal" && "border-amber-500/40 bg-amber-500/10",
      )}
    >
      <header className="mb-2 flex flex-wrap items-center gap-2 text-sm">
        <UserAvatar user={author} className="size-6" />
        <span className="font-medium">{author?.name ?? "Former member"}</span>
        {label ? <span className="text-muted-foreground">{label}</span> : null}
        {tone === "internal" ? (
          <span className="flex items-center gap-1 text-xs font-medium text-amber-800 dark:text-amber-300">
            <Lock className="size-3" aria-hidden /> Internal note
          </span>
        ) : null}
        <time dateTime={when} title={formatDateTime(when, timezone)} className="ml-auto text-xs text-muted-foreground">
          {timeAgo(when)}
        </time>
      </header>
      <p className="text-sm break-words whitespace-pre-line">{body}</p>
      {attachments.length ? (
        <div className="mt-3">
          <AttachmentList items={attachments} />
        </div>
      ) : null}
    </article>
  )
}

const KEEP = "keep"

function ReplyBox({ ticket: t }: { ticket: TicketDetail }) {
  const { slug } = useWorkspace()
  const qc = useQueryClient()
  const agent = t.permissions.work
  const canned = useCannedResponses(slug, agent)
  const files = useUploader(slug)
  const [body, setBody] = useState("")
  const [mode, setMode] = useState<"reply" | "internal">("reply")
  const [status, setStatus] = useState<string>(KEEP)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const firstName = t.requester.name.split(" ")[0]

  async function send(e: React.FormEvent) {
    e.preventDefault()
    if (!body.trim()) return setError("Write a message.")
    setError(null)
    setPending(true)
    try {
      const { data } = await api<{ data: TicketDetail }>(orgPath(slug, `/helpdesk/tickets/${t.id}/messages`), {
        method: "POST",
        body: {
          body,
          internal: mode === "internal",
          status: agent && status !== KEEP ? status : undefined,
          attachment_ids: files.ids,
        },
      })
      qc.setQueryData(helpdeskKeys.ticket(slug, t.id), data)
      qc.invalidateQueries({ queryKey: ["helpdesk", slug, "tickets"] })
      qc.invalidateQueries({ queryKey: helpdeskKeys.summary(slug) })
      setBody("")
      setStatus(KEEP)
      files.clear()
      toast.success(mode === "internal" ? "Note added." : "Reply sent.")
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setPending(false)
    }
  }

  return (
    <form onSubmit={send} className={cn("space-y-3 rounded-xl border p-4", mode === "internal" && "border-amber-500/40 bg-amber-500/5")}>
      <div className="flex flex-wrap items-center gap-2">
        {agent ? (
          <ToggleGroup type="single" value={mode} onValueChange={(v) => v && setMode(v as "reply" | "internal")} variant="outline" size="sm" aria-label="Message type">
            <ToggleGroupItem value="reply">
              <MessageSquareReply aria-hidden /> Reply to {firstName}
            </ToggleGroupItem>
            <ToggleGroupItem value="internal">
              <Lock aria-hidden /> Internal note
            </ToggleGroupItem>
          </ToggleGroup>
        ) : (
          <Label htmlFor="hd-reply">Reply</Label>
        )}
        {agent && canned.data?.length ? (
          <Select
            value=""
            onValueChange={(id) => {
              const c = canned.data.find((x) => String(x.id) === id)
              if (c) setBody((b) => (b ? `${b}\n\n` : "") + c.body.replaceAll("{name}", firstName))
            }}
          >
            <SelectTrigger className="ml-auto w-48" aria-label="Insert a canned response" size="sm">
              <SelectValue placeholder="Insert canned response" />
            </SelectTrigger>
            <SelectContent>
              {canned.data.map((c) => (
                <SelectItem key={c.id} value={String(c.id)}>
                  {c.title}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : null}
      </div>
      <FormAlert message={error} />
      <Textarea
        id="hd-reply"
        aria-label={mode === "internal" ? "Internal note (agents only)" : "Reply"}
        rows={4}
        maxLength={20000}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder={mode === "internal" ? "Only agents can see this." : agent ? `Write to ${firstName}…` : "Add more detail or answer a question…"}
      />
      <AttachmentList items={files.items} onRemove={(a) => files.remove(a.id)} />
      <div className="flex flex-wrap items-center gap-2">
        <UploadButton onFiles={files.add} uploading={files.uploading} />
        {agent ? (
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger className="w-52" aria-label="Status after sending" size="sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={KEEP}>Keep status</SelectItem>
              {TICKET_STATUSES.filter((s) => s.value !== t.status).map((s) => (
                <SelectItem key={s.value} value={s.value}>
                  Set to {s.label.toLowerCase()}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : null}
        <Button type="submit" className="ml-auto" disabled={pending || files.uploading}>
          {pending ? <Spinner /> : null} {mode === "internal" ? "Add note" : "Send reply"}
        </Button>
      </div>
      {!agent && t.status === "resolved" ? <p className="text-xs text-muted-foreground">Replying reopens this ticket.</p> : null}
    </form>
  )
}

function useUpdate(ticketId: number) {
  const { slug } = useWorkspace()
  const qc = useQueryClient()
  const [busy, setBusy] = useState(false)
  async function update(body: Record<string, unknown>, success?: string) {
    setBusy(true)
    try {
      const { data } = await api<{ data: TicketDetail }>(orgPath(slug, `/helpdesk/tickets/${ticketId}`), { method: "PATCH", body })
      qc.setQueryData(helpdeskKeys.ticket(slug, ticketId), data)
      qc.invalidateQueries({ queryKey: ["helpdesk", slug, "tickets"] })
      qc.invalidateQueries({ queryKey: helpdeskKeys.summary(slug) })
      if (success) toast.success(success)
    } catch (e) {
      toast.error(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }
  return { update, busy }
}

function AgentPanel({ ticket: t }: { ticket: TicketDetail }) {
  const { slug, href, me } = useWorkspace()
  const router = useRouter()
  const qc = useQueryClient()
  const summary = useHelpdeskSummary(slug)
  const agents = useAgents(slug, true)
  const { update, busy } = useUpdate(t.id)
  const NONE = "none"

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>Ticket</CardTitle>
        {busy ? <Spinner /> : null}
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        <div className="space-y-1.5">
          <Label>Requester</Label>
          <p className="flex items-center gap-2">
            <UserAvatar user={t.requester} className="size-6" /> {t.requester.name}
          </p>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="hd-assignee-side">Assignee</Label>
          <PersonSelect id="hd-assignee-side" people={agents.data ?? []} value={t.assignee?.id ?? null} onChange={(id) => update({ assignee_id: id })} disabled={busy} />
          {t.assignee?.id !== me.id && agents.data?.some((a) => a.id === me.id) ? (
            <Button variant="link" size="sm" className="h-auto px-0" onClick={() => update({ assignee_id: me.id }, "Assigned to you.")} disabled={busy}>
              Assign to me
            </Button>
          ) : null}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="hd-status-side">Status</Label>
          <Select value={t.status} onValueChange={(v) => update({ status: v as TicketStatus })} disabled={busy}>
            <SelectTrigger id="hd-status-side" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {TICKET_STATUSES.map((s) => (
                <SelectItem key={s.value} value={s.value}>
                  {s.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="hd-priority-side">Priority</Label>
          <Select value={t.priority} onValueChange={(v) => update({ priority: v }, "Priority changed. SLA targets were updated.")} disabled={busy}>
            <SelectTrigger id="hd-priority-side" className="w-full">
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
        <div className="space-y-1.5">
          <Label htmlFor="hd-category-side">Category</Label>
          <Select value={t.category ?? NONE} onValueChange={(v) => update({ category: v === NONE ? null : v })} disabled={busy}>
            <SelectTrigger id="hd-category-side" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE}>None</SelectItem>
              {[...new Set([...(summary.data?.categories ?? []), ...(t.category ? [t.category] : [])])].map((c) => (
                <SelectItem key={c} value={c}>
                  {c}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {t.permissions.delete ? (
          <ConfirmAction
            trigger={
              <Button variant="outline" size="sm" className="w-full text-destructive">
                <Trash2 aria-hidden /> Delete ticket
              </Button>
            }
            title={`Delete ${t.reference}?`}
            description="The ticket and its conversation are removed for everyone. This cannot be undone."
            onConfirm={async () => {
              try {
                await api(orgPath(slug, `/helpdesk/tickets/${t.id}`), { method: "DELETE" })
                qc.invalidateQueries({ queryKey: helpdeskKeys.all(slug) })
                toast.success("Ticket deleted.")
                router.push(href("/apps/helpdesk"))
              } catch (e) {
                toast.error(errorMessage(e))
              }
            }}
          />
        ) : null}
      </CardContent>
    </Card>
  )
}

function RequesterPanel({ ticket: t }: { ticket: TicketDetail }) {
  const { update, busy } = useUpdate(t.id)
  return (
    <Card>
      <CardHeader>
        <CardTitle>Your request</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <p>
          {t.assignee ? (
            <span className="flex items-center gap-2">
              <UserAvatar user={t.assignee} className="size-6" /> {t.assignee.name} is handling it.
            </span>
          ) : (
            "Waiting for an agent to pick it up."
          )}
        </p>
        {t.status === "waiting" ? <p className="font-medium text-violet-800 dark:text-violet-300">The agent is waiting for your reply.</p> : null}
        {t.permissions.resolve ? (
          <ConfirmAction
            trigger={
              <Button variant="outline" className="w-full">
                <CheckCircle2 aria-hidden /> It&apos;s sorted – mark resolved
              </Button>
            }
            title="Mark this ticket resolved?"
            description="The agents will see it is fixed. You can reply later to reopen it."
            confirmLabel="Mark resolved"
            destructive={false}
            onConfirm={() => update({ status: "resolved" }, "Marked as resolved.")}
          />
        ) : null}
        {busy ? <Spinner /> : null}
      </CardContent>
    </Card>
  )
}

const SLA_TEXT: Record<SlaTarget["state"], string> = {
  met: "Met",
  missed: "Missed",
  due_soon: "Due within the hour",
  pending: "On track",
  none: "–",
}

function SlaCard({ ticket: t }: { ticket: TicketDetail }) {
  const { org } = useWorkspace()
  const rows: [string, SlaTarget][] = [
    ["First response", t.sla.first_response],
    ["Resolution", t.sla.resolution],
  ]
  return (
    <Card>
      <CardHeader>
        <CardTitle>Service targets</CardTitle>
      </CardHeader>
      <CardContent>
        <dl className="space-y-3 text-sm">
          {rows.map(([label, s]) => (
            <div key={label}>
              <dt className="text-muted-foreground">{label}</dt>
              <dd
                className={cn(
                  "font-medium",
                  s.state === "missed" && "text-red-700 dark:text-red-300",
                  s.state === "due_soon" && "text-amber-700 dark:text-amber-300",
                  s.state === "met" && "text-emerald-700 dark:text-emerald-300",
                )}
              >
                {SLA_TEXT[s.state]}
                {s.due_at && s.state !== "none" ? (
                  <span className="block text-xs font-normal text-muted-foreground">
                    {s.met_at ? `at ${formatDateTime(s.met_at, org.timezone)} · ` : ""}due {formatDateTime(s.due_at, org.timezone)}
                  </span>
                ) : null}
              </dd>
            </div>
          ))}
        </dl>
      </CardContent>
    </Card>
  )
}

const EVENT_TEXT: Record<string, (a: TicketDetail["activity"][number]) => string> = {
  "helpdesk.created": () => "raised the ticket",
  "helpdesk.status_changed": (a) => `changed status to ${(a.to ?? "").replace("_", " ")}`,
  "helpdesk.priority_changed": (a) => `changed priority to ${a.to}`,
  "helpdesk.category_changed": (a) => (a.to ? `set category to ${a.to}` : "cleared the category"),
  "helpdesk.assignee_id_changed": (a) => (a.to ? `assigned it to ${a.to}` : "unassigned it"),
  "helpdesk.subject_changed": () => "renamed the ticket",
}

function ActivityCard({ ticket: t }: { ticket: TicketDetail }) {
  const { org } = useWorkspace()
  if (!t.activity.length) return null
  return (
    <Card>
      <CardHeader>
        <CardTitle>History</CardTitle>
      </CardHeader>
      <CardContent>
        <ol className="space-y-2 text-xs">
          {t.activity.map((a) => (
            <li key={a.id} className="text-muted-foreground">
              <span className="font-medium text-foreground">{a.actor ?? "System"}</span> {(EVENT_TEXT[a.event] ?? (() => a.event))(a)}
              <time dateTime={a.created_at} className="block" title={formatDateTime(a.created_at, org.timezone)}>
                {timeAgo(a.created_at)}
              </time>
            </li>
          ))}
        </ol>
      </CardContent>
    </Card>
  )
}
