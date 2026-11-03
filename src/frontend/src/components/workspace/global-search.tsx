"use client"

import { useQuery } from "@tanstack/react-query"
import { FileText, FolderKanban, Hash, ListChecks, MessageSquare, Search } from "lucide-react"
import { useRouter } from "next/navigation"
import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { Command, CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command"
import { Kbd } from "@/components/ui/kbd"
import { Spinner } from "@/components/ui/spinner"
import { api } from "@/lib/api"
import { t } from "@/lib/i18n"
import { orgPath, useWorkspace } from "./workspace-context"

export interface SearchItem {
  id: number
  title: string
  snippet?: string | null
  link: string
}
export type SearchResults = Record<"messages" | "channels" | "projects" | "tasks" | "files", { total: number; last_page: number; items: SearchItem[] }>

export const SEARCH_GROUPS = [
  { key: "messages", label: "Messages", icon: MessageSquare },
  { key: "channels", label: "Channels", icon: Hash },
  { key: "projects", label: "Projects", icon: FolderKanban },
  { key: "tasks", label: "Tasks", icon: ListChecks },
  { key: "files", label: "Files", icon: FileText },
] as const

function useDebounced<T>(value: T, delay = 250) {
  const [v, setV] = useState(value)
  useEffect(() => {
    const id = setTimeout(() => setV(value), delay)
    return () => clearTimeout(id)
  }, [value, delay])
  return v
}

export function GlobalSearch() {
  const { slug, href } = useWorkspace()
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const q = useDebounced(query.trim())

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault()
        setOpen((o) => !o)
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [])

  const results = useQuery({
    queryKey: ["search", slug, q, "quick"],
    enabled: open && q.length >= 2,
    queryFn: async () => (await api<{ data: SearchResults }>(orgPath(slug, "/search"), { query: { q } })).data,
  })

  const go = (path: string) => {
    setOpen(false)
    router.push(href(path))
  }

  const hasResults = results.data && SEARCH_GROUPS.some((g) => results.data[g.key].items.length)

  return (
    <>
      <Button
        variant="outline"
        className="h-8 w-full justify-start gap-2 px-3 font-normal text-muted-foreground sm:w-64"
        onClick={() => setOpen(true)}
        aria-label="Search workspace"
      >
        <Search />
        <span className="flex-1 text-left">Search…</span>
        <Kbd className="hidden sm:inline-flex">Ctrl K</Kbd>
      </Button>
      <CommandDialog open={open} onOpenChange={setOpen} title="Search workspace" description="Search messages, channels, projects, tasks and files">
        {/* Results are filtered by the API (permission-aware), so cmdk must not filter them again. */}
        <Command shouldFilter={q.length < 2}>
        <CommandInput placeholder="Search messages, projects, tasks, files…" value={query} onValueChange={setQuery} />
        <CommandList>
          {q.length < 2 ? (
            <CommandGroup heading="Go to">
              {(["/chat", "/projects", "/tasks", "/calendar", "/announcements", "/files", "/members"] as const).map((p) => (
                <CommandItem key={p} value={`go ${p}`} onSelect={() => go(p)}>
                  {
                    {
                      "/chat": t("nav.chat"),
                      "/projects": t("nav.projects"),
                      "/tasks": t("nav.myTasks"),
                      "/calendar": t("nav.calendar"),
                      "/announcements": t("nav.announcements"),
                      "/files": t("nav.files"),
                      "/members": t("nav.members"),
                    }[p]
                  }
                </CommandItem>
              ))}
            </CommandGroup>
          ) : results.isFetching && !results.data ? (
            <div className="flex justify-center p-6" role="status">
              <Spinner />
              <span className="sr-only">Searching</span>
            </div>
          ) : (
            <>
              {!hasResults ? <CommandEmpty>{t("empty.search")}</CommandEmpty> : null}
              {SEARCH_GROUPS.map((g) =>
                results.data?.[g.key].items.length ? (
                  <CommandGroup key={g.key} heading={`${g.label} (${results.data[g.key].total})`}>
                    {results.data[g.key].items.map((item) => (
                      <CommandItem key={`${g.key}-${item.id}`} value={`${g.key}-${item.id}-${item.title}`} onSelect={() => go(item.link)}>
                        <g.icon aria-hidden />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate">{item.title}</span>
                          {item.snippet ? <span className="block truncate text-xs text-muted-foreground">{item.snippet}</span> : null}
                        </span>
                      </CommandItem>
                    ))}
                  </CommandGroup>
                ) : null,
              )}
              <CommandGroup>
                <CommandItem value="see-all-results" onSelect={() => go(`/search?q=${encodeURIComponent(q)}`)}>
                  <Search aria-hidden /> See all results for &ldquo;{q}&rdquo;
                </CommandItem>
              </CommandGroup>
            </>
          )}
        </CommandList>
        </Command>
      </CommandDialog>
    </>
  )
}
