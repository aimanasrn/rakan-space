"use client"

import { useQueryClient } from "@tanstack/react-query"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { useState } from "react"
import { FormAlert, TextField, useFormErrors } from "@/components/form"
import { Button } from "@/components/ui/button"
import { FieldGroup } from "@/components/ui/field"
import { Spinner } from "@/components/ui/spinner"
import { meKey } from "@/hooks/use-auth"
import { api, ensureCsrfCookie } from "@/lib/api"
import type { Me } from "@/lib/types"
import { safeNext } from "@/lib/nav"

export default function RegisterPage() {
  const router = useRouter()
  const params = useSearchParams()
  const qc = useQueryClient()
  const { errors, formError, capture, reset } = useFormErrors()
  const [pending, setPending] = useState(false)

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    reset()
    setPending(true)
    const form = new FormData(e.currentTarget)
    try {
      await ensureCsrfCookie(true)
      const res = await api<{ data: Me; email_sent: boolean }>("/api/auth/register", {
        method: "POST",
        body: {
          name: form.get("name"),
          email: form.get("email"),
          password: form.get("password"),
          password_confirmation: form.get("password_confirmation"),
        },
      })
      qc.setQueryData(meKey, res.data)
      const next = safeNext(params.get("next"))
      const query = new URLSearchParams({ sent: res.email_sent ? "1" : "0", ...(next ? { next } : {}) })
      router.replace(`/verify-email?${query}`)
    } catch (error) {
      capture(error)
      setPending(false)
    }
  }

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Create your account</h1>
        <p className="text-sm text-muted-foreground">Start a workspace for your team, or join one you were invited to.</p>
      </div>
      <form onSubmit={onSubmit} noValidate>
        <FieldGroup>
          <FormAlert message={formError} />
          <TextField id="name" label="Full name" autoComplete="name" required error={errors.name} />
          <TextField id="email" label="Work email" type="email" autoComplete="email" required error={errors.email} defaultValue={params.get("email") ?? ""} />
          <TextField id="password" label="Password" type="password" autoComplete="new-password" required error={errors.password} description="At least 8 characters." />
          <TextField id="password_confirmation" label="Confirm password" type="password" autoComplete="new-password" required />
          <Button type="submit" size="lg" disabled={pending} className="w-full">
            {pending ? <Spinner /> : null}
            Create account
          </Button>
        </FieldGroup>
      </form>
      <p className="text-center text-sm text-muted-foreground">
        Already have an account?{" "}
        <Link href="/login" className="text-primary underline-offset-4 hover:underline">
          Sign in
        </Link>
      </p>
    </div>
  )
}
