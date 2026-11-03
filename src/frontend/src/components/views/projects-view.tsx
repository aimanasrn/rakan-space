"use client"

import { useQuery } from "@tanstack/react-query"
import { Archive, FolderKanban, Lock, Plus, Users } from "lucide-react"
import Link from "next/link"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { useState } from "react"
import { EmptyState, ErrorState, LoadingRows, PageHeader, ProjectStatusBadge, UserAvatar } from "@/components/common"
import { ProjectFormDialog } from "@/components/projects/project-form-dialog"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Progress } from "@/components/ui/progress"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { orgPath, useWorkspace } from "@/components/workspace/workspace-context"
import { keys } from "@/hooks/use-workspace-data"
import { api } from "@/lib/api"
import { formatDateKey } from "@/lib/datetime"
import { t } from "@/lib/i18n"
import type { Paginated, Project } from "@/lib/types"

export function ProjectsView() {
  const { slug, org, href } = useWorkspace()
  const params = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()
  const [q, setQ] = useState("")
  const [status, setStatus] = useState("all")
  const [archived, setArchived] = useState(false)
  const [mine, setMine] = useState(false)
  const [page, setPage] = useState(1)
  const creating = params.get("new") === "1"
  const setCreating = (open: boolean) => router.replace(open ? `${pathname}?new=1` : pathname)

  const query = { q: q || undefined, status: status === "all" ? undefined : status, archived: archived ? 1 : 0, mine: mine ? 1 : 0, page }
  const projects = useQuery({
    queryKey: keys.projects(slug, query),
    queryFn: () => api<Paginated<Project>>(orgPath(slug, "/projects"), { query }),
    placeholderData: (prev) => prev,
  })

  return (
    <div className="space-y-6 p-4 md:p-8">
      <PageHeader
        title={t("nav.projects")}
        description="Projects you can access in this workspace."
        actions={
          org.permissions.create_projects ? (
            <Button onClick={() => setCreating(true)}>
              <Plus /> New project
            </Button>
          ) : null
        }
      />
      <div className="flex flex-wrap items-center gap-3" role="search" aria-label="Filter projects">
        <Label htmlFor="project-search" className="sr-only">
          Search projects
        </Label>
        <Input id="project-search" placeholder="Search projects…" value={q} onChange={(e) => (setQ(e.target.value), setPage(1))} className="max-w-xs" />
        <Select value={status} onValueChange={(v) => (setStatus(v), setPage(1))}>
          <SelectTrigger className="w-40" aria-label="Status">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            {(["planning", "active", "on_hold", "completed"] as const).map((s) => (
              <SelectItem key={s} value={s}>
                {t(`projectStatus.${s}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="flex items-center gap-2">
          <Switch id="mine" checked={mine} onCheckedChange={(v) => (setMine(v), setPage(1))} />
          <Label htmlFor="mine">My projects</Label>
        </div>
        <div className="flex items-center gap-2">
          <Switch id="archived" checked={archived} onCheckedChange={(v) => (setArchived(v), setPage(1))} />
          <Label htmlFor="archived">Archived</Label>
        </div>
      </div>

      {projects.error ? <ErrorState error={projects.error} onRetry={() => projects.refetch()} /> : null}
      {projects.isLoading ? (
        <LoadingRows rows={4} />
      ) : projects.data?.data.length ? (
        <>
          <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {projects.data.data.map((p) => (
              <li key={p.id}>
                <Link href={href(`/projects/${p.id}`)} className="block h-full rounded-xl focus-visible:outline-2 focus-visible:outline-ring">
                  <Card className="h-full transition-colors hover:border-primary/40">
                    <CardHeader>
                      <div className="flex items-start justify-between gap-2">
                        <CardTitle className="leading-snug">{p.name}</CardTitle>
                        <ProjectStatusBadge status={p.status} />
                      </div>
                      {p.description ? <p className="line-clamp-2 text-sm text-muted-foreground">{p.description}</p> : null}
                    </CardHeader>
                    <CardContent className="space-y-2">
                      <Progress value={p.progress?.percent ?? 0} aria-label={`${p.name} progress ${p.progress?.percent ?? 0}%`} />
                      <p className="flex justify-between text-xs text-muted-foreground">
                        <span>
                          {p.progress?.done ?? 0}/{p.progress?.total ?? 0} tasks done
                          {p.progress?.overdue ? <span className="text-destructive"> · {p.progress.overdue} overdue</span> : null}
                        </span>
                        <span>{p.progress?.percent ?? 0}%</span>
                      </p>
                    </CardContent>
                    <CardFooter className="mt-auto flex items-center gap-3 text-xs text-muted-foreground">
                      {p.manager ? (
                        <span className="flex items-center gap-1.5">
                          <UserAvatar user={p.manager} className="size-5" /> {p.manager.name}
                        </span>
                      ) : null}
                      <span className="flex items-center gap-1">
                        <Users className="size-3.5" aria-hidden /> {p.members_count}
                      </span>
                      {p.visibility === "restricted" ? <Lock className="size-3.5" aria-label="Members only" /> : null}
                      {p.archived ? <Archive className="size-3.5" aria-label="Archived" /> : null}
                      {p.target_date ? <span className="ml-auto">Target {formatDateKey(p.target_date)}</span> : null}
                    </CardFooter>
                  </Card>
                </Link>
              </li>
            ))}
          </ul>
          {projects.data.meta.last_page > 1 ? (
            <nav className="flex items-center justify-center gap-2" aria-label="Pagination">
              <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                Previous
              </Button>
              <span className="text-sm text-muted-foreground">
                Page {page} of {projects.data.meta.last_page}
              </span>
              <Button variant="outline" size="sm" disabled={page >= projects.data.meta.last_page} onClick={() => setPage((p) => p + 1)}>
                Next
              </Button>
            </nav>
          ) : null}
        </>
      ) : (
        <EmptyState
          icon={FolderKanban}
          title={q || status !== "all" || archived || mine ? "No projects match your filters" : t("empty.projects")}
          description={org.permissions.create_projects ? "Create a project to organise tasks and files." : "Projects you are added to will appear here."}
          action={
            org.permissions.create_projects ? (
              <Button onClick={() => setCreating(true)}>
                <Plus /> New project
              </Button>
            ) : undefined
          }
        />
      )}
      {org.permissions.create_projects ? <ProjectFormDialog open={creating} onOpenChange={setCreating} /> : null}
    </div>
  )
}
