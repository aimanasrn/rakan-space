"use client"

import { useMutation, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { orgPath } from "@/components/workspace/workspace-context"
import { keys } from "@/hooks/use-workspace-data"
import { api, errorMessage } from "@/lib/api"
import type { Task, TaskStatus } from "@/lib/types"

/** Invalidate everything that shows tasks after a change. */
export function useInvalidateTasks(slug: string) {
  const qc = useQueryClient()
  return () => {
    qc.invalidateQueries({ queryKey: ["tasks", slug] })
    qc.invalidateQueries({ queryKey: ["task", slug] })
    qc.invalidateQueries({ queryKey: ["projects", slug] })
    qc.invalidateQueries({ queryKey: ["project", slug] })
    qc.invalidateQueries({ queryKey: ["dashboard", slug] })
  }
}

export function useUpdateTask(slug: string) {
  const invalidate = useInvalidateTasks(slug)
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...body }: { id: number } & Partial<Pick<Task, "title" | "description" | "status" | "priority" | "due_date">> & { assignee_id?: number | null }) =>
      api<{ data: Task }>(orgPath(slug, `/tasks/${id}`), { method: "PATCH", body }),
    onSuccess: ({ data }) => qc.setQueryData(keys.task(slug, data.id), data),
    onError: (e) => toast.error(errorMessage(e)),
    onSettled: invalidate,
  })
}

export function useMoveTask(slug: string) {
  const invalidate = useInvalidateTasks(slug)
  return useMutation({
    mutationFn: ({ id, status, ordered_ids }: { id: number; status: TaskStatus; ordered_ids?: number[] }) =>
      api<{ data: Task }>(orgPath(slug, `/tasks/${id}/move`), { method: "POST", body: { status, ordered_ids } }),
    onError: (e) => toast.error(errorMessage(e)),
    onSettled: invalidate,
  })
}

export const STATUSES: TaskStatus[] = ["todo", "in_progress", "in_review", "done"]
