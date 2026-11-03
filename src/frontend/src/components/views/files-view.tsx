"use client"

import { useQuery } from "@tanstack/react-query"
import { Download, Eye, FolderOpen } from "lucide-react"
import Link from "next/link"
import { useSearchParams } from "next/navigation"
import { useState } from "react"
import { FileTypeIcon } from "@/components/attachments"
import { EmptyState, ErrorState, LoadingRows, PageHeader, UserAvatar } from "@/components/common"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { orgPath, useWorkspace } from "@/components/workspace/workspace-context"
import { api } from "@/lib/api"
import { formatBytes, formatInstantDate } from "@/lib/datetime"
import { t } from "@/lib/i18n"
import type { Attachment, Paginated } from "@/lib/types"

export function FilesView() {
  const { slug, org, href } = useWorkspace()
  const params = useSearchParams()
  const [q, setQ] = useState(params.get("q") ?? "")
  const [type, setType] = useState("all")
  const [source, setSource] = useState("all")
  const [mine, setMine] = useState(false)
  const [page, setPage] = useState(1)

  const query = { q: q || undefined, type: type === "all" ? undefined : type, source: source === "all" ? undefined : source, mine: mine ? 1 : undefined, page }
  const files = useQuery({
    queryKey: ["files", slug, query],
    queryFn: () => api<Paginated<Attachment>>(orgPath(slug, "/files"), { query }),
    placeholderData: (prev) => prev,
  })

  return (
    <div className="space-y-6 p-4 md:p-8">
      <PageHeader title={t("nav.files")} description="Files shared in conversations, tasks, projects and announcements you can access. Access always follows the original item's permissions." />
      <div className="flex flex-wrap items-center gap-3" role="search" aria-label="Filter files">
        <Label htmlFor="file-search" className="sr-only">
          Search files
        </Label>
        <Input id="file-search" placeholder="Search by file name…" value={q} onChange={(e) => (setQ(e.target.value), setPage(1))} className="max-w-xs" />
        <Select value={type} onValueChange={(v) => (setType(v), setPage(1))}>
          <SelectTrigger className="w-36" aria-label="File type">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All types</SelectItem>
            <SelectItem value="image">Images</SelectItem>
            <SelectItem value="document">Documents</SelectItem>
            <SelectItem value="other">Other</SelectItem>
          </SelectContent>
        </Select>
        <Select value={source} onValueChange={(v) => (setSource(v), setPage(1))}>
          <SelectTrigger className="w-40" aria-label="Shared in">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Shared anywhere</SelectItem>
            <SelectItem value="message">Chat</SelectItem>
            <SelectItem value="task">Tasks</SelectItem>
            <SelectItem value="project">Projects</SelectItem>
            <SelectItem value="announcement">Announcements</SelectItem>
          </SelectContent>
        </Select>
        <div className="flex items-center gap-2">
          <Switch id="files-mine" checked={mine} onCheckedChange={(v) => (setMine(v), setPage(1))} />
          <Label htmlFor="files-mine">Uploaded by me</Label>
        </div>
      </div>
      {files.error ? <ErrorState error={files.error} onRetry={() => files.refetch()} /> : null}
      {files.isLoading ? (
        <LoadingRows rows={5} />
      ) : files.data?.data.length ? (
        <>
          <div className="overflow-x-auto rounded-xl border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="min-w-56">Name</TableHead>
                  <TableHead>Shared in</TableHead>
                  <TableHead>Uploaded by</TableHead>
                  <TableHead>Size</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>
                    <span className="sr-only">Actions</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {files.data.data.map((f) => {
                  return (
                    <TableRow key={f.id}>
                      <TableCell>
                        <span className="flex items-center gap-2">
                          <FileTypeIcon attachment={f} className="size-4 shrink-0 text-muted-foreground" />
                          <span className="truncate font-medium">{f.name}</span>
                          <span className="text-xs text-muted-foreground uppercase">{f.extension}</span>
                        </span>
                      </TableCell>
                      <TableCell>
                        {f.context ? (
                          <Link href={href(f.context.link)} className="block max-w-56 truncate text-primary hover:underline">
                            {f.context.label}
                            {f.context.sublabel ? <span className="text-muted-foreground"> · {f.context.sublabel}</span> : null}
                          </Link>
                        ) : (
                          "—"
                        )}
                      </TableCell>
                      <TableCell>
                        <span className="flex items-center gap-2 whitespace-nowrap">
                          <UserAvatar user={f.uploader} className="size-6" /> {f.uploader?.name ?? "Former member"}
                        </span>
                      </TableCell>
                      <TableCell className="whitespace-nowrap">{formatBytes(f.size)}</TableCell>
                      <TableCell className="whitespace-nowrap">{formatInstantDate(f.created_at, org.timezone)}</TableCell>
                      <TableCell>
                        <span className="flex gap-1">
                          {f.preview_url ? (
                            <Button variant="ghost" size="icon-sm" asChild>
                              <a href={f.preview_url} target="_blank" rel="noopener noreferrer" aria-label={`Preview ${f.name}`}>
                                <Eye />
                              </a>
                            </Button>
                          ) : null}
                          <Button variant="ghost" size="icon-sm" asChild>
                            <a href={f.download_url} aria-label={`Download ${f.name}`}>
                              <Download />
                            </a>
                          </Button>
                        </span>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </div>
          {files.data.meta.last_page > 1 ? (
            <nav className="flex items-center justify-center gap-2" aria-label="Pagination">
              <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                Previous
              </Button>
              <span className="text-sm text-muted-foreground">
                Page {page} of {files.data.meta.last_page} · {files.data.meta.total} files
              </span>
              <Button variant="outline" size="sm" disabled={page >= files.data.meta.last_page} onClick={() => setPage((p) => p + 1)}>
                Next
              </Button>
            </nav>
          ) : null}
        </>
      ) : (
        <EmptyState icon={FolderOpen} title={t("empty.files")} description="Attach files in chat, tasks, projects or announcements and they will be listed here." />
      )}
    </div>
  )
}
