import { Suspense } from "react"
import { PageSkeleton } from "@/components/common"
import { MyTasksView } from "@/components/views/my-tasks-view"

export const metadata = { title: "My Tasks" }

export default function MyTasksPage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <MyTasksView />
    </Suspense>
  )
}
