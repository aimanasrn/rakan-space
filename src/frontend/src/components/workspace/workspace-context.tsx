"use client"

import { createContext, useContext } from "react"
import type { Me, Organization } from "@/lib/types"

export interface WorkspaceContextValue {
  slug: string
  org: Organization
  me: Me
  /** Builds an in-workspace href, e.g. href("/projects/3"). */
  href: (path?: string) => string
}

export const WorkspaceContext = createContext<WorkspaceContextValue | null>(null)

export function useWorkspace(): WorkspaceContextValue {
  const ctx = useContext(WorkspaceContext)
  if (!ctx) throw new Error("useWorkspace must be used inside the workspace shell")
  return ctx
}

/** API path inside the current organisation: orgApi(slug, "/projects") */
export function orgPath(slug: string, path = "") {
  return `/api/orgs/${slug}${path}`
}
