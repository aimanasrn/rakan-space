import { Suspense } from "react"
import { PageSkeleton } from "@/components/common"
import { WorkflowsView } from "@/components/apps/approval/workflows-view"

export const metadata = { title: "Workflows" }

export default function Page() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <WorkflowsView />
    </Suspense>
  )
}
