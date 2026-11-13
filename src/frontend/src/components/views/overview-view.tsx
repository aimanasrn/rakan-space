"use client"

import { useQuery } from "@tanstack/react-query"
import { ArrowRight, Bell, CalendarDays, CalendarPlus, FolderKanban, ListChecks, Megaphone, MessageSquarePlus, Pin, Plus, Video } from "lucide-react"
import Link from "next/link"
import { EmptyState, ErrorState, PageHeader, PriorityBadge, TaskStatusBadge, UserAvatar } from "@/components/common"
import { describeActivity } from "@/components/views/activity-feed"
import { IdBadge } from "@/components/views/id-badge"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Progress } from "@/components/ui/progress"
import { Skeleton } from "@/components/ui/skeleton"
import { orgPath, useWorkspace } from "@/components/workspace/workspace-context"
import { api } from "@/lib/api"
import { daysUntil, formatDateTime, formatTime, relativeDue, timeAgo, zonedParts } from "@/lib/datetime"
import { t } from "@/lib/i18n"
import type { Activity, Project, Task, UserSummary } from "@/lib/types"
import { cn } from "@/lib/utils"

interface Dashboard {
  today: string
  timezone: string
  my_tasks: Task[]
  my_open_tasks_count: number
  overdue_count: number
  deadlines: Task[]
  events: { id: number; title: string; starts_at: string; ends_at: string; location: string | null; meeting_url: string | null }[]
  projects: Project[]
  announcements: { id: number; title: string; excerpt: string; pinned: boolean; requires_acknowledgement: boolean; acknowledged: boolean; author: UserSummary | null; created_at: string }[]
  notifications: { id: string; title: string; body: string | null; link: string | null; created_at: string }[]
  unread_notifications_count: number
  activity: Activity[]
}

export function OverviewView() {
  const { slug, org, me, href } = useWorkspace()
  const dash = useQuery({
    queryKey: ["dashboard", slug],
    queryFn: async () => (await api<{ data: Dashboard }>(orgPath(slug, "/dashboard"))).data,
    refetchInterval: 60_000,
  })
  const tz = org.timezone
  const hour = Number(zonedParts(new Date(), tz).time.slice(0, 2))
  const greeting = hour < 12 ? "Selamat pagi" : hour < 18 ? "Selamat petang" : "Selamat malam"

  return (
    <div className="space-y-6 p-4 md:p-8">
      <PageHeader
        title={`${greeting}, ${me.name.split(" ")[0]}`}
        description={`Here's what's happening at ${org.name} today.`}
        actions={
          <>
            {org.permissions.create_projects ? (
              <Button asChild size="sm">
                <Link href={href("/projects?new=1")}>
                  <Plus /> New project
                </Link>
              </Button>
            ) : null}
            <Button asChild size="sm" variant="outline">
              <Link href={href("/chat")}>
                <MessageSquarePlus /> Message
              </Link>
            </Button>
            <Button asChild size="sm" variant="outline">
              <Link href={href("/calendar?new=1")}>
                <CalendarPlus /> Event
              </Link>
            </Button>
          </>
        }
      />

      {dash.error ? <ErrorState error={dash.error} onRetry={() => dash.refetch()} /> : null}

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="grid gap-4 sm:grid-cols-2 lg:col-span-2">
          <StatCard label="My open tasks" value={dash.data?.my_open_tasks_count} icon={ListChecks} link={href("/tasks")} />
          <StatCard label="Overdue" value={dash.data?.overdue_count} icon={CalendarDays} link={href("/tasks?due=overdue")} tone={dash.data?.overdue_count ? "danger" : undefined} />
          <StatCard label="Active projects" value={dash.data?.projects.length} icon={FolderKanban} link={href("/projects")} />
          <StatCard label="Unread notifications" value={dash.data?.unread_notifications_count} icon={Bell} link={href("/notifications")} />
        </div>
        <IdBadge />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>My tasks</CardTitle>
            <CardDescription>Open tasks assigned to you, soonest first.</CardDescription>
            <CardAction>
              <Button variant="ghost" size="sm" asChild>
                <Link href={href("/tasks")}>
                  {t("actions.viewAll")} <ArrowRight />
                </Link>
              </Button>
            </CardAction>
          </CardHeader>
          <CardContent>
            {dash.isLoading ? (
              <SkeletonList />
            ) : dash.data?.my_tasks.length ? (
              <ul className="divide-y">
                {dash.data.my_tasks.map((task) => (
                  <li key={task.id}>
                    <Link href={href(`/projects/${task.project_id}?task=${task.id}`)} className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md px-1 py-2.5 hover:bg-muted">
                      <span className="min-w-0 basis-full truncate font-medium sm:flex-1 sm:basis-auto">{task.title}</span>
                      <span className="text-xs text-muted-foreground">{task.project?.name}</span>
                      <TaskStatusBadge status={task.status} />
                      <PriorityBadge priority={task.priority} />
                      {task.due_date ? (
                        <span className={cn("text-xs", daysUntil(task.due_date, tz) < 0 ? "font-medium text-destructive" : "text-muted-foreground")}>
                          {relativeDue(task.due_date, tz)}
                        </span>
                      ) : null}
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState icon={ListChecks} title={t("empty.myTasks")} className="py-8" />
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Upcoming deadlines</CardTitle>
            <CardDescription>Next 14 days, tasks you own or created.</CardDescription>
          </CardHeader>
          <CardContent>
            {dash.isLoading ? (
              <SkeletonList />
            ) : dash.data?.deadlines.length ? (
              <ul className="space-y-2">
                {dash.data.deadlines.map((task) => {
                  const days = daysUntil(task.due_date!, tz)
                  return (
                    <li key={task.id}>
                      <Link href={href(`/projects/${task.project_id}?task=${task.id}`)} className="flex items-center gap-3 rounded-md p-1.5 hover:bg-muted">
                        <span
                          className={cn(
                            "flex size-10 shrink-0 flex-col items-center justify-center rounded-md border text-xs leading-none",
                            days < 0 && "border-destructive/40 bg-destructive/5 text-destructive",
                          )}
                        >
                          <span className="font-semibold">{task.due_date!.slice(8, 10)}</span>
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium">{task.title}</span>
                          <span className={cn("block text-xs", days < 0 ? "text-destructive" : "text-muted-foreground")}>{relativeDue(task.due_date!, tz)}</span>
                        </span>
                      </Link>
                    </li>
                  )
                })}
              </ul>
            ) : (
              <p className="py-6 text-center text-sm text-muted-foreground">No deadlines in the next two weeks.</p>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Active projects</CardTitle>
            <CardAction>
              <Button variant="ghost" size="sm" asChild>
                <Link href={href("/projects")}>
                  {t("actions.viewAll")} <ArrowRight />
                </Link>
              </Button>
            </CardAction>
          </CardHeader>
          <CardContent>
            {dash.isLoading ? (
              <SkeletonList />
            ) : dash.data?.projects.length ? (
              <ul className="grid gap-3 sm:grid-cols-2">
                {dash.data.projects.map((p) => (
                  <li key={p.id}>
                    <Link href={href(`/projects/${p.id}`)} className="block space-y-2 rounded-lg border p-3 transition-colors hover:border-primary/40 hover:bg-muted/50">
                      <span className="block truncate font-medium">{p.name}</span>
                      <Progress value={p.progress?.percent ?? 0} aria-label={`${p.name} progress`} />
                      <span className="flex justify-between text-xs text-muted-foreground">
                        <span>
                          {p.progress?.done}/{p.progress?.total} tasks done
                        </span>
                        <span>{p.progress?.percent}%</span>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState
                icon={FolderKanban}
                title="No active projects you can access"
                action={
                  org.permissions.create_projects ? (
                    <Button size="sm" asChild>
                      <Link href={href("/projects?new=1")}>Create a project</Link>
                    </Button>
                  ) : undefined
                }
                className="py-8"
              />
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Upcoming events</CardTitle>
            <CardAction>
              <Button variant="ghost" size="sm" asChild>
                <Link href={href("/calendar")}>
                  {t("nav.calendar")} <ArrowRight />
                </Link>
              </Button>
            </CardAction>
          </CardHeader>
          <CardContent>
            {dash.isLoading ? (
              <SkeletonList />
            ) : dash.data?.events.length ? (
              <ul className="space-y-3">
                {dash.data.events.map((e) => (
                  <li key={e.id}>
                    <Link href={href(`/calendar?event=${e.id}`)} className="block rounded-md p-1.5 hover:bg-muted">
                      <span className="block truncate text-sm font-medium">{e.title}</span>
                      <span className="flex items-center gap-1 text-xs text-muted-foreground">
                        {formatDateTime(e.starts_at, tz, { year: undefined, hour: undefined, minute: undefined, weekday: "short" })} · {formatTime(e.starts_at, tz)}
                        {e.meeting_url ? <Video className="size-3" aria-label="Online meeting" /> : null}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="py-6 text-center text-sm text-muted-foreground">{t("empty.events")}</p>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>Announcements</CardTitle>
            <CardAction>
              <Button variant="ghost" size="sm" asChild>
                <Link href={href("/announcements")}>
                  {t("actions.viewAll")} <ArrowRight />
                </Link>
              </Button>
            </CardAction>
          </CardHeader>
          <CardContent>
            {dash.isLoading ? (
              <SkeletonList />
            ) : dash.data?.announcements.length ? (
              <ul className="space-y-3">
                {dash.data.announcements.map((a) => (
                  <li key={a.id}>
                    <Link href={href(`/announcements?id=${a.id}`)} className="block space-y-1 rounded-md p-1.5 hover:bg-muted">
                      <span className="flex items-center gap-1.5 text-sm font-medium">
                        {a.pinned ? <Pin className="size-3.5 text-primary" aria-label="Pinned" /> : null}
                        <span className="truncate">{a.title}</span>
                      </span>
                      <span className="line-clamp-2 text-xs text-muted-foreground">{a.excerpt}</span>
                      {a.requires_acknowledgement && !a.acknowledged ? <Badge variant="outline">Needs acknowledgement</Badge> : null}
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState icon={Megaphone} title={t("empty.announcements")} className="py-8" />
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Unread notifications</CardTitle>
          </CardHeader>
          <CardContent>
            {dash.isLoading ? (
              <SkeletonList />
            ) : dash.data?.notifications.length ? (
              <ul className="space-y-2">
                {dash.data.notifications.map((n) => (
                  <li key={n.id}>
                    <Link href={n.link ? href(n.link) : href("/notifications")} className="block rounded-md p-1.5 hover:bg-muted">
                      <span className="block text-sm">{n.title}</span>
                      <span className="text-xs text-muted-foreground">{timeAgo(n.created_at)}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="py-6 text-center text-sm text-muted-foreground">{t("empty.notifications")}</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Recent activity</CardTitle>
          </CardHeader>
          <CardContent>
            {dash.isLoading ? (
              <SkeletonList />
            ) : dash.data?.activity.length ? (
              <ul className="space-y-3">
                {dash.data.activity.map((a) => (
                  <li key={a.id} className="flex gap-2.5 text-sm">
                    <UserAvatar user={a.actor} className="size-6" />
                    <span className="min-w-0">
                      <span>{describeActivity(a)}</span>
                      <span className="block text-xs text-muted-foreground">{timeAgo(a.created_at)}</span>
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="py-6 text-center text-sm text-muted-foreground">{t("empty.activity")}</p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

function StatCard({ label, value, icon: Icon, link, tone }: { label: string; value?: number; icon: typeof Bell; link: string; tone?: "danger" }) {
  return (
    <Link href={link} className="group h-full rounded-xl focus-visible:outline-2 focus-visible:outline-ring">
      <Card className="h-full justify-center transition-colors group-hover:border-primary/40">
        <CardContent className="flex items-center gap-4">
          <span className={cn("flex size-10 items-center justify-center rounded-lg bg-accent text-accent-foreground", tone === "danger" && "bg-destructive/10 text-destructive")}>
            <Icon className="size-5" aria-hidden />
          </span>
          <span>
            <span className="block text-2xl font-semibold tabular-nums">{value ?? <Skeleton className="h-7 w-8" />}</span>
            <span className="text-sm text-muted-foreground">{label}</span>
          </span>
        </CardContent>
      </Card>
    </Link>
  )
}

function SkeletonList() {
  return (
    <div className="space-y-2">
      {[0, 1, 2].map((i) => (
        <Skeleton key={i} className="h-10 w-full" />
      ))}
    </div>
  )
}
