"use client"

import { useQueryClient } from "@tanstack/react-query"
import { usePathname, useRouter } from "next/navigation"
import { useEffect, useRef } from "react"
import { toast } from "sonner"
import { keys, useConversations } from "@/hooks/use-workspace-data"
import { meKey } from "@/hooks/use-auth"
import { api } from "@/lib/api"
import { getEcho, onConnectionChange } from "@/lib/echo"
import { emitReconnected, onMessageSignal, subscribeConversation } from "@/lib/realtime"
import type { AppNotification } from "@/lib/types"
import { orgPath, useWorkspace } from "./workspace-context"

/**
 * Wires Reverb events into the UI for the active workspace:
 * - user channel: notifications, conversation list changes, access revocation
 * - one channel per conversation the user belongs to (unread counts)
 * - reconnection: refetch persisted state so nothing missed is lost
 */
export function WorkspaceRealtime() {
  const { slug, org, me, href } = useWorkspace()
  const qc = useQueryClient()
  const router = useRouter()
  const pathname = usePathname()
  const pathRef = useRef(pathname)
  useEffect(() => {
    pathRef.current = pathname
  }, [pathname])
  const { data: conversations } = useConversations(slug)

  // User channel
  useEffect(() => {
    const echo = getEcho()
    if (!echo) return
    const channel = echo.private(`user.${me.id}`)

    channel.listen(".notification.created", async (e: { organization_id: number }) => {
      if (e.organization_id !== org.id) {
        qc.invalidateQueries({ queryKey: ["notifications-count"] })
        return
      }
      qc.invalidateQueries({ queryKey: keys.unread(slug) })
      qc.invalidateQueries({ queryKey: keys.notifications(slug) })
      qc.invalidateQueries({ queryKey: ["dashboard", slug] })
      try {
        const latest = await api<{ data: AppNotification[] }>(orgPath(slug, "/notifications"), { query: { per_page: 1, unread: 1 } })
        const n = latest.data[0]
        if (n) toast(n.title, { description: n.body ?? undefined, action: n.link ? { label: "Open", onClick: () => router.push(href(n.link!)) } : undefined })
      } catch {
        /* toast is best-effort */
      }
    })

    channel.listen(".conversations.changed", (e: { organization_id: number }) => {
      if (e.organization_id === org.id) qc.invalidateQueries({ queryKey: keys.conversations(slug) })
    })

    channel.listen(".access.revoked", (e: { organization_id: number; conversation_id?: number }) => {
      if (e.organization_id !== org.id) {
        qc.invalidateQueries({ queryKey: meKey })
        return
      }
      if (e.conversation_id) {
        qc.invalidateQueries({ queryKey: keys.conversations(slug) })
        qc.removeQueries({ queryKey: keys.conversation(slug, e.conversation_id) })
        if (pathRef.current.startsWith(href(`/chat/${e.conversation_id}`))) {
          toast.warning("You no longer have access to that conversation.")
          router.replace(href("/chat"))
        }
        return
      }
      toast.error(`Your access to ${org.name} has been removed.`)
      qc.invalidateQueries({ queryKey: meKey })
      router.replace("/")
    })

    return () => {
      echo.leave(`user.${me.id}`)
    }
  }, [me.id, org.id, org.name, slug, qc, router, href])

  // Conversation channels for unread counts
  const memberIds = (conversations ?? []).filter((c) => c.is_member).map((c) => c.id).join(",")
  useEffect(() => {
    const ids = memberIds ? memberIds.split(",").map(Number) : []
    const unsubs = ids.map((id) => subscribeConversation(id))
    return () => unsubs.forEach((u) => u())
  }, [memberIds])

  useEffect(
    () =>
      onMessageSignal((signal) => {
        if (signal.action === "created" && signal.user_id !== me.id) {
          qc.invalidateQueries({ queryKey: keys.conversations(slug) })
        }
      }),
    [qc, slug, me.id],
  )

  // Reconnection recovery
  useEffect(() => {
    let wasConnected = false
    return onConnectionChange((state) => {
      if (state === "connected") {
        if (wasConnected) {
          qc.invalidateQueries({ queryKey: keys.conversations(slug) })
          qc.invalidateQueries({ queryKey: keys.unread(slug) })
          qc.invalidateQueries({ queryKey: keys.notifications(slug) })
          emitReconnected()
        }
        wasConnected = true
      }
    })
  }, [qc, slug])

  return null
}
