"use client"

import { ArrowRight, Menu, X } from "lucide-react"
import Link from "next/link"
import { useEffect, useState } from "react"
import { homeFor, useMe } from "@/hooks/use-auth"
import { cn } from "@/lib/utils"

const NAV_LINKS = [
  { href: "#features", label: "Features" },
  { href: "#apps", label: "Apps" },
  { href: "#approvals", label: "Approvals" },
  { href: "#security", label: "Security" },
  { href: "#pricing", label: "Pricing" },
  { href: "#faq", label: "FAQ" },
]

/** Sticky top bar: gains a background once the page scrolls; mobile menu on small screens. */
export function LandingNav() {
  const [scrolled, setScrolled] = useState(false)
  const [open, setOpen] = useState(false)
  // Signed-in visitors get a shortcut back to their workspace.
  const { data: me } = useMe()

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8)
    window.addEventListener("scroll", onScroll, { passive: true })
    return () => window.removeEventListener("scroll", onScroll)
  }, [])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false)
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [open])

  return (
    <header
      className={cn(
        "fixed inset-x-0 top-0 z-50 transition-colors duration-300",
        scrolled || open ? "border-b border-white/10 bg-slate-950/80 backdrop-blur-xl" : "bg-transparent",
      )}
    >
      <nav aria-label="Main" className="mx-auto flex h-16 max-w-7xl items-center gap-6 px-4 sm:px-6">
        <Link href="/" className="flex items-center gap-2 font-semibold text-white">
          <span className="flex size-8 items-center justify-center rounded-lg bg-gradient-to-br from-teal-400 to-emerald-600 text-sm font-bold shadow-lg shadow-emerald-500/30">R</span>
          RakanSpace
        </Link>
        <ul className="hidden items-center gap-1 lg:flex">
          {NAV_LINKS.map((l) => (
            <li key={l.href}>
              <a href={l.href} className="rounded-md px-3 py-2 text-sm text-slate-300 transition-colors hover:text-white">
                {l.label}
              </a>
            </li>
          ))}
        </ul>
        <div className="ml-auto hidden items-center gap-2 sm:flex">
          {me ? (
            <Link
              href={homeFor(me)}
              className="inline-flex items-center gap-1.5 rounded-full bg-white px-4 py-2 text-sm font-medium text-slate-950 shadow-lg shadow-white/10 transition hover:bg-emerald-50"
            >
              Open workspace <ArrowRight className="size-4" aria-hidden />
            </Link>
          ) : (
            <>
              <Link href="/login" className="rounded-md px-3 py-2 text-sm text-slate-200 hover:text-white">
                Sign in
              </Link>
              <Link
                href="/register"
                className="rounded-full bg-white px-4 py-2 text-sm font-medium text-slate-950 shadow-lg shadow-white/10 transition hover:bg-emerald-50"
              >
                Get started free
              </Link>
            </>
          )}
        </div>
        <button
          type="button"
          className="ml-auto rounded-md p-2 text-slate-200 sm:ml-0 lg:hidden"
          aria-expanded={open}
          aria-controls="landing-mobile-menu"
          aria-label={open ? "Close menu" : "Open menu"}
          onClick={() => setOpen((o) => !o)}
        >
          {open ? <X className="size-5" /> : <Menu className="size-5" />}
        </button>
      </nav>
      {open ? (
        <div id="landing-mobile-menu" className="border-t border-white/10 px-4 pb-6 lg:hidden">
          <ul className="grid gap-1 py-3">
            {NAV_LINKS.map((l) => (
              <li key={l.href}>
                <a href={l.href} onClick={() => setOpen(false)} className="block rounded-md px-3 py-2.5 text-slate-200 hover:bg-white/5">
                  {l.label}
                </a>
              </li>
            ))}
          </ul>
          <div className="grid gap-2 sm:hidden">
            {me ? (
              <Link href={homeFor(me)} className="rounded-full bg-white px-4 py-2.5 text-center text-sm font-medium text-slate-950">
                Open workspace
              </Link>
            ) : (
              <>
                <Link href="/login" className="rounded-full border border-white/15 px-4 py-2.5 text-center text-sm text-white">
                  Sign in
                </Link>
                <Link href="/register" className="rounded-full bg-white px-4 py-2.5 text-center text-sm font-medium text-slate-950">
                  Get started free
                </Link>
              </>
            )}
          </div>
        </div>
      ) : null}
    </header>
  )
}
