import { Bell, CalendarDays, Check, FolderKanban, Hash, LayoutDashboard, LayoutGrid, Megaphone, MessagesSquare, Search } from "lucide-react"
import { AppIcon } from "@/components/launcher/app-icon"
import { APPS } from "@/lib/marketing"

const people = [
  { name: "Priya", initials: "PN", color: "bg-sky-500" },
  { name: "Hafiz", initials: "HI", color: "bg-amber-500" },
  { name: "Mei Ling", initials: "ML", color: "bg-fuchsia-500" },
]

const messages = [
  { who: people[0], text: "Sprint 14 starts today 🚀 Focus: landing pages + mobile login.", delay: "0s" },
  { who: people[1], text: "I'll pick up the API rate limiting task.", delay: "1.6s" },
  { who: people[2], text: "New hero designs are attached to the website task.", delay: "3.2s" },
]

/**
 * Decorative, animated preview of the product. Hidden from screen readers;
 * the surrounding text describes what it shows.
 */
export function HeroMockup() {
  return (
    <div aria-hidden className="relative mx-auto w-full max-w-5xl select-none">
      {/* Window */}
      <div className="overflow-hidden rounded-2xl border border-white/10 bg-slate-950/80 shadow-2xl shadow-emerald-500/10 ring-1 ring-white/5 backdrop-blur">
        <div className="flex items-center gap-2 border-b border-white/10 px-4 py-2.5">
          <span className="size-2.5 rounded-full bg-red-400/80" />
          <span className="size-2.5 rounded-full bg-amber-400/80" />
          <span className="size-2.5 rounded-full bg-emerald-400/80" />
          <div className="mx-auto flex w-64 items-center gap-2 rounded-md bg-white/5 px-3 py-1 text-[11px] text-slate-400">
            <Search className="size-3" /> rakanspace.app/w/your-team
          </div>
        </div>

        <div className="grid grid-cols-[3.25rem_1fr] sm:grid-cols-[11rem_1fr]">
          {/* Sidebar */}
          <div className="space-y-1 border-r border-white/10 bg-slate-900/60 p-2 text-[12px] text-slate-400">
            <div className="mb-3 flex items-center gap-2 px-1.5 py-1 text-slate-100">
              <span className="flex size-6 items-center justify-center rounded-md bg-gradient-to-br from-teal-400 to-emerald-600 text-[10px] font-bold text-white">R</span>
              <span className="hidden font-semibold sm:inline">Your Team</span>
            </div>
            {[
              { icon: LayoutDashboard, label: "Overview" },
              { icon: MessagesSquare, label: "Chat", active: true, badge: 3 },
              { icon: FolderKanban, label: "Projects" },
              { icon: CalendarDays, label: "Calendar" },
              { icon: Megaphone, label: "Announcements" },
            ].map((item) => (
              <div key={item.label} className={`flex items-center gap-2 rounded-md px-1.5 py-1.5 ${item.active ? "bg-white/10 text-white" : ""}`}>
                <item.icon className="size-4 shrink-0" />
                <span className="hidden flex-1 sm:inline">{item.label}</span>
                {item.badge ? <span className="hidden rounded-full bg-emerald-500 px-1.5 text-[10px] text-white sm:inline">{item.badge}</span> : null}
              </div>
            ))}
            <p className="hidden px-1.5 pt-3 pb-1 text-[10px] tracking-wide text-slate-500 uppercase sm:block">Apps</p>
            {APPS.slice(0, 3).map((app) => (
              <div key={app.key} className="flex items-center gap-2 rounded-md px-1.5 py-1.5">
                <AppIcon app={app} size="sm" />
                <span className="hidden sm:inline">{app.name}</span>
              </div>
            ))}
          </div>

          {/* Main */}
          <div className="min-w-0">
            <div className="flex items-center gap-2 border-b border-white/10 px-4 py-2 text-[12px] text-slate-300">
              <Hash className="size-3.5" /> engineering
              <span className="ml-auto flex items-center gap-3 text-slate-500">
                <LayoutGrid className="size-4" />
                <span className="relative">
                  <Bell className="size-4" />
                  <span className="absolute -top-0.5 -right-0.5 size-2 rounded-full bg-emerald-400" />
                  <span className="lp-ping absolute -top-0.5 -right-0.5 size-2 rounded-full bg-emerald-400" />
                </span>
              </span>
            </div>
            <div className="grid gap-4 p-4 md:grid-cols-[1fr_15rem]">
              {/* Chat */}
              <div className="flex min-h-56 flex-col justify-end gap-3">
                {messages.map((m) => (
                  <div key={m.text} className="lp-msg flex items-start gap-2.5" style={{ animationDelay: m.delay }}>
                    <span className={`flex size-7 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold text-white ${m.who.color}`}>{m.who.initials}</span>
                    <div>
                      <p className="text-[11px] font-medium text-slate-200">
                        {m.who.name} <span className="font-normal text-slate-500">· just now</span>
                      </p>
                      <p className="mt-0.5 rounded-lg rounded-tl-none bg-white/5 px-2.5 py-1.5 text-[12px] text-slate-300">{m.text}</p>
                    </div>
                  </div>
                ))}
                <div className="flex items-center gap-2 pl-9 text-[11px] text-slate-500">
                  <span className="lp-typing flex gap-0.5">
                    <span className="size-1 rounded-full bg-slate-400" />
                    <span className="size-1 rounded-full bg-slate-400" />
                    <span className="size-1 rounded-full bg-slate-400" />
                  </span>
                  Aisyah is typing
                </div>
              </div>

              {/* Mini Kanban */}
              <div className="hidden rounded-xl border border-white/10 bg-white/[0.03] p-2.5 md:block">
                <p className="mb-2 text-[11px] font-medium text-slate-300">Website Revamp</p>
                <div className="grid grid-cols-2 gap-2 text-[10px]">
                  <div className="space-y-1.5">
                    <p className="text-slate-500">In progress</p>
                    <div className="rounded-md border border-white/10 bg-slate-900 p-1.5 text-slate-300">Contact form</div>
                    <div className="h-8 rounded-md border border-dashed border-white/10" />
                  </div>
                  <div className="space-y-1.5">
                    <p className="text-slate-500">Done</p>
                    <div className="lp-card-move relative rounded-md border border-emerald-500/40 bg-emerald-500/10 p-1.5 text-emerald-100">
                      Landing page
                      <Check className="lp-card-check absolute top-1 right-1 size-3 text-emerald-300" />
                    </div>
                    <div className="rounded-md border border-white/10 bg-slate-900 p-1.5 text-slate-400 line-through">Homepage design</div>
                  </div>
                </div>
                <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-white/10">
                  <div className="h-full w-2/3 rounded-full bg-gradient-to-r from-teal-400 to-emerald-500" />
                </div>
                <p className="mt-1 text-[10px] text-slate-500">67% complete</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Floating approval toast */}
      <div className="lp-toast absolute -right-2 bottom-10 hidden w-64 rounded-xl border border-white/10 bg-slate-900/95 p-3 shadow-xl shadow-black/40 backdrop-blur sm:block lg:-right-10">
        <div className="flex items-start gap-2.5">
          <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-emerald-500/20 text-emerald-300">
            <Check className="size-4" />
          </span>
          <div className="text-[12px]">
            <p className="font-medium text-slate-100">Purchase request approved</p>
            <p className="text-slate-400">Design workstation · RM 8,200 · Finance step done</p>
          </div>
        </div>
      </div>

      {/* Floating launcher */}
      <div className="lp-float-slow absolute -top-20 -left-6 hidden rounded-2xl border border-white/10 bg-slate-900/90 p-3 shadow-xl shadow-black/40 backdrop-blur lg:block xl:-left-28">
        <p className="mb-2 text-[10px] font-semibold tracking-wide text-slate-400 uppercase">Installed apps</p>
        <div className="grid grid-cols-3 gap-2">
          {APPS.slice(0, 6).map((app) => (
            <div key={app.key} className="flex flex-col items-center gap-1">
              <AppIcon app={app} size="md" />
              <span className="text-[9px] text-slate-400">{app.name}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
