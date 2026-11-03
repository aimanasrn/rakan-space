import { Suspense } from "react"
import { PageSkeleton } from "@/components/common"
import { FormResponsesView } from "@/components/apps/form/form-responses-view"

export const metadata = { title: "Responses" }

export default function Page() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <FormResponsesView />
    </Suspense>
  )
}
