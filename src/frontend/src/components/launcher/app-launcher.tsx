"use client"

import { LayoutGrid, PackageOpen, Pin, Settings2, Store, X } from "lucide-react"
import Link from "next/link"
import { useState } from "react"
import { EmptyState, ErrorState } from "@/components/common"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { Skeleton } from "@/components/ui/skeleton"
import { Spinner } from "@/components/ui/spinner"
import { Textarea } from "@/components/ui/textarea"
import { useWorkspace } from "@/components/workspace/workspace-context"
import { t } from "@/lib/i18n"
import type { InstalledApp, LauncherData, MarketplaceApp } from "@/lib/types"
import { cn } from "@/lib/utils"
import { AppIcon } from "./app-icon"
import { BannerCarousel } from "./banner-carousel"
import { useInstallApp, useLauncher, usePinApp, useRequestAccess } from "./use-launcher"

const gridClass = "grid grid-cols-2 gap-2 min-[420px]:grid-cols-3 md:grid-cols-4"

/**
 * Grid button in the top bar that opens the app launcher. Radix Dialog gives
 * role="dialog", a focus trap, Esc/backdrop close and focus return to this trigger.
 */
export function AppLauncher() {
  const [open, setOpen] = useState(false)
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={t("launcher.open")} aria-haspopup="dialog">
          <LayoutGrid aria-hidden />
        </Button>
      </DialogTrigger>
      <DialogContent
        showCloseButton={false}
        aria-modal="true"
        className="dark flex max-h-[min(88svh,780px)] w-full flex-col gap-0 overflow-hidden rounded-3xl bg-[#0b1220] p-0 text-slate-100 shadow-2xl ring-white/10 sm:max-w-[700px]"
      >
        <div className="flex items-center gap-3 px-5 pt-5 pb-3 sm:px-6">
          <div className="min-w-0 flex-1">
            <DialogTitle className="text-lg font-semibold text-white">{t("launcher.title")}</DialogTitle>
            <DialogDescription className="text-slate-400">Open, pin and discover apps for this workspace.</DialogDescription>
          </div>
          <DialogClose asChild>
            <button
              type="button"
              aria-label={t("launcher.close")}
              className="flex size-9 shrink-0 items-center justify-center rounded-full bg-red-600 text-white shadow hover:bg-red-500 focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-[#0b1220] focus-visible:outline-none"
            >
              <X className="size-4" aria-hidden />
            </button>
          </DialogClose>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-6 sm:px-6">
          <LauncherBody onNavigate={() => setOpen(false)} />
        </div>
      </DialogContent>
    </Dialog>
  )
}

function LauncherBody({ onNavigate }: { onNavigate: () => void }) {
  const { slug } = useWorkspace()
  const launcher = useLauncher(slug)

  if (launcher.isPending) return <LauncherSkeleton />
  if (launcher.error && !launcher.data) {
    return <ErrorState error={launcher.error} onRetry={() => launcher.refetch()} className="mt-4 border-red-500/30 bg-red-500/10" />
  }
  return <LauncherSections data={launcher.data!} onNavigate={onNavigate} />
}

function LauncherSections({ data, onNavigate }: { data: LauncherData; onNavigate: () => void }) {
  const { href } = useWorkspace()
  const [selected, setSelected] = useState<MarketplaceApp | null>(null)

  return (
    <div className="space-y-6">
      <BannerCarousel banners={data.banners} onNavigate={onNavigate} />

      <section aria-labelledby="launcher-installed">
        <div className="mb-3 flex items-center justify-between gap-2">
          <h3 id="launcher-installed" className="text-sm font-semibold tracking-wide text-slate-300 uppercase">
            {t("launcher.installed")}
          </h3>
          {data.can_manage ? (
            <Link
              href={href("/settings/apps")}
              onClick={onNavigate}
              className="inline-flex items-center gap-1 rounded-md text-xs text-slate-400 hover:text-white focus-visible:ring-2 focus-visible:ring-white focus-visible:outline-none"
            >
              <Settings2 className="size-3.5" aria-hidden /> {t("launcher.manage")}
            </Link>
          ) : null}
        </div>
        {data.installed.length ? (
          <ul className={gridClass}>
            {data.installed.map((app) => (
              <InstalledTile key={app.key} app={app} onNavigate={onNavigate} />
            ))}
          </ul>
        ) : (
          <EmptyState
            icon={PackageOpen}
            title={t("launcher.noInstalled")}
            description={t(data.can_manage ? "launcher.noInstalledAdminHint" : "launcher.noInstalledHint")}
            className="border-white/15"
          />
        )}
      </section>

      <section aria-labelledby="launcher-marketplace">
        <h3 id="launcher-marketplace" className="mb-3 text-sm font-semibold tracking-wide text-slate-300 uppercase">
          {t("launcher.marketplace")}
        </h3>
        {data.marketplace.length ? (
          <ul className={gridClass}>
            {data.marketplace.map((app) => (
              <li key={app.key}>
                <button
                  type="button"
                  onClick={() => setSelected(app)}
                  aria-haspopup="dialog"
                  className="flex w-full flex-col items-center gap-2 rounded-2xl p-3 opacity-50 transition-opacity hover:bg-white/5 hover:opacity-80 focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-white focus-visible:outline-none"
                >
                  <AppIcon app={app} />
                  <span className="text-center text-xs font-medium text-slate-200">{app.name}</span>
                  {app.request_pending ? <span className="sr-only">({t("launcher.requestPending")})</span> : null}
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="rounded-xl border border-dashed border-white/15 p-4 text-center text-sm text-slate-400">
            <Store className="mx-auto mb-1 size-5" aria-hidden />
            {t("launcher.noMarketplace")}
          </p>
        )}
      </section>

      <MarketplaceAppDialog app={selected} canManage={data.can_manage} onClose={() => setSelected(null)} />
    </div>
  )
}

function InstalledTile({ app, onNavigate }: { app: InstalledApp; onNavigate: () => void }) {
  const { slug, href } = useWorkspace()
  const pin = usePinApp(slug)

  return (
    <li className="relative rounded-2xl hover:bg-white/5">
      <Link
        href={href(app.path)}
        onClick={onNavigate}
        className="flex flex-col items-center gap-2 rounded-2xl p-3 pt-4 focus-visible:ring-2 focus-visible:ring-white focus-visible:outline-none"
      >
        <AppIcon app={app} />
        <span className="text-center text-xs font-medium text-slate-100">{app.name}</span>
      </Link>
      <button
        type="button"
        aria-pressed={app.pinned}
        aria-label={t("launcher.pin", { name: app.name })}
        title={t(app.pinned ? "launcher.unpin" : "launcher.pin", { name: app.name })}
        disabled={pin.isPending}
        onClick={(e) => {
          // Toggling the pin must not open the app.
          e.stopPropagation()
          e.preventDefault()
          pin.mutate({ app, pinned: !app.pinned })
        }}
        className="absolute top-1 right-1 flex size-7 items-center justify-center rounded-full hover:bg-white/10 focus-visible:ring-2 focus-visible:ring-white focus-visible:outline-none disabled:cursor-wait"
      >
        <Pin className={cn("size-3.5 rotate-45", app.pinned ? "fill-yellow-400 text-yellow-400" : "text-slate-500")} aria-hidden />
      </button>
    </li>
  )
}

function MarketplaceAppDialog({ app, canManage, onClose }: { app: MarketplaceApp | null; canManage: boolean; onClose: () => void }) {
  const { slug } = useWorkspace()
  const install = useInstallApp(slug)
  const request = useRequestAccess(slug)
  const [note, setNote] = useState("")

  const close = () => {
    setNote("")
    onClose()
  }

  return (
    <Dialog open={!!app} onOpenChange={(o) => (o ? null : close())}>
      <DialogContent className="dark bg-[#111a2e] text-slate-100 ring-white/10 sm:max-w-md">
        {app ? (
          <div className="space-y-4">
            <div className="flex items-center gap-4 pr-6">
              <AppIcon app={app} />
              <div className="min-w-0">
                <DialogTitle className="text-lg text-white">{app.name}</DialogTitle>
                <p className="text-sm text-slate-400">{app.tagline}</p>
                <Badge variant="outline" className="mt-1 border-white/20 text-slate-300">
                  {app.category}
                </Badge>
              </div>
            </div>
            <DialogDescription className="text-slate-300">{app.description}</DialogDescription>

            {canManage ? (
              <Button className="w-full" disabled={install.isPending} onClick={() => install.mutate(app, { onSuccess: close })}>
                {install.isPending ? <Spinner /> : null}
                {t("launcher.install")}
              </Button>
            ) : app.request_pending ? (
              <Button className="w-full" variant="secondary" disabled>
                {t("launcher.requestPending")}
              </Button>
            ) : (
              <div className="space-y-2">
                <Label htmlFor="access-note" className="text-slate-300">
                  Why do you need it? (optional)
                </Label>
                <Textarea id="access-note" rows={2} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
                <Button className="w-full" disabled={request.isPending} onClick={() => request.mutate({ key: app.key, note }, { onSuccess: close })}>
                  {request.isPending ? <Spinner /> : null}
                  {t("launcher.requestAccess")}
                </Button>
              </div>
            )}
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  )
}

function LauncherSkeleton() {
  return (
    <div className="space-y-6" aria-busy="true" aria-label="Loading apps">
      <Skeleton className="h-44 w-full rounded-2xl bg-white/10" />
      {[8, 2].map((n, s) => (
        <div key={s} className="space-y-3">
          <Skeleton className="h-4 w-32 bg-white/10" />
          <div className={gridClass}>
            {Array.from({ length: n }).map((_, i) => (
              <div key={i} className="flex flex-col items-center gap-2 p-3">
                <Skeleton className="size-[60px] rounded-2xl bg-white/10" />
                <Skeleton className="h-3 w-14 bg-white/10" />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}
