"use client"

import { ChevronLeft, ChevronRight } from "lucide-react"
import Link from "next/link"
import { useEffect, useState, useSyncExternalStore } from "react"
import { useWorkspace } from "@/components/workspace/workspace-context"
import { t } from "@/lib/i18n"
import type { LauncherBanner } from "@/lib/types"
import { cn } from "@/lib/utils"
import { BannerIllustration } from "./illustrations"

const ROTATE_MS = 7000

function subscribeReducedMotion(callback: () => void) {
  const query = window.matchMedia("(prefers-reduced-motion: reduce)")
  query.addEventListener("change", callback)
  return () => query.removeEventListener("change", callback)
}

function usePrefersReducedMotion() {
  return useSyncExternalStore(
    subscribeReducedMotion,
    () => window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    () => true,
  )
}

/**
 * Admin-managed banners. Auto-rotates unless the user prefers reduced motion,
 * and pauses while hovered or focused.
 */
export function BannerCarousel({ banners, onNavigate, autoRotate = true }: { banners: LauncherBanner[]; onNavigate: () => void; autoRotate?: boolean }) {
  const [index, setIndex] = useState(0)
  const [hovered, setHovered] = useState(false)
  const [focused, setFocused] = useState(false)
  const reducedMotion = usePrefersReducedMotion()
  const count = banners.length
  const current = count ? index % count : 0
  const rotating = autoRotate && count > 1 && !reducedMotion && !hovered && !focused

  useEffect(() => {
    if (!rotating) return
    const timer = window.setInterval(() => setIndex((i) => i + 1), ROTATE_MS)
    return () => window.clearInterval(timer)
  }, [rotating])

  if (!count) return null
  const banner = banners[current]
  const go = (delta: number) => setIndex((current + delta + count) % count)

  return (
    <section
      aria-roledescription="carousel"
      aria-label="Announcements"
      className="relative"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setFocused(true)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setFocused(false)
      }}
    >
      <div aria-live={rotating ? "off" : "polite"}>
        <div
          key={banner.id}
          role="group"
          aria-roledescription="slide"
          aria-label={t("launcher.slide", { current: current + 1, total: count })}
          className="grid min-h-44 grid-cols-1 items-center gap-4 overflow-hidden rounded-2xl border border-white/10 bg-linear-to-br from-slate-800 to-slate-900 p-5 motion-safe:animate-in motion-safe:fade-in-0 sm:grid-cols-[1fr_auto] sm:p-6"
        >
          <div className={cn("min-w-0 space-y-2", count > 1 && "sm:px-6")}>
            <h3 className="text-lg leading-tight font-semibold text-white sm:text-xl">{banner.title}</h3>
            {banner.description ? <p className="text-sm leading-relaxed text-slate-300">{banner.description}</p> : null}
            {banner.cta_label && banner.cta_url ? <BannerCta banner={banner} onNavigate={onNavigate} /> : null}
          </div>
          <div className="hidden sm:block">
            {banner.image_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={banner.image_url} alt="" className="h-32 w-44 rounded-xl object-cover" />
            ) : (
              <BannerIllustration name={banner.illustration} className="h-32 w-44" />
            )}
          </div>
        </div>
      </div>

      {count > 1 ? (
        <>
          <button
            type="button"
            onClick={() => go(-1)}
            aria-label={t("launcher.previous")}
            className="absolute top-1/2 left-1.5 flex size-8 -translate-y-1/2 items-center justify-center rounded-full bg-black/40 text-white hover:bg-black/60 focus-visible:ring-2 focus-visible:ring-white focus-visible:outline-none"
          >
            <ChevronLeft className="size-4" aria-hidden />
          </button>
          <button
            type="button"
            onClick={() => go(1)}
            aria-label={t("launcher.next")}
            className="absolute top-1/2 right-1.5 flex size-8 -translate-y-1/2 items-center justify-center rounded-full bg-black/40 text-white hover:bg-black/60 focus-visible:ring-2 focus-visible:ring-white focus-visible:outline-none"
          >
            <ChevronRight className="size-4" aria-hidden />
          </button>
          <div className="mt-2 flex justify-center gap-1.5">
            {banners.map((b, i) => (
              <button
                key={b.id}
                type="button"
                onClick={() => setIndex(i)}
                aria-label={t("launcher.slide", { current: i + 1, total: count })}
                aria-current={i === current ? "true" : undefined}
                className={cn("h-1.5 rounded-full transition-all", i === current ? "w-5 bg-white" : "w-1.5 bg-white/40 hover:bg-white/70")}
              />
            ))}
          </div>
        </>
      ) : null}
    </section>
  )
}

const ctaClass =
  "mt-2 inline-flex h-9 items-center rounded-lg bg-[#1e3a8a] px-4 text-xs font-semibold tracking-wider text-white uppercase hover:bg-[#1e40af] focus-visible:ring-2 focus-visible:ring-white focus-visible:outline-none"

/** Workspace-relative links stay in the app; full URLs open in a new tab. */
function BannerCta({ banner, onNavigate }: { banner: LauncherBanner; onNavigate: () => void }) {
  const { href } = useWorkspace()
  const url = banner.cta_url ?? ""
  const label = banner.cta_label ?? t("launcher.learnMore")

  if (url.startsWith("/") && !url.startsWith("//")) {
    return (
      <Link href={href(url)} onClick={onNavigate} className={ctaClass}>
        {label}
      </Link>
    )
  }
  if (!/^https?:\/\//i.test(url)) return null
  return (
    <a href={url} target="_blank" rel="noopener noreferrer" className={ctaClass}>
      {label}
      <span className="sr-only"> (opens in a new tab)</span>
    </a>
  )
}
