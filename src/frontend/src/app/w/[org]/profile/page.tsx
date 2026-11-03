import { Suspense } from "react"
import { PageSkeleton } from "@/components/common"
import { ProfileView } from "@/components/views/profile-view"

export const metadata = { title: "Profile" }

export default function ProfilePage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <ProfileView />
    </Suspense>
  )
}
