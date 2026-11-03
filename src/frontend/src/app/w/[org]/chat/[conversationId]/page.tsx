import { Suspense } from "react"
import { PageSkeleton } from "@/components/common"
import { ConversationView } from "@/components/views/chat-view"

export default function ConversationPage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <ConversationView />
    </Suspense>
  )
}
