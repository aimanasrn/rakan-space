import { Suspense } from "react"
import { PageSkeleton } from "@/components/common"
import { SearchView } from "@/components/views/search-view"

export const metadata = { title: "Search" }

export default function SearchPage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <SearchView />
    </Suspense>
  )
}
