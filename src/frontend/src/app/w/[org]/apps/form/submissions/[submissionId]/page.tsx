import { Suspense } from "react"
import { PageSkeleton } from "@/components/common"
import { SubmissionDetailView } from "@/components/apps/form/submission-detail-view"

export const metadata = { title: "Response" }

export default function Page() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <SubmissionDetailView />
    </Suspense>
  )
}
