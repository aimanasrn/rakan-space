"use client"

import { useQueryClient } from "@tanstack/react-query"
import { BadgeCheck, Pencil } from "lucide-react"
import Link from "next/link"
import { useParams, useRouter } from "next/navigation"
import { useState } from "react"
import { toast } from "sonner"
import { LoadingRows } from "@/components/common"
import { FormAlert, useFormErrors } from "@/components/form"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Spinner } from "@/components/ui/spinner"
import { orgPath, useWorkspace } from "@/components/workspace/workspace-context"
import { api } from "@/lib/api"
import type { FormSubmissionDetail } from "@/lib/types"
import { LoadError, ModuleHeader } from "../shared"
import { type AttachmentMap, FormRenderer, type FormValues, validateValues, visibleValues } from "./form-renderer"
import { formKeys, useForm } from "./use-forms"

export function FormFillView() {
  const { formId } = useParams<{ formId: string }>()
  const id = Number(formId)
  const { slug, href } = useWorkspace()
  const router = useRouter()
  const qc = useQueryClient()
  const form = useForm(slug, id)
  const [values, setValues] = useState<FormValues>({})
  const [attachments, setAttachments] = useState<AttachmentMap>({})
  const { errors, formError, capture, reset, setErrors } = useFormErrors()
  const [pending, setPending] = useState(false)

  if (form.isPending) {
    return (
      <div className="mx-auto max-w-3xl p-4 md:p-8">
        <LoadingRows rows={6} />
      </div>
    )
  }
  if (form.error) {
    return (
      <div className="mx-auto max-w-3xl p-4 md:p-8">
        <LoadError error={form.error} onRetry={() => form.refetch()} what="Form" />
      </div>
    )
  }

  const f = form.data

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    reset()
    const clientErrors = validateValues(f.fields, values)
    if (Object.keys(clientErrors).length) {
      setErrors(clientErrors)
      document.getElementById(`field-${Object.keys(clientErrors)[0].replace("values.", "")}`)?.focus()
      return
    }
    setPending(true)
    try {
      const { data } = await api<{ data: FormSubmissionDetail }>(orgPath(slug, `/forms/${f.id}/submissions`), { method: "POST", body: { values: visibleValues(f.fields, values) } })
      toast.success(data.status === "pending_approval" ? "Submitted and sent for approval." : "Thanks, your response was submitted.")
      qc.invalidateQueries({ queryKey: formKeys.all(slug) })
      router.push(href(`/apps/form/submissions/${data.id}`))
    } catch (error) {
      capture(error)
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-4 md:p-8">
      <ModuleHeader
        app="form"
        title={f.name}
        back={{ href: href("/apps/form"), label: "Forms" }}
        description={f.workflow ? (
          <span className="inline-flex items-center gap-1">
            <BadgeCheck className="size-3.5" aria-hidden /> Needs approval ({f.workflow.name})
          </span>
        ) : undefined}
        actions={
          f.permissions.manage ? (
            <Button asChild variant="outline">
              <Link href={href(`/apps/form/${f.id}/edit`)}>
                <Pencil aria-hidden /> Edit form
              </Link>
            </Button>
          ) : null
        }
      />
      {f.description ? <p className="text-sm whitespace-pre-wrap text-muted-foreground">{f.description}</p> : null}

      {!f.permissions.fill ? (
        <Card>
          <CardContent className="text-sm">
            {f.status === "published" ? "You are not in the audience for this form." : "This form is not accepting responses. Publish it from the form builder first."}
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent>
            <form onSubmit={submit} noValidate className="space-y-6">
              <FormAlert message={formError} />
              <FormRenderer
                fields={f.fields}
                values={values}
                onChange={(key, value) => setValues((v) => ({ ...v, [key]: value }))}
                errors={errors}
                attachments={attachments}
                onAttachment={(a) => setAttachments((m) => ({ ...m, [a.id]: a }))}
              />
              <p className="text-xs text-muted-foreground">
                <span className="text-destructive">*</span> Required
              </p>
              <div className="flex justify-end gap-2 border-t pt-4">
                <Button type="submit" disabled={pending}>
                  {pending ? <Spinner /> : null} {f.workflow ? "Submit for approval" : "Submit"}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
