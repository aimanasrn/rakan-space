import { Suspense } from "react"
import { PageSkeleton } from "@/components/common"
import { ChatHomeView } from "@/components/views/chat-view"

export default function ChatHomePage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <ChatHomeView />
    </Suspense>
  )
}
