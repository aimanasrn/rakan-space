import { Suspense } from "react"
import { PageSkeleton } from "@/components/common"
import { ApprovalHomeView } from "@/components/apps/approval/approval-home-view"

export const metadata = { title: "Approval" }

export default function Page() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <ApprovalHomeView />
    </Suspense>
  )
}
