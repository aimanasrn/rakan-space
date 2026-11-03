"use client"

import { useQuery, useQueryClient } from "@tanstack/react-query"
import { ArrowLeft, Check, ImageIcon, Lock, Pencil, Plus, ShieldCheck, Trash2, X } from "lucide-react"
import Link from "next/link"
import { useState } from "react"
import { toast } from "sonner"
import { EmptyState, ErrorState, LoadingRows, PageHeader, UserAvatar } from "@/components/common"
import { ConfirmAction } from "@/components/confirm"
import { FormAlert, TextField, useFormErrors } from "@/components/form"
import { AppIcon } from "@/components/launcher/app-icon"
import { BannerIllustration, ILLUSTRATION_OPTIONS } from "@/components/launcher/illustrations"
import { useInstallApp } from "@/components/launcher/use-launcher"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { FieldGroup } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Spinner } from "@/components/ui/spinner"
import { Switch } from "@/components/ui/switch"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { orgPath, useWorkspace } from "@/components/workspace/workspace-context"
import { keys } from "@/hooks/use-workspace-data"
import { api, errorMessage } from "@/lib/api"
import { formatDateTime, timeAgo, zonedParts, zonedToUtc } from "@/lib/datetime"
import type { AdminApp, AppAbility, AppAccessRequest, ConfigurableRole, LauncherBanner, Paginated } from "@/lib/types"

const ABILITIES: AppAbility[] = ["view", "create", "edit", "delete", "approve", "admin"]
const CONFIGURABLE: ConfigurableRole[] = ["manager", "staff"]

export function AppSettingsView() {
  const { org, href } = useWorkspace()

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-4 md:p-8">
      <Button asChild variant="ghost" size="sm" className="-ml-2">
        <Link href={href("/settings")}>
          <ArrowLeft aria-hidden /> Settings
        </Link>
      </Button>
      <PageHeader title="Apps & launcher" description="Choose which apps this workspace uses, who can do what in them, and the banners shown in the app launcher." />
      {org.permissions.manage_apps ? (
        <Tabs defaultValue="apps">
          <TabsList>
            <TabsTrigger value="apps">Apps</TabsTrigger>
            <TabsTrigger value="requests">Access requests</TabsTrigger>
            <TabsTrigger value="banners">Banners</TabsTrigger>
          </TabsList>
          <TabsContent value="apps" className="pt-4">
            <AppsTab />
          </TabsContent>
          <TabsContent value="requests" className="pt-4">
            <RequestsTab />
          </TabsContent>
          <TabsContent value="banners" className="pt-4">
            <BannersTab />
          </TabsContent>
        </Tabs>
      ) : (
        <EmptyState icon={Lock} title="Only owners and admins can manage apps" description="Open the app launcher from the top bar to use or request apps." />
      )}
    </div>
  )
}

// --------------------------------------------------------------------- Apps

function AppsTab() {
  const { slug } = useWorkspace()
  const qc = useQueryClient()
  const install = useInstallApp(slug)
  const [editing, setEditing] = useState<AdminApp | null>(null)
  const apps = useQuery({
    queryKey: keys.adminApps(slug),
    queryFn: async () => (await api<{ data: AdminApp[] }>(orgPath(slug, "/admin/apps"))).data,
  })

  async function uninstall(app: AdminApp) {
    try {
      await api(orgPath(slug, `/admin/apps/${app.key}`), { method: "DELETE" })
      toast.success(`${app.name} uninstalled.`)
      qc.invalidateQueries({ queryKey: keys.adminApps(slug) })
      qc.invalidateQueries({ queryKey: keys.launcher(slug) })
    } catch (e) {
      toast.error(errorMessage(e))
    }
  }

  if (apps.isPending) return <LoadingRows rows={6} />
  if (apps.error) return <ErrorState error={apps.error} onRetry={() => apps.refetch()} />

  return (
    <>
      <div className="overflow-x-auto rounded-xl border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="min-w-64">App</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Staff can</TableHead>
              <TableHead>
                <span className="sr-only">Actions</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {apps.data.map((app) => (
              <TableRow key={app.key}>
                <TableCell>
                  <div className="flex items-center gap-3">
                    <AppIcon app={app} size="md" />
                    <div className="min-w-0">
                      <p className="font-medium">{app.name}</p>
                      <p className="truncate text-xs text-muted-foreground">{app.tagline}</p>
                    </div>
                  </div>
                </TableCell>
                <TableCell>
                  <div className="flex flex-wrap gap-1">
                    {app.installed ? <Badge>Installed</Badge> : <Badge variant="outline">Marketplace</Badge>}
                    {app.pending_requests ? <Badge variant="secondary">{app.pending_requests} pending</Badge> : null}
                  </div>
                </TableCell>
                <TableCell className="text-sm text-muted-foreground capitalize">{app.role_abilities.staff.join(", ") || "No access"}</TableCell>
                <TableCell>
                  <div className="flex justify-end gap-2">
                    <Button variant="outline" size="sm" onClick={() => setEditing(app)}>
                      <ShieldCheck aria-hidden /> Permissions
                    </Button>
                    {app.installed ? (
                      <ConfirmAction
                        trigger={
                          <Button variant="ghost" size="sm">
                            Uninstall
                          </Button>
                        }
                        title={`Uninstall ${app.name}?`}
                        description="It disappears from everyone's launcher and pinned shortcuts. Permission settings are kept if you reinstall."
                        confirmLabel="Uninstall"
                        onConfirm={() => uninstall(app)}
                      />
                    ) : (
                      <Button size="sm" disabled={install.isPending && install.variables?.key === app.key} onClick={() => install.mutate(app)}>
                        {install.isPending && install.variables?.key === app.key ? <Spinner /> : null}
                        Install
                      </Button>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      {editing ? <PermissionsDialog app={editing} onClose={() => setEditing(null)} /> : null}
    </>
  )
}

function PermissionsDialog({ app, onClose }: { app: AdminApp; onClose: () => void }) {
  const { slug } = useWorkspace()
  const qc = useQueryClient()
  const [roles, setRoles] = useState<Record<ConfigurableRole, AppAbility[]>>(app.role_abilities)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Every ability needs "view"; removing "view" removes everything.
  function toggle(role: ConfigurableRole, ability: AppAbility, on: boolean) {
    setRoles((current) => {
      let next = on ? [...current[role], ability] : current[role].filter((a) => a !== ability)
      if (ability === "view" && !on) next = []
      if (on && ability !== "view" && !next.includes("view")) next.push("view")
      return { ...current, [role]: ABILITIES.filter((a) => next.includes(a)) }
    })
  }

  async function save() {
    setPending(true)
    setError(null)
    try {
      await api(orgPath(slug, `/admin/apps/${app.key}/permissions`), { method: "PUT", body: { roles } })
      toast.success(`Permissions for ${app.name} saved.`)
      qc.invalidateQueries({ queryKey: keys.adminApps(slug) })
      qc.invalidateQueries({ queryKey: keys.launcher(slug) })
      onClose()
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setPending(false)
    }
  }

  return (
    <Dialog open onOpenChange={(o) => (o ? null : onClose())}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{app.name} permissions</DialogTitle>
          <DialogDescription>Owners and Admins can always do everything. Abilities only cover this app&apos;s own data.</DialogDescription>
        </DialogHeader>
        <FormAlert message={error} />
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Role</TableHead>
                {ABILITIES.map((a) => (
                  <TableHead key={a} className="text-center capitalize">
                    {a}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow>
                <TableCell className="text-muted-foreground">Owner, Admin</TableCell>
                {ABILITIES.map((a) => (
                  <TableCell key={a} className="text-center">
                    <Check className="mx-auto size-4 text-muted-foreground" aria-label="Always allowed" />
                  </TableCell>
                ))}
              </TableRow>
              {CONFIGURABLE.map((role) => (
                <TableRow key={role}>
                  <TableCell className="font-medium capitalize">{role}</TableCell>
                  {ABILITIES.map((a) => (
                    <TableCell key={a} className="text-center">
                      <Checkbox
                        checked={roles[role].includes(a)}
                        onCheckedChange={(v) => toggle(role, a, v === true)}
                        aria-label={`${role} can ${a}`}
                      />
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={save} disabled={pending}>
            {pending ? <Spinner /> : null}
            Save permissions
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ----------------------------------------------------------------- Requests

function RequestsTab() {
  const { slug, org } = useWorkspace()
  const qc = useQueryClient()
  const [status, setStatus] = useState("pending")
  const [q, setQ] = useState("")
  const [page, setPage] = useState(1)
  const params = { status, q: q || undefined, page, per_page: 20 }
  const requests = useQuery({
    queryKey: keys.appRequests(slug, params),
    queryFn: () => api<Paginated<AppAccessRequest>>(orgPath(slug, "/admin/app-requests"), { query: params }),
  })

  async function decide(r: AppAccessRequest, action: "approve" | "reject") {
    try {
      await api(orgPath(slug, `/admin/app-requests/${r.id}/${action}`), { method: "POST" })
      toast.success(action === "approve" ? `${r.app.name} installed and ${r.user.name} notified.` : `Request from ${r.user.name} declined.`)
      qc.invalidateQueries({ queryKey: ["app-requests", slug] })
      qc.invalidateQueries({ queryKey: keys.adminApps(slug) })
      qc.invalidateQueries({ queryKey: keys.launcher(slug) })
    } catch (e) {
      toast.error(errorMessage(e))
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3" role="search" aria-label="Filter requests">
        <Label htmlFor="request-search" className="sr-only">
          Search requests
        </Label>
        <Input id="request-search" placeholder="Search by person or app…" value={q} onChange={(e) => (setQ(e.target.value), setPage(1))} className="max-w-xs" />
        <Select value={status} onValueChange={(v) => (setStatus(v), setPage(1))}>
          <SelectTrigger className="w-36" aria-label="Status">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="pending">Pending</SelectItem>
            <SelectItem value="approved">Approved</SelectItem>
            <SelectItem value="rejected">Declined</SelectItem>
            <SelectItem value="all">All</SelectItem>
          </SelectContent>
        </Select>
      </div>
      {requests.error ? <ErrorState error={requests.error} onRetry={() => requests.refetch()} /> : null}
      {requests.isPending ? (
        <LoadingRows rows={3} />
      ) : requests.data?.data.length ? (
        <ul className="divide-y rounded-xl border">
          {requests.data.data.map((r) => (
            <li key={r.id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
              <div className="flex min-w-0 flex-1 items-center gap-3">
                <UserAvatar user={r.user} />
                <div className="min-w-0">
                  <p className="text-sm">
                    <span className="font-medium">{r.user.name}</span> requested <span className="font-medium">{r.app.name}</span>
                  </p>
                  <p className="text-xs text-muted-foreground" title={formatDateTime(r.created_at, org.timezone)}>
                    {timeAgo(r.created_at)}
                    {r.decided_by ? ` · ${r.status === "approved" ? "approved" : "declined"} by ${r.decided_by.name}` : null}
                  </p>
                  {r.note ? <p className="mt-1 text-sm text-muted-foreground">“{r.note}”</p> : null}
                </div>
              </div>
              {r.status === "pending" ? (
                <div className="flex gap-2">
                  <Button size="sm" onClick={() => decide(r, "approve")}>
                    <Check aria-hidden /> Approve & install
                  </Button>
                  <ConfirmAction
                    trigger={
                      <Button size="sm" variant="outline">
                        <X aria-hidden /> Decline
                      </Button>
                    }
                    title="Decline this request?"
                    description={`${r.user.name} will be notified.`}
                    confirmLabel="Decline"
                    onConfirm={() => decide(r, "reject")}
                  />
                </div>
              ) : (
                <Badge variant={r.status === "approved" ? "default" : "outline"}>{r.status === "approved" ? "Approved" : "Declined"}</Badge>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState title="No requests" description={status === "pending" ? "Nobody is waiting for an app right now." : "Nothing matches these filters."} />
      )}
      <Pager page={page} lastPage={requests.data?.meta.last_page ?? 1} onPage={setPage} />
    </div>
  )
}

// ------------------------------------------------------------------ Banners

function BannersTab() {
  const { slug } = useWorkspace()
  const qc = useQueryClient()
  const [status, setStatus] = useState("all")
  const [q, setQ] = useState("")
  const [page, setPage] = useState(1)
  const [editing, setEditing] = useState<LauncherBanner | "new" | null>(null)
  const params = { status, q: q || undefined, page, per_page: 20 }
  const banners = useQuery({
    queryKey: keys.banners(slug, params),
    queryFn: () => api<Paginated<LauncherBanner>>(orgPath(slug, "/launcher/banners"), { query: params }),
  })

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["launcher-banners", slug] })
    qc.invalidateQueries({ queryKey: keys.launcher(slug) })
  }

  async function setActive(b: LauncherBanner, is_active: boolean) {
    try {
      await api(orgPath(slug, `/launcher/banners/${b.id}`), { method: "PATCH", body: { is_active } })
      refresh()
    } catch (e) {
      toast.error(errorMessage(e))
    }
  }

  async function remove(b: LauncherBanner) {
    try {
      await api(orgPath(slug, `/launcher/banners/${b.id}`), { method: "DELETE" })
      toast.success("Banner deleted.")
      refresh()
    } catch (e) {
      toast.error(errorMessage(e))
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex flex-1 flex-wrap items-center gap-3" role="search" aria-label="Filter banners">
          <Label htmlFor="banner-search" className="sr-only">
            Search banners
          </Label>
          <Input id="banner-search" placeholder="Search banners…" value={q} onChange={(e) => (setQ(e.target.value), setPage(1))} className="max-w-xs" />
          <Select value={status} onValueChange={(v) => (setStatus(v), setPage(1))}>
            <SelectTrigger className="w-36" aria-label="Status">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="live">Live now</SelectItem>
              <SelectItem value="scheduled">Scheduled</SelectItem>
              <SelectItem value="expired">Ended</SelectItem>
              <SelectItem value="inactive">Turned off</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <Button onClick={() => setEditing("new")}>
          <Plus aria-hidden /> New banner
        </Button>
      </div>
      {banners.error ? <ErrorState error={banners.error} onRetry={() => banners.refetch()} /> : null}
      {banners.isPending ? (
        <LoadingRows rows={3} />
      ) : banners.data?.data.length ? (
        <ul className="grid gap-3">
          {banners.data.data.map((b) => (
            <li key={b.id} className="flex flex-col gap-4 rounded-xl border p-4 sm:flex-row sm:items-center">
              <div className="flex h-20 w-28 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-slate-900">
                {b.image_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={b.image_url} alt="" className="size-full object-cover" />
                ) : (
                  <BannerIllustration name={b.illustration} className="scale-50" />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-medium">{b.title}</p>
                  {b.is_live ? <Badge>Live</Badge> : <Badge variant="outline">{b.is_active ? "Not in schedule" : "Off"}</Badge>}
                </div>
                {b.description ? <p className="line-clamp-2 text-sm text-muted-foreground">{b.description}</p> : null}
                <p className="text-xs text-muted-foreground">Order {b.sort_order}</p>
              </div>
              <div className="flex items-center gap-2">
                <Switch checked={b.is_active} onCheckedChange={(v) => setActive(b, v)} aria-label={`Show "${b.title}" in the launcher`} />
                <Button variant="ghost" size="icon-sm" onClick={() => setEditing(b)} aria-label={`Edit "${b.title}"`}>
                  <Pencil aria-hidden />
                </Button>
                <ConfirmAction
                  trigger={
                    <Button variant="ghost" size="icon-sm" aria-label={`Delete "${b.title}"`}>
                      <Trash2 aria-hidden />
                    </Button>
                  }
                  title="Delete this banner?"
                  description="It will no longer appear in the launcher."
                  onConfirm={() => remove(b)}
                />
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState
          icon={ImageIcon}
          title="No banners"
          description={q || status !== "all" ? "Nothing matches these filters." : "Banners appear at the top of everyone's app launcher."}
        />
      )}
      <Pager page={page} lastPage={banners.data?.meta.last_page ?? 1} onPage={setPage} />
      {editing ? <BannerFormDialog banner={editing === "new" ? null : editing} onClose={() => setEditing(null)} onSaved={refresh} /> : null}
    </div>
  )
}

function toLocalInput(value: string | null, timeZone: string) {
  if (!value) return ""
  const { dateKey, time } = zonedParts(value, timeZone)
  return `${dateKey}T${time}`
}

function fromLocalInput(value: string, timeZone: string) {
  if (!value) return null
  const [dateKey, time] = value.split("T")
  return zonedToUtc(dateKey, time, timeZone).toISOString()
}

function BannerFormDialog({ banner, onClose, onSaved }: { banner: LauncherBanner | null; onClose: () => void; onSaved: () => void }) {
  const { slug, org } = useWorkspace()
  const { errors, formError, capture, reset } = useFormErrors()
  const [pending, setPending] = useState(false)
  const [active, setActive] = useState(banner?.is_active ?? true)
  const [illustration, setIllustration] = useState(banner?.illustration ?? "excellence")
  const [removeImage, setRemoveImage] = useState(false)
  const [savedId, setSavedId] = useState<number | null>(banner?.id ?? null)

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    reset()
    const form = new FormData(e.currentTarget)
    const image = form.get("image") as File | null
    if (image && image.size > 2 * 1024 * 1024) {
      capture(new Error("The image must be 2 MB or smaller."))
      return
    }
    setPending(true)
    const body = {
      title: String(form.get("title") ?? "").trim(),
      description: String(form.get("description") ?? "").trim() || null,
      cta_label: String(form.get("cta_label") ?? "").trim() || null,
      cta_url: String(form.get("cta_url") ?? "").trim() || null,
      illustration,
      is_active: active,
      sort_order: Number(form.get("sort_order") || 0),
      starts_at: fromLocalInput(String(form.get("starts_at") ?? ""), org.timezone),
      ends_at: fromLocalInput(String(form.get("ends_at") ?? ""), org.timezone),
    }
    try {
      // After a create, retries update the same banner instead of creating another.
      const saved = savedId
        ? await api<{ data: LauncherBanner }>(orgPath(slug, `/launcher/banners/${savedId}`), { method: "PATCH", body })
        : await api<{ data: LauncherBanner }>(orgPath(slug, "/launcher/banners"), { method: "POST", body })
      const id = saved.data.id
      setSavedId(id)
      if (image && image.size) {
        const upload = new FormData()
        upload.append("image", image)
        await api(orgPath(slug, `/launcher/banners/${id}/image`), { method: "POST", body: upload })
      } else if (removeImage && banner?.image_url) {
        await api(orgPath(slug, `/launcher/banners/${id}/image`), { method: "DELETE" })
      }
      toast.success(banner ? "Banner updated." : "Banner created.")
      onSaved()
      onClose()
    } catch (error) {
      capture(error)
    } finally {
      setPending(false)
    }
  }

  return (
    <Dialog open onOpenChange={(o) => (o ? null : onClose())}>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{banner ? "Edit banner" : "New banner"}</DialogTitle>
          <DialogDescription>Shown at the top of the app launcher for everyone in this workspace.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} noValidate>
          <FieldGroup>
            <FormAlert message={formError} />
            <TextField id="title" label="Title" required maxLength={120} defaultValue={banner?.title} error={errors.title} />
            <TextField id="description" label="Description" textarea rows={3} maxLength={500} defaultValue={banner?.description ?? ""} error={errors.description} />
            <div className="grid gap-4 sm:grid-cols-[10rem_1fr]">
              <TextField id="cta_label" label="Button label" maxLength={40} placeholder="Learn more" defaultValue={banner?.cta_label ?? ""} error={errors.cta_label} />
              <TextField
                id="cta_url"
                label="Button link"
                maxLength={2048}
                placeholder="/apps/lms or https://…"
                defaultValue={banner?.cta_url ?? ""}
                error={errors.cta_url}
                description="A path in this workspace, or a full https:// link (opens in a new tab)."
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="illustration">Illustration</Label>
                <Select value={illustration} onValueChange={setIllustration}>
                  <SelectTrigger id="illustration" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ILLUSTRATION_OPTIONS.map((o) => (
                      <SelectItem key={o.value} value={o.value}>
                        {o.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">Used when no image is uploaded.</p>
              </div>
              <TextField id="image" label="Image" type="file" accept="image/png,image/jpeg,image/webp" error={errors.image} description="PNG, JPG or WebP up to 2 MB." />
            </div>
            {banner?.image_url ? (
              <label className="flex items-center gap-2 text-sm">
                <Checkbox checked={removeImage} onCheckedChange={(v) => setRemoveImage(v === true)} /> Remove the current image
              </label>
            ) : null}
            <div className="grid gap-4 sm:grid-cols-2">
              <TextField id="starts_at" label="Show from (optional)" type="datetime-local" defaultValue={toLocalInput(banner?.starts_at ?? null, org.timezone)} error={errors.starts_at} />
              <TextField id="ends_at" label="Show until (optional)" type="datetime-local" defaultValue={toLocalInput(banner?.ends_at ?? null, org.timezone)} error={errors.ends_at} />
            </div>
            <div className="grid items-end gap-4 sm:grid-cols-2">
              <TextField id="sort_order" label="Order" type="number" min={-1000} max={1000} defaultValue={banner?.sort_order ?? 0} error={errors.sort_order} description="Lower numbers show first." />
              <label className="flex items-center gap-2 pb-6 text-sm">
                <Switch checked={active} onCheckedChange={setActive} /> Show in the launcher
              </label>
            </div>
            <p className="text-xs text-muted-foreground">Times are in the workspace time zone ({org.timezone}).</p>
          </FieldGroup>
          <DialogFooter className="mt-6">
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? <Spinner /> : null}
              {banner ? "Save banner" : "Create banner"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function Pager({ page, lastPage, onPage }: { page: number; lastPage: number; onPage: (p: number) => void }) {
  if (lastPage <= 1) return null
  return (
    <nav className="flex items-center justify-end gap-2" aria-label="Pagination">
      <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => onPage(page - 1)}>
        Previous
      </Button>
      <span className="text-sm text-muted-foreground">
        Page {page} of {lastPage}
      </span>
      <Button variant="outline" size="sm" disabled={page >= lastPage} onClick={() => onPage(page + 1)}>
        Next
      </Button>
    </nav>
  )
}
