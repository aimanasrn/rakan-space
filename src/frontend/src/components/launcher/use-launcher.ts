"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { orgPath } from "@/components/workspace/workspace-context"
import { keys } from "@/hooks/use-workspace-data"
import { api, errorMessage } from "@/lib/api"
import { t } from "@/lib/i18n"
import type { InstalledApp, LauncherData } from "@/lib/types"

export function useLauncher(slug: string, enabled = true) {
  return useQuery({
    queryKey: keys.launcher(slug),
    queryFn: async () => (await api<{ data: LauncherData }>(orgPath(slug, "/launcher"))).data,
    staleTime: 60_000,
    enabled,
  })
}

/** Pin toggle with an optimistic update that rolls back if the server refuses. */
export function usePinApp(slug: string) {
  const qc = useQueryClient()
  const key = keys.launcher(slug)

  return useMutation({
    mutationFn: ({ app, pinned }: { app: InstalledApp; pinned: boolean }) =>
      api(orgPath(slug, `/user-apps/${app.key}/pin`), { method: "PATCH", body: { pinned } }),
    onMutate: async ({ app, pinned }) => {
      await qc.cancelQueries({ queryKey: key })
      const previous = qc.getQueryData<LauncherData>(key)
      qc.setQueryData<LauncherData>(key, (data) =>
        data ? { ...data, installed: data.installed.map((a) => (a.key === app.key ? { ...a, pinned } : a)) } : data,
      )
      return { previous }
    },
    onError: (_error, _vars, context) => {
      if (context?.previous) qc.setQueryData(key, context.previous)
      toast.error(t("launcher.pinFailed"))
    },
    onSuccess: (_data, { app, pinned }) => {
      toast.success(t(pinned ? "launcher.pinned" : "launcher.unpinned", { name: app.name }))
    },
    onSettled: () => qc.invalidateQueries({ queryKey: key }),
  })
}

export function useInstallApp(slug: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (app: { key: string; name: string }) => api(orgPath(slug, `/user-apps/${app.key}/install`), { method: "POST" }),
    onSuccess: (_d, app) => {
      toast.success(t("launcher.installed_toast", { name: app.name }))
      qc.invalidateQueries({ queryKey: keys.launcher(slug) })
      qc.invalidateQueries({ queryKey: keys.adminApps(slug) })
      qc.invalidateQueries({ queryKey: ["app-requests", slug] })
    },
    onError: (e) => toast.error(errorMessage(e)),
  })
}

export function useRequestAccess(slug: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ key, note }: { key: string; note?: string }) =>
      api(orgPath(slug, `/user-apps/${key}/request-access`), { method: "POST", body: { note: note || null } }),
    onSuccess: () => {
      toast.success(t("launcher.requestSent"))
      qc.invalidateQueries({ queryKey: keys.launcher(slug) })
    },
    onError: (e) => toast.error(errorMessage(e)),
  })
}
