"use client"

import { useRouter } from "next/navigation"
import { useEffect } from "react"
import { FullPageLoader } from "@/components/common"
import { homeFor, useMe } from "@/hooks/use-auth"

/** Entry point: send people to their workspace, onboarding, or sign-in. */
export default function Home() {
  const router = useRouter()
  const { data: me, isLoading } = useMe()

  useEffect(() => {
    if (isLoading) return
    router.replace(me ? homeFor(me) : "/login")
  }, [me, isLoading, router])

  return <FullPageLoader />
}
