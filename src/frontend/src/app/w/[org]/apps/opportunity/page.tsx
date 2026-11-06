import { Suspense } from "react"
import { PageSkeleton } from "@/components/common"
import { OpportunityHomeView } from "@/components/apps/opportunity/opportunity-home-view"

export const metadata = { title: "Opportunity" }

export default function Page() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <OpportunityHomeView />
    </Suspense>
  )
}
