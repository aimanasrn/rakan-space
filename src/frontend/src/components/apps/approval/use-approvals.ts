"use client"

import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { orgPath } from "@/components/workspace/workspace-context"
import { api } from "@/lib/api"
import type { ApprovalDelegation, ApprovalRequestDetail, ApprovalRequestSummary, ApprovalSummary, ApprovalWorkflow, Paginated } from "@/lib/types"

export const approvalKeys = {
  all: (slug: string) => ["approval", slug] as const,
  summary: (slug: string) => ["approval", slug, "summary"] as const,
  list: (slug: string, params: object) => ["approval", slug, "requests", params] as const,
  request: (slug: string, id: number) => ["approval", slug, "request", id] as const,
  workflows: (slug: string, params: object) => ["approval", slug, "workflows", params] as const,
  workflow: (slug: string, id: number) => ["approval", slug, "workflow", id] as const,
  workflowOptions: (slug: string) => ["approval", slug, "workflow-options"] as const,
  delegations: (slug: string, scope: string) => ["approval", slug, "delegations", scope] as const,
}

export interface RequestListParams {
  box: "inbox" | "mine" | "decided" | "all"
  status?: string
  q?: string
  page?: number
}

export function useApprovalSummary(slug: string) {
  return useQuery({
    queryKey: approvalKeys.summary(slug),
    queryFn: async () => (await api<{ data: ApprovalSummary }>(orgPath(slug, "/approval/summary"))).data,
    refetchInterval: 60_000,
  })
}

export function useApprovalRequests(slug: string, params: RequestListParams) {
  return useQuery({
    queryKey: approvalKeys.list(slug, params),
    queryFn: () => api<Paginated<ApprovalRequestSummary>>(orgPath(slug, "/approval/requests"), { query: { ...params, per_page: 20 } }),
    placeholderData: keepPreviousData,
  })
}

export function useApprovalRequest(slug: string, id: number) {
  return useQuery({
    queryKey: approvalKeys.request(slug, id),
    queryFn: async () => (await api<{ data: ApprovalRequestDetail }>(orgPath(slug, `/approval/requests/${id}`))).data,
    enabled: Number.isFinite(id),
  })
}

/** Approve / reject / return, resubmit or withdraw. Refreshes every approval list afterwards. */
export function useApprovalAction(slug: string, id: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ action, body }: { action: "decide" | "resubmit" | "cancel"; body?: object }) =>
      (await api<{ data: ApprovalRequestDetail }>(orgPath(slug, `/approval/requests/${id}/${action}`), { method: "POST", body: body ?? {} })).data,
    onSuccess: (data) => {
      qc.setQueryData(approvalKeys.request(slug, id), data)
      qc.invalidateQueries({ queryKey: approvalKeys.all(slug) })
      // Linked items (e.g. a form response) change status too.
      qc.invalidateQueries({ queryKey: ["forms", slug] })
    },
  })
}

export function useWorkflowOptions(slug: string, enabled = true) {
  return useQuery({
    queryKey: approvalKeys.workflowOptions(slug),
    queryFn: async () => (await api<{ data: ApprovalWorkflow[] }>(orgPath(slug, "/approval/workflows"), { query: { options: 1 } })).data,
    enabled,
    staleTime: 60_000,
  })
}

export function useWorkflows(slug: string, params: { q?: string; status?: string; page?: number }) {
  return useQuery({
    queryKey: approvalKeys.workflows(slug, params),
    queryFn: () => api<Paginated<ApprovalWorkflow>>(orgPath(slug, "/approval/workflows"), { query: { ...params, per_page: 20 } }),
    placeholderData: keepPreviousData,
  })
}

export function useWorkflow(slug: string, id: number | null) {
  return useQuery({
    queryKey: approvalKeys.workflow(slug, id ?? 0),
    queryFn: async () => (await api<{ data: ApprovalWorkflow }>(orgPath(slug, `/approval/workflows/${id}`))).data,
    enabled: id !== null && Number.isFinite(id),
  })
}

export function useDelegations(slug: string, scope: "mine" | "to_me") {
  return useQuery({
    queryKey: approvalKeys.delegations(slug, scope),
    queryFn: async () => (await api<{ data: ApprovalDelegation[] }>(orgPath(slug, "/approval/delegations"), { query: { scope } })).data,
  })
}
