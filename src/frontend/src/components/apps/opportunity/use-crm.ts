"use client"

import { keepPreviousData, useQuery } from "@tanstack/react-query"
import { orgPath } from "@/components/workspace/workspace-context"
import { api } from "@/lib/api"
import type {
  CrmAccount,
  CrmAccountDetail,
  CrmActivity,
  CrmContact,
  CrmForecast,
  CrmOpportunity,
  CrmOpportunityDetail,
  CrmSummary,
  Paginated,
} from "@/lib/types"

export const crmKeys = {
  all: (slug: string) => ["crm", slug] as const,
  summary: (slug: string) => ["crm", slug, "summary"] as const,
  board: (slug: string, params: object) => ["crm", slug, "board", params] as const,
  deal: (slug: string, id: number) => ["crm", slug, "deal", id] as const,
  accounts: (slug: string, params: object) => ["crm", slug, "accounts", params] as const,
  account: (slug: string, id: number) => ["crm", slug, "account", id] as const,
  contacts: (slug: string, params: object) => ["crm", slug, "contacts", params] as const,
  forecast: (slug: string, params: object) => ["crm", slug, "forecast", params] as const,
  tasks: (slug: string) => ["crm", slug, "tasks"] as const,
}

export function useCrmSummary(slug: string) {
  return useQuery({
    queryKey: crmKeys.summary(slug),
    queryFn: async () => (await api<{ data: CrmSummary }>(orgPath(slug, "/crm/summary"))).data,
    retry: false,
  })
}

export function useBoard(slug: string, params: { owner: "me" | "all"; q?: string; closed?: "recent" | "all" | "none" }) {
  return useQuery({
    queryKey: crmKeys.board(slug, params),
    queryFn: async () => (await api<{ data: CrmOpportunity[] }>(orgPath(slug, "/crm/opportunities"), { query: params })).data,
    placeholderData: keepPreviousData,
  })
}

export function useDeal(slug: string, id: number) {
  return useQuery({
    queryKey: crmKeys.deal(slug, id),
    queryFn: async () => (await api<{ data: CrmOpportunityDetail }>(orgPath(slug, `/crm/opportunities/${id}`))).data,
    enabled: Number.isFinite(id),
    retry: false,
  })
}

export function useAccounts(slug: string, params: { q?: string; page?: number; per_page?: number }, enabled = true) {
  return useQuery({
    queryKey: crmKeys.accounts(slug, params),
    queryFn: () => api<Paginated<CrmAccount>>(orgPath(slug, "/crm/accounts"), { query: params }),
    placeholderData: keepPreviousData,
    enabled,
  })
}

export function useAccount(slug: string, id: number) {
  return useQuery({
    queryKey: crmKeys.account(slug, id),
    queryFn: async () => (await api<{ data: CrmAccountDetail }>(orgPath(slug, `/crm/accounts/${id}`))).data,
    enabled: Number.isFinite(id),
    retry: false,
  })
}

export function useContacts(slug: string, params: { q?: string; account_id?: number; page?: number; per_page?: number }, enabled = true) {
  return useQuery({
    queryKey: crmKeys.contacts(slug, params),
    queryFn: () => api<Paginated<CrmContact>>(orgPath(slug, "/crm/contacts"), { query: params }),
    placeholderData: keepPreviousData,
    enabled,
  })
}

export function useForecast(slug: string, params: { owner: "me" | "all"; months: number }) {
  return useQuery({
    queryKey: crmKeys.forecast(slug, params),
    queryFn: async () => (await api<{ data: CrmForecast }>(orgPath(slug, "/crm/forecast"), { query: params })).data,
    placeholderData: keepPreviousData,
  })
}

export function useMyCrmTasks(slug: string) {
  return useQuery({
    queryKey: crmKeys.tasks(slug),
    queryFn: async () => (await api<{ data: CrmActivity[] }>(orgPath(slug, "/crm/activities/my-tasks"))).data,
  })
}

const money = new Intl.NumberFormat("en-MY", { style: "currency", currency: "MYR", maximumFractionDigits: 0 })
const moneyExact = new Intl.NumberFormat("en-MY", { style: "currency", currency: "MYR", minimumFractionDigits: 2 })

/** RM 12,000 (whole ringgit) or RM 12,000.50 with exact = true. */
export function formatMoney(amount: number, exact = false): string {
  return (exact ? moneyExact : money).format(amount)
}

/** "2026-11" → "Nov 2026" */
export function formatMonth(key: string): string {
  const [y, m] = key.split("-").map(Number)
  return new Intl.DateTimeFormat("en-MY", { month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(y, m - 1, 1)))
}
