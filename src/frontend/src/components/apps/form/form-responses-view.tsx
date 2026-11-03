"use client"

import { Pencil } from "lucide-react"
import Link from "next/link"
import { useParams } from "next/navigation"
import { LoadingRows } from "@/components/common"
import { Button } from "@/components/ui/button"
import { useWorkspace } from "@/components/workspace/workspace-context"
import { LoadError, ModuleHeader } from "../shared"
import { SubmissionList } from "./form-home-view"
import { useForm } from "./use-forms"

export function FormResponsesView() {
  const { formId } = useParams<{ formId: string }>()
  const id = Number(formId)
  const { slug, href } = useWorkspace()
  const form = useForm(slug, id)

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-4 md:p-8">
      {form.isPending ? (
        <LoadingRows rows={5} />
      ) : form.error ? (
        <LoadError error={form.error} onRetry={() => form.refetch()} what="Form" />
      ) : (
        <>
          <ModuleHeader
            app="form"
            title={`Responses: ${form.data.name}`}
            back={{ href: href("/apps/form?tab=manage"), label: "Manage forms" }}
            actions={
              form.data.permissions.manage ? (
                <Button asChild variant="outline">
                  <Link href={href(`/apps/form/${id}/edit`)}>
                    <Pencil aria-hidden /> Edit form
                  </Link>
                </Button>
              ) : null
            }
          />
          <SubmissionList formId={id} />
        </>
      )}
    </div>
  )
}
