"use client"

import { AlertTriangle, Loader2, type LucideIcon } from "lucide-react"
import { Fragment, type ReactNode } from "react"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { Skeleton } from "@/components/ui/skeleton"
import { errorMessage } from "@/lib/api"
import { t } from "@/lib/i18n"
import type { ProjectStatus, Role, TaskPriority, TaskStatus, UserSummary } from "@/lib/types"
import { cn } from "@/lib/utils"

export function initials(name: string | null | undefined) {
  return (name ?? "?")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join("")
}

export function UserAvatar({ user, className }: { user: Pick<UserSummary, "name" | "avatar_url"> | null | undefined; className?: string }) {
  return (
    <Avatar className={cn("size-8", className)}>
      {user?.avatar_url ? <AvatarImage src={user.avatar_url} alt="" /> : null}
      <AvatarFallback className="bg-accent text-accent-foreground text-xs font-medium">{initials(user?.name ?? "Former member")}</AvatarFallback>
    </Avatar>
  )
}

export function BrandMark({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cn("inline-flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground font-semibold", className)}
    >
      R
    </span>
  )
}

export function PageHeader({ title, description, actions }: { title: string; description?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {description ? <p className="mt-1 text-sm text-muted-foreground">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  )
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
}: {
  icon?: LucideIcon
  title: string
  description?: string
  action?: ReactNode
  className?: string
}) {
  return (
    <Empty className={cn("border border-dashed", className)}>
      <EmptyHeader>
        {Icon ? (
          <EmptyMedia variant="icon">
            <Icon />
          </EmptyMedia>
        ) : null}
        <EmptyTitle>{title}</EmptyTitle>
        {description ? <EmptyDescription>{description}</EmptyDescription> : null}
      </EmptyHeader>
      {action ? <EmptyContent>{action}</EmptyContent> : null}
    </Empty>
  )
}

export function ErrorState({ error, onRetry, className }: { error: unknown; onRetry?: () => void; className?: string }) {
  return (
    <div role="alert" className={cn("flex flex-col items-center gap-3 rounded-xl border border-destructive/30 bg-destructive/5 p-6 text-center", className)}>
      <AlertTriangle className="size-6 text-destructive" aria-hidden />
      <p className="text-sm">{errorMessage(error)}</p>
      {onRetry ? (
        <Button variant="outline" size="sm" onClick={onRetry}>
          {t("actions.retry")}
        </Button>
      ) : null}
    </div>
  )
}

export function LoadingRows({ rows = 4, className }: { rows?: number; className?: string }) {
  return (
    <div className={cn("space-y-3", className)} aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} className="h-12 w-full" />
      ))}
    </div>
  )
}

export function FullPageLoader({ label = "Loading" }: { label?: string }) {
  return (
    <div className="flex min-h-svh items-center justify-center" role="status">
      <Loader2 className="size-6 animate-spin text-primary" aria-hidden />
      <span className="sr-only">{label}</span>
    </div>
  )
}

export function PageSkeleton() {
  return (
    <div className="space-y-6 p-4 md:p-8" aria-busy="true">
      <Skeleton className="h-8 w-56" />
      <Skeleton className="h-4 w-80" />
      <LoadingRows rows={5} />
    </div>
  )
}

const statusStyles: Record<TaskStatus, string> = {
  todo: "bg-muted text-muted-foreground",
  in_progress: "bg-sky-500/15 text-sky-800 dark:text-sky-300",
  in_review: "bg-amber-500/15 text-amber-800 dark:text-amber-300",
  done: "bg-emerald-500/15 text-emerald-800 dark:text-emerald-300",
}

export function TaskStatusBadge({ status, className }: { status: TaskStatus; className?: string }) {
  return (
    <Badge variant="outline" className={cn("border-transparent", statusStyles[status], className)}>
      {t(`status.${status}`)}
    </Badge>
  )
}

const priorityStyles: Record<TaskPriority, string> = {
  low: "text-muted-foreground",
  medium: "text-sky-700 dark:text-sky-300",
  high: "text-amber-700 dark:text-amber-300",
  urgent: "text-red-700 dark:text-red-300",
}

export function PriorityBadge({ priority, className }: { priority: TaskPriority; className?: string }) {
  return (
    <Badge variant="outline" className={cn("gap-1", priorityStyles[priority], className)}>
      <span aria-hidden className="inline-block size-1.5 rounded-full bg-current" />
      {t(`priority.${priority}`)}
    </Badge>
  )
}

export function ProjectStatusBadge({ status }: { status: ProjectStatus }) {
  const styles: Record<ProjectStatus, string> = {
    planning: "bg-violet-500/15 text-violet-800 dark:text-violet-300",
    active: "bg-emerald-500/15 text-emerald-800 dark:text-emerald-300",
    on_hold: "bg-amber-500/15 text-amber-800 dark:text-amber-300",
    completed: "bg-muted text-muted-foreground",
  }
  return (
    <Badge variant="outline" className={cn("border-transparent", styles[status])}>
      {t(`projectStatus.${status}`)}
    </Badge>
  )
}

export function RoleBadge({ role }: { role: Role }) {
  return (
    <Badge variant={role === "owner" || role === "admin" ? "default" : "secondary"} className="capitalize">
      {t(`role.${role}`)}
    </Badge>
  )
}

/**
 * Renders user-generated text safely: React escapes all content; only
 * http(s) URLs become links, opened without referrer/opener.
 */
export function RichText({ text, highlight = [] }: { text: string; highlight?: string[] }) {
  const urlPattern = /(https?:\/\/[^\s<]+[^\s<.,;:!?)\]'"])/g
  const segments = text.split(urlPattern)
  const names = highlight.filter(Boolean).map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
  const mentionPattern = names.length ? new RegExp(`(@(?:${names.join("|")}))`, "g") : null

  return (
    <>
      {segments.map((segment, i) =>
        i % 2 === 1 ? (
          <a key={i} href={segment} target="_blank" rel="noopener noreferrer nofollow" className="text-primary underline underline-offset-2 break-all">
            {segment}
          </a>
        ) : mentionPattern ? (
          <Fragment key={i}>
            {segment.split(mentionPattern).map((part, j) =>
              j % 2 === 1 ? (
                <span key={j} className="rounded bg-accent px-0.5 font-medium text-accent-foreground">
                  {part}
                </span>
              ) : (
                part
              ),
            )}
          </Fragment>
        ) : (
          <Fragment key={i}>{segment}</Fragment>
        ),
      )}
    </>
  )
}
