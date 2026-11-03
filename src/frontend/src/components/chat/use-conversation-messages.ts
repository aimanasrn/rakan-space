"use client"

import { useQueryClient } from "@tanstack/react-query"
import { useCallback, useEffect, useRef, useState } from "react"
import { orgPath } from "@/components/workspace/workspace-context"
import { keys } from "@/hooks/use-workspace-data"
import { api, ApiError, errorMessage } from "@/lib/api"
import { onMessageSignal, onReconnected } from "@/lib/realtime"
import type { Attachment, Message, UserSummary } from "@/lib/types"

export interface PendingMessage {
  client_id: string
  body: string
  mentions: number[]
  parent: Message | null
  attachments: Attachment[]
  status: "sending" | "failed"
  error?: string
  created_at: string
}

function uuid(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID()
  // RFC 4122 v4 fallback for non-secure contexts.
  return "10000000-1000-4000-8000-100000000000".replace(/[018]/g, (c) =>
    (Number(c) ^ (crypto.getRandomValues(new Uint8Array(1))[0] & (15 >> (Number(c) / 4)))).toString(16),
  )
}

/** Merge server messages by id (dedupes HTTP response vs. broadcast catch-up). */
function merge(current: Message[], incoming: Message[]): Message[] {
  const map = new Map(current.map((m) => [m.id, m]))
  for (const m of incoming) map.set(m.id, m)
  return [...map.values()].sort((a, b) => a.id - b.id)
}

/**
 * Message state for one conversation:
 * - history pages (?before=), catch-up (?after=) on real-time signals and reconnects
 * - optimistic sends with a client-generated id; failed sends can be retried
 *   with the same id, and the server returns the existing message instead of
 *   creating a duplicate
 */
export function useConversationMessages(slug: string, conversationId: number, me: UserSummary, canRead: boolean) {
  const qc = useQueryClient()
  const [messages, setMessages] = useState<Message[]>([])
  const [pending, setPending] = useState<PendingMessage[]>([])
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading")
  const [error, setError] = useState<unknown>(null)
  const [hasMore, setHasMore] = useState(false)
  const [loadingOlder, setLoadingOlder] = useState(false)
  const lastIdRef = useRef(0)
  const fetchingNewer = useRef<Promise<void> | null>(null)
  const base = orgPath(slug, `/conversations/${conversationId}/messages`)

  useEffect(() => {
    lastIdRef.current = messages.length ? messages[messages.length - 1].id : lastIdRef.current
  }, [messages])

  const removePending = useCallback((clientIds: string[]) => {
    if (clientIds.length) setPending((p) => p.filter((m) => !clientIds.includes(m.client_id)))
  }, [])

  // Initial page. Callers mount one instance per conversation (keyed), so state starts fresh.
  useEffect(() => {
    if (!canRead) return
    let cancelled = false
    api<{ data: Message[]; meta: { has_more: boolean } }>(base, { query: { limit: 50 } })
      .then((res) => {
        if (cancelled) return
        setMessages(res.data)
        setHasMore(res.meta.has_more)
        setStatus("ready")
      })
      .catch((e) => {
        if (cancelled) return
        setError(e)
        setStatus("error")
      })
    return () => {
      cancelled = true
    }
  }, [base, canRead])

  const fetchNewer = useCallback(async () => {
    if (fetchingNewer.current) return fetchingNewer.current
    fetchingNewer.current = (async () => {
      try {
        let more = true
        while (more) {
          const res = await api<{ data: Message[]; meta: { has_more: boolean } }>(base, { query: { after: lastIdRef.current, limit: 100 } })
          if (res.data.length) {
            lastIdRef.current = res.data[res.data.length - 1].id
            setMessages((m) => merge(m, res.data))
            removePending(res.data.map((m) => m.client_id))
          }
          more = res.meta.has_more
        }
      } catch {
        /* the next signal or reconnect will retry */
      } finally {
        fetchingNewer.current = null
      }
    })()
    return fetchingNewer.current
  }, [base, removePending])

  const refreshOne = useCallback(
    async (id: number) => {
      try {
        const { data } = await api<{ data: Message }>(`${base}/${id}`)
        setMessages((m) => merge(m, [data]))
      } catch {
        /* ignore */
      }
    },
    [base],
  )

  // Real-time signals and reconnection recovery
  useEffect(() => {
    if (!canRead) return
    const offSignal = onMessageSignal((s) => {
      if (s.conversation_id !== conversationId) return
      if (s.action === "created") fetchNewer()
      else refreshOne(s.message_id)
    })
    const offReconnect = onReconnected(() => fetchNewer())
    const onVisible = () => document.visibilityState === "visible" && fetchNewer()
    document.addEventListener("visibilitychange", onVisible)
    return () => {
      offSignal()
      offReconnect()
      document.removeEventListener("visibilitychange", onVisible)
    }
  }, [canRead, conversationId, fetchNewer, refreshOne])

  const loadOlder = useCallback(async () => {
    if (!messages.length || loadingOlder) return
    setLoadingOlder(true)
    try {
      const res = await api<{ data: Message[]; meta: { has_more: boolean } }>(base, { query: { before: messages[0].id, limit: 50 } })
      setMessages((m) => merge(m, res.data))
      setHasMore(res.meta.has_more)
    } finally {
      setLoadingOlder(false)
    }
  }, [base, messages, loadingOlder])

  const post = useCallback(
    async (p: PendingMessage) => {
      setPending((list) => list.map((m) => (m.client_id === p.client_id ? { ...m, status: "sending", error: undefined } : m)))
      try {
        const { data } = await api<{ data: Message }>(base, {
          method: "POST",
          body: {
            client_id: p.client_id,
            body: p.body || null,
            mentions: p.mentions,
            parent_id: p.parent?.id ?? null,
            attachment_ids: p.attachments.map((a) => a.id),
          },
        })
        setMessages((m) => merge(m, [data]))
        removePending([p.client_id])
        qc.invalidateQueries({ queryKey: keys.conversations(slug) })
      } catch (e) {
        // 4xx validation/permission errors are not retryable as-is, but we keep the text so it is not lost.
        const message = e instanceof ApiError && e.status === 0 ? "Not sent — you appear to be offline." : errorMessage(e)
        setPending((list) => list.map((m) => (m.client_id === p.client_id ? { ...m, status: "failed", error: message } : m)))
      }
    },
    [base, qc, slug, removePending],
  )

  const send = useCallback(
    (body: string, mentions: number[], parent: Message | null, attachments: Attachment[]) => {
      const p: PendingMessage = {
        client_id: uuid(),
        body,
        mentions,
        parent,
        attachments,
        status: "sending",
        created_at: new Date().toISOString(),
      }
      setPending((list) => [...list, p])
      void post(p)
    },
    [post],
  )

  const retry = useCallback((clientId: string) => {
    const p = pending.find((m) => m.client_id === clientId)
    if (p) void post(p)
  }, [pending, post])

  const discard = useCallback((clientId: string) => removePending([clientId]), [removePending])

  const replace = useCallback((message: Message) => setMessages((m) => merge(m, [message])), [])

  return { messages, pending, status, error, hasMore, loadingOlder, loadOlder, send, retry, discard, replace, me }
}
