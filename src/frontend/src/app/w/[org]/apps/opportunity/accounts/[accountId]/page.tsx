import { Suspense } from "react"
import { PageSkeleton } from "@/components/common"
import { AccountDetailView } from "@/components/apps/opportunity/account-detail-view"

export const metadata = { title: "Account" }

export default function Page() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <AccountDetailView />
    </Suspense>
  )
}
