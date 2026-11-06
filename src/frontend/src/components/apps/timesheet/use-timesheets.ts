"use client"

import { keepPreviousData, useQuery } from "@tanstack/react-query"
import { orgPath } from "@/components/workspace/workspace-context"
import { api } from "@/lib/api"
import { addDaysToKey } from "@/lib/datetime"
import type {
  Paginated,
  TimesheetDetail,
  TimesheetProjectOption,
  TimesheetReport,
  TimesheetReportGroup,
  TimesheetSettings,
  TimesheetSummary,
  TimesheetTaskOption,
} from "@/lib/types"

export const timesheetKeys = {
  all: (slug: string) => ["timesheet", slug] as const,
  week: (slug: string, week: string) => ["timesheet", slug, "week", week] as const,
  sheets: (slug: string, params: object) => ["timesheet", slug, "sheets", params] as const,
  sheet: (slug: string, id: number) => ["timesheet", slug, "sheet", id] as const,
  projects: (slug: string) => ["timesheet", slug, "projects"] as const,
  tasks: (slug: string, projectId: number) => ["timesheet", slug, "tasks", projectId] as const,
  report: (slug: string, params: object) => ["timesheet", slug, "report", params] as const,
  settings: (slug: string) => ["timesheet", slug, "settings"] as const,
}

export function useWeek(slug: string, week: string) {
  return useQuery({
    queryKey: timesheetKeys.week(slug, week),
    queryFn: async () => (await api<{ data: TimesheetDetail }>(orgPath(slug, `/timesheet/weeks/${week}`))).data,
    retry: false,
  })
}

export function useSheets(slug: string, params: { scope: "mine" | "team" | "all"; status?: string; q?: string; page?: number }) {
  return useQuery({
    queryKey: timesheetKeys.sheets(slug, params),
    queryFn: () => api<Paginated<TimesheetSummary>>(orgPath(slug, "/timesheet/sheets"), { query: { ...params, per_page: 20 } }),
    placeholderData: keepPreviousData,
  })
}

export function useSheet(slug: string, id: number) {
  return useQuery({
    queryKey: timesheetKeys.sheet(slug, id),
    queryFn: async () => (await api<{ data: TimesheetDetail }>(orgPath(slug, `/timesheet/sheets/${id}`))).data,
    enabled: Number.isFinite(id),
    retry: false,
  })
}

export function useLoggableProjects(slug: string) {
  return useQuery({
    queryKey: timesheetKeys.projects(slug),
    queryFn: async () => (await api<{ data: TimesheetProjectOption[] }>(orgPath(slug, "/timesheet/projects"))).data,
    staleTime: 60_000,
  })
}

export function useProjectTasks(slug: string, projectId: number | null) {
  return useQuery({
    queryKey: timesheetKeys.tasks(slug, projectId ?? 0),
    queryFn: async () => (await api<{ data: TimesheetTaskOption[] }>(orgPath(slug, `/timesheet/projects/${projectId}/tasks`))).data,
    enabled: projectId !== null,
    staleTime: 60_000,
  })
}

export function useTimesheetReport(
  slug: string,
  params: { from: string; to: string; group_by: TimesheetReportGroup; status: "submitted" | "approved" },
) {
  return useQuery({
    queryKey: timesheetKeys.report(slug, params),
    queryFn: async () => (await api<{ data: TimesheetReport }>(orgPath(slug, "/timesheet/report"), { query: params })).data,
    enabled: Boolean(params.from && params.to && params.from <= params.to),
    placeholderData: keepPreviousData,
  })
}

export function useTimesheetSettings(slug: string, enabled: boolean) {
  return useQuery({
    queryKey: timesheetKeys.settings(slug),
    queryFn: async () => (await api<{ data: TimesheetSettings }>(orgPath(slug, "/timesheet/settings"))).data,
    enabled,
  })
}

// ------------------------------------------------------------------ helpers

/** Monday of the week containing a YYYY-MM-DD date. */
export function mondayOf(dateKey: string): string {
  const [y, m, d] = dateKey.split("-").map(Number)
  const day = new Date(Date.UTC(y, m - 1, d)).getUTCDay() // 0 = Sunday
  return addDaysToKey(dateKey, -((day + 6) % 7))
}

export function weekDays(weekStart: string): string[] {
  return Array.from({ length: 7 }, (_, i) => addDaysToKey(weekStart, i))
}

/** 450 → "7.5", 20 → "0.33". Empty for 0. */
export function formatHours(minutes: number): string {
  if (!minutes) return ""
  return String(Math.round((minutes / 60) * 100) / 100)
}

/** 450 → "7h 30m" */
export function formatDuration(minutes: number): string {
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  if (!h) return `${m}m`
  return m ? `${h}h ${m}m` : `${h}h`
}

/**
 * Reads what someone typed in an hours cell: "7.5", "7,5", "7:30", "7h30", "45m".
 * Returns minutes, or null when it cannot be understood.
 */
export function parseHours(input: string): number | null {
  const s = input.trim().toLowerCase().replace(",", ".")
  if (s === "") return 0
  let match = s.match(/^(\d{1,2})\s*[:h]\s*(\d{1,2})\s*m?$/)
  if (match) {
    const minutes = Number(match[2])
    return minutes < 60 ? Number(match[1]) * 60 + minutes : null
  }
  match = s.match(/^(\d{1,3})\s*m$/)
  if (match) return Number(match[1])
  match = s.match(/^(\d{1,2}(?:\.\d{1,2})?|\.\d{1,2})\s*h?$/)
  if (match) return Math.round(Number(match[1]) * 60)
  return null
}
