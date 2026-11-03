import { Suspense } from "react"
import { PageSkeleton } from "@/components/common"
import { ReportsView } from "@/components/views/reports-view"

export const metadata = { title: "Reports" }

export default function ReportsPage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <ReportsView />
    </Suspense>
  )
}
