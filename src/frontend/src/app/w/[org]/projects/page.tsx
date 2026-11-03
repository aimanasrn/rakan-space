import { Suspense } from "react"
import { PageSkeleton } from "@/components/common"
import { ProjectsView } from "@/components/views/projects-view"

export const metadata = { title: "Projects" }

export default function ProjectsPage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <ProjectsView />
    </Suspense>
  )
}
