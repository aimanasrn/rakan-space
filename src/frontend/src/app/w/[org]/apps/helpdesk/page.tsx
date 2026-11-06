import { Suspense } from "react"
import { PageSkeleton } from "@/components/common"
import { HelpdeskHomeView } from "@/components/apps/helpdesk/helpdesk-home-view"

export const metadata = { title: "Helpdesk" }

export default function Page() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <HelpdeskHomeView />
    </Suspense>
  )
}
