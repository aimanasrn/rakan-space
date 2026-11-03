"use client"

import { useQuery } from "@tanstack/react-query"
import { SearchX } from "lucide-react"
import Link from "next/link"
import { useParams, usePathname, useRouter } from "next/navigation"
import { useCallback, useEffect, useMemo } from "react"
import { EmptyState, FullPageLoader } from "@/components/common"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar"
import { homeFor, useMe } from "@/hooks/use-auth"
import { keys } from "@/hooks/use-workspace-data"
import { api, ApiError } from "@/lib/api"
import type { Organization } from "@/lib/types"
import { AppLauncher } from "@/components/launcher/app-launcher"
import { AppSidebar } from "./app-sidebar"
import { GlobalSearch } from "./global-search"
import { NotificationsMenu } from "./notifications-menu"
import { WorkspaceRealtime } from "./realtime"
import { UserMenu } from "./user-menu"
import { WorkspaceContext } from "./workspace-context"

export function WorkspaceShell({ children }: { children: React.ReactNode }) {
  const { org: slug } = useParams<{ org: string }>()
  const router = useRouter()
  const pathname = usePathname()
  const { data: me, isLoading: meLoading } = useMe()

  const org = useQuery({
    queryKey: keys.org(slug),
    enabled: !!me?.email_verified,
    queryFn: async () => (await api<{ data: Organization }>(`/api/orgs/${slug}`)).data,
  })

  useEffect(() => {
    if (meLoading) return
    if (!me) router.replace(`/login?next=${encodeURIComponent(pathname)}`)
    else if (!me.email_verified) router.replace(`/verify-email?next=${encodeURIComponent(pathname)}`)
  }, [me, meLoading, pathname, router])

  // Remember the last workspace for the home redirect.
  useEffect(() => {
    if (org.data) localStorage.setItem("rakanspace:last-org", org.data.slug)
  }, [org.data])

  const href = useCallback((path = "") => `/w/${slug}${path}`, [slug])
  const value = useMemo(() => (me && org.data ? { slug, org: org.data, me, href } : null), [slug, org.data, me, href])

  if (meLoading || !me || !me.email_verified || org.isLoading) return <FullPageLoader />

  if (org.error || !value) {
    const notFound = org.error instanceof ApiError && org.error.status === 404
    return (
      <main className="flex min-h-svh items-center justify-center p-6">
        <EmptyState
          icon={SearchX}
          title={notFound ? "Workspace not found" : "We couldn't load this workspace"}
          description={notFound ? "It may not exist, or you are no longer a member." : "Please try again in a moment."}
          action={
            <Button asChild>
              <Link href={homeFor(me)}>Go to my workspace</Link>
            </Button>
          }
        />
      </main>
    )
  }

  return (
    <WorkspaceContext.Provider value={value}>
      <WorkspaceRealtime />
      <SidebarProvider>
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-md focus:bg-background focus:px-3 focus:py-2 focus:shadow"
        >
          Skip to content
        </a>
        <AppSidebar />
        <SidebarInset className="min-w-0">
          <header className="sticky top-0 z-20 flex h-14 shrink-0 items-center gap-2 border-b bg-background/90 px-3 backdrop-blur md:px-4">
            <SidebarTrigger aria-label="Toggle navigation" />
            <Separator orientation="vertical" className="mr-1 h-5" />
            <div className="min-w-0 flex-1">
              <GlobalSearch />
            </div>
            <AppLauncher />
            <NotificationsMenu />
            <UserMenu />
          </header>
          <div id="main" tabIndex={-1} className="min-w-0 flex-1 outline-none">
            {children}
          </div>
        </SidebarInset>
      </SidebarProvider>
    </WorkspaceContext.Provider>
  )
}
