import { Suspense } from "react"
import { PageSkeleton } from "@/components/common"
import { ChatLayout } from "@/components/views/chat-view"

export const metadata = { title: "Chat" }

export default function Layout({ children }: LayoutProps<"/w/[org]/chat">) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <ChatLayout>{children}</ChatLayout>
    </Suspense>
  )
}
