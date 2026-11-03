"use client"

import { useQueryClient } from "@tanstack/react-query"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { useState } from "react"
import { FormAlert, TextField, useFormErrors } from "@/components/form"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { FieldGroup } from "@/components/ui/field"
import { Label } from "@/components/ui/label"
import { Spinner } from "@/components/ui/spinner"
import { homeFor, meKey } from "@/hooks/use-auth"
import { api, ensureCsrfCookie } from "@/lib/api"
import { safeNext } from "@/lib/nav"
import type { Me } from "@/lib/types"

export default function LoginPage() {
  const router = useRouter()
  const params = useSearchParams()
  const qc = useQueryClient()
  const { errors, formError, capture, reset } = useFormErrors()
  const [pending, setPending] = useState(false)
  const [remember, setRemember] = useState(true)

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    reset()
    setPending(true)
    const form = new FormData(e.currentTarget)
    try {
      await ensureCsrfCookie(true)
      const { data } = await api<{ data: Me }>("/api/auth/login", {
        method: "POST",
        body: { email: form.get("email"), password: form.get("password"), remember },
      })
      qc.setQueryData(meKey, data)
      router.replace(safeNext(params.get("next")) ?? homeFor(data))
    } catch (error) {
      capture(error)
      setPending(false)
    }
  }

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Welcome back</h1>
        <p className="text-sm text-muted-foreground">Sign in to your RakanSpace account.</p>
      </div>
      <form onSubmit={onSubmit} noValidate>
        <FieldGroup>
          <FormAlert message={formError} />
          <TextField id="email" label="Email" type="email" autoComplete="email" required error={errors.email} defaultValue={params.get("email") ?? ""} />
          <TextField id="password" label="Password" type="password" autoComplete="current-password" required error={errors.password} />
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Checkbox id="remember" checked={remember} onCheckedChange={(v) => setRemember(v === true)} />
              <Label htmlFor="remember" className="font-normal">
                Keep me signed in
              </Label>
            </div>
            <Link href="/forgot-password" className="text-sm text-primary underline-offset-4 hover:underline">
              Forgot password?
            </Link>
          </div>
          <Button type="submit" size="lg" disabled={pending} className="w-full">
            {pending ? <Spinner /> : null}
            Sign in
          </Button>
        </FieldGroup>
      </form>
      <p className="text-center text-sm text-muted-foreground">
        New to RakanSpace?{" "}
        <Link href={`/register${params.get("next") ? `?next=${encodeURIComponent(params.get("next")!)}` : ""}`} className="text-primary underline-offset-4 hover:underline">
          Create an account
        </Link>
      </p>
    </div>
  )
}
