"use client"

import { useQuery, useQueryClient } from "@tanstack/react-query"
import { Building2, Check, MailPlus, Settings2 } from "lucide-react"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { useEffect, useState } from "react"
import { BrandMark, FullPageLoader } from "@/components/common"
import { FormAlert, TextField, useFormErrors } from "@/components/form"
import { InviteForm } from "@/components/invite-form"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { FieldGroup } from "@/components/ui/field"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Spinner } from "@/components/ui/spinner"
import { homeFor, meKey, useLogout, useMe } from "@/hooks/use-auth"
import { api } from "@/lib/api"
import { TIMEZONES } from "@/lib/datetime"
import type { Organization } from "@/lib/types"
import { cn } from "@/lib/utils"

type Step = "create" | "profile" | "invite"

const STEPS: { id: Step; label: string; icon: typeof Building2 }[] = [
  { id: "create", label: "Create workspace", icon: Building2 },
  { id: "profile", label: "Organisation profile", icon: Settings2 },
  { id: "invite", label: "Invite teammates", icon: MailPlus },
]

function browserTimezone() {
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone
  return TIMEZONES.includes(tz) ? tz : "Asia/Kuala_Lumpur"
}

export function OnboardingView() {
  const router = useRouter()
  const params = useSearchParams()
  const qc = useQueryClient()
  const logout = useLogout()
  const { data: me, isLoading } = useMe()
  const step = (params.get("step") as Step) || "create"
  const slug = params.get("org")

  useEffect(() => {
    if (isLoading) return
    if (!me) router.replace("/login?next=/onboarding")
    else if (!me.email_verified) router.replace("/verify-email?next=/onboarding")
  }, [me, isLoading, router])

  const org = useQuery({
    queryKey: ["org", slug],
    enabled: !!slug && step !== "create",
    queryFn: async () => (await api<{ data: Organization }>(`/api/orgs/${slug}`)).data,
  })

  if (isLoading || !me || !me.email_verified) return <FullPageLoader />

  const go = (s: Step, orgSlug?: string) => router.push(`/onboarding?step=${s}${orgSlug ? `&org=${orgSlug}` : ""}`)

  async function finish() {
    if (slug) await api(`/api/orgs/${slug}/onboarding/complete`, { method: "POST" }).catch(() => undefined)
    await qc.invalidateQueries({ queryKey: meKey })
    router.replace(`/w/${slug}`)
  }

  return (
    <div className="min-h-svh bg-muted/40">
      <header className="flex items-center justify-between p-4 md:px-8">
        <span className="flex items-center gap-2 font-semibold">
          <BrandMark /> RakanSpace
        </span>
        <div className="flex items-center gap-2">
          {me.organizations.length && step === "create" ? (
            <Button variant="ghost" asChild>
              <Link href={homeFor(me)}>Back to workspace</Link>
            </Button>
          ) : null}
          <Button variant="ghost" onClick={logout}>
            Sign out
          </Button>
        </div>
      </header>
      <main className="mx-auto max-w-2xl space-y-6 p-4 md:p-8">
        <ol className="flex flex-wrap gap-2" aria-label="Onboarding progress">
          {STEPS.map((s, i) => {
            const index = STEPS.findIndex((x) => x.id === step)
            const done = i < index
            return (
              <li
                key={s.id}
                aria-current={s.id === step ? "step" : undefined}
                className={cn(
                  "flex items-center gap-2 rounded-full border px-3 py-1 text-sm",
                  s.id === step ? "border-primary bg-primary text-primary-foreground" : done ? "border-primary/40 text-primary" : "text-muted-foreground",
                )}
              >
                {done ? <Check className="size-4" aria-hidden /> : <s.icon className="size-4" aria-hidden />}
                <span>
                  <span className="sr-only">Step {i + 1}: </span>
                  {s.label}
                </span>
              </li>
            )
          })}
        </ol>

        {step === "create" ? <CreateStep onCreated={(s) => go("profile", s)} /> : null}
        {step === "profile" && org.data ? <ProfileStep org={org.data} onNext={() => go("invite", slug!)} /> : null}
        {step === "invite" && org.data ? (
          <Card>
            <CardHeader>
              <CardTitle>Invite your teammates</CardTitle>
              <CardDescription>They will receive an email invitation that expires in 7 days.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <InviteForm slug={org.data.slug} roles={org.data.permissions.assignable_roles} />
              <div className="flex justify-end gap-2 border-t pt-4">
                <Button variant="ghost" onClick={finish}>
                  Skip for now
                </Button>
                <Button onClick={finish}>Open workspace</Button>
              </div>
            </CardContent>
          </Card>
        ) : null}
        {step !== "create" && org.isLoading ? <FullPageLoader /> : null}
      </main>
    </div>
  )
}

function CreateStep({ onCreated }: { onCreated: (slug: string) => void }) {
  const qc = useQueryClient()
  const { errors, formError, capture, reset } = useFormErrors()
  const [pending, setPending] = useState(false)
  const [timezone, setTimezone] = useState(browserTimezone)

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    reset()
    setPending(true)
    try {
      const { data } = await api<{ data: Organization }>("/api/orgs", {
        method: "POST",
        body: { name: new FormData(e.currentTarget).get("name"), timezone },
      })
      await qc.invalidateQueries({ queryKey: meKey })
      onCreated(data.slug)
    } catch (error) {
      capture(error)
      setPending(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Create your workspace</CardTitle>
        <CardDescription>A workspace holds your organisation&apos;s members, channels, projects and files. Joining an existing one? Open the invitation link from your email.</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} noValidate>
          <FieldGroup>
            <FormAlert message={formError} />
            <TextField id="name" label="Organisation name" placeholder="e.g. Syarikat Maju Sdn Bhd" required error={errors.name} />
            <div className="space-y-2">
              <Label htmlFor="timezone">Time zone</Label>
              <Select value={timezone} onValueChange={setTimezone}>
                <SelectTrigger id="timezone" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TIMEZONES.map((tz) => (
                    <SelectItem key={tz} value={tz}>
                      {tz.replace("_", " ")}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button type="submit" disabled={pending}>
              {pending ? <Spinner /> : null}
              Create workspace
            </Button>
          </FieldGroup>
        </form>
      </CardContent>
    </Card>
  )
}

function ProfileStep({ org, onNext }: { org: Organization; onNext: () => void }) {
  const { errors, formError, capture, reset } = useFormErrors()
  const [pending, setPending] = useState(false)

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    reset()
    setPending(true)
    const form = new FormData(e.currentTarget)
    try {
      await api(`/api/orgs/${org.slug}`, {
        method: "PATCH",
        body: { description: form.get("description") || null, industry: form.get("industry") || null, website: form.get("website") || null },
      })
      const logo = form.get("logo") as File | null
      if (logo && logo.size) {
        const body = new FormData()
        body.append("logo", logo)
        await api(`/api/orgs/${org.slug}/logo`, { method: "POST", body })
      }
      onNext()
    } catch (error) {
      capture(error)
      setPending(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Tell us about {org.name}</CardTitle>
        <CardDescription>This helps teammates recognise the workspace. You can change it later in Settings.</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} noValidate>
          <FieldGroup>
            <FormAlert message={formError} />
            <TextField id="description" label="Description" textarea rows={3} defaultValue={org.description ?? ""} error={errors.description} />
            <TextField id="industry" label="Industry" defaultValue={org.industry ?? ""} error={errors.industry} />
            <TextField id="website" label="Website" type="url" placeholder="https://" defaultValue={org.website ?? ""} error={errors.website} />
            <TextField id="logo" label="Logo" type="file" accept="image/png,image/jpeg,image/webp" error={errors.logo} description="PNG, JPG or WebP up to 2 MB." />
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={onNext}>
                Skip for now
              </Button>
              <Button type="submit" disabled={pending}>
                {pending ? <Spinner /> : null}
                Continue
              </Button>
            </div>
          </FieldGroup>
        </form>
      </CardContent>
    </Card>
  )
}
