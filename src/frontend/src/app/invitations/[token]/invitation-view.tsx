"use client"

import { useQuery, useQueryClient } from "@tanstack/react-query"
import { MailX, Users } from "lucide-react"
import Link from "next/link"
import { useParams, useRouter } from "next/navigation"
import { useState } from "react"
import { toast } from "sonner"
import { BrandMark, ErrorState, FullPageLoader, RoleBadge } from "@/components/common"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { Spinner } from "@/components/ui/spinner"
import { meKey, useLogout, useMe } from "@/hooks/use-auth"
import { api, errorMessage } from "@/lib/api"
import { formatDateTime } from "@/lib/datetime"
import type { Me, Role } from "@/lib/types"

interface Preview {
  organization: { name: string }
  email: string
  role: Role
  status: "pending" | "accepted" | "revoked" | "expired"
  invited_by: string | null
  expires_at: string
}

export function InvitationView() {
  const { token } = useParams<{ token: string }>()
  const router = useRouter()
  const qc = useQueryClient()
  const logout = useLogout()
  const { data: me, isLoading: meLoading } = useMe()
  const [accepting, setAccepting] = useState(false)
  const preview = useQuery({
    queryKey: ["invitation", token],
    queryFn: async () => (await api<{ data: Preview }>(`/api/invitations/${token}`)).data,
  })

  if (preview.isLoading || meLoading) return <FullPageLoader />

  const next = `/invitations/${token}`
  const inv = preview.data

  async function accept() {
    setAccepting(true)
    try {
      const res = await api<{ data: Me; organization: { slug: string; name: string } }>(`/api/invitations/${token}/accept`, { method: "POST" })
      qc.setQueryData(meKey, res.data)
      toast.success(`Welcome to ${res.organization.name}!`)
      router.replace(`/w/${res.organization.slug}`)
    } catch (e) {
      toast.error(errorMessage(e))
      setAccepting(false)
    }
  }

  const emailMatches = me && inv && me.email.toLowerCase() === inv.email.toLowerCase()

  return (
    <main className="flex min-h-svh items-center justify-center bg-muted/40 p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="items-center text-center">
          <BrandMark className="mx-auto mb-2 size-10 text-lg" />
          {preview.error || !inv ? (
            <>
              <CardTitle>Invitation not found</CardTitle>
              <CardDescription>This link is invalid or has been replaced by a newer invitation.</CardDescription>
            </>
          ) : (
            <>
              <CardTitle className="text-xl">Join {inv.organization.name}</CardTitle>
              <CardDescription>
                {inv.invited_by ?? "A teammate"} invited <strong className="text-foreground">{inv.email}</strong> to join as <RoleBadge role={inv.role} />
              </CardDescription>
            </>
          )}
        </CardHeader>
        <CardContent className="space-y-3 text-center text-sm">
          {preview.error ? <ErrorState error={preview.error} /> : null}
          {inv && inv.status !== "pending" ? (
            <div role="alert" className="flex flex-col items-center gap-2 text-muted-foreground">
              <MailX className="size-8" aria-hidden />
              {inv.status === "accepted" && "This invitation has already been used."}
              {inv.status === "revoked" && "This invitation was revoked by an administrator."}
              {inv.status === "expired" && "This invitation has expired. Ask the person who invited you for a new one."}
            </div>
          ) : null}
          {inv && inv.status === "pending" ? (
            <p className="text-muted-foreground">
              <Users className="mr-1 inline size-4" aria-hidden />
              Expires {formatDateTime(inv.expires_at, Intl.DateTimeFormat().resolvedOptions().timeZone)}
            </p>
          ) : null}
          {inv && inv.status === "pending" && me && !emailMatches ? (
            <p role="alert" className="rounded-lg bg-destructive/5 p-3 text-destructive">
              You are signed in as {me.email}. Sign in with {inv.email} to accept this invitation.
            </p>
          ) : null}
          {inv && inv.status === "pending" && me && emailMatches && !me.email_verified ? (
            <p role="alert" className="rounded-lg bg-accent p-3 text-accent-foreground">
              Verify your email address first, then come back to this page.
            </p>
          ) : null}
        </CardContent>
        <CardFooter className="flex flex-col gap-2">
          {inv && inv.status === "pending" && !me ? (
            <>
              <Button className="w-full" asChild>
                <Link href={`/register?email=${encodeURIComponent(inv.email)}&next=${encodeURIComponent(next)}`}>Create an account</Link>
              </Button>
              <Button className="w-full" variant="outline" asChild>
                <Link href={`/login?email=${encodeURIComponent(inv.email)}&next=${encodeURIComponent(next)}`}>I already have an account</Link>
              </Button>
            </>
          ) : null}
          {inv && inv.status === "pending" && me && emailMatches && me.email_verified ? (
            <Button className="w-full" onClick={accept} disabled={accepting}>
              {accepting ? <Spinner /> : null}
              Accept invitation
            </Button>
          ) : null}
          {inv && inv.status === "pending" && me && emailMatches && !me.email_verified ? (
            <Button className="w-full" asChild>
              <Link href={`/verify-email?next=${encodeURIComponent(next)}`}>Verify email</Link>
            </Button>
          ) : null}
          {me && !emailMatches ? (
            <Button className="w-full" variant="outline" onClick={logout}>
              Sign out and switch account
            </Button>
          ) : null}
          {me && emailMatches === false ? null : me && (!inv || inv.status !== "pending") ? (
            <Button className="w-full" variant="ghost" asChild>
              <Link href="/home">Go to RakanSpace</Link>
            </Button>
          ) : null}
        </CardFooter>
      </Card>
    </main>
  )
}
