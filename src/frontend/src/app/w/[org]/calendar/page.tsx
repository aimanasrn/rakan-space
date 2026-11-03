import { Suspense } from "react"
import { PageSkeleton } from "@/components/common"
import { CalendarView } from "@/components/views/calendar-view"

export const metadata = { title: "Calendar" }

export default function CalendarPage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <CalendarView />
    </Suspense>
  )
}
