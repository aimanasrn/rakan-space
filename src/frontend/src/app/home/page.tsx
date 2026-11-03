"use client"

import { useRouter } from "next/navigation"
import { useEffect } from "react"
import { FullPageLoader } from "@/components/common"
import { homeFor, useMe } from "@/hooks/use-auth"

/**
 * In-app entry point: sends people to their workspace, onboarding, or sign-in.
 * Used after leaving a workspace or losing access. "/" is the public landing page.
 */
export default function AppHome() {
  const router = useRouter()
  const { data: me, isLoading } = useMe()

  useEffect(() => {
    if (isLoading) return
    router.replace(me ? homeFor(me) : "/login")
  }, [me, isLoading, router])

  return <FullPageLoader />
}
