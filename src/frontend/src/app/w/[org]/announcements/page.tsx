import { Suspense } from "react"
import { PageSkeleton } from "@/components/common"
import { AnnouncementsView } from "@/components/views/announcements-view"

export const metadata = { title: "Announcements" }

export default function AnnouncementsPage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <AnnouncementsView />
    </Suspense>
  )
}
