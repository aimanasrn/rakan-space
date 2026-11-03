"use client"

import { getEcho } from "./echo"

/**
 * Real-time events only carry identifiers. Components react by fetching
 * from the API (which re-checks permissions). Conversation subscriptions are
 * reference-counted so several components can share one channel.
 */

export interface MessageSignal {
  conversation_id: number
  message_id: number
  client_id: string
  user_id: number | null
  action: "created" | "updated" | "deleted"
}

export const realtimeBus = typeof window !== "undefined" ? new EventTarget() : (null as unknown as EventTarget)

export function emitMessageSignal(signal: MessageSignal) {
  realtimeBus?.dispatchEvent(new CustomEvent<MessageSignal>("message", { detail: signal }))
}

export function onMessageSignal(listener: (signal: MessageSignal) => void): () => void {
  const handler = (e: Event) => listener((e as CustomEvent<MessageSignal>).detail)
  realtimeBus?.addEventListener("message", handler)
  return () => realtimeBus?.removeEventListener("message", handler)
}

export function emitReconnected() {
  realtimeBus?.dispatchEvent(new Event("reconnected"))
}

export function onReconnected(listener: () => void): () => void {
  realtimeBus?.addEventListener("reconnected", listener)
  return () => realtimeBus?.removeEventListener("reconnected", listener)
}

const counts = new Map<number, number>()

export function subscribeConversation(id: number): () => void {
  const echo = getEcho()
  if (!echo) return () => {}

  const current = counts.get(id) ?? 0
  counts.set(id, current + 1)

  if (current === 0) {
    const channel = echo.private(`conversation.${id}`)
    for (const action of ["created", "updated", "deleted"] as const) {
      channel.listen(`.message.${action}`, (payload: Omit<MessageSignal, "action">) => emitMessageSignal({ ...payload, action }))
    }
  }

  return () => {
    const remaining = (counts.get(id) ?? 1) - 1
    if (remaining <= 0) {
      counts.delete(id)
      echo.leave(`conversation.${id}`)
    } else {
      counts.set(id, remaining)
    }
  }
}
