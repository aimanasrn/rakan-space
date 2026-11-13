/**
 * Landing page content in one place. Plans and prices are placeholders:
 * there is no billing in the product yet (see README "Future scope").
 * Change them here; nothing else needs to move.
 */

export const SALES_EMAIL = process.env.NEXT_PUBLIC_SALES_EMAIL || ""

export interface Plan {
  id: "starter" | "business" | "enterprise"
  name: string
  tagline: string
  /** Price per user per month in RM; null = free, "custom" = talk to us. */
  monthly: number | null | "custom"
  highlight?: boolean
  cta: string
  features: string[]
}

export const PLANS: Plan[] = [
  {
    id: "starter",
    name: "Starter",
    tagline: "For small teams getting organised.",
    monthly: null,
    cta: "Start free",
    features: ["Up to 10 members", "Chat, projects, tasks and calendar", "Announcements and files", "Form and Approval apps", "Email support"],
  },
  {
    id: "business",
    name: "Business",
    tagline: "For growing companies with real processes.",
    monthly: 15,
    highlight: true,
    cta: "Get started",
    features: [
      "Unlimited members and workspaces",
      "Every app in the launcher as it ships",
      "Approval workflows with conditions, SLAs and delegation",
      "Per-app permissions by role",
      "Audit log and reports",
      "Priority support",
    ],
  },
  {
    id: "enterprise",
    name: "Enterprise",
    tagline: "For organisations with special requirements.",
    monthly: "custom",
    cta: "Talk to us",
    features: ["Everything in Business", "Help moving from your current tools", "Dedicated onboarding", "Invoice billing"],
  },
]

/** Yearly billing discount shown by the pricing toggle. */
export const YEARLY_DISCOUNT = 0.2

/** Mirrors the backend app catalogue (App\Support\AppCatalog). "live" = usable today. */
export const APPS: { key: string; name: string; icon: string; gradient: [string, string]; tagline: string; live: boolean }[] = [
  { key: "form", name: "Form", icon: "clipboard-list", gradient: ["#6366f1", "#8b5cf6"], tagline: "Drag-and-drop forms with logic", live: true },
  { key: "approval", name: "Approval", icon: "badge-check", gradient: ["#10b981", "#059669"], tagline: "Workflows, inbox and delegation", live: true },
  { key: "project", name: "Project", icon: "folder-kanban", gradient: ["#0ea5e9", "#2563eb"], tagline: "Projects, tasks and Kanban", live: true },
  { key: "timesheet", name: "Timesheet", icon: "clock", gradient: ["#f59e0b", "#ea580c"], tagline: "Weekly time tracking", live: true },
  { key: "leave", name: "Leave", icon: "calendar-days", gradient: ["#06b6d4", "#2563eb"], tagline: "Leave balances and calendar", live: true },
  { key: "helpdesk", name: "Helpdesk", icon: "life-buoy", gradient: ["#ef4444", "#db2777"], tagline: "Tickets, SLAs, canned replies", live: true },
  { key: "opportunity", name: "Opportunity", icon: "trending-up", gradient: ["#14b8a6", "#0891b2"], tagline: "Sales pipeline and forecasts", live: true },
  { key: "lms", name: "LMS", icon: "graduation-cap", gradient: ["#a855f7", "#7c3aed"], tagline: "Courses and certificates", live: false },
  { key: "checkin", name: "CheckIn", icon: "map-pin", gradient: ["#22c55e", "#16a34a"], tagline: "GPS attendance", live: false },
  { key: "videcard", name: "Videcard", icon: "contact", gradient: ["#f43f5e", "#e11d48"], tagline: "Digital business cards", live: false },
]

export const FAQS: { q: string; a: string }[] = [
  {
    q: "Who is RakanSpace for?",
    a: "Companies of any size that want team chat, projects, approvals and forms in one place instead of five separate tools. It is built with Malaysian teams in mind: Asia/Kuala_Lumpur time zone by default and Bahasa Melayu on the way.",
  },
  {
    q: "Can one person belong to several companies?",
    a: "Yes. A person can join many workspaces, with a different role in each. Switching takes one click, and nothing from one workspace is ever visible in another.",
  },
  {
    q: "Can owners read private channels and direct messages?",
    a: "No. Owner and Admin rights cover managing the workspace, not reading private conversations or private events they were not invited to.",
  },
  {
    q: "What happens when someone leaves the company?",
    a: "Remove them and their access ends on their very next request. Their messages, files and history stay, their open approvals are handed on, and their other workspaces are not affected.",
  },
  {
    q: "How do approvals work?",
    a: "Design a workflow once: who approves (a person, a role or the requester's manager), in which order, extra steps above an amount, time limits with reminders and escalation. Attach it to any form, and every submission follows it with a full history.",
  },
  {
    q: "Where are files stored?",
    a: "In private storage (local or any S3-compatible service). Every download is permission-checked; there are no public links.",
  },
]
