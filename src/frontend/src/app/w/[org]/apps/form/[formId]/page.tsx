import { Suspense } from "react"
import { PageSkeleton } from "@/components/common"
import { FormFillView } from "@/components/apps/form/form-fill-view"

export const metadata = { title: "Fill in form" }

export default function Page() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <FormFillView />
    </Suspense>
  )
}
