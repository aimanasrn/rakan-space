"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Bell, CheckCheck } from "lucide-react"
import { useRouter } from "next/navigation"
import { useState } from "react"
import { UserAvatar } from "@/components/common"
import { Button } from "@/components/ui/button"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Spinner } from "@/components/ui/spinner"
import { keys, useUnreadNotifications } from "@/hooks/use-workspace-data"
import { api } from "@/lib/api"
import { timeAgo } from "@/lib/datetime"
import { t } from "@/lib/i18n"
import type { AppNotification, Paginated } from "@/lib/types"
import { cn } from "@/lib/utils"
import { orgPath, useWorkspace } from "./workspace-context"

export function useMarkNotificationRead(slug: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api(orgPath(slug, `/notifications/${id}/read`), { method: "POST" }),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: keys.notifications(slug) })
      qc.invalidateQueries({ queryKey: keys.unread(slug) })
    },
  })
}

export function useMarkAllRead(slug: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => api(orgPath(slug, "/notifications/read-all"), { method: "POST" }),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: keys.notifications(slug) })
      qc.invalidateQueries({ queryKey: keys.unread(slug) })
      qc.invalidateQueries({ queryKey: ["dashboard", slug] })
    },
  })
}

export function NotificationItem({ n, onOpen }: { n: AppNotification; onOpen: (n: AppNotification) => void }) {
  return (
    <button
      type="button"
      onClick={() => onOpen(n)}
      className={cn(
        "flex w-full gap-3 rounded-lg px-3 py-2.5 text-left transition-colors hover:bg-muted focus-visible:bg-muted focus-visible:outline-none",
        !n.read && "bg-accent/50",
      )}
    >
      <UserAvatar user={n.actor ?? { name: "RakanSpace", avatar_url: null }} className="size-7" />
      <span className="min-w-0 flex-1">
        <span className={cn("block text-sm", !n.read && "font-medium")}>{n.title}</span>
        {n.body ? <span className="block truncate text-xs text-muted-foreground">{n.body}</span> : null}
        <span className="block text-xs text-muted-foreground">{timeAgo(n.created_at)}</span>
      </span>
      {!n.read ? <span className="mt-1.5 size-2 shrink-0 rounded-full bg-primary" aria-label="Unread" /> : null}
    </button>
  )
}

export function NotificationsMenu() {
  const { slug, href } = useWorkspace()
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const { data: unread = 0 } = useUnreadNotifications(slug)
  const markRead = useMarkNotificationRead(slug)
  const markAll = useMarkAllRead(slug)
  const list = useQuery({
    queryKey: [...keys.notifications(slug), "menu"],
    enabled: open,
    queryFn: () => api<Paginated<AppNotification>>(orgPath(slug, "/notifications"), { query: { per_page: 10 } }),
  })

  const openItem = (n: AppNotification) => {
    if (!n.read) markRead.mutate(n.id)
    setOpen(false)
    if (n.link) router.push(href(n.link))
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="relative" aria-label={unread ? `${t("nav.notifications")}, ${unread} unread` : t("nav.notifications")}>
          <Bell />
          {unread ? (
            <span className="absolute -top-0.5 -right-0.5 flex min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold text-primary-foreground">
              {unread > 99 ? "99+" : unread}
            </span>
          ) : null}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[min(24rem,calc(100vw-2rem))] p-0">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <h2 className="text-sm font-semibold">{t("nav.notifications")}</h2>
          <Button variant="ghost" size="sm" disabled={!unread || markAll.isPending} onClick={() => markAll.mutate()}>
            <CheckCheck /> {t("actions.markAllRead")}
          </Button>
        </div>
        <ScrollArea className="max-h-96">
          <div className="p-1">
            {list.isLoading ? (
              <div className="flex justify-center p-6">
                <Spinner />
              </div>
            ) : list.data?.data.length ? (
              list.data.data.map((n) => <NotificationItem key={n.id} n={n} onOpen={openItem} />)
            ) : (
              <p className="p-6 text-center text-sm text-muted-foreground">{t("empty.notifications")}</p>
            )}
          </div>
        </ScrollArea>
        <div className="border-t p-1">
          <Button
            variant="ghost"
            className="w-full"
            onClick={() => {
              setOpen(false)
              router.push(href("/notifications"))
            }}
          >
            {t("actions.viewAll")}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  )
}
