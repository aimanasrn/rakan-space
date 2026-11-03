import { Suspense } from "react"
import { FullPageLoader } from "@/components/common"
import { WorkspaceShell } from "@/components/workspace/shell"

export default function WorkspaceLayout({ children }: LayoutProps<"/w/[org]">) {
  return (
    <Suspense fallback={<FullPageLoader />}>
      <WorkspaceShell>{children}</WorkspaceShell>
    </Suspense>
  )
}
