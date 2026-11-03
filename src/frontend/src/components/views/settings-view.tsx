"use client"

import { useQuery, useQueryClient } from "@tanstack/react-query"
import { Crown, LogOut, ShieldCheck } from "lucide-react"
import { useRouter } from "next/navigation"
import { useState } from "react"
import { toast } from "sonner"
import { LoadingRows, PageHeader, UserAvatar } from "@/components/common"
import { ConfirmAction } from "@/components/confirm"
import { FormAlert, TextField, useFormErrors } from "@/components/form"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { FieldGroup } from "@/components/ui/field"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Spinner } from "@/components/ui/spinner"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { orgPath, useWorkspace } from "@/components/workspace/workspace-context"
import { meKey } from "@/hooks/use-auth"
import { keys, useMemberOptions } from "@/hooks/use-workspace-data"
import { api, errorMessage } from "@/lib/api"
import { formatDateTime, TIMEZONES } from "@/lib/datetime"
import type { Activity, Paginated } from "@/lib/types"

export function SettingsView() {
  const { org } = useWorkspace()
  return (
    <div className="mx-auto max-w-3xl space-y-6 p-4 md:p-8">
      <PageHeader title="Settings" description={`Workspace settings for ${org.name}.`} />
      {org.permissions.manage_settings ? <OrganizationProfile /> : <ReadOnlyProfile />}
      {org.permissions.transfer_ownership ? <TransferOwnership /> : null}
      {org.permissions.view_audit_log ? <AuditLog /> : null}
      <LeaveWorkspace />
    </div>
  )
}

function ReadOnlyProfile() {
  const { org } = useWorkspace()
  return (
    <Card>
      <CardHeader>
        <CardTitle>Organisation</CardTitle>
        <CardDescription>Only owners and admins can change these settings.</CardDescription>
      </CardHeader>
      <CardContent>
        <dl className="grid grid-cols-[8rem_1fr] gap-y-2 text-sm">
          <dt className="text-muted-foreground">Name</dt>
          <dd>{org.name}</dd>
          <dt className="text-muted-foreground">Time zone</dt>
          <dd>{org.timezone}</dd>
          <dt className="text-muted-foreground">Your role</dt>
          <dd className="capitalize">{org.membership.role}</dd>
        </dl>
      </CardContent>
    </Card>
  )
}

function OrganizationProfile() {
  const { slug, org } = useWorkspace()
  const qc = useQueryClient()
  const { errors, formError, capture, reset } = useFormErrors()
  const [pending, setPending] = useState(false)
  const [timezone, setTimezone] = useState(org.timezone)
  const zones = TIMEZONES.includes(org.timezone) ? TIMEZONES : [org.timezone, ...TIMEZONES]

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    reset()
    setPending(true)
    const form = new FormData(e.currentTarget)
    try {
      await api(orgPath(slug), {
        method: "PATCH",
        body: { name: form.get("name"), description: form.get("description") || null, industry: form.get("industry") || null, website: form.get("website") || null, timezone },
      })
      const logo = form.get("logo") as File | null
      if (logo && logo.size) {
        const body = new FormData()
        body.append("logo", logo)
        await api(orgPath(slug, "/logo"), { method: "POST", body })
      }
      toast.success("Settings saved.")
      qc.invalidateQueries({ queryKey: keys.org(slug) })
      qc.invalidateQueries({ queryKey: meKey })
    } catch (error) {
      capture(error)
    } finally {
      setPending(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Organisation profile</CardTitle>
        <CardDescription>The time zone controls how dates, deadlines and event times are shown to everyone.</CardDescription>
      </CardHeader>
      <form onSubmit={submit} noValidate>
        <CardContent>
          <FieldGroup>
            <FormAlert message={formError} />
            <TextField id="name" label="Name" required defaultValue={org.name} error={errors.name} />
            <TextField id="description" label="Description" textarea rows={3} defaultValue={org.description ?? ""} error={errors.description} />
            <div className="grid gap-4 sm:grid-cols-2">
              <TextField id="industry" label="Industry" defaultValue={org.industry ?? ""} error={errors.industry} />
              <TextField id="website" label="Website" type="url" defaultValue={org.website ?? ""} error={errors.website} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="org-tz">Time zone</Label>
              <Select value={timezone} onValueChange={setTimezone}>
                <SelectTrigger id="org-tz" className="w-full sm:w-72">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {zones.map((tz) => (
                    <SelectItem key={tz} value={tz}>
                      {tz.replace("_", " ")}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {errors.timezone ? <p className="text-sm text-destructive">{errors.timezone}</p> : null}
            </div>
            <div className="flex items-center gap-4">
              {org.logo_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={org.logo_url} alt={`${org.name} logo`} className="size-14 rounded-lg border object-cover" />
              ) : null}
              <div className="flex-1">
                <TextField id="logo" label="Logo" type="file" accept="image/png,image/jpeg,image/webp" error={errors.logo} description="PNG, JPG or WebP up to 2 MB." />
              </div>
            </div>
          </FieldGroup>
        </CardContent>
        <CardFooter className="mt-6 justify-end border-t">
          <Button type="submit" disabled={pending}>
            {pending ? <Spinner /> : null}
            Save changes
          </Button>
        </CardFooter>
      </form>
    </Card>
  )
}

function TransferOwnership() {
  const { slug, me } = useWorkspace()
  const qc = useQueryClient()
  const members = useMemberOptions(slug)
  const [target, setTarget] = useState("")
  const [password, setPassword] = useState("")
  const [error, setError] = useState<string | null>(null)
  const candidates = (members.data ?? []).filter((m) => m.user.id !== me.id)

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Crown className="size-4" aria-hidden /> Transfer ownership
        </CardTitle>
        <CardDescription>The selected member becomes an Owner and you become an Admin. A workspace always keeps at least one owner.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <FormAlert message={error} />
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="transfer-to">New owner</Label>
            <Select value={target} onValueChange={setTarget}>
              <SelectTrigger id="transfer-to" className="w-full">
                <SelectValue placeholder="Choose a member" />
              </SelectTrigger>
              <SelectContent>
                {candidates.map((m) => (
                  <SelectItem key={m.id} value={String(m.id)}>
                    {m.user.name} ({m.role})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <TextField id="transfer-password" label="Confirm your password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </div>
      </CardContent>
      <CardFooter className="justify-end border-t">
        <ConfirmAction
          trigger={
            <Button variant="outline" disabled={!target || !password}>
              Transfer ownership
            </Button>
          }
          title="Transfer ownership?"
          description="You will become an Admin. Only an owner can undo this."
          confirmLabel="Transfer"
          onConfirm={async () => {
            setError(null)
            try {
              await api(orgPath(slug, "/transfer-ownership"), { method: "POST", body: { membership_id: Number(target), password } })
              toast.success("Ownership transferred.")
              setPassword("")
              qc.invalidateQueries({ queryKey: keys.org(slug) })
              qc.invalidateQueries({ queryKey: meKey })
              qc.invalidateQueries({ queryKey: ["members", slug] })
            } catch (e) {
              setError(errorMessage(e))
            }
          }}
        />
      </CardFooter>
    </Card>
  )
}

function AuditLog() {
  const { slug, org } = useWorkspace()
  const log = useQuery({
    queryKey: ["audit", slug],
    queryFn: () => api<Paginated<Activity>>(orgPath(slug, "/audit-log")),
  })
  const describe = (a: Activity) => {
    const p = a.properties as Record<string, string>
    switch (a.event) {
      case "member.role_changed":
        return `Changed a member's role from ${p.from} to ${p.to}`
      case "member.removed":
        return "Removed a member"
      case "member.left":
        return "Left the workspace"
      case "member.deactivated":
        return "Deactivated a member"
      case "member.reactivated":
        return "Reactivated a member"
      case "invitation.created":
        return `Invited ${p.email} as ${p.role}`
      case "invitation.revoked":
        return `Revoked the invitation for ${p.email}`
      case "invitation.accepted":
        return `Joined as ${p.role}`
      case "organization.ownership_transferred":
        return "Transferred ownership"
      case "organization.updated":
        return "Updated organisation settings"
      default:
        return a.event.replaceAll(".", " ").replaceAll("_", " ")
    }
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ShieldCheck className="size-4" aria-hidden /> Audit log
        </CardTitle>
        <CardDescription>Role changes, membership changes and other administrative actions.</CardDescription>
      </CardHeader>
      <CardContent>
        {log.isLoading ? (
          <LoadingRows rows={3} />
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>When</TableHead>
                  <TableHead>Who</TableHead>
                  <TableHead>What</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {log.data?.data.map((a) => (
                  <TableRow key={a.id}>
                    <TableCell className="whitespace-nowrap text-muted-foreground">{formatDateTime(a.created_at, org.timezone)}</TableCell>
                    <TableCell>
                      <span className="flex items-center gap-2 whitespace-nowrap">
                        <UserAvatar user={a.actor} className="size-6" /> {a.actor?.name ?? "System"}
                      </span>
                    </TableCell>
                    <TableCell>{describe(a)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function LeaveWorkspace() {
  const { slug, org } = useWorkspace()
  const qc = useQueryClient()
  const router = useRouter()
  return (
    <Card className="border-destructive/30">
      <CardHeader>
        <CardTitle>Leave workspace</CardTitle>
        <CardDescription>You will lose access to {org.name}. Your messages and task history remain. The last owner must transfer ownership first.</CardDescription>
      </CardHeader>
      <CardFooter className="justify-end border-t">
        <ConfirmAction
          trigger={
            <Button variant="destructive">
              <LogOut /> Leave {org.name}
            </Button>
          }
          title={`Leave ${org.name}?`}
          description="You will need a new invitation to rejoin."
          confirmLabel="Leave workspace"
          onConfirm={async () => {
            try {
              await api(orgPath(slug, `/members/${org.membership.id}`), { method: "DELETE" })
              toast.success(`You left ${org.name}.`)
              await qc.invalidateQueries({ queryKey: meKey })
              router.replace("/")
            } catch (e) {
              toast.error(errorMessage(e))
            }
          }}
        />
      </CardFooter>
    </Card>
  )
}
