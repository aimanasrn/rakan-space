"use client"

import { keepPreviousData, useQuery } from "@tanstack/react-query"
import { orgPath } from "@/components/workspace/workspace-context"
import { api } from "@/lib/api"
import { formatDateKey } from "@/lib/datetime"
import type { LeaveCalendar, LeaveHalfDay, LeaveRequest, LeaveRequestDetail, LeaveSettings, LeaveSummary, LeaveType, Paginated } from "@/lib/types"

export const leaveKeys = {
  all: (slug: string) => ["leave", slug] as const,
  summary: (slug: string, params: object) => ["leave", slug, "summary", params] as const,
  types: (slug: string) => ["leave", slug, "types"] as const,
  requests: (slug: string, params: object) => ["leave", slug, "requests", params] as const,
  request: (slug: string, id: number) => ["leave", slug, "request", id] as const,
  calendar: (slug: string, params: object) => ["leave", slug, "calendar", params] as const,
  settings: (slug: string) => ["leave", slug, "settings"] as const,
}

export function useLeaveSummary(slug: string, params: { year?: number; user_id?: number }, enabled = true) {
  return useQuery({
    queryKey: leaveKeys.summary(slug, params),
    queryFn: async () => (await api<{ data: LeaveSummary }>(orgPath(slug, "/leave/summary"), { query: params })).data,
    placeholderData: keepPreviousData,
    enabled,
    retry: false,
  })
}

export function useLeaveTypes(slug: string) {
  return useQuery({
    queryKey: leaveKeys.types(slug),
    queryFn: async () => (await api<{ data: LeaveType[] }>(orgPath(slug, "/leave/types"))).data,
    staleTime: 60_000,
  })
}

export function useLeaveRequests(slug: string, params: { scope: "mine" | "team" | "all"; status?: string; year?: number; q?: string; page?: number }) {
  return useQuery({
    queryKey: leaveKeys.requests(slug, params),
    queryFn: () => api<Paginated<LeaveRequest>>(orgPath(slug, "/leave/requests"), { query: { ...params, per_page: 20 } }),
    placeholderData: keepPreviousData,
  })
}

export function useLeaveRequest(slug: string, id: number) {
  return useQuery({
    queryKey: leaveKeys.request(slug, id),
    queryFn: async () => (await api<{ data: LeaveRequestDetail }>(orgPath(slug, `/leave/requests/${id}`))).data,
    enabled: Number.isFinite(id),
    retry: false,
  })
}

export function useLeaveCalendar(slug: string, params: { month: string; scope: "everyone" | "team" | "mine" }) {
  return useQuery({
    queryKey: leaveKeys.calendar(slug, params),
    queryFn: async () => (await api<{ data: LeaveCalendar }>(orgPath(slug, "/leave/calendar"), { query: params })).data,
    placeholderData: keepPreviousData,
  })
}

export function useLeaveSettings(slug: string, enabled: boolean) {
  return useQuery({
    queryKey: leaveKeys.settings(slug),
    queryFn: async () => (await api<{ data: LeaveSettings }>(orgPath(slug, "/leave/settings"))).data,
    enabled,
  })
}

// ------------------------------------------------------------------ helpers

/** 1 → "1 day", 2.5 → "2.5 days" */
export function formatDays(days: number): string {
  const n = Math.round(days * 10) / 10
  return `${n} ${n === 1 ? "day" : "days"}`
}

/** "12 Nov 2026", "12 – 14 Nov 2026" or "28 Nov – 2 Dec 2026", plus "(morning)" for half days. */
export function formatLeaveDates(l: { start_date: string; end_date: string; half_day: LeaveHalfDay }): string {
  const half = l.half_day === "am" ? " (morning)" : l.half_day === "pm" ? " (afternoon)" : ""
  if (l.start_date === l.end_date) return formatDateKey(l.start_date, { day: "numeric", month: "short", year: "numeric" }) + half
  const sameMonth = l.start_date.slice(0, 7) === l.end_date.slice(0, 7)
  const sameYear = l.start_date.slice(0, 4) === l.end_date.slice(0, 4)
  const start = formatDateKey(l.start_date, sameMonth ? { day: "numeric" } : sameYear ? { day: "numeric", month: "short" } : { day: "numeric", month: "short", year: "numeric" })
  return `${start} – ${formatDateKey(l.end_date, { day: "numeric", month: "short", year: "numeric" })}`
}

/** Working days (Mon–Fri) between two YYYY-MM-DD dates, inclusive; 0.5 for a half day. Mirrors the backend. */
export function countWorkingDays(start: string, end: string, halfDay: LeaveHalfDay): number {
  if (!start || !end || end < start) return 0
  let days = 0
  const d = new Date(`${start}T00:00:00Z`)
  const last = new Date(`${end}T00:00:00Z`)
  while (d <= last) {
    const dow = d.getUTCDay()
    if (dow !== 0 && dow !== 6) days++
    d.setUTCDate(d.getUTCDate() + 1)
  }
  return halfDay !== "none" && days === 1 ? 0.5 : days
}

/** "2026-11" → "2026-12" */
export function addMonths(month: string, n: number): string {
  const [y, m] = month.split("-").map(Number)
  const d = new Date(Date.UTC(y, m - 1 + n, 1))
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`
}

/** Every date of the weeks (Monday first) covering the month, as YYYY-MM-DD. */
export function monthGrid(month: string): string[] {
  const [y, m] = month.split("-").map(Number)
  const first = new Date(Date.UTC(y, m - 1, 1))
  const start = new Date(first)
  start.setUTCDate(1 - ((first.getUTCDay() + 6) % 7))
  const lastDay = new Date(Date.UTC(y, m, 0))
  const end = new Date(lastDay)
  end.setUTCDate(lastDay.getUTCDate() + (6 - ((lastDay.getUTCDay() + 6) % 7)))
  const out: string[] = []
  for (const d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) out.push(d.toISOString().slice(0, 10))
  return out
}
