import { Suspense } from "react"
import { PageSkeleton } from "@/components/common"
import { TicketDetailView } from "@/components/apps/helpdesk/ticket-detail-view"

export const metadata = { title: "Ticket" }

export default function Page() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <TicketDetailView />
    </Suspense>
  )
}
