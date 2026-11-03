import {
  ArrowRight,
  BadgeCheck,
  Bell,
  Building2,
  CalendarDays,
  Check,
  ChevronDown,
  ClipboardList,
  Eye,
  FileLock2,
  FolderKanban,
  History,
  KeyRound,
  LayoutGrid,
  Lock,
  Megaphone,
  MessagesSquare,
  PenLine,
  Search,
  ShieldCheck,
  Sparkles,
  UserMinus,
  UserPlus,
  Users,
  Zap,
} from "lucide-react"
import Link from "next/link"
import { AppIcon } from "@/components/launcher/app-icon"
import { APPS, FAQS } from "@/lib/marketing"
import { HeroMockup } from "./hero-mockup"
import { LandingNav } from "./landing-nav"
import { Pricing } from "./pricing"
import "./landing.css"

/** Public marketing page at "/". Server-rendered; only the nav and pricing toggle are client components. */
export function LandingPage() {
  return (
    <div className="lp-root dark min-h-svh bg-slate-950 text-slate-100 [color-scheme:dark]">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[60] focus:rounded-md focus:bg-white focus:px-3 focus:py-2 focus:text-slate-950"
      >
        Skip to content
      </a>
      <LandingNav />
      <main id="main">
        <Hero />
        <AppMarquee />
        <Features />
        <Apps />
        <Approvals />
        <Security />
        <HowItWorks />
        <section id="pricing" aria-labelledby="pricing-title" className="relative scroll-mt-20 px-4 py-24 sm:px-6 lg:py-32">
          <Glow className="top-20 left-1/2 -translate-x-1/2 bg-emerald-500/10" />
          <div className="relative mx-auto max-w-6xl">
            <SectionHeading
              id="pricing-title"
              eyebrow="Pricing"
              title="Simple pricing that grows with you"
              text="Start free with your team. Upgrade when you need every app and advanced approvals."
            />
            <div className="mt-12">
              <Pricing />
            </div>
          </div>
        </section>
        <Faq />
        <FinalCta />
      </main>
      <Footer />
    </div>
  )
}

// --------------------------------------------------------------------- pieces

function Glow({ className }: { className: string }) {
  return <div aria-hidden className={`pointer-events-none absolute size-[36rem] rounded-full blur-3xl ${className}`} />
}

function SectionHeading({ id, eyebrow, title, text, align = "center" }: { id: string; eyebrow: string; title: string; text: string; align?: "center" | "left" }) {
  return (
    <div className={`lp-reveal max-w-2xl ${align === "center" ? "mx-auto text-center" : ""}`}>
      <p className="text-sm font-semibold tracking-wide text-emerald-400 uppercase">{eyebrow}</p>
      <h2 id={id} className="mt-3 text-3xl font-semibold tracking-tight text-balance text-white sm:text-4xl lg:text-5xl">
        {title}
      </h2>
      <p className="mt-4 text-lg text-pretty text-slate-400">{text}</p>
    </div>
  )
}

function Hero() {
  return (
    <section aria-labelledby="hero-title" className="relative overflow-hidden px-4 pt-32 pb-20 sm:px-6 lg:pt-40 lg:pb-28">
      <div aria-hidden className="lp-grid-bg absolute inset-0" />
      <div aria-hidden className="lp-blob absolute -top-40 left-[10%] size-[32rem] rounded-full bg-teal-500/25 blur-3xl" />
      <div aria-hidden className="lp-blob absolute top-20 right-[5%] size-[28rem] rounded-full bg-violet-600/20 blur-3xl [animation-delay:-6s]" />
      <div aria-hidden className="lp-blob absolute top-[28rem] left-[40%] size-[24rem] rounded-full bg-emerald-500/15 blur-3xl [animation-delay:-12s]" />

      <div className="relative mx-auto max-w-7xl">
        <div className="mx-auto max-w-3xl text-center">
          <a
            href="#approvals"
            className="lp-hero-in inline-flex items-center gap-2 rounded-full border border-emerald-400/30 bg-emerald-400/10 px-3 py-1 text-sm text-emerald-200 transition hover:bg-emerald-400/20"
          >
            <Sparkles className="size-4" aria-hidden /> New: Form builder and Approval workflows
            <ArrowRight className="size-3.5" aria-hidden />
          </a>
          <h1 id="hero-title" className="lp-hero-in mt-8 text-5xl font-semibold tracking-tight text-balance text-white [animation-delay:80ms] sm:text-6xl lg:text-7xl">
            One space.{" "}
            <span className="lp-shine bg-gradient-to-r from-teal-300 via-emerald-300 via-40% to-teal-300 bg-clip-text text-transparent">One team.</span>
          </h1>
          <p className="lp-hero-in mt-3 text-lg font-medium text-slate-400 italic [animation-delay:140ms]" lang="ms">
            Satu ruang. Satu pasukan.
          </p>
          <p className="lp-hero-in mx-auto mt-6 max-w-2xl text-lg text-pretty text-slate-300 [animation-delay:200ms] sm:text-xl">
            Chat, projects, approvals, forms and every business app your company runs on — in one secure workspace your whole team actually enjoys using.
          </p>
          <div className="lp-hero-in mt-10 flex flex-col items-center justify-center gap-3 [animation-delay:280ms] sm:flex-row">
            <Link
              href="/register"
              className="group inline-flex items-center gap-2 rounded-full bg-white px-6 py-3 text-base font-medium text-slate-950 shadow-xl shadow-emerald-500/20 transition hover:bg-emerald-50"
            >
              Create your workspace
              <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" aria-hidden />
            </Link>
            <a href="#features" className="inline-flex items-center gap-2 rounded-full border border-white/15 px-6 py-3 text-base text-white transition hover:bg-white/10">
              See what&apos;s inside
            </a>
          </div>
          <ul className="lp-hero-in mt-8 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-sm text-slate-400 [animation-delay:360ms]">
            {["Free for teams up to 10", "No credit card", "Set up in minutes"].map((t) => (
              <li key={t} className="flex items-center gap-1.5">
                <Check className="size-4 text-emerald-400" aria-hidden /> {t}
              </li>
            ))}
          </ul>
        </div>

        <div className="lp-hero-in relative mt-16 [animation-delay:450ms] lg:mt-20">
          <div aria-hidden className="absolute inset-x-10 -top-6 bottom-0 rounded-[2rem] bg-gradient-to-b from-emerald-400/20 to-transparent blur-2xl" />
          <HeroMockup />
          <p className="sr-only">
            Preview of RakanSpace: a team chat channel with messages arriving live, a project board where a task moves to Done, and a notification that a purchase request was approved.
          </p>
        </div>
      </div>
    </section>
  )
}

function AppMarquee() {
  const items = [...APPS, ...APPS]
  return (
    <section aria-label="Apps included in RakanSpace" className="lp-marquee relative border-y border-white/10 bg-white/[0.02] py-6">
      <div className="overflow-hidden [mask-image:linear-gradient(to_right,transparent,black_10%,black_90%,transparent)]">
        <ul className="lp-marquee-track flex w-max gap-10 pr-10">
          {items.map((app, i) => (
            <li key={`${app.key}-${i}`} className="flex items-center gap-3 text-slate-300" aria-hidden={i >= APPS.length || undefined}>
              <AppIcon app={app} size="md" />
              <span className="text-lg font-medium whitespace-nowrap">{app.name}</span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  )
}

function FeatureCard({ icon: Icon, title, text, children, className = "" }: { icon: typeof Zap; title: string; text: string; children?: React.ReactNode; className?: string }) {
  return (
    <li className={`lp-reveal group relative overflow-hidden rounded-3xl border border-white/10 bg-gradient-to-b from-white/[0.06] to-white/[0.02] p-6 transition hover:border-white/20 ${className}`}>
      <div aria-hidden className="absolute -top-24 -right-24 size-48 rounded-full bg-emerald-500/0 blur-3xl transition duration-500 group-hover:bg-emerald-500/20" />
      <span className="flex size-10 items-center justify-center rounded-xl bg-white/10 text-emerald-300">
        <Icon className="size-5" aria-hidden />
      </span>
      <h3 className="mt-4 text-lg font-semibold text-white">{title}</h3>
      <p className="mt-2 text-sm text-slate-400">{text}</p>
      {children ? <div aria-hidden className="mt-6">{children}</div> : null}
    </li>
  )
}

function Features() {
  return (
    <section id="features" aria-labelledby="features-title" className="relative scroll-mt-20 px-4 py-24 sm:px-6 lg:py-32">
      <div className="mx-auto max-w-7xl">
        <SectionHeading
          id="features-title"
          eyebrow="The workspace"
          title="Everything your team needs, finally in one place"
          text="Stop paying for and switching between five tools. RakanSpace brings conversations, work and company news together, with the right people seeing the right things."
        />
        <ul className="mt-16 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          <FeatureCard icon={MessagesSquare} title="Real-time team chat" text="Public and private channels, direct messages, @mentions, replies, files and unread counts. Messages never get lost, even on a bad connection." className="lg:col-span-2">
            <div className="space-y-2">
              {[
                { who: "Aisyah", text: "Town hall moved to 3pm Wednesday 📅", c: "bg-teal-500" },
                { who: "Daniel", text: "Noted — I'll update the calendar.", c: "bg-violet-500" },
              ].map((m, i) => (
                <div key={m.who} className="lp-msg flex items-center gap-2" style={{ animationDelay: `${i * 1.4}s` }}>
                  <span className={`size-6 shrink-0 rounded-full ${m.c}`} />
                  <span className="rounded-xl rounded-tl-none bg-white/[0.07] px-3 py-1.5 text-sm text-slate-200">
                    <b className="font-medium text-white">{m.who}</b> {m.text}
                  </span>
                </div>
              ))}
            </div>
          </FeatureCard>
          <FeatureCard icon={FolderKanban} title="Projects and tasks" text="Kanban and list views, assignees, due dates, checklists, comments and activity. See progress at a glance.">
            <div className="grid grid-cols-3 gap-1.5 text-[10px] text-slate-400">
              {["To do", "Doing", "Done"].map((col, i) => (
                <div key={col} className="space-y-1.5 rounded-lg bg-white/[0.04] p-1.5">
                  <p>{col}</p>
                  {Array.from({ length: 3 - i }).map((_, n) => (
                    <div key={n} className={`h-4 rounded ${i === 2 ? "bg-emerald-500/30" : "bg-white/10"}`} />
                  ))}
                </div>
              ))}
            </div>
          </FeatureCard>
          <FeatureCard icon={CalendarDays} title="Shared calendar" text="Meetings and company events with reminders, shown in your organisation's time zone. Task deadlines appear automatically.">
            <div className="grid grid-cols-7 gap-1">
              {Array.from({ length: 21 }).map((_, i) => (
                <span key={i} className={`flex aspect-square items-center justify-center rounded text-[9px] ${[3, 9, 10, 16].includes(i) ? "bg-emerald-500/30 text-emerald-100" : "bg-white/[0.04] text-slate-500"}`}>
                  {i + 1}
                </span>
              ))}
            </div>
          </FeatureCard>
          <FeatureCard icon={Megaphone} title="Announcements that get read" text="Post to everyone or one department, pin what matters and ask for acknowledgement — then see exactly who has read it.">
            <div className="rounded-xl bg-white/[0.04] p-3">
              <p className="text-xs text-slate-300">New leave policy · 18 of 24 acknowledged</p>
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/10">
                <div className="h-full w-3/4 rounded-full bg-gradient-to-r from-teal-400 to-emerald-400" />
              </div>
            </div>
          </FeatureCard>
          <FeatureCard icon={Search} title="Find anything instantly" text="Press Ctrl/⌘+K to search messages, projects, tasks and files — only ever showing what you're allowed to open.">
            <div className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-slate-400">
              <Search className="size-4" /> quarterly budget
              <kbd className="ml-auto rounded border border-white/15 px-1.5 text-[10px]">⌘K</kbd>
            </div>
          </FeatureCard>
        </ul>
      </div>
    </section>
  )
}

function Apps() {
  return (
    <section id="apps" aria-labelledby="apps-title" className="relative scroll-mt-20 overflow-hidden px-4 py-24 sm:px-6 lg:py-32">
      <Glow className="-top-40 -right-40 bg-violet-600/15" />
      <div className="relative mx-auto max-w-7xl">
        <SectionHeading
          id="apps-title"
          eyebrow="App launcher"
          title="One launcher. Every business app."
          text="Install only what your company needs, decide what each role can do in every app, and let people pin their favourites to the sidebar."
        />
        <ul className="mt-16 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {APPS.map((app, i) => (
            <li
              key={app.key}
              className="lp-reveal group flex items-center gap-4 rounded-2xl border border-white/10 bg-white/[0.03] p-4 transition hover:-translate-y-0.5 hover:border-white/20 hover:bg-white/[0.06]"
              style={{ animationDelay: `${(i % 3) * 60}ms` }}
            >
              <AppIcon app={app} className="transition-transform duration-300 group-hover:scale-105 group-hover:rotate-3" />
              <div className="min-w-0">
                <h3 className="flex items-center gap-2 font-semibold text-white">
                  {app.name}
                  {app.live ? (
                    <span className="rounded-full bg-emerald-400/15 px-2 py-0.5 text-[10px] font-medium text-emerald-300">Available</span>
                  ) : (
                    <span className="rounded-full bg-white/10 px-2 py-0.5 text-[10px] font-medium text-slate-400">Coming soon</span>
                  )}
                </h3>
                <p className="text-sm text-slate-400">{app.tagline}</p>
              </div>
            </li>
          ))}
        </ul>
        <div className="lp-reveal mt-10 grid gap-4 sm:grid-cols-3">
          {[
            { icon: LayoutGrid, title: "Install per company", text: "Owners and admins choose the apps. Others can request access in one click." },
            { icon: KeyRound, title: "Permissions per role", text: "View, create, edit, delete, approve or administer — set for every app." },
            { icon: Bell, title: "One inbox", text: "Notifications from every app arrive in-app and by email, never twice." },
          ].map((f) => (
            <div key={f.title} className="flex gap-3 rounded-2xl p-2">
              <f.icon className="mt-0.5 size-5 shrink-0 text-emerald-400" aria-hidden />
              <div>
                <p className="font-medium text-white">{f.title}</p>
                <p className="text-sm text-slate-400">{f.text}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

function Approvals() {
  const steps = [
    { label: "Submitted", sub: "Purchase request · RM 8,200", icon: ClipboardList },
    { label: "Line manager", sub: "Priya approved", icon: Users },
    { label: "Finance", sub: "Only above RM 5,000", icon: Building2 },
    { label: "Approved", sub: "Requester notified", icon: BadgeCheck },
  ]
  return (
    <section id="approvals" aria-labelledby="approvals-title" className="relative scroll-mt-20 px-4 py-24 sm:px-6 lg:py-32">
      <div className="mx-auto grid max-w-7xl items-center gap-16 lg:grid-cols-2">
        <div>
          <SectionHeading
            id="approvals-title"
            eyebrow="Form + Approval"
            title="From paper forms to approved in hours, not weeks"
            text="Build any form by dragging fields, attach an approval workflow, and every submission is routed, reminded and recorded automatically."
            align="left"
          />
          <ul className="lp-reveal mt-8 space-y-4">
            {[
              { icon: PenLine, text: "10 field types including signatures, file uploads and line-item tables, with show/hide logic." },
              { icon: Users, text: "Approvers by person, role or the requester's own manager — one of them, or all of them in parallel." },
              { icon: Zap, text: "Conditional steps like “Finance approves above RM 5,000”. Reminders and escalation when a step is overdue." },
              { icon: UserMinus, text: "Out of office? Delegate your approvals. Someone leaves? Their pending approvals are handed on." },
              { icon: History, text: "A complete history of every decision and comment, kept for every round." },
            ].map((b) => (
              <li key={b.text} className="flex gap-3 text-slate-300">
                <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg bg-emerald-500/15 text-emerald-300">
                  <b.icon className="size-4" aria-hidden />
                </span>
                {b.text}
              </li>
            ))}
          </ul>
        </div>

        <div className="lp-reveal relative" aria-hidden>
          <Glow className="top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-emerald-500/15" />
          <div className="relative rounded-3xl border border-white/10 bg-slate-900/70 p-6 shadow-2xl backdrop-blur sm:p-8">
            <div className="flex items-center justify-between">
              <p className="font-medium text-white">Purchase approval</p>
              <span className="rounded-full bg-amber-400/15 px-2.5 py-1 text-xs text-amber-200">In progress</span>
            </div>
            <div className="relative mt-8">
              <div className="absolute top-5 right-[12.5%] left-[12.5%] h-0.5 bg-white/10">
                <span className="lp-travel absolute -top-1 size-2.5 rounded-full bg-emerald-400 shadow-[0_0_12px_rgb(52_211_153)]" />
              </div>
              <ol className="relative grid grid-cols-4 gap-2">
                {steps.map((s, i) => (
                  <li key={s.label} className="flex flex-col items-center text-center">
                    <span
                      className="lp-light flex size-10 items-center justify-center rounded-full border-2 border-white/15 bg-slate-950 text-emerald-300"
                      style={{ animationDelay: `${i * 1.5}s` }}
                    >
                      <s.icon className="size-4" />
                    </span>
                    <p className="mt-3 text-xs font-medium text-white sm:text-sm">{s.label}</p>
                    <p className="mt-0.5 text-[10px] text-slate-400 sm:text-xs">{s.sub}</p>
                  </li>
                ))}
              </ol>
            </div>
            <div className="mt-8 space-y-3 rounded-2xl bg-white/[0.04] p-4">
              {[
                { label: "Item", value: "Design workstation" },
                { label: "Total amount (RM)", value: "8,200.00" },
                { label: "Needed by", value: "Friday" },
              ].map((r) => (
                <div key={r.label} className="flex items-center justify-between gap-4 text-sm">
                  <span className="text-slate-400">{r.label}</span>
                  <span className="text-slate-100">{r.value}</span>
                </div>
              ))}
              <div className="flex items-center justify-between gap-4 border-t border-white/10 pt-3 text-sm">
                <span className="text-slate-400">Signature</span>
                <span className="font-serif text-lg text-slate-100 italic">Tan Mei Ling</span>
              </div>
            </div>
            <div className="mt-4 flex gap-2">
              <span className="flex-1 rounded-full bg-white py-2 text-center text-sm font-medium text-slate-950">Approve</span>
              <span className="rounded-full border border-white/15 px-4 py-2 text-sm text-white">Return</span>
              <span className="rounded-full border border-red-400/30 px-4 py-2 text-sm text-red-200">Reject</span>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}

function Security() {
  const items = [
    { icon: Building2, title: "Every company is sealed off", text: "Workspaces are isolated down to the database. Guessing an ID from another company returns “not found”." },
    { icon: Lock, title: "Private stays private", text: "Owners manage the workspace — they cannot read private channels, DMs or meetings they weren't invited to." },
    { icon: UserMinus, title: "Access ends instantly", text: "Deactivate or remove someone and their very next request is refused. Their history is kept." },
    { icon: FileLock2, title: "No public file links", text: "Files live in private storage. Every download checks who you are and what you're allowed to see." },
    { icon: Eye, title: "Audit log", text: "Role changes, removals, app installs and settings changes are recorded for owners and admins." },
    { icon: ShieldCheck, title: "Roles per workspace", text: "Owner, Admin, Manager or Staff — per company. Be an admin in one workspace and staff in another." },
  ]
  return (
    <section id="security" aria-labelledby="security-title" className="relative scroll-mt-20 border-y border-white/10 bg-white/[0.02] px-4 py-24 sm:px-6 lg:py-32">
      <div className="mx-auto max-w-7xl">
        <SectionHeading
          id="security-title"
          eyebrow="Security and privacy"
          title="Built for trust from the first line of code"
          text="Permissions are enforced on the server for every single request — not just hidden in the interface."
        />
        <ul className="mt-16 grid gap-px overflow-hidden rounded-3xl border border-white/10 bg-white/10 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((item) => (
            <li key={item.title} className="lp-reveal bg-slate-950 p-8">
              <item.icon className="size-6 text-emerald-400" aria-hidden />
              <h3 className="mt-4 font-semibold text-white">{item.title}</h3>
              <p className="mt-2 text-sm text-slate-400">{item.text}</p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  )
}

function HowItWorks() {
  const steps = [
    { icon: Building2, title: "Create your workspace", text: "Name your company, set your time zone and upload your logo. Takes about a minute." },
    { icon: UserPlus, title: "Invite your team", text: "Send secure, single-use invitations with the right role and department for each person." },
    { icon: LayoutGrid, title: "Install your apps", text: "Turn on Form, Approval, Project and more from the launcher — add others whenever you're ready." },
  ]
  return (
    <section aria-labelledby="how-title" className="relative px-4 py-24 sm:px-6 lg:py-32">
      <div className="mx-auto max-w-6xl">
        <SectionHeading id="how-title" eyebrow="Get started" title="Up and running before your next meeting" text="No installation, no IT project. Your team signs in from any browser." />
        <div className="relative mt-16">
        <div aria-hidden className="absolute top-6 right-[16%] left-[16%] hidden h-px bg-gradient-to-r from-transparent via-white/20 to-transparent md:block" />
        <ol className="relative grid gap-10 md:grid-cols-3">
          {steps.map((s, i) => (
            <li key={s.title} className="lp-reveal relative text-center">
              <span className="relative mx-auto flex size-12 items-center justify-center rounded-2xl border border-white/10 bg-slate-900 text-emerald-300 shadow-lg shadow-emerald-500/10">
                <s.icon className="size-5" aria-hidden />
                <span className="absolute -top-2 -right-2 flex size-5 items-center justify-center rounded-full bg-emerald-400 text-[11px] font-bold text-slate-950">{i + 1}</span>
              </span>
              <h3 className="mt-5 text-lg font-semibold text-white">{s.title}</h3>
              <p className="mx-auto mt-2 max-w-xs text-sm text-slate-400">{s.text}</p>
            </li>
          ))}
        </ol>
        </div>
      </div>
    </section>
  )
}

function Faq() {
  return (
    <section id="faq" aria-labelledby="faq-title" className="scroll-mt-20 px-4 py-24 sm:px-6 lg:py-32">
      <div className="mx-auto max-w-3xl">
        <SectionHeading id="faq-title" eyebrow="FAQ" title="Questions, answered" text="Anything else? Create a free workspace and look around — it takes a minute." />
        <div className="mt-12 divide-y divide-white/10 rounded-3xl border border-white/10 bg-white/[0.03]">
          {FAQS.map((f) => (
            <details key={f.q} className="group px-6 py-5 [&_summary::-webkit-details-marker]:hidden">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-medium text-white">
                {f.q}
                <ChevronDown className="size-5 shrink-0 text-slate-400 transition-transform group-open:rotate-180" aria-hidden />
              </summary>
              <p className="mt-3 text-slate-400">{f.a}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  )
}

function FinalCta() {
  return (
    <section aria-labelledby="cta-title" className="px-4 pb-24 sm:px-6 lg:pb-32">
      <div className="lp-reveal relative mx-auto max-w-6xl overflow-hidden rounded-[2rem] border border-white/10 bg-gradient-to-br from-teal-600 via-emerald-600 to-teal-800 px-6 py-16 text-center shadow-2xl shadow-emerald-500/20 sm:px-16 sm:py-20">
        <div aria-hidden className="lp-grid-bg absolute inset-0 opacity-60" />
        <div aria-hidden className="lp-blob absolute -top-24 -left-24 size-80 rounded-full bg-white/20 blur-3xl" />
        <div className="relative">
          <h2 id="cta-title" className="text-3xl font-semibold tracking-tight text-balance text-white sm:text-5xl">
            Bring your whole company into one space
          </h2>
          <p className="mx-auto mt-4 max-w-xl text-lg text-emerald-50/90">Free for teams of up to 10. Upgrade only when you&apos;re ready.</p>
          <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Link href="/register" className="inline-flex items-center gap-2 rounded-full bg-white px-6 py-3 font-medium text-emerald-900 shadow-lg transition hover:bg-emerald-50">
              Create your workspace <ArrowRight className="size-4" aria-hidden />
            </Link>
            <Link href="/login" className="rounded-full border border-white/40 px-6 py-3 text-white transition hover:bg-white/10">
              I already have an account
            </Link>
          </div>
        </div>
      </div>
    </section>
  )
}

function Footer() {
  return (
    <footer className="border-t border-white/10 px-4 py-12 sm:px-6">
      <div className="mx-auto flex max-w-7xl flex-col gap-8 md:flex-row md:items-start md:justify-between">
        <div className="max-w-xs">
          <p className="flex items-center gap-2 font-semibold text-white">
            <span className="flex size-7 items-center justify-center rounded-lg bg-gradient-to-br from-teal-400 to-emerald-600 text-xs font-bold">R</span>
            RakanSpace
          </p>
          <p className="mt-3 text-sm text-slate-400" lang="ms">
            Satu ruang. Satu pasukan.
          </p>
        </div>
        <nav aria-label="Footer" className="grid grid-cols-2 gap-8 text-sm sm:grid-cols-3">
          <div>
            <p className="font-medium text-white">Product</p>
            <ul className="mt-3 space-y-2 text-slate-400">
              <li><a href="#features" className="hover:text-white">Features</a></li>
              <li><a href="#apps" className="hover:text-white">Apps</a></li>
              <li><a href="#pricing" className="hover:text-white">Pricing</a></li>
            </ul>
          </div>
          <div>
            <p className="font-medium text-white">Company</p>
            <ul className="mt-3 space-y-2 text-slate-400">
              <li><a href="#security" className="hover:text-white">Security</a></li>
              <li><a href="#faq" className="hover:text-white">FAQ</a></li>
            </ul>
          </div>
          <div>
            <p className="font-medium text-white">Account</p>
            <ul className="mt-3 space-y-2 text-slate-400">
              <li><Link href="/login" className="hover:text-white">Sign in</Link></li>
              <li><Link href="/register" className="hover:text-white">Create workspace</Link></li>
            </ul>
          </div>
        </nav>
      </div>
      <p className="mx-auto mt-10 max-w-7xl border-t border-white/10 pt-6 text-xs text-slate-500">© RakanSpace. All rights reserved.</p>
    </footer>
  )
}
