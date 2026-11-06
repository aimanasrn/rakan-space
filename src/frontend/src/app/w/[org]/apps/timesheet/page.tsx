import { Suspense } from "react"
import { PageSkeleton } from "@/components/common"
import { TimesheetHomeView } from "@/components/apps/timesheet/timesheet-home-view"

export const metadata = { title: "Timesheet" }

export default function Page() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <TimesheetHomeView />
    </Suspense>
  )
}
