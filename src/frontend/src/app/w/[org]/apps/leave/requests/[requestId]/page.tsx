import { Suspense } from "react"
import { PageSkeleton } from "@/components/common"
import { LeaveRequestDetailView } from "@/components/apps/leave/request-detail-view"

export const metadata = { title: "Leave application" }

export default function Page() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <LeaveRequestDetailView />
    </Suspense>
  )
}
