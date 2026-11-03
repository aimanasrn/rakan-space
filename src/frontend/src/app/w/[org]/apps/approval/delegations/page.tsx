import { Suspense } from "react"
import { PageSkeleton } from "@/components/common"
import { DelegationsView } from "@/components/apps/approval/delegations-view"

export const metadata = { title: "Out of office" }

export default function Page() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <DelegationsView />
    </Suspense>
  )
}
