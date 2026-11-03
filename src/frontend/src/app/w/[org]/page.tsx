import { Suspense } from "react"
import { PageSkeleton } from "@/components/common"
import { OverviewView } from "@/components/views/overview-view"

export default function OverviewPage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <OverviewView />
    </Suspense>
  )
}
