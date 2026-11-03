"use client"

import { useQueryClient } from "@tanstack/react-query"
import { BadgeCheck, ClipboardList, FileText, Inbox, Pencil, Plus } from "lucide-react"
import Link from "next/link"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { useState } from "react"
import { EmptyState, ErrorState, LoadingRows, UserAvatar } from "@/components/common"
import { FormAlert, TextField, useFormErrors } from "@/components/form"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { FieldGroup } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Spinner } from "@/components/ui/spinner"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { orgPath, useWorkspace } from "@/components/workspace/workspace-context"
import { api } from "@/lib/api"
import { formatDateTime, timeAgo } from "@/lib/datetime"
import type { FormDetail, FormSubmissionSummary } from "@/lib/types"
import { LoadError, ModuleHeader, Pager, StatusBadge } from "../shared"
import { formKeys, useAppAbilities, useForms, useSubmissions } from "./use-forms"

type Tab = "available" | "mine" | "manage" | "all"

export function FormHomeView() {
  const { slug } = useWorkspace()
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()
  const app = useAppAbilities(slug, "form")
  const { can } = app
  const canBuild = can("create") || can("edit")
  const [creating, setCreating] = useState(false)

  const tabs: { value: Tab; label: string; show: boolean }[] = [
    { value: "available", label: "Fill in a form", show: true },
    { value: "mine", label: "My submissions", show: true },
    { value: "manage", label: "Manage forms", show: canBuild },
    { value: "all", label: "All responses", show: can("admin") },
  ]
  const requested = params.get("tab") as Tab | null
  const tab: Tab = requested && tabs.some((t) => t.value === requested && t.show) ? requested : "available"

  if (app.error) {
    return (
      <div className="mx-auto max-w-5xl p-4 md:p-8">
        <LoadError error={app.error} onRetry={() => app.refetch()} what="Form app" />
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-4 md:p-8">
      <ModuleHeader
        app="form"
        title="Form"
        description="Fill in forms and track what you submitted."
        actions={
          canBuild ? (
            <Button onClick={() => setCreating(true)}>
              <Plus aria-hidden /> New form
            </Button>
          ) : null
        }
      />
      <Tabs value={tab} onValueChange={(v) => router.replace(`${pathname}?tab=${v}`, { scroll: false })}>
        <TabsList className="flex-wrap">
          {tabs
            .filter((t) => t.show)
            .map((t) => (
              <TabsTrigger key={t.value} value={t.value}>
                {t.label}
              </TabsTrigger>
            ))}
        </TabsList>
      </Tabs>
      {tab === "available" ? <AvailableForms /> : null}
      {tab === "mine" ? <SubmissionList scope="mine" /> : null}
      {tab === "manage" ? <ManageForms onCreate={() => setCreating(true)} /> : null}
      {tab === "all" ? <SubmissionList scope="all" /> : null}
      <NewFormDialog open={creating} onOpenChange={setCreating} />
    </div>
  )
}

function SearchBox({ id, value, onChange, placeholder }: { id: string; value: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    <>
      <Label htmlFor={id} className="sr-only">
        {placeholder}
      </Label>
      <Input id={id} placeholder={placeholder} value={value} onChange={(e) => onChange(e.target.value)} className="max-w-xs" />
    </>
  )
}

function AvailableForms() {
  const { slug, href } = useWorkspace()
  const [q, setQ] = useState("")
  const [page, setPage] = useState(1)
  const forms = useForms(slug, { mode: "fill", q: q || undefined, page })

  return (
    <div className="space-y-4">
      <div role="search" aria-label="Search forms">
        <SearchBox id="form-search" value={q} onChange={(v) => (setQ(v), setPage(1))} placeholder="Search forms…" />
      </div>
      {forms.isPending ? (
        <LoadingRows rows={3} />
      ) : forms.error ? (
        <ErrorState error={forms.error} onRetry={() => forms.refetch()} />
      ) : forms.data.data.length ? (
        <>
          <ul className="grid gap-4 sm:grid-cols-2">
            {forms.data.data.map((f) => {
              const done = !f.allow_multiple && (f.my_submissions_count ?? 0) > 0
              return (
                <li key={f.id}>
                  <Card className="h-full">
                    <CardHeader>
                      <CardTitle className="flex items-start gap-2">
                        <FileText className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
                        {f.name}
                      </CardTitle>
                      {f.description ? <CardDescription className="line-clamp-3">{f.description}</CardDescription> : null}
                    </CardHeader>
                    <CardFooter className="mt-auto flex flex-wrap items-center justify-between gap-2">
                      <div className="flex flex-wrap gap-1.5 text-xs text-muted-foreground">
                        {f.workflow ? (
                          <Badge variant="secondary" className="gap-1">
                            <BadgeCheck className="size-3" aria-hidden /> Needs approval
                          </Badge>
                        ) : null}
                        {f.my_submissions_count ? <span>You responded {f.my_submissions_count}×</span> : null}
                      </div>
                      {done ? (
                        <Badge variant="outline">Already submitted</Badge>
                      ) : (
                        <Button asChild size="sm">
                          <Link href={href(`/apps/form/${f.id}`)} aria-label={`Fill in ${f.name}`}>
                            Fill in
                          </Link>
                        </Button>
                      )}
                    </CardFooter>
                  </Card>
                </li>
              )
            })}
          </ul>
          <Pager page={page} lastPage={forms.data.meta.last_page} onPage={setPage} />
        </>
      ) : (
        <EmptyState icon={ClipboardList} title={q ? "No forms match" : "No forms for you yet"} description="Published forms you can fill in appear here." />
      )}
    </div>
  )
}

function ManageForms({ onCreate }: { onCreate: () => void }) {
  const { slug, href, org } = useWorkspace()
  const [q, setQ] = useState("")
  const [status, setStatus] = useState("all")
  const [page, setPage] = useState(1)
  const forms = useForms(slug, { mode: "manage", q: q || undefined, status, page })

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3" role="search" aria-label="Filter forms">
        <SearchBox id="manage-search" value={q} onChange={(v) => (setQ(v), setPage(1))} placeholder="Search your forms…" />
        <Select value={status} onValueChange={(v) => (setStatus(v), setPage(1))}>
          <SelectTrigger className="w-36" aria-label="Status">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Any status</SelectItem>
            <SelectItem value="draft">Draft</SelectItem>
            <SelectItem value="published">Published</SelectItem>
            <SelectItem value="closed">Closed</SelectItem>
          </SelectContent>
        </Select>
      </div>
      {forms.isPending ? (
        <LoadingRows rows={3} />
      ) : forms.error ? (
        <ErrorState error={forms.error} onRetry={() => forms.refetch()} />
      ) : forms.data.data.length ? (
        <>
          <ul className="divide-y rounded-xl border">
            {forms.data.data.map((f) => (
              <li key={f.id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Link href={href(`/apps/form/${f.id}/edit`)} className="font-medium hover:underline">
                      {f.name}
                    </Link>
                    <Badge variant={f.status === "published" ? "default" : "outline"} className="capitalize">
                      {f.status}
                    </Badge>
                    {f.version ? <span className="text-xs text-muted-foreground">v{f.version}</span> : null}
                    {f.has_unpublished_changes && f.version ? <Badge variant="secondary">Unpublished changes</Badge> : null}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {f.workflow ? `Approval: ${f.workflow.name} · ` : ""}
                    {f.created_by ? `by ${f.created_by.name} · ` : ""}
                    <span title={formatDateTime(f.updated_at, org.timezone)}>updated {timeAgo(f.updated_at)}</span>
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Button asChild variant="outline" size="sm">
                    <Link href={href(`/apps/form/${f.id}/responses`)}>
                      <Inbox aria-hidden /> {f.submissions_count ?? 0} responses
                    </Link>
                  </Button>
                  <Button asChild size="sm">
                    <Link href={href(`/apps/form/${f.id}/edit`)}>
                      <Pencil aria-hidden /> Edit
                    </Link>
                  </Button>
                </div>
              </li>
            ))}
          </ul>
          <Pager page={page} lastPage={forms.data.meta.last_page} onPage={setPage} />
        </>
      ) : (
        <EmptyState
          icon={ClipboardList}
          title={q || status !== "all" ? "No forms match" : "You haven't built any forms yet"}
          action={!q && status === "all" ? <Button onClick={onCreate}>Create a form</Button> : undefined}
        />
      )}
    </div>
  )
}

/** "My submissions", "all responses" (Form admins) or one form's responses. */
export function SubmissionList({ scope, formId }: { scope?: "mine" | "all"; formId?: number }) {
  const { slug } = useWorkspace()
  const [q, setQ] = useState("")
  const [status, setStatus] = useState("all")
  const [page, setPage] = useState(1)
  const list = useSubmissions(slug, { formId, scope, status, q: q || undefined, page })
  const showSubmitter = scope !== "mine"

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3" role="search" aria-label="Filter responses">
        <SearchBox
          id={`submission-search-${scope ?? formId}`}
          value={q}
          onChange={(v) => (setQ(v), setPage(1))}
          placeholder={showSubmitter ? "Search by person, form or FRM-…" : "Search by form or FRM-…"}
        />
        <Select value={status} onValueChange={(v) => (setStatus(v), setPage(1))}>
          <SelectTrigger className="w-44" aria-label="Status">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Any status</SelectItem>
            <SelectItem value="submitted">Submitted</SelectItem>
            <SelectItem value="pending_approval">Pending approval</SelectItem>
            <SelectItem value="approved">Approved</SelectItem>
            <SelectItem value="rejected">Rejected</SelectItem>
            <SelectItem value="returned">Returned</SelectItem>
            <SelectItem value="withdrawn">Withdrawn</SelectItem>
          </SelectContent>
        </Select>
      </div>
      {list.isPending ? (
        <LoadingRows rows={4} />
      ) : list.error ? (
        <ErrorState error={list.error} onRetry={() => list.refetch()} />
      ) : list.data.data.length ? (
        <>
          <ul className="divide-y rounded-xl border">
            {list.data.data.map((s) => (
              <SubmissionRow key={s.id} submission={s} showSubmitter={showSubmitter} />
            ))}
          </ul>
          <Pager page={page} lastPage={list.data.meta.last_page} onPage={setPage} />
        </>
      ) : (
        <EmptyState icon={Inbox} title={q || status !== "all" ? "No responses match" : scope === "mine" ? "You haven't submitted anything yet" : "No responses yet"} />
      )}
    </div>
  )
}

function SubmissionRow({ submission: s, showSubmitter }: { submission: FormSubmissionSummary; showSubmitter: boolean }) {
  const { href, org } = useWorkspace()
  return (
    <li className="relative flex flex-col gap-2 p-4 hover:bg-muted/40 sm:flex-row sm:items-center">
      <div className="flex min-w-0 flex-1 items-center gap-3">
        {showSubmitter ? <UserAvatar user={s.submitter} /> : null}
        <div className="min-w-0">
          <Link href={href(`/apps/form/submissions/${s.id}`)} className="font-medium after:absolute after:inset-0 hover:underline">
            {s.form.name}
          </Link>
          <p className="text-xs text-muted-foreground">
            {s.reference}
            {showSubmitter ? ` · ${s.submitter.name}` : ""} · <span title={formatDateTime(s.submitted_at, org.timezone)}>{timeAgo(s.submitted_at)}</span>
          </p>
        </div>
      </div>
      <StatusBadge status={s.status} />
    </li>
  )
}

function NewFormDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { slug, href } = useWorkspace()
  const router = useRouter()
  const qc = useQueryClient()
  const { errors, formError, capture, reset, setErrors } = useFormErrors()
  const [pending, setPending] = useState(false)

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    reset()
    const form = new FormData(e.currentTarget)
    const name = String(form.get("name") ?? "").trim()
    if (name.length < 2) return setErrors({ name: "Give the form a name." })
    setPending(true)
    try {
      const { data } = await api<{ data: FormDetail }>(orgPath(slug, "/forms"), {
        method: "POST",
        body: { name, description: String(form.get("description") ?? "").trim() || null },
      })
      qc.invalidateQueries({ queryKey: formKeys.all(slug) })
      onOpenChange(false)
      router.push(href(`/apps/form/${data.id}/edit`))
    } catch (error) {
      capture(error)
    } finally {
      setPending(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New form</DialogTitle>
          <DialogDescription>You can add fields, an approval workflow and who can fill it in next.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} noValidate>
          <FieldGroup>
            <FormAlert message={formError} />
            <TextField id="name" label="Name" required maxLength={160} placeholder="e.g. Purchase Request" error={errors.name} />
            <TextField id="description" label="Description" textarea rows={3} maxLength={2000} error={errors.description} />
          </FieldGroup>
          <DialogFooter className="mt-6">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? <Spinner /> : null} Create and add fields
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
