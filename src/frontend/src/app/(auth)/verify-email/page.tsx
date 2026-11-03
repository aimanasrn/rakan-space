"use client"

import { useQueryClient } from "@tanstack/react-query"
import { CheckCircle2, MailCheck } from "lucide-react"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { useEffect, useRef, useState } from "react"
import { toast } from "sonner"
import { ErrorState, FullPageLoader } from "@/components/common"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import { homeFor, meKey, useLogout, useMe } from "@/hooks/use-auth"
import { api, errorMessage } from "@/lib/api"
import type { Me } from "@/lib/types"
import { safeNext } from "@/lib/nav"

/**
 * Two modes:
 *  - With ?id&hash&expires&signature (from the email link): verify, then continue.
 *  - Otherwise: "check your inbox" with a resend button.
 */
export default function VerifyEmailPage() {
  const params = useSearchParams()
  const router = useRouter()
  const qc = useQueryClient()
  const logout = useLogout()
  const { data: me, isLoading } = useMe()
  const [error, setError] = useState<unknown>(null)
  const [resending, setResending] = useState(false)
  const started = useRef(false)

  const id = params.get("id")
  const hash = params.get("hash")
  const isLink = !!(id && hash && params.get("signature"))
  const sentParam = params.get("sent")

  useEffect(() => {
    if (!isLink || isLoading || started.current) return
    if (!me) {
      router.replace(`/login?next=${encodeURIComponent(`/verify-email?${params.toString()}`)}`)
      return
    }
    started.current = true
    api<{ data: Me }>(`/api/auth/email/verify/${id}/${hash}`, {
      query: { expires: params.get("expires"), signature: params.get("signature") },
    })
      .then(({ data }) => {
        qc.setQueryData(meKey, data)
        toast.success("Email verified.")
        router.replace(safeNext(params.get("next")) ?? homeFor(data))
      })
      .catch(setError)
  }, [isLink, isLoading, me, id, hash, params, qc, router])

  if (isLoading) return <FullPageLoader />

  if (isLink) {
    return error ? (
      <div className="space-y-4">
        <ErrorState error={error} />
        <p className="text-center text-sm text-muted-foreground">The link may have expired. Request a new one below.</p>
        <Button className="w-full" variant="outline" asChild>
          <Link href="/verify-email">Back</Link>
        </Button>
      </div>
    ) : (
      <FullPageLoader label="Verifying your email" />
    )
  }

  if (!me) {
    return (
      <div className="space-y-4 text-center">
        <p>Please sign in to verify your email.</p>
        <Button asChild>
          <Link href="/login">Sign in</Link>
        </Button>
      </div>
    )
  }

  if (me.email_verified) {
    return (
      <div className="space-y-4 text-center">
        <CheckCircle2 className="mx-auto size-10 text-primary" aria-hidden />
        <h1 className="text-2xl font-semibold">Your email is verified</h1>
        <Button onClick={() => router.replace(homeFor(me))}>Continue</Button>
      </div>
    )
  }

  async function resend() {
    setResending(true)
    try {
      await api("/api/auth/email/verification-notification", { method: "POST" })
      toast.success("Verification email sent. Check your inbox.")
    } catch (e) {
      toast.error(errorMessage(e))
    } finally {
      setResending(false)
    }
  }

  return (
    <div className="space-y-6 text-center">
      <MailCheck className="mx-auto size-10 text-primary" aria-hidden />
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">Check your inbox</h1>
        {sentParam === "0" ? (
          <p role="alert" className="text-sm text-destructive">
            Your account was created, but we could not send the verification email. Please use the button below to try again.
          </p>
        ) : (
          <p className="text-sm text-muted-foreground">
            We sent a verification link to <strong className="text-foreground">{me.email}</strong>. Open it to continue.
          </p>
        )}
      </div>
      <div className="flex flex-col gap-2">
        <Button onClick={resend} disabled={resending}>
          {resending ? <Spinner /> : null}
          Resend verification email
        </Button>
        <Button variant="ghost" onClick={logout}>
          Use a different account
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">Local development: emails are captured by Mailpit at http://localhost:8025.</p>
    </div>
  )
}
