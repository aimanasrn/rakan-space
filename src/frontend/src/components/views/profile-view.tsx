"use client"

import { useQueryClient } from "@tanstack/react-query"
import { useTheme } from "next-themes"
import { useState } from "react"
import { toast } from "sonner"
import { PageHeader, UserAvatar } from "@/components/common"
import { FormAlert, TextField, useFormErrors } from "@/components/form"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { FieldGroup } from "@/components/ui/field"
import { Label } from "@/components/ui/label"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Spinner } from "@/components/ui/spinner"
import { useWorkspace } from "@/components/workspace/workspace-context"
import { meKey } from "@/hooks/use-auth"
import { api, errorMessage } from "@/lib/api"
import type { Me } from "@/lib/types"

export function ProfileView() {
  const { me } = useWorkspace()
  const qc = useQueryClient()
  const { theme, setTheme } = useTheme()
  const profile = useFormErrors()
  const password = useFormErrors()
  const [saving, setSaving] = useState(false)
  const [savingPassword, setSavingPassword] = useState(false)
  const [uploading, setUploading] = useState(false)

  async function saveProfile(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    profile.reset()
    setSaving(true)
    const form = new FormData(e.currentTarget)
    try {
      const { data } = await api<{ data: Me }>("/api/profile", {
        method: "PUT",
        body: { name: form.get("name"), job_title: form.get("job_title") || null, phone: form.get("phone") || null },
      })
      qc.setQueryData(meKey, data)
      toast.success("Profile updated.")
    } catch (error) {
      profile.capture(error)
    } finally {
      setSaving(false)
    }
  }

  async function savePassword(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    password.reset()
    setSavingPassword(true)
    const formEl = e.currentTarget
    const form = new FormData(formEl)
    try {
      await api("/api/profile/password", {
        method: "PUT",
        body: { current_password: form.get("current_password"), password: form.get("password"), password_confirmation: form.get("password_confirmation") },
      })
      toast.success("Password changed.")
      formEl.reset()
    } catch (error) {
      password.capture(error)
    } finally {
      setSavingPassword(false)
    }
  }

  async function avatar(file: File | null) {
    setUploading(true)
    try {
      let data: Me
      if (file) {
        const body = new FormData()
        body.append("avatar", file)
        data = (await api<{ data: Me }>("/api/profile/avatar", { method: "POST", body })).data
      } else {
        data = (await api<{ data: Me }>("/api/profile/avatar", { method: "DELETE" })).data
      }
      qc.setQueryData(meKey, data)
      toast.success(file ? "Photo updated." : "Photo removed.")
    } catch (e) {
      toast.error(errorMessage(e))
    } finally {
      setUploading(false)
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6 p-4 md:p-8">
      <PageHeader title="Your profile" description="Your profile is shared across all workspaces you belong to." />
      <Card>
        <CardHeader>
          <CardTitle>Photo</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-4">
          <UserAvatar user={me} className="size-16 text-lg" />
          <div className="flex flex-wrap gap-2">
            <Label className="inline-flex">
              <span className="sr-only">Upload photo</span>
              <input type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" onChange={(e) => e.target.files?.[0] && avatar(e.target.files[0])} />
              <span className="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-lg border px-2.5 text-sm font-medium hover:bg-muted focus-within:ring-2 focus-within:ring-ring">
                {uploading ? <Spinner /> : null} Upload photo
              </span>
            </Label>
            {me.avatar_url ? (
              <Button variant="ghost" onClick={() => avatar(null)} disabled={uploading}>
                Remove
              </Button>
            ) : null}
          </div>
          <p className="w-full text-xs text-muted-foreground">PNG, JPG or WebP up to 2 MB.</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Details</CardTitle>
          <CardDescription>{me.email}</CardDescription>
        </CardHeader>
        <form onSubmit={saveProfile} noValidate>
          <CardContent>
            <FieldGroup>
              <FormAlert message={profile.formError} />
              <TextField id="name" label="Full name" required defaultValue={me.name} error={profile.errors.name} />
              <TextField id="job_title" label="Job title" defaultValue={me.job_title ?? ""} error={profile.errors.job_title} />
              <TextField id="phone" label="Phone" type="tel" defaultValue={me.phone ?? ""} error={profile.errors.phone} />
            </FieldGroup>
          </CardContent>
          <CardFooter className="mt-6 justify-end border-t">
            <Button type="submit" disabled={saving}>
              {saving ? <Spinner /> : null} Save
            </Button>
          </CardFooter>
        </form>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Change password</CardTitle>
        </CardHeader>
        <form onSubmit={savePassword} noValidate>
          <CardContent>
            <FieldGroup>
              <FormAlert message={password.formError} />
              <TextField id="current_password" label="Current password" type="password" autoComplete="current-password" error={password.errors.current_password} />
              <TextField id="password" label="New password" type="password" autoComplete="new-password" error={password.errors.password} />
              <TextField id="password_confirmation" label="Confirm new password" type="password" autoComplete="new-password" />
            </FieldGroup>
          </CardContent>
          <CardFooter className="mt-6 justify-end border-t">
            <Button type="submit" disabled={savingPassword}>
              {savingPassword ? <Spinner /> : null} Update password
            </Button>
          </CardFooter>
        </form>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Appearance</CardTitle>
        </CardHeader>
        <CardContent>
          <RadioGroup value={theme ?? "system"} onValueChange={setTheme} className="flex flex-wrap gap-6" aria-label="Theme">
            {(["light", "dark", "system"] as const).map((v) => (
              <div key={v} className="flex items-center gap-2">
                <RadioGroupItem id={`theme-${v}`} value={v} />
                <Label htmlFor={`theme-${v}`} className="font-normal capitalize">
                  {v}
                </Label>
              </div>
            ))}
          </RadioGroup>
        </CardContent>
      </Card>
    </div>
  )
}
