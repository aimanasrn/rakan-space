"use client"

import Link from "next/link"
import { useState } from "react"
import { FormAlert, TextField, useFormErrors } from "@/components/form"
import { Button } from "@/components/ui/button"
import { FieldGroup } from "@/components/ui/field"
import { Spinner } from "@/components/ui/spinner"
import { api } from "@/lib/api"

export default function ForgotPasswordPage() {
  const { errors, formError, capture, reset } = useFormErrors()
  const [pending, setPending] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    reset()
    setPending(true)
    try {
      const res = await api<{ message: string }>("/api/auth/forgot-password", {
        method: "POST",
        body: { email: new FormData(e.currentTarget).get("email") },
      })
      setMessage(res.message)
    } catch (error) {
      capture(error)
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Reset your password</h1>
        <p className="text-sm text-muted-foreground">Enter your email and we will send you a reset link.</p>
      </div>
      {message ? (
        <div role="status" className="rounded-lg border border-primary/30 bg-accent px-4 py-3 text-sm text-accent-foreground">
          {message}
        </div>
      ) : (
        <form onSubmit={onSubmit} noValidate>
          <FieldGroup>
            <FormAlert message={formError} />
            <TextField id="email" label="Email" type="email" autoComplete="email" required error={errors.email} />
            <Button type="submit" size="lg" disabled={pending} className="w-full">
              {pending ? <Spinner /> : null}
              Send reset link
            </Button>
          </FieldGroup>
        </form>
      )}
      <p className="text-center text-sm">
        <Link href="/login" className="text-primary underline-offset-4 hover:underline">
          Back to sign in
        </Link>
      </p>
    </div>
  )
}
