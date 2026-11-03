"use client"

import { useQuery, useQueryClient } from "@tanstack/react-query"
import { CalendarClock, ChevronLeft, ChevronRight, ListChecks, MapPin, Pencil, Plus, Trash2, Users, Video } from "lucide-react"
import Link from "next/link"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { useMemo, useState } from "react"
import { toast } from "sonner"
import { ErrorState, LoadingRows, PageHeader, RichText, TaskStatusBadge, UserAvatar } from "@/components/common"
import { ConfirmAction } from "@/components/confirm"
import { FormAlert, TextField, useFormErrors } from "@/components/form"
import { PeoplePicker } from "@/components/pickers"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { FieldGroup } from "@/components/ui/field"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Spinner } from "@/components/ui/spinner"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { orgPath, useWorkspace } from "@/components/workspace/workspace-context"
import { useMemberOptions } from "@/hooks/use-workspace-data"
import { api, ApiError, errorMessage } from "@/lib/api"
import { addDaysToKey, formatDateKey, formatTime, todayKey, zonedParts, zonedToUtc } from "@/lib/datetime"
import type { CalendarEvent, Deadline } from "@/lib/types"
import { cn } from "@/lib/utils"

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]

function monthGrid(monthKey: string) {
  const [y, m] = monthKey.split("-").map(Number)
  const first = new Date(Date.UTC(y, m - 1, 1))
  const offset = (first.getUTCDay() + 6) % 7 // Monday-first
  const start = addDaysToKey(first.toISOString().slice(0, 10), -offset)
  return Array.from({ length: 42 }, (_, i) => addDaysToKey(start, i))
}

function shiftMonth(monthKey: string, delta: number) {
  const [y, m] = monthKey.split("-").map(Number)
  const d = new Date(Date.UTC(y, m - 1 + delta, 1))
  return d.toISOString().slice(0, 7)
}

export function CalendarView() {
  const { slug, org } = useWorkspace()
  const tz = org.timezone
  const params = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()
  const today = todayKey(tz)
  const [month, setMonth] = useState(today.slice(0, 7))
  const [mode, setMode] = useState<"month" | "agenda">("month")
  const [editing, setEditing] = useState<CalendarEvent | null>(null)
  const creating = params.get("new") === "1"
  const openEventId = params.get("event") ? Number(params.get("event")) : null
  const setParam = (key: string, value: string | null) => {
    const next = new URLSearchParams(params.toString())
    if (value === null) next.delete(key)
    else next.set(key, value)
    router.replace(next.size ? `${pathname}?${next}` : pathname, { scroll: false })
  }

  const days = useMemo(() => monthGrid(`${month}-01`), [month])
  const rangeStart = mode === "month" ? days[0] : today
  const rangeEnd = mode === "month" ? addDaysToKey(days[41], 1) : addDaysToKey(today, 60)
  const from = zonedToUtc(rangeStart, "00:00", tz).toISOString()
  const to = zonedToUtc(rangeEnd, "00:00", tz).toISOString()

  const data = useQuery({
    queryKey: ["events", slug, from, to],
    queryFn: () => api<{ data: CalendarEvent[]; deadlines: Deadline[] }>(orgPath(slug, "/events"), { query: { from, to } }),
    placeholderData: (prev) => prev,
  })

  const byDay = useMemo(() => {
    const map = new Map<string, { events: CalendarEvent[]; deadlines: Deadline[] }>()
    const bucket = (k: string) => map.get(k) ?? (map.set(k, { events: [], deadlines: [] }), map.get(k)!)
    for (const e of data.data?.data ?? []) {
      const start = zonedParts(e.starts_at, tz).dateKey
      // Ends exactly at midnight belong to the previous day.
      const end = zonedParts(new Date(new Date(e.ends_at).getTime() - 1), tz).dateKey
      for (let k = start; k <= end; k = addDaysToKey(k, 1)) bucket(k).events.push(e)
    }
    for (const d of data.data?.deadlines ?? []) bucket(d.due_date).deadlines.push(d)
    return map
  }, [data.data, tz])

  const openEvent = (data.data?.data ?? []).find((e) => e.id === openEventId)

  return (
    <div className="space-y-6 p-4 md:p-8">
      <PageHeader
        title="Calendar"
        description={`Events and task deadlines, shown in ${tz.replace("_", " ")} time.`}
        actions={
          <Button onClick={() => setParam("new", "1")}>
            <Plus /> New event
          </Button>
        }
      />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Tabs value={mode} onValueChange={(v) => setMode(v as "month" | "agenda")}>
          <TabsList>
            <TabsTrigger value="month">Month</TabsTrigger>
            <TabsTrigger value="agenda">Agenda</TabsTrigger>
          </TabsList>
        </Tabs>
        {mode === "month" ? (
          <div className="flex items-center gap-2">
            <Button variant="outline" size="icon-sm" onClick={() => setMonth((m) => shiftMonth(m, -1))} aria-label="Previous month">
              <ChevronLeft />
            </Button>
            <h2 className="min-w-36 text-center font-medium" aria-live="polite">
              {formatDateKey(`${month}-01`, { day: undefined, month: "long" })}
            </h2>
            <Button variant="outline" size="icon-sm" onClick={() => setMonth((m) => shiftMonth(m, 1))} aria-label="Next month">
              <ChevronRight />
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setMonth(today.slice(0, 7))}>
              Today
            </Button>
          </div>
        ) : null}
      </div>

      {data.error ? <ErrorState error={data.error} onRetry={() => data.refetch()} /> : null}
      {data.isLoading ? (
        <LoadingRows rows={6} />
      ) : mode === "month" ? (
        <div className="overflow-x-auto">
          <div className="grid min-w-[44rem] grid-cols-7 overflow-hidden rounded-xl border" role="grid" aria-label="Month view">
            {WEEKDAYS.map((d) => (
              <div key={d} role="columnheader" className="border-b bg-muted/50 px-2 py-1.5 text-xs font-medium text-muted-foreground">
                {d}
              </div>
            ))}
            {days.map((day) => {
              const items = byDay.get(day)
              const inMonth = day.startsWith(month)
              const all = [...(items?.events ?? []).map((e) => ({ kind: "event" as const, e })), ...(items?.deadlines ?? []).map((d) => ({ kind: "deadline" as const, d }))]
              return (
                <div key={day} role="gridcell" aria-label={formatDateKey(day, { weekday: "long" })} className={cn("min-h-28 border-b border-l p-1.5 first:border-l-0 nth-[7n+8]:border-l-0", !inMonth && "bg-muted/30 text-muted-foreground")}>
                  <span className={cn("inline-flex size-6 items-center justify-center rounded-full text-xs", day === today && "bg-primary font-semibold text-primary-foreground")}>{Number(day.slice(8))}</span>
                  <ul className="mt-1 space-y-0.5">
                    {all.slice(0, 3).map((item) =>
                      item.kind === "event" ? (
                        <li key={`e-${item.e.id}`}>
                          <button type="button" onClick={() => setParam("event", String(item.e.id))} className="block w-full truncate rounded bg-primary/10 px-1.5 py-0.5 text-left text-xs text-foreground hover:bg-primary/20">
                            <span className="text-muted-foreground">{formatTime(item.e.starts_at, tz)}</span> {item.e.title}
                          </button>
                        </li>
                      ) : (
                        <li key={`d-${item.d.id}`}>
                          <DeadlineLink deadline={item.d} compact />
                        </li>
                      ),
                    )}
                    {all.length > 3 ? <li className="px-1.5 text-xs text-muted-foreground">+{all.length - 3} more</li> : null}
                  </ul>
                </div>
              )
            })}
          </div>
        </div>
      ) : (
        <Agenda byDay={byDay} start={today} end={rangeEnd} onOpen={(id) => setParam("event", String(id))} />
      )}

      <EventFormDialog
        key={editing?.id ?? "new"}
        open={creating || !!editing}
        event={editing}
        onOpenChange={(o) => {
          if (!o) {
            setEditing(null)
            setParam("new", null)
          }
        }}
      />
      <EventDetailDialog
        eventId={openEventId}
        event={openEvent}
        onClose={() => setParam("event", null)}
        onEdit={(e) => {
          setParam("event", null)
          setEditing(e)
        }}
      />
    </div>
  )
}

function DeadlineLink({ deadline, compact }: { deadline: Deadline; compact?: boolean }) {
  const { href } = useWorkspace()
  return (
    <Link
      href={href(`/projects/${deadline.project.id}?task=${deadline.id}`)}
      className={cn("flex items-center gap-1 truncate rounded px-1.5 py-0.5 text-xs hover:bg-muted", deadline.status === "done" && "text-muted-foreground line-through", !compact && "py-1.5 text-sm")}
    >
      <ListChecks className="size-3 shrink-0 text-amber-600" aria-label="Task deadline" />
      <span className="truncate">{deadline.title}</span>
    </Link>
  )
}

function Agenda({ byDay, start, end, onOpen }: { byDay: Map<string, { events: CalendarEvent[]; deadlines: Deadline[] }>; start: string; end: string; onOpen: (id: number) => void }) {
  const { org } = useWorkspace()
  const days = [...byDay.keys()].filter((k) => k >= start && k < end).sort()
  if (!days.length) return <p className="rounded-xl border border-dashed p-10 text-center text-sm text-muted-foreground">Nothing scheduled in the next 60 days.</p>
  return (
    <ol className="space-y-6">
      {days.map((day) => (
        <li key={day}>
          <h3 className="mb-2 text-sm font-semibold">{formatDateKey(day, { weekday: "long" })}</h3>
          <ul className="divide-y rounded-xl border">
            {byDay.get(day)!.events.map((e) => (
              <li key={e.id}>
                <button type="button" onClick={() => onOpen(e.id)} className="flex w-full items-start gap-4 p-3 text-left hover:bg-muted/50">
                  <span className="w-24 shrink-0 text-sm text-muted-foreground">
                    {formatTime(e.starts_at, org.timezone)}–{formatTime(e.ends_at, org.timezone)}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium">{e.title}</span>
                    <span className="flex flex-wrap gap-3 text-xs text-muted-foreground">
                      {e.location ? (
                        <span className="flex items-center gap-1">
                          <MapPin className="size-3" aria-hidden /> {e.location}
                        </span>
                      ) : null}
                      {e.meeting_url ? (
                        <span className="flex items-center gap-1">
                          <Video className="size-3" aria-hidden /> Online
                        </span>
                      ) : null}
                      <span className="flex items-center gap-1">
                        <Users className="size-3" aria-hidden /> {e.audience === "everyone" ? "Everyone" : `${e.participants.length} participants`}
                      </span>
                    </span>
                  </span>
                </button>
              </li>
            ))}
            {byDay.get(day)!.deadlines.map((d) => (
              <li key={`d${d.id}`} className="flex items-center gap-4 p-3">
                <span className="w-24 shrink-0 text-sm text-muted-foreground">Due</span>
                <span className="min-w-0 flex-1">
                  <DeadlineLink deadline={d} />
                  <span className="px-1.5 text-xs text-muted-foreground">{d.project.name}</span>
                </span>
                <TaskStatusBadge status={d.status} />
              </li>
            ))}
          </ul>
        </li>
      ))}
    </ol>
  )
}

function EventDetailDialog({ eventId, event: cached, onClose, onEdit }: { eventId: number | null; event?: CalendarEvent; onClose: () => void; onEdit: (e: CalendarEvent) => void }) {
  const { slug, org } = useWorkspace()
  const qc = useQueryClient()
  const tz = org.timezone
  const fetched = useQuery({
    queryKey: ["event", slug, eventId],
    enabled: eventId !== null && !cached,
    queryFn: async () => (await api<{ data: CalendarEvent }>(orgPath(slug, `/events/${eventId}`))).data,
  })
  const e = cached ?? fetched.data

  return (
    <Dialog open={eventId !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        {!e ? (
          <>
            <DialogHeader>
              <DialogTitle>Event</DialogTitle>
            </DialogHeader>
            {fetched.error ? <ErrorState error={fetched.error} /> : <LoadingRows rows={3} />}
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>{e.title}</DialogTitle>
              <DialogDescription className="flex items-center gap-1.5">
                <CalendarClock className="size-4" aria-hidden />
                {formatDateKey(zonedParts(e.starts_at, tz).dateKey, { weekday: "long" })}, {formatTime(e.starts_at, tz)} – {formatTime(e.ends_at, tz)}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 text-sm">
              {e.location ? (
                <p className="flex items-center gap-2">
                  <MapPin className="size-4 text-muted-foreground" aria-hidden /> {e.location}
                </p>
              ) : null}
              {e.meeting_url ? (
                <p className="flex items-center gap-2">
                  <Video className="size-4 text-muted-foreground" aria-hidden />
                  <a href={e.meeting_url} target="_blank" rel="noopener noreferrer nofollow" className="text-primary underline underline-offset-2">
                    Join meeting
                  </a>
                </p>
              ) : null}
              {e.description ? (
                <p className="whitespace-pre-wrap">
                  <RichText text={e.description} />
                </p>
              ) : null}
              <div>
                <p className="mb-2 font-medium">{e.audience === "everyone" ? "Everyone in the workspace is invited" : `${e.participants.length} participants`}</p>
                <ul className="flex flex-wrap gap-2">
                  {e.participants.map((p) => (
                    <li key={p.id}>
                      <Badge variant="secondary" className="gap-1.5 pl-0.5">
                        <UserAvatar user={p} className="size-5" />
                        {p.name}
                      </Badge>
                    </li>
                  ))}
                </ul>
              </div>
              {e.reminder_minutes ? <p className="text-muted-foreground">Reminder {e.reminder_minutes >= 60 ? `${e.reminder_minutes / 60} h` : `${e.reminder_minutes} min`} before.</p> : null}
              <p className="text-xs text-muted-foreground">Organised by {e.creator?.name ?? "Former member"}</p>
            </div>
            {e.can_manage ? (
              <DialogFooter>
                <ConfirmAction
                  trigger={
                    <Button variant="destructive">
                      <Trash2 /> Delete
                    </Button>
                  }
                  title="Delete this event?"
                  description="Participants will no longer see it on their calendar."
                  onConfirm={async () => {
                    try {
                      await api(orgPath(slug, `/events/${e.id}`), { method: "DELETE" })
                      toast.success("Event deleted.")
                      qc.invalidateQueries({ queryKey: ["events", slug] })
                      onClose()
                    } catch (err) {
                      toast.error(errorMessage(err))
                    }
                  }}
                />
                <Button onClick={() => onEdit(e)}>
                  <Pencil /> Edit
                </Button>
              </DialogFooter>
            ) : null}
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}

function EventFormDialog({ open, onOpenChange, event }: { open: boolean; onOpenChange: (o: boolean) => void; event: CalendarEvent | null }) {
  const { slug, org, me } = useWorkspace()
  const tz = org.timezone
  const qc = useQueryClient()
  const members = useMemberOptions(slug)
  const { errors, formError, capture, reset } = useFormErrors()
  const [pending, setPending] = useState(false)
  const start = event ? zonedParts(event.starts_at, tz) : { dateKey: todayKey(tz), time: "10:00" }
  const end = event ? zonedParts(event.ends_at, tz) : { dateKey: todayKey(tz), time: "11:00" }
  const [audience, setAudience] = useState<"participants" | "everyone">(event?.audience ?? "participants")
  const [participants, setParticipants] = useState<number[]>(event ? event.participants.map((p) => p.id).filter((id) => id !== me.id) : [])
  const [reminder, setReminder] = useState(String(event?.reminder_minutes ?? 15))

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    reset()
    const form = new FormData(e.currentTarget)
    const date = String(form.get("date"))
    const endDate = String(form.get("end_date") || date)
    if (!date || !form.get("start_time") || !form.get("end_time")) {
      capture(new ApiError(422, "Choose a date and times.", { starts_at: ["Choose a date and times."] }))
      return
    }
    setPending(true)
    try {
      await api(orgPath(slug, event ? `/events/${event.id}` : "/events"), {
        method: event ? "PUT" : "POST",
        body: {
          title: form.get("title"),
          description: form.get("description") || null,
          location: form.get("location") || null,
          meeting_url: form.get("meeting_url") || null,
          // Entered in the organisation time zone, sent as UTC instants.
          starts_at: zonedToUtc(date, String(form.get("start_time")), tz).toISOString(),
          ends_at: zonedToUtc(endDate, String(form.get("end_time")), tz).toISOString(),
          audience,
          reminder_minutes: reminder === "none" ? null : Number(reminder),
          participant_ids: participants,
        },
      })
      toast.success(event ? "Event updated." : "Event created. Invitees have been notified.")
      qc.invalidateQueries({ queryKey: ["events", slug] })
      qc.invalidateQueries({ queryKey: ["dashboard", slug] })
      onOpenChange(false)
    } catch (error) {
      capture(error)
    } finally {
      setPending(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{event ? "Edit event" : "New event"}</DialogTitle>
          <DialogDescription>Times are in {tz.replace("_", " ")}.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} noValidate>
          <FieldGroup>
            <FormAlert message={formError} />
            <TextField id="title" label="Title" required defaultValue={event?.title} error={errors.title} />
            <div className="grid gap-4 sm:grid-cols-3">
              <TextField id="date" label="Date" type="date" required defaultValue={start.dateKey} error={errors.starts_at} />
              <TextField id="start_time" label="Start" type="time" required defaultValue={start.time} />
              <TextField id="end_time" label="End" type="time" required defaultValue={end.time} error={errors.ends_at} />
            </div>
            <TextField id="end_date" label="End date (if different)" type="date" defaultValue={end.dateKey !== start.dateKey ? end.dateKey : ""} />
            <TextField id="location" label="Location" defaultValue={event?.location ?? ""} error={errors.location} />
            <TextField id="meeting_url" label="Meeting link" type="url" placeholder="https://" defaultValue={event?.meeting_url ?? ""} error={errors.meeting_url} />
            <TextField id="description" label="Description" textarea rows={3} defaultValue={event?.description ?? ""} />
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="audience">Who is invited</Label>
                <Select value={audience} onValueChange={(v) => setAudience(v as typeof audience)}>
                  <SelectTrigger id="audience" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="participants">Selected participants</SelectItem>
                    {org.permissions.create_org_events ? <SelectItem value="everyone">Everyone in the workspace</SelectItem> : null}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="reminder">Reminder</Label>
                <Select value={reminder} onValueChange={setReminder}>
                  <SelectTrigger id="reminder" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">No reminder</SelectItem>
                    {[5, 10, 15, 30, 60, 120, 1440].map((m) => (
                      <SelectItem key={m} value={String(m)}>
                        {m >= 1440 ? "1 day" : m >= 60 ? `${m / 60} hour${m > 60 ? "s" : ""}` : `${m} minutes`} before
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            {audience === "participants" ? (
              <div className="space-y-2">
                <Label htmlFor="participants">Participants</Label>
                <PeoplePicker id="participants" people={(members.data ?? []).map((m) => m.user)} value={participants} onChange={setParticipants} exclude={[me.id]} />
                {errors.participant_ids ? <p className="text-sm text-destructive">{errors.participant_ids}</p> : null}
              </div>
            ) : null}
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={pending}>
                {pending ? <Spinner /> : null}
                {event ? "Save changes" : "Create event"}
              </Button>
            </DialogFooter>
          </FieldGroup>
        </form>
      </DialogContent>
    </Dialog>
  )
}
