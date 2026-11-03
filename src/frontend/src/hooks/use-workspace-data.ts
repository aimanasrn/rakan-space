"use client"

import { useQuery } from "@tanstack/react-query"
import { orgPath } from "@/components/workspace/workspace-context"
import { api } from "@/lib/api"
import type { Conversation, Department, Membership, Paginated } from "@/lib/types"

export const keys = {
  org: (slug: string) => ["org", slug] as const,
  conversations: (slug: string) => ["conversations", slug] as const,
  conversation: (slug: string, id: number) => ["conversation", slug, id] as const,
  notifications: (slug: string) => ["notifications", slug] as const,
  unread: (slug: string) => ["notifications-count", slug] as const,
  members: (slug: string, params?: object) => ["members", slug, params ?? {}] as const,
  departments: (slug: string) => ["departments", slug] as const,
  projects: (slug: string, params?: object) => ["projects", slug, params ?? {}] as const,
  project: (slug: string, id: number) => ["project", slug, id] as const,
  tasks: (slug: string, params?: object) => ["tasks", slug, params ?? {}] as const,
  task: (slug: string, id: number) => ["task", slug, id] as const,
}

export function useConversations(slug: string) {
  return useQuery({
    queryKey: keys.conversations(slug),
    queryFn: async () => (await api<{ data: Conversation[] }>(orgPath(slug, "/conversations"))).data,
    refetchInterval: 120_000,
  })
}

/** Active members for pickers (assignees, participants, channel members). */
export function useMemberOptions(slug: string) {
  return useQuery({
    queryKey: keys.members(slug, { options: true }),
    queryFn: async () => (await api<Paginated<Membership>>(orgPath(slug, "/members"), { query: { per_page: 200 } })).data,
    staleTime: 120_000,
  })
}

export function useDepartments(slug: string) {
  return useQuery({
    queryKey: keys.departments(slug),
    queryFn: async () => (await api<{ data: Department[] }>(orgPath(slug, "/departments"))).data,
    staleTime: 120_000,
  })
}

export function useUnreadNotifications(slug: string) {
  return useQuery({
    queryKey: keys.unread(slug),
    queryFn: async () => (await api<{ data: { unread_count: number } }>(orgPath(slug, "/notifications/unread-count"))).data.unread_count,
    refetchInterval: 120_000,
  })
}
