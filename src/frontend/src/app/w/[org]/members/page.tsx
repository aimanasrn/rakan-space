import { Suspense } from "react"
import { PageSkeleton } from "@/components/common"
import { MembersView } from "@/components/views/members-view"

export const metadata = { title: "Members" }

export default function MembersPage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <MembersView />
    </Suspense>
  )
}
