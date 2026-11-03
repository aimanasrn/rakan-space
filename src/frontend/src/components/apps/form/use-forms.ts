"use client"

import { keepPreviousData, useQuery } from "@tanstack/react-query"
import { orgPath } from "@/components/workspace/workspace-context"
import { keys } from "@/hooks/use-workspace-data"
import { api } from "@/lib/api"
import type { AppAbility, FormDetail, FormSubmissionDetail, FormSubmissionSummary, FormSummary, InstalledApp, Paginated } from "@/lib/types"

export const formKeys = {
  all: (slug: string) => ["forms", slug] as const,
  list: (slug: string, params: object) => ["forms", slug, "list", params] as const,
  form: (slug: string, id: number) => ["forms", slug, "form", id] as const,
  versions: (slug: string, id: number) => ["forms", slug, "versions", id] as const,
  submissions: (slug: string, params: object) => ["forms", slug, "submissions", params] as const,
  submission: (slug: string, id: number) => ["forms", slug, "submission", id] as const,
}

/** The member's abilities in an app (from the launcher API); [] while loading or without access. */
export function useAppAbilities(slug: string, appKey: string) {
  const query = useQuery({
    queryKey: keys.app(slug, appKey),
    queryFn: async () => (await api<{ data: Omit<InstalledApp, "pinned"> }>(orgPath(slug, `/apps/${appKey}`))).data,
    retry: false,
    staleTime: 60_000,
  })
  const abilities: AppAbility[] = query.data?.abilities ?? []
  return { ...query, abilities, can: (a: AppAbility) => abilities.includes(a) }
}

export function useForms(slug: string, params: { mode: "fill" | "manage"; q?: string; status?: string; page?: number }) {
  return useQuery({
    queryKey: formKeys.list(slug, params),
    queryFn: () => api<Paginated<FormSummary>>(orgPath(slug, "/forms"), { query: { ...params, per_page: 20 } }),
    placeholderData: keepPreviousData,
  })
}

export function useForm(slug: string, id: number) {
  return useQuery({
    queryKey: formKeys.form(slug, id),
    queryFn: async () => (await api<{ data: FormDetail }>(orgPath(slug, `/forms/${id}`))).data,
    enabled: Number.isFinite(id),
    retry: false,
  })
}

export function useSubmissions(slug: string, params: { formId?: number; scope?: "mine" | "all"; status?: string; q?: string; page?: number }) {
  const { formId, ...rest } = params
  return useQuery({
    queryKey: formKeys.submissions(slug, params),
    queryFn: () =>
      api<Paginated<FormSubmissionSummary>>(orgPath(slug, formId ? `/forms/${formId}/submissions` : "/form-submissions"), {
        query: { ...rest, per_page: 20 },
      }),
    placeholderData: keepPreviousData,
  })
}

export function useSubmission(slug: string, id: number) {
  return useQuery({
    queryKey: formKeys.submission(slug, id),
    queryFn: async () => (await api<{ data: FormSubmissionDetail }>(orgPath(slug, `/form-submissions/${id}`))).data,
    enabled: Number.isFinite(id),
    retry: false,
  })
}
