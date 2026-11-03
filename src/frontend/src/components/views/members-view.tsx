"use client"

import { useQuery, useQueryClient } from "@tanstack/react-query"
import { Building, MailPlus, MessageSquare, MoreHorizontal, Pencil, Plus, RotateCcw, Send, Trash2, UserCheck, UserMinus, UserX, Users } from "lucide-react"
import { useRouter } from "next/navigation"
import { useState } from "react"
import { toast } from "sonner"
import { EmptyState, ErrorState, LoadingRows, PageHeader, RoleBadge, UserAvatar } from "@/components/common"
import { ConfirmAction } from "@/components/confirm"
import { FormAlert, TextField, useFormErrors } from "@/components/form"
import { InviteForm } from "@/components/invite-form"
import { PeoplePicker } from "@/components/pickers"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { FieldGroup } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Spinner } from "@/components/ui/spinner"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { orgPath, useWorkspace } from "@/components/workspace/workspace-context"
import { keys, useDepartments, useMemberOptions } from "@/hooks/use-workspace-data"
import { api, errorMessage } from "@/lib/api"
import { formatInstantDate, timeAgo } from "@/lib/datetime"
import { t } from "@/lib/i18n"
import type { ConversationDetail, Department, Invitation, Membership, Paginated, Role } from "@/lib/types"

export function MembersView() {
  const { org } = useWorkspace()
  const [inviting, setInviting] = useState(false)
  const admin = org.permissions.manage_members
  return (
    <div className="space-y-6 p-4 md:p-8">
      <PageHeader
        title={t("nav.members")}
        description={`${org.members_count} active member${org.members_count === 1 ? "" : "s"} in ${org.name}.`}
        actions={
          org.permissions.invite_members ? (
            <Button onClick={() => setInviting(true)}>
              <MailPlus /> Invite people
            </Button>
          ) : null
        }
      />
      <Tabs defaultValue="directory">
        <TabsList>
          <TabsTrigger value="directory">Directory</TabsTrigger>
          {admin ? <TabsTrigger value="invitations">Invitations</TabsTrigger> : null}
          <TabsTrigger value="departments">Departments</TabsTrigger>
        </TabsList>
        <TabsContent value="directory" className="pt-4">
          <Directory />
        </TabsContent>
        {admin ? (
          <TabsContent value="invitations" className="pt-4">
            <Invitations />
          </TabsContent>
        ) : null}
        <TabsContent value="departments" className="pt-4">
          <Departments />
        </TabsContent>
      </Tabs>
      <InviteDialog open={inviting} onOpenChange={setInviting} />
    </div>
  )
}

function InviteDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { slug, org } = useWorkspace()
  const qc = useQueryClient()
  const departments = useDepartments(slug)
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Invite people to {org.name}</DialogTitle>
          <DialogDescription>Invitations are single-use, expire in 7 days and must be accepted with the invited email address.</DialogDescription>
        </DialogHeader>
        <InviteForm slug={slug} roles={org.permissions.assignable_roles} departments={departments.data ?? []} onDone={() => qc.invalidateQueries({ queryKey: ["invitations", slug] })} />
      </DialogContent>
    </Dialog>
  )
}

function Directory() {
  const { slug, org, me, href } = useWorkspace()
  const router = useRouter()
  const qc = useQueryClient()
  const departments = useDepartments(slug)
  const [q, setQ] = useState("")
  const [role, setRole] = useState("all")
  const [department, setDepartment] = useState("all")
  const [status, setStatus] = useState("active")
  const [page, setPage] = useState(1)
  const [removing, setRemoving] = useState<Membership | null>(null)
  const admin = org.permissions.manage_members

  const query = { q: q || undefined, role: role === "all" ? undefined : role, department_id: department === "all" ? undefined : department, status, page, per_page: 25 }
  const members = useQuery({
    queryKey: keys.members(slug, query),
    queryFn: () => api<Paginated<Membership>>(orgPath(slug, "/members"), { query }),
    placeholderData: (prev) => prev,
  })

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["members", slug] })
    qc.invalidateQueries({ queryKey: keys.org(slug) })
  }

  async function act(m: Membership, path: string, method: "POST" | "PATCH" | "DELETE", body: unknown, message: string) {
    try {
      await api(orgPath(slug, `/members/${m.id}${path}`), { method, body })
      toast.success(message)
      refresh()
    } catch (e) {
      toast.error(errorMessage(e))
    }
  }

  async function message(userId: number) {
    try {
      const { data } = await api<{ data: ConversationDetail }>(orgPath(slug, "/direct-conversations"), { method: "POST", body: { user_id: userId } })
      router.push(href(`/chat/${data.id}`))
    } catch (e) {
      toast.error(errorMessage(e))
    }
  }

  // Admins may not act on owners/admins; only owners can.
  const canManage = (m: Membership) => admin && m.user.id !== me.id && (org.membership.role === "owner" || !["owner", "admin"].includes(m.role))

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3" role="search" aria-label="Filter members">
        <Label htmlFor="member-search" className="sr-only">
          Search members
        </Label>
        <Input id="member-search" placeholder="Search by name, email or title…" value={q} onChange={(e) => (setQ(e.target.value), setPage(1))} className="max-w-xs" />
        <Select value={role} onValueChange={(v) => (setRole(v), setPage(1))}>
          <SelectTrigger className="w-36" aria-label="Role">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All roles</SelectItem>
            {(["owner", "admin", "manager", "staff"] as const).map((r) => (
              <SelectItem key={r} value={r}>
                {t(`role.${r}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={department} onValueChange={(v) => (setDepartment(v), setPage(1))}>
          <SelectTrigger className="w-44" aria-label="Department">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All departments</SelectItem>
            {departments.data?.map((d) => (
              <SelectItem key={d.id} value={String(d.id)}>
                {d.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {admin ? (
          <Select value={status} onValueChange={(v) => (setStatus(v), setPage(1))}>
            <SelectTrigger className="w-40" aria-label="Status">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="active">Active</SelectItem>
              <SelectItem value="deactivated">Deactivated</SelectItem>
              <SelectItem value="all">Active & deactivated</SelectItem>
            </SelectContent>
          </Select>
        ) : null}
      </div>
      {members.error ? <ErrorState error={members.error} onRetry={() => members.refetch()} /> : null}
      {members.isLoading ? (
        <LoadingRows rows={5} />
      ) : members.data?.data.length ? (
        <div className="overflow-x-auto rounded-xl border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="min-w-56">Name</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Departments</TableHead>
                <TableHead>Joined</TableHead>
                <TableHead>
                  <span className="sr-only">Actions</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {members.data.data.map((m) => (
                <TableRow key={m.id}>
                  <TableCell>
                    <div className="flex items-center gap-3">
                      <UserAvatar user={m.user} />
                      <div className="min-w-0">
                        <p className="truncate font-medium">
                          {m.user.name} {m.user.id === me.id ? <span className="text-muted-foreground">(you)</span> : null}
                        </p>
                        <p className="truncate text-xs text-muted-foreground">{m.user.job_title ?? m.user.email}</p>
                      </div>
                      {m.status !== "active" ? <Badge variant="outline">Deactivated</Badge> : null}
                    </div>
                  </TableCell>
                  <TableCell>
                    <RoleBadge role={m.role} />
                  </TableCell>
                  <TableCell className="text-muted-foreground">{m.departments?.map((d) => d.name).join(", ") || "—"}</TableCell>
                  <TableCell className="whitespace-nowrap text-muted-foreground">{m.joined_at ? formatInstantDate(m.joined_at, org.timezone) : "—"}</TableCell>
                  <TableCell>
                    <div className="flex justify-end gap-1">
                      {m.user.id !== me.id && m.status === "active" ? (
                        <Button variant="ghost" size="icon-sm" onClick={() => message(m.user.id)} aria-label={`Message ${m.user.name}`}>
                          <MessageSquare />
                        </Button>
                      ) : null}
                      {canManage(m) ? (
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon-sm" aria-label={`Manage ${m.user.name}`}>
                              <MoreHorizontal />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="w-52">
                            <DropdownMenuLabel>Role</DropdownMenuLabel>
                            <DropdownMenuRadioGroup value={m.role} onValueChange={(v) => act(m, "", "PATCH", { role: v }, `${m.user.name} is now ${t(`role.${v as Role}`)}.`)}>
                              {org.permissions.assignable_roles.map((r) => (
                                <DropdownMenuRadioItem key={r} value={r}>
                                  {t(`role.${r}`)}
                                </DropdownMenuRadioItem>
                              ))}
                            </DropdownMenuRadioGroup>
                            <DropdownMenuSeparator />
                            {m.status === "active" ? (
                              <DropdownMenuItem onSelect={() => act(m, "/deactivate", "POST", undefined, `${m.user.name} was deactivated.`)}>
                                <UserX /> Deactivate
                              </DropdownMenuItem>
                            ) : (
                              <DropdownMenuItem onSelect={() => act(m, "/reactivate", "POST", undefined, `${m.user.name} was reactivated.`)}>
                                <UserCheck /> Reactivate
                              </DropdownMenuItem>
                            )}
                            <DropdownMenuItem variant="destructive" onSelect={() => setRemoving(m)}>
                              <UserMinus /> Remove from workspace
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      ) : null}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ) : (
        <EmptyState icon={Users} title="No members match these filters" />
      )}
      {members.data && members.data.meta.last_page > 1 ? (
        <nav className="flex items-center justify-center gap-2" aria-label="Pagination">
          <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
            Previous
          </Button>
          <span className="text-sm text-muted-foreground">
            Page {page} of {members.data.meta.last_page}
          </span>
          <Button variant="outline" size="sm" disabled={page >= members.data.meta.last_page} onClick={() => setPage((p) => p + 1)}>
            Next
          </Button>
        </nav>
      ) : null}
      <ConfirmAction
        open={!!removing}
        onOpenChange={(o) => !o && setRemoving(null)}
        title={`Remove ${removing?.user.name}?`}
        description="They lose access to this workspace immediately, including channels, projects and files. Their messages and task history are kept. Memberships in other workspaces are not affected."
        confirmLabel="Remove"
        onConfirm={() => (removing ? act(removing, "", "DELETE", undefined, `${removing.user.name} was removed.`) : undefined)}
      />
    </div>
  )
}

function Invitations() {
  const { slug, org } = useWorkspace()
  const qc = useQueryClient()
  const invitations = useQuery({
    queryKey: ["invitations", slug],
    queryFn: () => api<Paginated<Invitation>>(orgPath(slug, "/invitations")),
  })

  async function act(inv: Invitation, path: string, method: "POST" | "DELETE", success: string) {
    try {
      await api(orgPath(slug, `/invitations/${inv.id}${path}`), { method })
      toast.success(success)
    } catch (e) {
      toast.error(errorMessage(e))
    } finally {
      qc.invalidateQueries({ queryKey: ["invitations", slug] })
    }
  }

  if (invitations.isLoading) return <LoadingRows rows={3} />
  if (invitations.error) return <ErrorState error={invitations.error} onRetry={() => invitations.refetch()} />
  if (!invitations.data?.data.length) return <EmptyState icon={MailPlus} title="No pending invitations" description="Invite teammates with the button above." />

  return (
    <div className="overflow-x-auto rounded-xl border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Email</TableHead>
            <TableHead>Role</TableHead>
            <TableHead>Invited by</TableHead>
            <TableHead>Expires</TableHead>
            <TableHead>Last sent</TableHead>
            <TableHead>
              <span className="sr-only">Actions</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {invitations.data.data.map((inv) => (
            <TableRow key={inv.id}>
              <TableCell className="font-medium">{inv.email}</TableCell>
              <TableCell>
                <RoleBadge role={inv.role} />
              </TableCell>
              <TableCell>{inv.invited_by?.name ?? "—"}</TableCell>
              <TableCell className="whitespace-nowrap">{formatInstantDate(inv.expires_at, org.timezone)}</TableCell>
              <TableCell className="whitespace-nowrap text-muted-foreground">{inv.last_sent_at ? timeAgo(inv.last_sent_at) : <span className="text-destructive">Not delivered</span>}</TableCell>
              <TableCell>
                <div className="flex justify-end gap-1">
                  <Button variant="ghost" size="sm" onClick={() => act(inv, "/resend", "POST", "Invitation resent with a new link.")}>
                    <Send /> Resend
                  </Button>
                  <ConfirmAction
                    trigger={
                      <Button variant="ghost" size="sm">
                        <RotateCcw /> Revoke
                      </Button>
                    }
                    title="Revoke invitation?"
                    description={`The link sent to ${inv.email} will stop working.`}
                    confirmLabel="Revoke"
                    onConfirm={() => act(inv, "", "DELETE", "Invitation revoked.")}
                  />
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}

function Departments() {
  const { slug, org } = useWorkspace()
  const departments = useDepartments(slug)
  const [editing, setEditing] = useState<Department | null>(null)
  const [creating, setCreating] = useState(false)
  const [managing, setManaging] = useState<Department | null>(null)
  const qc = useQueryClient()
  const admin = org.permissions.manage_departments

  async function remove(d: Department) {
    try {
      await api(orgPath(slug, `/departments/${d.id}`), { method: "DELETE" })
      toast.success("Department deleted.")
      qc.invalidateQueries({ queryKey: keys.departments(slug) })
    } catch (e) {
      toast.error(errorMessage(e))
    }
  }

  return (
    <div className="space-y-4">
      {admin ? (
        <Button variant="outline" onClick={() => setCreating(true)}>
          <Plus /> New department
        </Button>
      ) : null}
      {departments.isLoading ? (
        <LoadingRows rows={3} />
      ) : departments.data?.length ? (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {departments.data.map((d) => (
            <li key={d.id}>
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Building className="size-4 text-muted-foreground" aria-hidden /> {d.name}
                  </CardTitle>
                  <CardDescription>{d.description ?? `${d.members_count ?? 0} members`}</CardDescription>
                </CardHeader>
                <CardContent className="flex flex-wrap items-center gap-2">
                  <Badge variant="secondary">{d.members_count ?? 0} members</Badge>
                  {admin ? (
                    <>
                      <Button size="sm" variant="ghost" onClick={() => setManaging(d)}>
                        <Users /> Members
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setEditing(d)} aria-label={`Edit ${d.name}`}>
                        <Pencil />
                      </Button>
                      <ConfirmAction
                        trigger={
                          <Button size="sm" variant="ghost" aria-label={`Delete ${d.name}`}>
                            <Trash2 />
                          </Button>
                        }
                        title={`Delete ${d.name}?`}
                        description="Members stay in the workspace; only the department grouping is removed."
                        onConfirm={() => remove(d)}
                      />
                    </>
                  ) : null}
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState icon={Building} title="No departments yet" description={admin ? "Group people into departments to target announcements." : undefined} />
      )}
      <DepartmentDialog key={editing?.id ?? "new"} open={creating || !!editing} department={editing} onOpenChange={(o) => !o && (setCreating(false), setEditing(null))} />
      {managing ? <DepartmentMembersDialog department={managing} onClose={() => setManaging(null)} /> : null}
    </div>
  )
}

function DepartmentDialog({ open, onOpenChange, department }: { open: boolean; onOpenChange: (o: boolean) => void; department: Department | null }) {
  const { slug } = useWorkspace()
  const qc = useQueryClient()
  const { errors, formError, capture, reset } = useFormErrors()
  const [pending, setPending] = useState(false)
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    reset()
    setPending(true)
    const form = new FormData(e.currentTarget)
    try {
      await api(orgPath(slug, department ? `/departments/${department.id}` : "/departments"), {
        method: department ? "PUT" : "POST",
        body: { name: form.get("name"), description: form.get("description") || null },
      })
      qc.invalidateQueries({ queryKey: keys.departments(slug) })
      toast.success(department ? "Department updated." : "Department created.")
      onOpenChange(false)
    } catch (error) {
      capture(error)
    } finally {
      setPending(false)
    }
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{department ? "Edit department" : "New department"}</DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} noValidate>
          <FieldGroup>
            <FormAlert message={formError} />
            <TextField id="name" label="Name" required defaultValue={department?.name} error={errors.name} />
            <TextField id="description" label="Description" defaultValue={department?.description ?? ""} error={errors.description} />
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={pending}>
                {pending ? <Spinner /> : null}
                Save
              </Button>
            </DialogFooter>
          </FieldGroup>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function DepartmentMembersDialog({ department, onClose }: { department: Department; onClose: () => void }) {
  const { slug } = useWorkspace()
  const qc = useQueryClient()
  const members = useMemberOptions(slug)
  const detail = useQuery({
    queryKey: ["department", slug, department.id],
    queryFn: async () => (await api<{ data: Department }>(orgPath(slug, `/departments/${department.id}`))).data,
  })
  const [ids, setIds] = useState<number[] | null>(null)
  const value = ids ?? detail.data?.members?.map((m) => m.id) ?? []
  const [pending, setPending] = useState(false)

  async function save() {
    setPending(true)
    try {
      await api(orgPath(slug, `/departments/${department.id}/members`), { method: "PUT", body: { user_ids: value } })
      toast.success("Department members updated.")
      qc.invalidateQueries({ queryKey: keys.departments(slug) })
      qc.invalidateQueries({ queryKey: ["members", slug] })
      onClose()
    } catch (e) {
      toast.error(errorMessage(e))
    } finally {
      setPending(false)
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{department.name} members</DialogTitle>
          <DialogDescription>Department-targeted announcements go to these people.</DialogDescription>
        </DialogHeader>
        {detail.isLoading ? <LoadingRows rows={2} /> : <PeoplePicker people={(members.data ?? []).map((m) => m.user)} value={value} onChange={setIds} />}
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={save} disabled={pending || detail.isLoading}>
            {pending ? <Spinner /> : null}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
