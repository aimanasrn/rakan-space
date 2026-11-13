import { Suspense } from "react"
import { PageSkeleton } from "@/components/common"
import { LeaveHomeView } from "@/components/apps/leave/leave-home-view"

export const metadata = { title: "Leave" }

export default function Page() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <LeaveHomeView />
    </Suspense>
  )
}
