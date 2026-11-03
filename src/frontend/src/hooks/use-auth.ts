"use client"

import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useRouter } from "next/navigation"
import { useCallback } from "react"
import { api, ApiError } from "@/lib/api"
import { disconnectEcho } from "@/lib/echo"
import type { Me } from "@/lib/types"

export const meKey = ["me"] as const

/** Current user, or null when signed out. */
export function useMe() {
  return useQuery({
    queryKey: meKey,
    queryFn: async () => {
      try {
        return (await api<{ data: Me }>("/api/auth/user")).data
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) return null
        throw e
      }
    },
    staleTime: 60_000,
  })
}

export function useLogout() {
  const qc = useQueryClient()
  const router = useRouter()
  return useCallback(async () => {
    try {
      await api("/api/auth/logout", { method: "POST" })
    } finally {
      disconnectEcho()
      qc.clear()
      router.replace("/login")
    }
  }, [qc, router])
}

/** Where to send a signed-in user who has no specific destination. */
export function homeFor(me: Me): string {
  if (!me.email_verified) return "/verify-email"
  const first = me.organizations[0]
  if (!first) return "/onboarding"
  return `/w/${first.slug}`
}
