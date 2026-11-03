import { Suspense } from "react"
import { PageSkeleton } from "@/components/common"
import { FormBuilderView } from "@/components/apps/form/form-builder-view"

export const metadata = { title: "Form builder" }

export default function Page() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <FormBuilderView />
    </Suspense>
  )
}
