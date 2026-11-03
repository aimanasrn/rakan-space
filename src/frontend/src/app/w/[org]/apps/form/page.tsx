import { Suspense } from "react"
import { PageSkeleton } from "@/components/common"
import { FormHomeView } from "@/components/apps/form/form-home-view"

export const metadata = { title: "Form" }

export default function Page() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <FormHomeView />
    </Suspense>
  )
}
