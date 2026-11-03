import { Suspense } from "react"
import { FullPageLoader } from "@/components/common"
import { InvitationView } from "./invitation-view"

export default function InvitationPage() {
  return (
    <Suspense fallback={<FullPageLoader />}>
      <InvitationView />
    </Suspense>
  )
}
