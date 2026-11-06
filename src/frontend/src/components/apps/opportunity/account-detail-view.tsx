"use client"

import { useQueryClient } from "@tanstack/react-query"
import { Globe, MapPin, Pencil, Phone, Plus, Trash2 } from "lucide-react"
import Link from "next/link"
import { useParams, useRouter } from "next/navigation"
import { useState } from "react"
import { toast } from "sonner"
import { LoadingRows } from "@/components/common"
import { ConfirmAction } from "@/components/confirm"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { orgPath, useWorkspace } from "@/components/workspace/workspace-context"
import { api, errorMessage } from "@/lib/api"
import { formatDateKey } from "@/lib/datetime"
import type { CrmContact } from "@/lib/types"
import { LoadError, ModuleHeader } from "../shared"
import { AccountDialog, ActivityFeed, ContactDialog, OpportunityDialog } from "./crm-forms"
import { crmKeys, formatMoney, useAccount, useCrmSummary } from "./use-crm"

export function AccountDetailView() {
  const { accountId } = useParams<{ accountId: string }>()
  const id = Number(accountId)
  const { slug, href } = useWorkspace()
  const router = useRouter()
  const qc = useQueryClient()
  const account = useAccount(slug, id)
  const summary = useCrmSummary(slug)
  const [editing, setEditing] = useState(false)
  const [contact, setContact] = useState<CrmContact | "new" | null>(null)
  const [newDeal, setNewDeal] = useState(false)

  if (account.isPending || summary.isPending) {
    return (
      <div className="mx-auto max-w-6xl p-4 md:p-8">
        <LoadingRows rows={6} />
      </div>
    )
  }
  if (account.error || summary.error) {
    return (
      <div className="mx-auto max-w-6xl p-4 md:p-8">
        <LoadError error={account.error ?? summary.error} onRetry={() => (account.refetch(), summary.refetch())} what="Account" />
      </div>
    )
  }

  const a = account.data
  const s = summary.data
  const stageName = (id: number) => s.stages.find((x) => x.id === id)?.name ?? ""

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-4 md:p-8">
      <ModuleHeader
        app="opportunity"
        title={a.name}
        back={{ href: href("/apps/opportunity?tab=accounts"), label: "Accounts" }}
        description={[a.industry, a.owner ? `Owner: ${a.owner.name}` : null].filter(Boolean).join(" · ") || undefined}
        actions={
          <>
            {a.permissions.edit ? (
              <Button variant="outline" onClick={() => setEditing(true)}>
                <Pencil aria-hidden /> Edit
              </Button>
            ) : null}
            {a.permissions.delete ? (
              <ConfirmAction
                trigger={
                  <Button variant="outline" className="text-destructive">
                    <Trash2 aria-hidden /> Delete
                  </Button>
                }
                title={`Delete ${a.name}?`}
                description="Its notes are deleted. Its contacts and opportunities are kept without an account."
                onConfirm={async () => {
                  try {
                    await api(orgPath(slug, `/crm/accounts/${a.id}`), { method: "DELETE" })
                    qc.invalidateQueries({ queryKey: crmKeys.all(slug) })
                    router.push(href("/apps/opportunity?tab=accounts"))
                  } catch (e) {
                    toast.error(errorMessage(e))
                  }
                }}
              />
            ) : null}
          </>
        }
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="min-w-0 space-y-6">
          <section aria-labelledby="deals-heading" className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 id="deals-heading" className="text-lg font-semibold">
                Opportunities
              </h2>
              {s.can_create ? (
                <Button size="sm" variant="outline" onClick={() => setNewDeal(true)}>
                  <Plus aria-hidden /> New opportunity
                </Button>
              ) : null}
            </div>
            {a.opportunities.length ? (
              <ul className="divide-y rounded-xl border">
                {a.opportunities.map((o) => (
                  <li key={o.id}>
                    <Link href={href(`/apps/opportunity/deals/${o.id}`)} className="flex flex-wrap items-center gap-3 p-3 text-sm hover:bg-muted/40">
                      <span className="flex-1 font-medium">{o.name}</span>
                      <span className="text-muted-foreground">{stageName(o.stage_id)}</span>
                      {o.expected_close_date ? <span className="text-muted-foreground">{formatDateKey(o.expected_close_date, { year: undefined })}</span> : null}
                      <span className="w-28 text-right font-medium tabular-nums">{formatMoney(o.amount)}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">No opportunities you can see for this account.</p>
            )}
          </section>
          <section aria-labelledby="acct-activity" className="space-y-3">
            <h2 id="acct-activity" className="text-lg font-semibold">
              Activity
            </h2>
            <ActivityFeed activities={a.activities} accountId={a.id} canAdd={s.can_create} showParent />
          </section>
        </div>

        <aside className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Company</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              {a.website ? (
                <p className="flex items-center gap-2">
                  <Globe className="size-4 text-muted-foreground" aria-hidden />
                  <a href={a.website} target="_blank" rel="noopener noreferrer" className="truncate hover:underline">
                    {a.website.replace(/^https?:\/\//, "")}
                  </a>
                </p>
              ) : null}
              {a.phone ? (
                <p className="flex items-center gap-2">
                  <Phone className="size-4 text-muted-foreground" aria-hidden /> {a.phone}
                </p>
              ) : null}
              {a.address ? (
                <p className="flex items-start gap-2">
                  <MapPin className="mt-0.5 size-4 text-muted-foreground" aria-hidden /> {a.address}
                </p>
              ) : null}
              {a.notes ? <p className="border-t pt-2 whitespace-pre-line">{a.notes}</p> : null}
              {!a.website && !a.phone && !a.address && !a.notes ? <p className="text-muted-foreground">No details yet.</p> : null}
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle>Contacts</CardTitle>
              {s.can_create ? (
                <Button size="sm" variant="ghost" onClick={() => setContact("new")}>
                  <Plus aria-hidden /> Add
                </Button>
              ) : null}
            </CardHeader>
            <CardContent>
              {a.contacts.length ? (
                <ul className="space-y-3 text-sm">
                  {a.contacts.map((c) => (
                    <li key={c.id} className="flex items-start gap-2">
                      <div className="min-w-0 flex-1">
                        <p className="font-medium">{c.name}</p>
                        {c.job_title ? <p className="text-xs text-muted-foreground">{c.job_title}</p> : null}
                        {c.email ? (
                          <a href={`mailto:${c.email}`} className="block truncate text-xs hover:underline">
                            {c.email}
                          </a>
                        ) : null}
                        {c.phone ? <p className="text-xs">{c.phone}</p> : null}
                      </div>
                      {c.permissions.edit ? (
                        <Button variant="ghost" size="icon" className="size-7" aria-label={`Edit ${c.name}`} onClick={() => setContact(c)}>
                          <Pencil aria-hidden />
                        </Button>
                      ) : null}
                      {c.permissions.delete ? (
                        <ConfirmAction
                          trigger={
                            <Button variant="ghost" size="icon" className="size-7" aria-label={`Delete ${c.name}`}>
                              <Trash2 aria-hidden />
                            </Button>
                          }
                          title={`Delete ${c.name}?`}
                          description="Opportunities that name this contact keep their history."
                          onConfirm={async () => {
                            try {
                              await api(orgPath(slug, `/crm/contacts/${c.id}`), { method: "DELETE" })
                              qc.invalidateQueries({ queryKey: crmKeys.all(slug) })
                            } catch (e) {
                              toast.error(errorMessage(e))
                            }
                          }}
                        />
                      ) : null}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted-foreground">No contacts yet.</p>
              )}
            </CardContent>
          </Card>
        </aside>
      </div>

      {editing ? <AccountDialog open={editing} onOpenChange={setEditing} initial={a} /> : null}
      {contact ? (
        <ContactDialog
          open
          onOpenChange={(o) => !o && setContact(null)}
          initial={contact === "new" ? undefined : contact}
          accountId={a.id}
        />
      ) : null}
      {newDeal ? <OpportunityDialog open={newDeal} onOpenChange={setNewDeal} summary={s} defaultAccountId={a.id} /> : null}
    </div>
  )
}
