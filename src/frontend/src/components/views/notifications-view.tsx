"use client"

import { useQuery } from "@tanstack/react-query"
import { Bell, CheckCheck } from "lucide-react"
import { useRouter } from "next/navigation"
import { useState } from "react"
import { EmptyState, ErrorState, LoadingRows, PageHeader } from "@/components/common"
import { NotificationItem, useMarkAllRead, useMarkNotificationRead } from "@/components/workspace/notifications-menu"
import { Button } from "@/components/ui/button"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { orgPath, useWorkspace } from "@/components/workspace/workspace-context"
import { keys } from "@/hooks/use-workspace-data"
import { api } from "@/lib/api"
import { t } from "@/lib/i18n"
import type { AppNotification, Paginated } from "@/lib/types"

export function NotificationsView() {
  const { slug, href } = useWorkspace()
  const router = useRouter()
  const [filter, setFilter] = useState<"all" | "unread">("all")
  const [page, setPage] = useState(1)
  const markRead = useMarkNotificationRead(slug)
  const markAll = useMarkAllRead(slug)
  const list = useQuery({
    queryKey: [...keys.notifications(slug), "page", filter, page],
    queryFn: () => api<Paginated<AppNotification>>(orgPath(slug, "/notifications"), { query: { unread: filter === "unread" ? 1 : undefined, page } }),
    placeholderData: (prev) => prev,
  })
  const unread = Number(list.data?.meta.unread_count ?? 0)

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-4 md:p-8">
      <PageHeader
        title={t("nav.notifications")}
        description={unread ? `${unread} unread` : "You're all caught up."}
        actions={
          <Button variant="outline" disabled={!unread || markAll.isPending} onClick={() => markAll.mutate()}>
            <CheckCheck /> {t("actions.markAllRead")}
          </Button>
        }
      />
      <Tabs value={filter} onValueChange={(v) => (setFilter(v as typeof filter), setPage(1))}>
        <TabsList>
          <TabsTrigger value="all">All</TabsTrigger>
          <TabsTrigger value="unread">Unread</TabsTrigger>
        </TabsList>
      </Tabs>
      {list.error ? <ErrorState error={list.error} onRetry={() => list.refetch()} /> : null}
      {list.isLoading ? (
        <LoadingRows rows={5} />
      ) : list.data?.data.length ? (
        <div className="space-y-1 rounded-xl border p-1">
          {list.data.data.map((n) => (
            <NotificationItem
              key={n.id}
              n={n}
              onOpen={(item) => {
                if (!item.read) markRead.mutate(item.id)
                if (item.link) router.push(href(item.link))
              }}
            />
          ))}
        </div>
      ) : (
        <EmptyState icon={Bell} title={t("empty.notifications")} />
      )}
      {list.data && list.data.meta.last_page > 1 ? (
        <nav className="flex items-center justify-center gap-2" aria-label="Pagination">
          <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
            Previous
          </Button>
          <span className="text-sm text-muted-foreground">
            Page {page} of {list.data.meta.last_page}
          </span>
          <Button variant="outline" size="sm" disabled={page >= list.data.meta.last_page} onClick={() => setPage((p) => p + 1)}>
            Next
          </Button>
        </nav>
      ) : null}
    </div>
  )
}
