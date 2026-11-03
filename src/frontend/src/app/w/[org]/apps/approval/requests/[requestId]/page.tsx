import { Suspense } from "react"
import { PageSkeleton } from "@/components/common"
import { RequestDetailView } from "@/components/apps/approval/request-detail-view"

export const metadata = { title: "Approval request" }

export default function Page() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <RequestDetailView />
    </Suspense>
  )
}
