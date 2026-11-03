import { Suspense } from "react"
import { PageSkeleton } from "@/components/common"
import { AppHomeView } from "@/components/views/app-home-view"

export const metadata = { title: "App" }

export default function AppHomePage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <AppHomeView />
    </Suspense>
  )
}
