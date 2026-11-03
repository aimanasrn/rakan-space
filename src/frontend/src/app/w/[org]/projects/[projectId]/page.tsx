import { Suspense } from "react"
import { PageSkeleton } from "@/components/common"
import { ProjectDetailView } from "@/components/views/project-detail-view"

export const metadata = { title: "Project" }

export default function ProjectDetailPage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <ProjectDetailView />
    </Suspense>
  )
}
