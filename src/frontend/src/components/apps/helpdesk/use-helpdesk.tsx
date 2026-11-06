"use client"

import { keepPreviousData, useQuery } from "@tanstack/react-query"
import { Badge } from "@/components/ui/badge"
import { orgPath } from "@/components/workspace/workspace-context"
import { api } from "@/lib/api"
import type {
  CannedResponse,
  HelpdeskSettings,
  HelpdeskSummary,
  Paginated,
  SlaTarget,
  TicketDetail,
  TicketPriority,
  TicketStatus,
  TicketSummary,
  UserSummary,
} from "@/lib/types"
import { cn } from "@/lib/utils"

export const helpdeskKeys = {
  all: (slug: string) => ["helpdesk", slug] as const,
  summary: (slug: string) => ["helpdesk", slug, "summary"] as const,
  tickets: (slug: string, params: object) => ["helpdesk", slug, "tickets", params] as const,
  ticket: (slug: string, id: number) => ["helpdesk", slug, "ticket", id] as const,
  agents: (slug: string) => ["helpdesk", slug, "agents"] as const,
  canned: (slug: string) => ["helpdesk", slug, "canned"] as const,
  settings: (slug: string) => ["helpdesk", slug, "settings"] as const,
}

export function useHelpdeskSummary(slug: string) {
  return useQuery({
    queryKey: helpdeskKeys.summary(slug),
    queryFn: async () => (await api<{ data: HelpdeskSummary }>(orgPath(slug, "/helpdesk/summary"))).data,
    retry: false,
  })
}

export type TicketScope = "mine" | "assigned" | "unassigned" | "all"

export function useTickets(
  slug: string,
  params: { scope: TicketScope; status?: string; priority?: string; category?: string; q?: string; sort?: "updated" | "due"; page?: number },
) {
  return useQuery({
    queryKey: helpdeskKeys.tickets(slug, params),
    queryFn: () => api<Paginated<TicketSummary>>(orgPath(slug, "/helpdesk/tickets"), { query: { ...params, per_page: 20 } }),
    placeholderData: keepPreviousData,
    refetchInterval: 60_000,
  })
}

export function useTicket(slug: string, id: number) {
  return useQuery({
    queryKey: helpdeskKeys.ticket(slug, id),
    queryFn: async () => (await api<{ data: TicketDetail }>(orgPath(slug, `/helpdesk/tickets/${id}`))).data,
    enabled: Number.isFinite(id),
    retry: false,
    // No live push for tickets yet: poll while the page is open.
    refetchInterval: 30_000,
  })
}

export function useAgents(slug: string, enabled: boolean) {
  return useQuery({
    queryKey: helpdeskKeys.agents(slug),
    queryFn: async () => (await api<{ data: UserSummary[] }>(orgPath(slug, "/helpdesk/agents"))).data,
    enabled,
    staleTime: 120_000,
  })
}

export function useCannedResponses(slug: string, enabled: boolean) {
  return useQuery({
    queryKey: helpdeskKeys.canned(slug),
    queryFn: async () => (await api<{ data: CannedResponse[] }>(orgPath(slug, "/helpdesk/canned-responses"))).data,
    enabled,
    staleTime: 60_000,
  })
}

export function useHelpdeskSettings(slug: string) {
  return useQuery({
    queryKey: helpdeskKeys.settings(slug),
    queryFn: async () => (await api<{ data: HelpdeskSettings }>(orgPath(slug, "/helpdesk/settings"))).data,
  })
}

// --------------------------------------------------------------- display

export const TICKET_STATUSES: { value: TicketStatus; label: string; className: string }[] = [
  { value: "open", label: "Open", className: "bg-sky-500/15 text-sky-800 dark:text-sky-300" },
  { value: "in_progress", label: "In progress", className: "bg-amber-500/15 text-amber-800 dark:text-amber-300" },
  { value: "waiting", label: "Waiting on requester", className: "bg-violet-500/15 text-violet-800 dark:text-violet-300" },
  { value: "resolved", label: "Resolved", className: "bg-emerald-500/15 text-emerald-800 dark:text-emerald-300" },
  { value: "closed", label: "Closed", className: "bg-muted text-muted-foreground" },
]

export const PRIORITIES: { value: TicketPriority; label: string; className: string }[] = [
  { value: "low", label: "Low", className: "text-muted-foreground" },
  { value: "medium", label: "Medium", className: "text-foreground" },
  { value: "high", label: "High", className: "text-orange-700 dark:text-orange-300" },
  { value: "urgent", label: "Urgent", className: "text-red-700 dark:text-red-300 font-semibold" },
]

export function TicketStatusBadge({ status, className }: { status: TicketStatus; className?: string }) {
  const s = TICKET_STATUSES.find((x) => x.value === status)!
  return <Badge className={cn("border-transparent", s.className, className)}>{s.label}</Badge>
}

export function PriorityLabel({ priority }: { priority: TicketPriority }) {
  const p = PRIORITIES.find((x) => x.value === priority)!
  return <span className={cn("text-xs", p.className)}>{p.label}</span>
}

/** Short SLA chip for lists; nothing when there is nothing to say. */
export function SlaChip({ sla, label }: { sla: SlaTarget; label: string }) {
  if (sla.state === "missed")
    return <Badge className="border-transparent bg-red-500/15 text-red-800 dark:text-red-300">{label} missed</Badge>
  if (sla.state === "due_soon")
    return <Badge className="border-transparent bg-amber-500/15 text-amber-800 dark:text-amber-300">{label} due soon</Badge>
  return null
}
