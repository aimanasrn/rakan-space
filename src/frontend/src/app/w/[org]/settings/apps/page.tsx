import { Suspense } from "react"
import { PageSkeleton } from "@/components/common"
import { AppSettingsView } from "@/components/views/app-settings-view"

export const metadata = { title: "Apps & launcher" }

export default function AppSettingsPage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <AppSettingsView />
    </Suspense>
  )
}
