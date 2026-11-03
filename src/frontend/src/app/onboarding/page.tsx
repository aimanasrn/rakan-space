import { Suspense } from "react"
import { FullPageLoader } from "@/components/common"
import { OnboardingView } from "./onboarding-view"

export const metadata = { title: "Set up your workspace" }

export default function OnboardingPage() {
  return (
    <Suspense fallback={<FullPageLoader />}>
      <OnboardingView />
    </Suspense>
  )
}
