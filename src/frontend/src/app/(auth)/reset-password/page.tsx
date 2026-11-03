"use client"

import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { useState } from "react"
import { toast } from "sonner"
import { FormAlert, TextField, useFormErrors } from "@/components/form"
import { Button } from "@/components/ui/button"
import { FieldGroup } from "@/components/ui/field"
import { Spinner } from "@/components/ui/spinner"
import { api } from "@/lib/api"

export default function ResetPasswordPage() {
  const params = useSearchParams()
  const router = useRouter()
  const { errors, formError, capture, reset } = useFormErrors()
  const [pending, setPending] = useState(false)
  const token = params.get("token")
  const email = params.get("email") ?? ""

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    reset()
    setPending(true)
    const form = new FormData(e.currentTarget)
    try {
      await api("/api/auth/reset-password", {
        method: "POST",
        body: { token, email: form.get("email"), password: form.get("password"), password_confirmation: form.get("password_confirmation") },
      })
      toast.success("Password updated. You can sign in now.")
      router.replace(`/login?email=${encodeURIComponent(String(form.get("email")))}`)
    } catch (error) {
      capture(error)
      setPending(false)
    }
  }

  if (!token) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-semibold">Invalid reset link</h1>
        <p className="text-sm text-muted-foreground">This link is incomplete. Request a new one.</p>
        <Button asChild>
          <Link href="/forgot-password">Request a new link</Link>
        </Button>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">Choose a new password</h1>
      <form onSubmit={onSubmit} noValidate>
        <FieldGroup>
          <FormAlert message={formError} />
          <TextField id="email" label="Email" type="email" defaultValue={email} required error={errors.email} />
          <TextField id="password" label="New password" type="password" autoComplete="new-password" required error={errors.password} />
          <TextField id="password_confirmation" label="Confirm new password" type="password" autoComplete="new-password" required />
          <Button type="submit" size="lg" disabled={pending} className="w-full">
            {pending ? <Spinner /> : null}
            Update password
          </Button>
        </FieldGroup>
      </form>
    </div>
  )
}
