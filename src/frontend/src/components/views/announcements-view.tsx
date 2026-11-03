"use client"

import { useQuery, useQueryClient } from "@tanstack/react-query"
import { CheckCircle2, Megaphone, MoreHorizontal, Pencil, Pin, PinOff, Plus, Trash2, UsersRound } from "lucide-react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { useEffect, useState } from "react"
import { toast } from "sonner"
import { AttachmentList, UploadButton, useUploader } from "@/components/attachments"
import { EmptyState, ErrorState, LoadingRows, PageHeader, RichText, UserAvatar } from "@/components/common"
import { ConfirmAction } from "@/components/confirm"
import { FormAlert, TextField, useFormErrors } from "@/components/form"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardFooter, CardHeader } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { FieldGroup } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Progress } from "@/components/ui/progress"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Spinner } from "@/components/ui/spinner"
import { orgPath, useWorkspace } from "@/components/workspace/workspace-context"
import { useDepartments } from "@/hooks/use-workspace-data"
import { api, errorMessage } from "@/lib/api"
import { formatDateTime, timeAgo } from "@/lib/datetime"
import { t } from "@/lib/i18n"
import type { Announcement, Paginated, UserSummary } from "@/lib/types"
import { cn } from "@/lib/utils"

export function AnnouncementsView() {
  const { slug, org } = useWorkspace()
  const params = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()
  const [q, setQ] = useState("")
  const [page, setPage] = useState(1)
  const [editing, setEditing] = useState<Announcement | null>(null)
  const [creating, setCreating] = useState(false)
  const [acksFor, setAcksFor] = useState<Announcement | null>(null)
  const focusId = params.get("id") ? Number(params.get("id")) : null

  const list = useQuery({
    queryKey: ["announcements", slug, q, page],
    queryFn: () => api<Paginated<Announcement>>(orgPath(slug, "/announcements"), { query: { q: q || undefined, page } }),
    placeholderData: (prev) => prev,
  })

  // Deep link to an announcement that is not on the current page.
  const single = useQuery({
    queryKey: ["announcement", slug, focusId],
    enabled: !!focusId && !!list.data && !list.data.data.some((a) => a.id === focusId),
    queryFn: async () => (await api<{ data: Announcement }>(orgPath(slug, `/announcements/${focusId}`))).data,
  })

  useEffect(() => {
    if (focusId && list.data) document.getElementById(`announcement-${focusId}`)?.scrollIntoView({ block: "start" })
  }, [focusId, list.data])

  const items = [...(single.data ? [single.data] : []), ...(list.data?.data ?? [])]

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-4 md:p-8">
      <PageHeader
        title={t("nav.announcements")}
        description="Updates for the whole organisation or specific departments."
        actions={
          org.permissions.publish_announcements ? (
            <Button onClick={() => setCreating(true)}>
              <Plus /> New announcement
            </Button>
          ) : null
        }
      />
      <div>
        <Label htmlFor="announcement-search" className="sr-only">
          Search announcements
        </Label>
        <Input id="announcement-search" placeholder="Search announcements…" value={q} onChange={(e) => (setQ(e.target.value), setPage(1))} className="max-w-sm" />
      </div>
      {list.error ? <ErrorState error={list.error} onRetry={() => list.refetch()} /> : null}
      {list.isLoading ? (
        <LoadingRows rows={3} />
      ) : items.length ? (
        <ul className="space-y-4">
          {items.map((a) => (
            <li key={a.id} id={`announcement-${a.id}`} className="scroll-mt-20">
              <AnnouncementCard announcement={a} highlighted={focusId === a.id} onEdit={() => setEditing(a)} onShowAcks={() => setAcksFor(a)} onClose={() => router.replace(pathname)} />
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState icon={Megaphone} title={t("empty.announcements")} description={org.permissions.publish_announcements ? "Publish the first update for your team." : undefined} />
      )}
      {list.data && list.data.meta.last_page > 1 ? (
        <nav className="flex items-center justify-center gap-2" aria-label="Pagination">
          <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
            Previous
          </Button>
          <span className="text-sm text-muted-foreground">
            Page {page} of {list.data.meta.last_page}
          </span>
          <Button variant="outline" size="sm" disabled={page >= list.data.meta.last_page} onClick={() => setPage((p) => p + 1)}>
            Next
          </Button>
        </nav>
      ) : null}
      {org.permissions.publish_announcements || editing ? (
        <AnnouncementFormDialog
          key={editing?.id ?? "new"}
          open={creating || !!editing}
          announcement={editing}
          onOpenChange={(o) => {
            if (!o) {
              setCreating(false)
              setEditing(null)
            }
          }}
        />
      ) : null}
      <AcknowledgementsDialog announcement={acksFor} onClose={() => setAcksFor(null)} />
    </div>
  )
}

function AnnouncementCard({ announcement: a, highlighted, onEdit, onShowAcks }: { announcement: Announcement; highlighted: boolean; onEdit: () => void; onShowAcks: () => void; onClose: () => void }) {
  const { slug, org } = useWorkspace()
  const qc = useQueryClient()
  const [confirm, setConfirm] = useState(false)
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["announcements", slug] })
    qc.invalidateQueries({ queryKey: ["announcement", slug] })
    qc.invalidateQueries({ queryKey: ["dashboard", slug] })
  }

  async function call(path: string, method: "POST" | "PATCH" | "DELETE", body?: unknown, message?: string) {
    try {
      await api(orgPath(slug, `/announcements/${a.id}${path}`), { method, body })
      if (message) toast.success(message)
      refresh()
    } catch (e) {
      toast.error(errorMessage(e))
    }
  }

  return (
    <Card className={cn(a.pinned && "border-primary/40", highlighted && "ring-2 ring-ring/50")}>
      <CardHeader className="flex flex-row items-start gap-3">
        <UserAvatar user={a.author} className="size-9" />
        <div className="min-w-0 flex-1 space-y-1">
          <h2 className="flex flex-wrap items-center gap-2 text-lg leading-tight font-semibold">
            {a.pinned ? <Pin className="size-4 text-primary" aria-label="Pinned" /> : null}
            {a.title}
          </h2>
          <p className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
            <span>{a.author?.name ?? "Former member"}</span>
            <span aria-hidden>·</span>
            <time dateTime={a.created_at} title={formatDateTime(a.created_at, org.timezone)}>
              {timeAgo(a.created_at)}
            </time>
            <Badge variant="outline">{a.audience === "department" ? (a.department?.name ?? "Department") : "Everyone"}</Badge>
          </p>
        </div>
        {a.can_manage ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${a.title}`}>
                <MoreHorizontal />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={onEdit}>
                <Pencil /> Edit
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => call("", "PATCH", { pinned: !a.pinned }, a.pinned ? "Unpinned." : "Pinned.")}>
                {a.pinned ? <PinOff /> : <Pin />} {a.pinned ? "Unpin" : "Pin to top"}
              </DropdownMenuItem>
              {a.requires_acknowledgement ? (
                <DropdownMenuItem onSelect={onShowAcks}>
                  <UsersRound /> Acknowledgement status
                </DropdownMenuItem>
              ) : null}
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onSelect={() => setConfirm(true)}>
                <Trash2 /> Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm leading-relaxed whitespace-pre-wrap">
          <RichText text={a.body} />
        </p>
        <AttachmentList items={a.attachments} />
      </CardContent>
      {a.requires_acknowledgement ? (
        <CardFooter className="flex flex-wrap items-center justify-between gap-3 border-t">
          {a.acknowledged ? (
            <span className="flex items-center gap-1.5 text-sm text-success">
              <CheckCircle2 className="size-4" aria-hidden /> You acknowledged this
            </span>
          ) : (
            <Button size="sm" onClick={() => call("/acknowledge", "POST", undefined, "Thanks for acknowledging.")}>
              <CheckCircle2 /> Acknowledge
            </Button>
          )}
          {a.can_manage ? (
            <Button variant="link" size="sm" onClick={onShowAcks}>
              {a.acknowledgements_count} acknowledged
            </Button>
          ) : null}
        </CardFooter>
      ) : null}
      <ConfirmAction open={confirm} onOpenChange={setConfirm} title="Delete announcement?" description="It will be removed for everyone." onConfirm={() => call("", "DELETE", undefined, "Announcement deleted.")} />
    </Card>
  )
}

function AnnouncementFormDialog({ open, onOpenChange, announcement }: { open: boolean; onOpenChange: (o: boolean) => void; announcement: Announcement | null }) {
  const { slug, org } = useWorkspace()
  const qc = useQueryClient()
  const departments = useDepartments(slug)
  const uploader = useUploader(slug)
  const { errors, formError, capture, reset } = useFormErrors()
  const [pending, setPending] = useState(false)
  const [audience, setAudience] = useState<"organization" | "department">(announcement?.audience ?? "organization")
  const [departmentId, setDepartmentId] = useState(announcement?.department ? String(announcement.department.id) : "")
  const [ack, setAck] = useState(announcement?.requires_acknowledgement ?? false)
  const [pinned, setPinned] = useState(announcement?.pinned ?? false)

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    reset()
    setPending(true)
    const form = new FormData(e.currentTarget)
    try {
      await api(orgPath(slug, announcement ? `/announcements/${announcement.id}` : "/announcements"), {
        method: announcement ? "PATCH" : "POST",
        body: {
          title: form.get("title"),
          body: form.get("body"),
          audience,
          department_id: audience === "department" ? Number(departmentId) || null : null,
          requires_acknowledgement: ack,
          pinned,
          attachment_ids: uploader.ids,
        },
      })
      toast.success(announcement ? "Announcement updated." : "Announcement published. The audience has been notified.")
      qc.invalidateQueries({ queryKey: ["announcements", slug] })
      qc.invalidateQueries({ queryKey: ["dashboard", slug] })
      uploader.clear()
      onOpenChange(false)
    } catch (error) {
      capture(error)
    } finally {
      setPending(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{announcement ? "Edit announcement" : "New announcement"}</DialogTitle>
          <DialogDescription>{org.membership.role === "manager" ? "Managers can publish to everyone or to departments they belong to." : "Publish to everyone or a specific department."}</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} noValidate>
          <FieldGroup>
            <FormAlert message={formError} />
            <TextField id="title" label="Title" required defaultValue={announcement?.title} error={errors.title} />
            <TextField id="body" label="Message" textarea rows={6} required defaultValue={announcement?.body} error={errors.body} />
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="ann-audience">Audience</Label>
                <Select value={audience} onValueChange={(v) => setAudience(v as typeof audience)}>
                  <SelectTrigger id="ann-audience" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="organization">Everyone</SelectItem>
                    <SelectItem value="department" disabled={!departments.data?.length}>
                      A department
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {audience === "department" ? (
                <div className="space-y-2">
                  <Label htmlFor="ann-dept">Department</Label>
                  <Select value={departmentId} onValueChange={setDepartmentId}>
                    <SelectTrigger id="ann-dept" className="w-full" aria-invalid={!!errors.department_id}>
                      <SelectValue placeholder="Choose…" />
                    </SelectTrigger>
                    <SelectContent>
                      {departments.data?.map((d) => (
                        <SelectItem key={d.id} value={String(d.id)}>
                          {d.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {errors.department_id ? <p className="text-sm text-destructive">{errors.department_id}</p> : null}
                </div>
              ) : null}
            </div>
            <div className="flex items-center gap-2">
              <Checkbox id="ann-ack" checked={ack} onCheckedChange={(v) => setAck(v === true)} />
              <Label htmlFor="ann-ack" className="font-normal">
                Require acknowledgement
              </Label>
            </div>
            <div className="flex items-center gap-2">
              <Checkbox id="ann-pin" checked={pinned} onCheckedChange={(v) => setPinned(v === true)} />
              <Label htmlFor="ann-pin" className="font-normal">
                Pin to the top
              </Label>
            </div>
            <div className="space-y-2">
              <UploadButton onFiles={uploader.add} uploading={uploader.uploading} />
              <AttachmentList items={[...(announcement?.attachments ?? []), ...uploader.items]} />
            </div>
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={pending || uploader.uploading}>
                {pending ? <Spinner /> : null}
                {announcement ? "Save changes" : "Publish"}
              </Button>
            </DialogFooter>
          </FieldGroup>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function AcknowledgementsDialog({ announcement, onClose }: { announcement: Announcement | null; onClose: () => void }) {
  return (
    <Dialog open={!!announcement} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Acknowledgements</DialogTitle>
          <DialogDescription>{announcement?.title}</DialogDescription>
        </DialogHeader>
        {announcement ? <AcknowledgementsBody announcementId={announcement.id} /> : null}
      </DialogContent>
    </Dialog>
  )
}

function AcknowledgementsBody({ announcementId }: { announcementId: number }) {
  const { slug, org } = useWorkspace()
  const acks = useQuery({
    queryKey: ["acks", slug, announcementId],
    queryFn: () =>
      api<{ data: { user: UserSummary; acknowledged_at: string | null }[]; meta: { audience: number; acknowledged: number } }>(orgPath(slug, `/announcements/${announcementId}/acknowledgements`)),
  })
  const pct = acks.data ? Math.round((acks.data.meta.acknowledged / Math.max(1, acks.data.meta.audience)) * 100) : 0
  return (
    <>
        {acks.isLoading || !acks.data ? (
          acks.error ? <ErrorState error={acks.error} /> : <LoadingRows rows={3} />
        ) : (
          <div className="space-y-4">
            <div className="space-y-1">
              <p className="text-sm">
                {acks.data!.meta.acknowledged} of {acks.data!.meta.audience} people ({pct}%)
              </p>
              <Progress value={pct} aria-label="Acknowledged" />
            </div>
            <ul className="max-h-80 space-y-2 overflow-y-auto">
              {acks.data!.data.map((row) => (
                <li key={row.user.id} className="flex items-center gap-2 text-sm">
                  <UserAvatar user={row.user} className="size-7" />
                  <span className="flex-1 truncate">{row.user.name}</span>
                  {row.acknowledged_at ? (
                    <span className="text-xs text-success">{formatDateTime(row.acknowledged_at, org.timezone, { year: undefined })}</span>
                  ) : (
                    <span className="text-xs text-muted-foreground">Pending</span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
    </>
  )
}
