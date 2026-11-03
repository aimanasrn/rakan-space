import Link from "next/link"
import { Suspense } from "react"
import { BrandMark, FullPageLoader } from "@/components/common"

export default function AuthLayout({ children }: LayoutProps<"/">) {
  return (
    <div className="grid min-h-svh lg:grid-cols-2">
      <div className="flex flex-col gap-6 p-6 md:p-10">
        <Link href="/" className="flex items-center gap-2 font-semibold">
          <BrandMark />
          RakanSpace
        </Link>
        <main className="flex flex-1 items-center justify-center">
          <div className="w-full max-w-sm">
            <Suspense fallback={<FullPageLoader />}>{children}</Suspense>
          </div>
        </main>
      </div>
      <aside className="relative hidden overflow-hidden bg-primary text-primary-foreground lg:flex lg:flex-col lg:justify-end lg:p-12">
        <div aria-hidden className="absolute inset-0 bg-[radial-gradient(circle_at_30%_20%,rgba(255,255,255,0.18),transparent_55%)]" />
        <div className="relative space-y-4">
          <p className="text-4xl font-semibold tracking-tight">Satu ruang. Satu pasukan.</p>
          <p className="max-w-md text-lg opacity-90">
            Chat, projects, tasks, calendars and announcements for your whole organisation — in one connected workspace.
          </p>
        </div>
      </aside>
    </div>
  )
}
