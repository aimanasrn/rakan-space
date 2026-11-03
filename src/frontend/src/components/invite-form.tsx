"use client"

import { Plus, Trash2 } from "lucide-react"
import { useState } from "react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Spinner } from "@/components/ui/spinner"
import { api, errorMessage } from "@/lib/api"
import { t } from "@/lib/i18n"
import type { Department, Role } from "@/lib/types"

interface Row {
  email: string
  role: Role
  department_id: string
}

export interface InviteResult {
  email: string
  ok: boolean
  emailSent: boolean
  message: string
}

/** Invite one or more people. Reports per-address outcomes honestly. */
export function InviteForm({
  slug,
  roles,
  departments = [],
  onDone,
  submitLabel = "Send invitations",
}: {
  slug: string
  roles: Role[]
  departments?: Department[]
  onDone?: (results: InviteResult[]) => void
  submitLabel?: string
}) {
  const invitable = roles.filter((r) => r !== "owner")
  const defaultRole: Role = invitable.includes("staff") ? "staff" : (invitable[0] ?? "staff")
  const [rows, setRows] = useState<Row[]>([{ email: "", role: defaultRole, department_id: "" }])
  const [pending, setPending] = useState(false)
  const [results, setResults] = useState<InviteResult[]>([])

  const update = (i: number, patch: Partial<Row>) => setRows((r) => r.map((row, idx) => (idx === i ? { ...row, ...patch } : row)))

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    const filled = rows.filter((r) => r.email.trim())
    if (!filled.length) {
      toast.error("Enter at least one email address.")
      return
    }
    setPending(true)
    const out: InviteResult[] = []
    for (const row of filled) {
      try {
        const res = await api<{ email_sent: boolean; message: string }>(`/api/orgs/${slug}/invitations`, {
          method: "POST",
          body: { email: row.email.trim(), role: row.role, department_id: row.department_id ? Number(row.department_id) : null },
        })
        out.push({ email: row.email, ok: true, emailSent: res.email_sent, message: res.message })
      } catch (error) {
        out.push({ email: row.email, ok: false, emailSent: false, message: errorMessage(error) })
      }
    }
    setResults(out)
    setPending(false)
    const sent = out.filter((r) => r.ok && r.emailSent).length
    const created = out.filter((r) => r.ok).length
    if (sent) toast.success(`${sent} invitation${sent > 1 ? "s" : ""} sent.`)
    if (created > sent) toast.warning(`${created - sent} invitation(s) created but the email could not be sent. Resend from Members → Invitations.`)
    setRows((current) => {
      const failed = current.filter((r) => out.some((o) => o.email === r.email && !o.ok))
      return failed.length ? failed : [{ email: "", role: defaultRole, department_id: "" }]
    })
    onDone?.(out)
  }

  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      <div className="space-y-3">
        {rows.map((row, i) => (
          <div key={i} className="grid gap-2 sm:grid-cols-[1fr_8rem_auto] sm:items-end">
            <div className="space-y-1.5">
              <Label htmlFor={`invite-email-${i}`} className={i > 0 ? "sr-only sm:not-sr-only sm:invisible" : undefined}>
                Email address
              </Label>
              <Input
                id={`invite-email-${i}`}
                type="email"
                placeholder="name@company.com"
                value={row.email}
                onChange={(e) => update(i, { email: e.target.value })}
                autoComplete="off"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`invite-role-${i}`} className={i > 0 ? "sr-only sm:not-sr-only sm:invisible" : undefined}>
                Role
              </Label>
              <Select value={row.role} onValueChange={(v) => update(i, { role: v as Role })}>
                <SelectTrigger id={`invite-role-${i}`} className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {invitable.map((r) => (
                    <SelectItem key={r} value={r}>
                      {t(`role.${r}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={`Remove row ${i + 1}`}
              disabled={rows.length === 1}
              onClick={() => setRows((r) => r.filter((_, idx) => idx !== i))}
            >
              <Trash2 />
            </Button>
            {departments.length ? (
              <div className="sm:col-span-3">
                <Label htmlFor={`invite-dept-${i}`} className="sr-only">
                  Department
                </Label>
                <Select value={row.department_id || "none"} onValueChange={(v) => update(i, { department_id: v === "none" ? "" : v })}>
                  <SelectTrigger id={`invite-dept-${i}`} className="w-full" size="sm">
                    <SelectValue placeholder="Department (optional)" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">No department</SelectItem>
                    {departments.map((d) => (
                      <SelectItem key={d.id} value={String(d.id)}>
                        {d.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : null}
          </div>
        ))}
      </div>
      <Button type="button" variant="outline" size="sm" onClick={() => setRows((r) => [...r, { email: "", role: defaultRole, department_id: "" }])}>
        <Plus /> Add another
      </Button>
      {results.length ? (
        <ul className="space-y-1 text-sm" aria-live="polite">
          {results.map((r, i) => (
            <li key={i} className={r.ok && r.emailSent ? "text-success" : "text-destructive"}>
              {r.email}: {r.ok ? (r.emailSent ? "invitation sent" : "created, but the email could not be sent") : r.message}
            </li>
          ))}
        </ul>
      ) : null}
      <Button type="submit" disabled={pending}>
        {pending ? <Spinner /> : null}
        {submitLabel}
      </Button>
    </form>
  )
}
