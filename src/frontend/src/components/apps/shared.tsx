"use client"

import { ArrowLeft, SearchX } from "lucide-react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import type { ReactNode } from "react"
import { EmptyState, ErrorState } from "@/components/common"
import { AppIcon } from "@/components/launcher/app-icon"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { useWorkspace } from "@/components/workspace/workspace-context"
import { ApiError } from "@/lib/api"
import type { ApprovalStatus, SubmissionStatus, TimesheetStatus } from "@/lib/types"
import { cn } from "@/lib/utils"

const APP_STYLE = {
  form: { icon: "clipboard-list", gradient: ["#6366f1", "#8b5cf6"] as [string, string] },
  approval: { icon: "badge-check", gradient: ["#10b981", "#059669"] as [string, string] },
  timesheet: { icon: "clock", gradient: ["#f59e0b", "#ea580c"] as [string, string] },
  helpdesk: { icon: "life-buoy", gradient: ["#ef4444", "#db2777"] as [string, string] },
  opportunity: { icon: "trending-up", gradient: ["#14b8a6", "#0891b2"] as [string, string] },
}

/** Page header for module screens: app icon, title, optional back link and actions. */
export function ModuleHeader({
  app,
  title,
  description,
  back,
  actions,
}: {
  app: keyof typeof APP_STYLE
  title: string
  description?: ReactNode
  back?: { href: string; label: string }
  actions?: ReactNode
}) {
  return (
    <div className="space-y-3">
      {back ? (
        <Button asChild variant="ghost" size="sm" className="-ml-2">
          <Link href={back.href}>
            <ArrowLeft aria-hidden /> {back.label}
          </Link>
        </Button>
      ) : null}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-center gap-3">
          <AppIcon app={APP_STYLE[app]} size="md" />
          <div className="min-w-0">
            <h1 className="truncate text-2xl font-semibold tracking-tight">{title}</h1>
            {description ? <p className="text-sm text-muted-foreground">{description}</p> : null}
          </div>
        </div>
        {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
    </div>
  )
}

/** Sub-navigation between a module's sections. */
export function ModuleNav({ items }: { items: { href: string; label: string; badge?: number; show?: boolean }[] }) {
  const pathname = usePathname()
  return (
    <nav aria-label="Sections" className="flex gap-1 overflow-x-auto border-b">
      {items
        .filter((i) => i.show !== false)
        .map((item) => {
          const active = pathname === item.href
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "-mb-px flex items-center gap-2 border-b-2 px-3 py-2 text-sm whitespace-nowrap",
                active ? "border-primary font-medium text-foreground" : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              {item.label}
              {item.badge ? (
                <span className="rounded-full bg-primary px-1.5 text-xs text-primary-foreground" aria-label={`${item.badge} waiting`}>
                  {item.badge > 99 ? "99+" : item.badge}
                </span>
              ) : null}
            </Link>
          )
        })}
    </nav>
  )
}

const STATUS: Record<ApprovalStatus | SubmissionStatus | TimesheetStatus, { label: string; className: string }> = {
  pending: { label: "Pending", className: "bg-amber-500/15 text-amber-800 dark:text-amber-300" },
  pending_approval: { label: "Pending approval", className: "bg-amber-500/15 text-amber-800 dark:text-amber-300" },
  submitted: { label: "Submitted", className: "bg-sky-500/15 text-sky-800 dark:text-sky-300" },
  approved: { label: "Approved", className: "bg-emerald-500/15 text-emerald-800 dark:text-emerald-300" },
  rejected: { label: "Rejected", className: "bg-red-500/15 text-red-800 dark:text-red-300" },
  returned: { label: "Returned", className: "bg-violet-500/15 text-violet-800 dark:text-violet-300" },
  draft: { label: "Draft", className: "bg-muted text-muted-foreground" },
  cancelled: { label: "Withdrawn", className: "bg-muted text-muted-foreground" },
  withdrawn: { label: "Withdrawn", className: "bg-muted text-muted-foreground" },
}

export function StatusBadge({ status, className }: { status: ApprovalStatus | SubmissionStatus | TimesheetStatus; className?: string }) {
  const s = STATUS[status]
  return <Badge className={cn("border-transparent", s.className, className)}>{s.label}</Badge>
}

export function Pager({ page, lastPage, onPage }: { page: number; lastPage: number; onPage: (p: number) => void }) {
  if (lastPage <= 1) return null
  return (
    <nav className="flex items-center justify-end gap-2" aria-label="Pagination">
      <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => onPage(page - 1)}>
        Previous
      </Button>
      <span className="text-sm text-muted-foreground">
        Page {page} of {lastPage}
      </span>
      <Button variant="outline" size="sm" disabled={page >= lastPage} onClick={() => onPage(page + 1)}>
        Next
      </Button>
    </nav>
  )
}

/** 404 → friendly "not available"; anything else → error with retry. */
export function LoadError({ error, onRetry, what }: { error: unknown; onRetry: () => void; what: string }) {
  const { href } = useWorkspace()
  if (error instanceof ApiError && error.status === 404) {
    return (
      <EmptyState
        icon={SearchX}
        title={`${what} not found`}
        description="It may not exist, or you don't have access to it."
        action={
          <Button asChild variant="outline">
            <Link href={href()}>Back to overview</Link>
          </Button>
        }
      />
    )
  }
  return <ErrorState error={error} onRetry={onRetry} />
}
