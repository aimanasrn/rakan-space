"use client"

import { useQueryClient } from "@tanstack/react-query"
import { ExternalLink, Pencil } from "lucide-react"
import Link from "next/link"
import { useParams } from "next/navigation"
import { useState } from "react"
import { toast } from "sonner"
import { LoadingRows, UserAvatar } from "@/components/common"
import { ConfirmAction } from "@/components/confirm"
import { FormAlert, useFormErrors } from "@/components/form"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Spinner } from "@/components/ui/spinner"
import { orgPath, useWorkspace } from "@/components/workspace/workspace-context"
import { api, errorMessage } from "@/lib/api"
import { formatDateTime } from "@/lib/datetime"
import type { FormSubmissionDetail } from "@/lib/types"
import { LoadError, ModuleHeader, StatusBadge } from "../shared"
import { type AttachmentMap, FormRenderer, type FormValues, validateValues, visibleValues } from "./form-renderer"
import { SubmissionValues } from "./submission-values"
import { formKeys, useSubmission } from "./use-forms"

export function SubmissionDetailView() {
  const { submissionId } = useParams<{ submissionId: string }>()
  const id = Number(submissionId)
  const { slug, href, org } = useWorkspace()
  const submission = useSubmission(slug, id)
  const [editing, setEditing] = useState(false)

  if (submission.isPending) {
    return (
      <div className="mx-auto max-w-4xl p-4 md:p-8">
        <LoadingRows rows={6} />
      </div>
    )
  }
  if (submission.error) {
    return (
      <div className="mx-auto max-w-4xl p-4 md:p-8">
        <LoadError error={submission.error} onRetry={() => submission.refetch()} what="Response" />
      </div>
    )
  }

  const s = submission.data
  return (
    <div className="mx-auto max-w-4xl space-y-6 p-4 md:p-8">
      <ModuleHeader
        app="form"
        title={s.form.name}
        back={{ href: href("/apps/form?tab=mine"), label: "Forms" }}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <StatusBadge status={s.status} />
            <span>
              {s.reference} · version {s.version}
            </span>
          </span>
        }
      />

      <div className="grid gap-6 lg:grid-cols-[1fr_18rem]">
        <Card className="min-w-0">
          <CardHeader>
            <CardTitle>{editing ? "Edit your answers" : "Answers"}</CardTitle>
            <CardDescription className="flex items-center gap-2">
              <UserAvatar user={s.submitter} className="size-5" /> {s.submitter.name} · {formatDateTime(s.submitted_at, org.timezone)}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {editing ? <ResubmitForm submission={s} onDone={() => setEditing(false)} /> : <SubmissionValues fields={s.fields} values={s.values} attachments={s.attachments} />}
          </CardContent>
        </Card>

        <div className="space-y-4">
          {s.approval ? (
            <Card>
              <CardHeader>
                <CardTitle>Approval</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <StatusBadge status={s.approval.status} />
                {s.approval.current_step ? <p>Waiting at: {s.approval.current_step}</p> : null}
                {s.approval.can_view ? (
                  <Button asChild variant="outline" className="w-full">
                    <Link href={href(`/apps/approval/requests/${s.approval.id}`)}>
                      <ExternalLink aria-hidden /> View approval
                    </Link>
                  </Button>
                ) : null}
              </CardContent>
            </Card>
          ) : null}
          {s.permissions.resubmit && !editing ? (
            <Card className="border-violet-500/40">
              <CardHeader>
                <CardTitle>Changes requested</CardTitle>
                <CardDescription>See the approver&apos;s comment, update your answers and resubmit.</CardDescription>
              </CardHeader>
              <CardContent>
                <Button className="w-full" onClick={() => setEditing(true)}>
                  <Pencil aria-hidden /> Edit and resubmit
                </Button>
              </CardContent>
            </Card>
          ) : null}
          {s.permissions.withdraw ? <Withdraw submission={s} /> : null}
        </div>
      </div>
    </div>
  )
}

function ResubmitForm({ submission: s, onDone }: { submission: FormSubmissionDetail; onDone: () => void }) {
  const { slug } = useWorkspace()
  const qc = useQueryClient()
  const [values, setValues] = useState<FormValues>(s.values)
  const [attachments, setAttachments] = useState<AttachmentMap>(Object.fromEntries(s.attachments.map((a) => [a.id, a])))
  const { errors, formError, capture, reset, setErrors } = useFormErrors()
  const [pending, setPending] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    reset()
    const clientErrors = validateValues(s.fields, values)
    if (Object.keys(clientErrors).length) return setErrors(clientErrors)
    setPending(true)
    try {
      const { data } = await api<{ data: FormSubmissionDetail }>(orgPath(slug, `/form-submissions/${s.id}`), { method: "PUT", body: { values: visibleValues(s.fields, values) } })
      qc.setQueryData(formKeys.submission(slug, s.id), data)
      qc.invalidateQueries({ queryKey: formKeys.all(slug) })
      qc.invalidateQueries({ queryKey: ["approval", slug] })
      toast.success("Resubmitted for approval.")
      onDone()
    } catch (error) {
      capture(error)
    } finally {
      setPending(false)
    }
  }

  return (
    <form onSubmit={submit} noValidate className="space-y-6">
      <FormAlert message={formError} />
      <FormRenderer
        fields={s.fields}
        values={values}
        onChange={(key, value) => setValues((v) => ({ ...v, [key]: value }))}
        errors={errors}
        attachments={attachments}
        onAttachment={(a) => setAttachments((m) => ({ ...m, [a.id]: a }))}
      />
      <div className="flex justify-end gap-2 border-t pt-4">
        <Button type="button" variant="outline" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" disabled={pending}>
          {pending ? <Spinner /> : null} Resubmit
        </Button>
      </div>
    </form>
  )
}

function Withdraw({ submission: s }: { submission: FormSubmissionDetail }) {
  const { slug } = useWorkspace()
  const qc = useQueryClient()
  return (
    <ConfirmAction
      trigger={
        <Button variant="outline" className="w-full">
          Withdraw response
        </Button>
      }
      title="Withdraw this response?"
      description={s.approval ? "Its approval request is cancelled too. This cannot be undone." : "This cannot be undone."}
      confirmLabel="Withdraw"
      onConfirm={async () => {
        try {
          const { data } = await api<{ data: FormSubmissionDetail }>(orgPath(slug, `/form-submissions/${s.id}/withdraw`), { method: "POST" })
          qc.setQueryData(formKeys.submission(slug, s.id), data)
          qc.invalidateQueries({ queryKey: formKeys.all(slug) })
          qc.invalidateQueries({ queryKey: ["approval", slug] })
          toast.success("Response withdrawn.")
        } catch (e) {
          toast.error(errorMessage(e))
        }
      }}
    />
  )
}
