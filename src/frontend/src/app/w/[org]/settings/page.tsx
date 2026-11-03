import { Suspense } from "react"
import { PageSkeleton } from "@/components/common"
import { SettingsView } from "@/components/views/settings-view"

export const metadata = { title: "Settings" }

export default function SettingsPage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <SettingsView />
    </Suspense>
  )
}
