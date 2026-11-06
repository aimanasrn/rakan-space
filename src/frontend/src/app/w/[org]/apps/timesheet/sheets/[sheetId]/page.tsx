import { Suspense } from "react"
import { PageSkeleton } from "@/components/common"
import { SheetDetailView } from "@/components/apps/timesheet/sheet-detail-view"

export const metadata = { title: "Timesheet" }

export default function Page() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <SheetDetailView />
    </Suspense>
  )
}
