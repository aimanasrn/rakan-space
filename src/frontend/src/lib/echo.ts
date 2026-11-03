"use client"

import Echo from "laravel-echo"
import Pusher from "pusher-js"
import { api } from "./api"
import { config } from "./config"

/**
 * Single Laravel Echo client connected to Reverb. Private channel
 * subscriptions are authorised by the API on every (re)subscribe.
 */
let echo: Echo<"reverb"> | null = null

export function getEcho(): Echo<"reverb"> | null {
  if (typeof window === "undefined") return null
  if (echo) return echo

  ;(window as unknown as { Pusher: typeof Pusher }).Pusher = Pusher

  echo = new Echo({
    broadcaster: "reverb",
    key: config.reverb.key,
    wsHost: config.reverb.host,
    wsPort: config.reverb.port,
    wssPort: config.reverb.port,
    forceTLS: config.reverb.scheme === "https",
    enabledTransports: ["ws", "wss"],
    authorizer: (channel: { name: string }) => ({
      authorize: (socketId: string, callback: (error: Error | null, data: { auth: string } | null) => void) => {
        api<{ auth: string }>("/api/broadcasting/auth", { method: "POST", body: { socket_id: socketId, channel_name: channel.name } })
          .then((data) => callback(null, data))
          .catch((error) => callback(error as Error, null))
      },
    }),
  })

  return echo
}

export function disconnectEcho() {
  echo?.disconnect()
  echo = null
}

type ConnectionListener = (state: string, previous: string) => void

/** Subscribe to WebSocket connection state changes (used for reconnection recovery). */
export function onConnectionChange(listener: ConnectionListener): () => void {
  const client = getEcho()
  const pusher = (client?.connector as unknown as { pusher?: Pusher })?.pusher
  if (!pusher) return () => {}
  const handler = ({ current, previous }: { current: string; previous: string }) => listener(current, previous)
  pusher.connection.bind("state_change", handler)
  return () => pusher.connection.unbind("state_change", handler)
}

export function connectionState(): string {
  const pusher = (getEcho()?.connector as unknown as { pusher?: Pusher })?.pusher
  return pusher?.connection.state ?? "unavailable"
}
