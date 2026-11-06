import { Suspense } from "react"
import { PageSkeleton } from "@/components/common"
import { DealDetailView } from "@/components/apps/opportunity/deal-detail-view"

export const metadata = { title: "Opportunity" }

export default function Page() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <DealDetailView />
    </Suspense>
  )
}
