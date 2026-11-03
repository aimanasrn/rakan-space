"use client"

import { useQuery } from "@tanstack/react-query"
import { ListChecks } from "lucide-react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { useState } from "react"
import { EmptyState, ErrorState, LoadingRows, PageHeader } from "@/components/common"
import { TaskSheet } from "@/components/tasks/task-sheet"
import { defaultFilters, filtersToQuery, TaskFilters, TaskTable, type TaskFilterState } from "@/components/tasks/task-views"
import { Button } from "@/components/ui/button"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { orgPath, useWorkspace } from "@/components/workspace/workspace-context"
import { keys } from "@/hooks/use-workspace-data"
import { api } from "@/lib/api"
import { t } from "@/lib/i18n"
import type { Paginated, Task } from "@/lib/types"

/** All tasks assigned to me across accessible projects in this workspace. */
export function MyTasksView() {
  const { slug } = useWorkspace()
  const params = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()
  const [scope, setScope] = useState<"open" | "done" | "all">("open")
  const [filters, setFilters] = useState<TaskFilterState>({ ...defaultFilters, due: params.get("due") ?? "all" })
  const [page, setPage] = useState(1)
  const openTaskId = params.get("task") ? Number(params.get("task")) : null

  const status = scope === "open" ? "todo,in_progress,in_review" : scope === "done" ? "done" : undefined
  const query = { ...filtersToQuery(filters), assignee: "me", status, page, per_page: 50 }
  const tasks = useQuery({
    queryKey: keys.tasks(slug, query),
    queryFn: () => api<Paginated<Task>>(orgPath(slug, "/tasks"), { query }),
    placeholderData: (prev) => prev,
  })

  return (
    <div className="space-y-6 p-4 md:p-8">
      <PageHeader title={t("nav.myTasks")} description="Tasks assigned to you across every project you can access." />
      <div className="flex flex-col gap-3">
        <Tabs value={scope} onValueChange={(v) => (setScope(v as typeof scope), setPage(1))}>
          <TabsList>
            <TabsTrigger value="open">Open</TabsTrigger>
            <TabsTrigger value="done">Completed</TabsTrigger>
            <TabsTrigger value="all">All</TabsTrigger>
          </TabsList>
        </Tabs>
        <TaskFilters value={filters} onChange={(f) => (setFilters(f), setPage(1))} hideStatus />
      </div>
      {tasks.error ? <ErrorState error={tasks.error} onRetry={() => tasks.refetch()} /> : null}
      {tasks.isLoading ? (
        <LoadingRows rows={5} />
      ) : tasks.data?.data.length ? (
        <>
          <TaskTable tasks={tasks.data.data} showProject onOpen={(task) => router.replace(`${pathname}?task=${task.id}`, { scroll: false })} />
          {tasks.data.meta.last_page > 1 ? (
            <nav className="flex items-center justify-center gap-2" aria-label="Pagination">
              <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                Previous
              </Button>
              <span className="text-sm text-muted-foreground">
                Page {page} of {tasks.data.meta.last_page}
              </span>
              <Button variant="outline" size="sm" disabled={page >= tasks.data.meta.last_page} onClick={() => setPage((p) => p + 1)}>
                Next
              </Button>
            </nav>
          ) : null}
        </>
      ) : (
        <EmptyState icon={ListChecks} title={scope === "open" ? t("empty.myTasks") : t("empty.tasks")} />
      )}
      <TaskSheet taskId={openTaskId} onClose={() => router.replace(pathname, { scroll: false })} />
    </div>
  )
}
