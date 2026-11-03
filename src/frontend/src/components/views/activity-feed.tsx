"use client"

import { UserAvatar } from "@/components/common"
import { t } from "@/lib/i18n"
import type { Activity, TaskStatus } from "@/lib/types"
import { timeAgo } from "@/lib/datetime"

const statusLabel = (s: unknown) => (typeof s === "string" && ["todo", "in_progress", "in_review", "done"].includes(s) ? t(`status.${s as TaskStatus}`) : String(s ?? ""))

/** Human-readable sentence for an activity record. */
export function describeActivity(a: Activity): string {
  const who = a.actor?.name ?? "Someone"
  const p = a.properties as Record<string, string | number | undefined>
  const title = p.title ? `"${p.title}"` : "a task"
  switch (a.event) {
    case "task.created":
      return `${who} created ${title}`
    case "task.status_changed":
      return `${who} moved ${title} to ${statusLabel(p.to)}`
    case "task.assigned":
      return p.to ? `${who} reassigned ${title}` : `${who} unassigned ${title}`
    case "task.updated":
      return `${who} updated the ${String(p.field ?? "details").replace("_", " ")} of ${title}`
    case "task.commented":
      return `${who} commented on ${title}`
    case "task.deleted":
      return `${who} deleted ${title}`
    case "project.created":
      return `${who} created the project ${p.name ?? ""}`
    case "project.updated":
      return `${who} updated project details`
    case "project.archived":
      return `${who} archived the project`
    case "project.unarchived":
      return `${who} restored the project`
    case "project.members_updated":
      return `${who} updated project members`
    default:
      return `${who} ${a.event.replace(".", " ").replace("_", " ")}`
  }
}

export function ActivityFeed({ items }: { items: Activity[] }) {
  if (!items.length) return <p className="py-4 text-sm text-muted-foreground">{t("empty.activity")}</p>
  return (
    <ol className="space-y-3">
      {items.map((a) => (
        <li key={a.id} className="flex gap-2.5 text-sm">
          <UserAvatar user={a.actor} className="size-6" />
          <span className="min-w-0">
            {describeActivity(a)}
            <span className="block text-xs text-muted-foreground">{timeAgo(a.created_at)}</span>
          </span>
        </li>
      ))}
    </ol>
  )
}
