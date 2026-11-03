import { Suspense } from "react"
import { PageSkeleton } from "@/components/common"
import { NotificationsView } from "@/components/views/notifications-view"

export const metadata = { title: "Notifications" }

export default function NotificationsPage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <NotificationsView />
    </Suspense>
  )
}
