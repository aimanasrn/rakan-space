"use client"

import { Pencil } from "lucide-react"
import Link from "next/link"
import { useParams } from "next/navigation"
import { LoadingRows, UserAvatar } from "@/components/common"
import { Button } from "@/components/ui/button"
import { useWorkspace } from "@/components/workspace/workspace-context"
import { formatDateKey, formatDateTime } from "@/lib/datetime"
import { LoadError, ModuleHeader, StatusBadge } from "../shared"
import { formatDuration, useSheet } from "./use-timesheets"
import { WeekEditor } from "./week-editor"

/** One timesheet, for its owner, their manager, approvers and Timesheet admins. */
export function SheetDetailView() {
  const { sheetId } = useParams<{ sheetId: string }>()
  const id = Number(sheetId)
  const { slug, href, org, me } = useWorkspace()
  const sheet = useSheet(slug, id)

  if (sheet.isPending) {
    return (
      <div className="mx-auto max-w-6xl p-4 md:p-8">
        <LoadingRows rows={6} />
      </div>
    )
  }
  if (sheet.error) {
    return (
      <div className="mx-auto max-w-6xl p-4 md:p-8">
        <LoadError error={sheet.error} onRetry={() => sheet.refetch()} what="Timesheet" />
      </div>
    )
  }

  const s = sheet.data
  const mine = s.user?.id === me.id
  return (
    <div className="mx-auto max-w-6xl space-y-6 p-4 md:p-8">
      <ModuleHeader
        app="timesheet"
        title={`Week of ${formatDateKey(s.week_start)}`}
        back={{ href: href(mine ? "/apps/timesheet?tab=history" : "/apps/timesheet?tab=team"), label: "Timesheet" }}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <StatusBadge status={s.status} />
            {s.user ? (
              <span className="flex items-center gap-1.5">
                <UserAvatar user={s.user} className="size-5" /> {s.user.name}
              </span>
            ) : null}
            <span>· {formatDuration(s.total_minutes)}</span>
            {s.submitted_at ? <span>· submitted {formatDateTime(s.submitted_at, org.timezone)}</span> : null}
          </span>
        }
        actions={
          s.permissions.edit ? (
            <Button asChild>
              <Link href={href(`/apps/timesheet?tab=week&week=${s.week_start}`)}>
                <Pencil aria-hidden /> Edit week
              </Link>
            </Button>
          ) : null
        }
      />
      {/* Read-only here; the owner edits from "My week". */}
      <WeekEditor key={`${s.id}:${s.updated_at}:${s.status}`} sheet={{ ...s, permissions: { ...s.permissions, edit: false } }} />
    </div>
  )
}
