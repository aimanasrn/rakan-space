import { Suspense } from "react"
import { PageSkeleton } from "@/components/common"
import { FilesView } from "@/components/views/files-view"

export const metadata = { title: "Files" }

export default function FilesPage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <FilesView />
    </Suspense>
  )
}
