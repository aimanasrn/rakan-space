"use client"

import { useQuery } from "@tanstack/react-query"
import { Download, Search } from "lucide-react"
import Link from "next/link"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { useState } from "react"
import { EmptyState, ErrorState, LoadingRows, PageHeader, UserAvatar } from "@/components/common"
import { SEARCH_GROUPS, type SearchItem, type SearchResults } from "@/components/workspace/global-search"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { orgPath, useWorkspace } from "@/components/workspace/workspace-context"
import { api } from "@/lib/api"
import { t } from "@/lib/i18n"
import type { UserSummary } from "@/lib/types"

type Group = (typeof SEARCH_GROUPS)[number]["key"]

export function SearchView() {
  const { slug, href } = useWorkspace()
  const params = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()
  const q = params.get("q") ?? ""
  const [tab, setTab] = useState<"all" | Group>("all")
  const [page, setPage] = useState(1)

  const results = useQuery({
    queryKey: ["search", slug, q, tab, page],
    enabled: q.trim().length >= 2,
    queryFn: async () => (await api<{ data: Partial<SearchResults> }>(orgPath(slug, "/search"), { query: { q, type: tab === "all" ? undefined : tab, page } })).data,
    placeholderData: (prev) => prev,
  })

  const groups = SEARCH_GROUPS.filter((g) => tab === "all" || g.key === tab)

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-4 md:p-8">
      <PageHeader title="Search" description="Results only include items you can currently access." />
      <form
        role="search"
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          setPage(1)
          router.replace(`${pathname}?q=${encodeURIComponent(String(new FormData(e.currentTarget).get("q") ?? "").trim())}`)
        }}
      >
        <Label htmlFor="search-page-input" className="sr-only">
          Search
        </Label>
        <Input id="search-page-input" name="q" key={q} defaultValue={q} placeholder="Search messages, channels, projects, tasks and files" autoFocus />
        <Button type="submit">
          <Search /> Search
        </Button>
      </form>
      {q.length >= 2 ? (
        <Tabs value={tab} onValueChange={(v) => (setTab(v as typeof tab), setPage(1))}>
          <TabsList className="flex-wrap">
            <TabsTrigger value="all">All</TabsTrigger>
            {SEARCH_GROUPS.map((g) => (
              <TabsTrigger key={g.key} value={g.key}>
                {g.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      ) : null}
      {q.length < 2 ? (
        <EmptyState icon={Search} title="Type at least 2 characters to search" />
      ) : results.isLoading ? (
        <LoadingRows rows={5} />
      ) : results.error ? (
        <ErrorState error={results.error} onRetry={() => results.refetch()} />
      ) : groups.every((g) => !results.data?.[g.key]?.items.length) ? (
        <EmptyState icon={Search} title={t("empty.search")} description={`Nothing matched “${q}”.`} />
      ) : (
        <div className="space-y-8">
          {groups.map((g) => {
            const r = results.data?.[g.key]
            if (!r?.items.length) return null
            return (
              <section key={g.key} aria-labelledby={`results-${g.key}`}>
                <h2 id={`results-${g.key}`} className="mb-2 flex items-center gap-2 font-semibold">
                  <g.icon className="size-4" aria-hidden /> {g.label} <Badge variant="secondary">{r.total}</Badge>
                  {tab === "all" && r.total > r.items.length ? (
                    <Button variant="link" size="sm" onClick={() => setTab(g.key)}>
                      See all
                    </Button>
                  ) : null}
                </h2>
                <ul className="divide-y rounded-xl border">
                  {r.items.map((item: SearchItem & { user?: UserSummary; download_url?: string }) => (
                    <li key={item.id} className="flex items-center gap-3 p-3 hover:bg-muted/50">
                      {item.user ? <UserAvatar user={item.user} className="size-7" /> : null}
                      <Link href={href(item.link)} className="min-w-0 flex-1">
                        <span className="block truncate font-medium">{item.title}</span>
                        {item.snippet ? <span className="line-clamp-2 text-sm text-muted-foreground">{item.snippet}</span> : null}
                      </Link>
                      {item.download_url ? (
                        <Button variant="ghost" size="icon-sm" asChild>
                          <a href={item.download_url} aria-label={`Download ${item.title}`}>
                            <Download />
                          </a>
                        </Button>
                      ) : null}
                    </li>
                  ))}
                </ul>
                {tab !== "all" && r.last_page > 1 ? (
                  <nav className="mt-3 flex items-center justify-center gap-2" aria-label="Pagination">
                    <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                      Previous
                    </Button>
                    <span className="text-sm text-muted-foreground">
                      Page {page} of {r.last_page}
                    </span>
                    <Button variant="outline" size="sm" disabled={page >= r.last_page} onClick={() => setPage((p) => p + 1)}>
                      Next
                    </Button>
                  </nav>
                ) : null}
              </section>
            )
          })}
        </div>
      )}
    </div>
  )
}
