"use client"

import { useQuery } from "@tanstack/react-query"
import { ArrowLeft, Hammer, SearchX } from "lucide-react"
import Link from "next/link"
import { useParams } from "next/navigation"
import { EmptyState, ErrorState, PageSkeleton } from "@/components/common"
import { AppIcon } from "@/components/launcher/app-icon"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { orgPath, useWorkspace } from "@/components/workspace/workspace-context"
import { keys } from "@/hooks/use-workspace-data"
import { api, ApiError } from "@/lib/api"
import type { AppAbility, InstalledApp } from "@/lib/types"

/** Which build phase delivers each module (shown until the module exists). */
const PHASE: Record<string, number> = { form: 2, approval: 2, timesheet: 3, helpdesk: 4, opportunity: 5, lms: 6, checkin: 7, videcard: 7 }

/**
 * Home page of a launcher app. The server returns 404 unless the app is installed
 * and the member's role can view it.
 */
export function AppHomeView() {
  const { app: key } = useParams<{ app: string }>()
  const { slug, href } = useWorkspace()
  const app = useQuery({
    queryKey: keys.app(slug, key),
    queryFn: async () => (await api<{ data: Omit<InstalledApp, "pinned"> }>(orgPath(slug, `/apps/${encodeURIComponent(key)}`))).data,
    retry: (count, error) => !(error instanceof ApiError && error.status === 404) && count < 2,
  })

  if (app.isPending) return <PageSkeleton />

  if (app.error) {
    const notFound = app.error instanceof ApiError && app.error.status === 404
    return (
      <div className="mx-auto max-w-3xl p-4 md:p-8">
        {notFound ? (
          <EmptyState
            icon={SearchX}
            title="App not available"
            description="It isn't installed in this workspace, or your role doesn't have access."
            action={
              <Button asChild variant="outline">
                <Link href={href()}>Back to overview</Link>
              </Button>
            }
          />
        ) : (
          <ErrorState error={app.error} onRetry={() => app.refetch()} />
        )}
      </div>
    )
  }

  const data = app.data
  return (
    <div className="mx-auto max-w-4xl space-y-6 p-4 md:p-8">
      <Button asChild variant="ghost" size="sm" className="-ml-2">
        <Link href={href()}>
          <ArrowLeft aria-hidden /> Overview
        </Link>
      </Button>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
        <AppIcon app={data} />
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight">{data.name}</h1>
          <p className="text-sm text-muted-foreground">{data.tagline}</p>
        </div>
      </div>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Hammer className="size-4" aria-hidden /> Coming soon
          </CardTitle>
          <CardDescription>
            {data.description}
            {PHASE[data.key] ? ` This module is planned for phase ${PHASE[data.key]}.` : null}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p className="mb-2 text-sm font-medium">Your access</p>
          <ul className="flex flex-wrap gap-1.5" aria-label="Your abilities in this app">
            {data.abilities.map((a: AppAbility) => (
              <li key={a}>
                <Badge variant="secondary" className="capitalize">
                  {a}
                </Badge>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </div>
  )
}
