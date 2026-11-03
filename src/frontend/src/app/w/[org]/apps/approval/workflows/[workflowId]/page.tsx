import { Suspense } from "react"
import { PageSkeleton } from "@/components/common"
import { WorkflowDesignerView } from "@/components/apps/approval/workflow-designer-view"

export const metadata = { title: "Workflow" }

export default function Page() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <WorkflowDesignerView />
    </Suspense>
  )
}
