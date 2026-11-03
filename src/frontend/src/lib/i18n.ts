/**
 * Interface text, organised by area so a Bahasa Melayu dictionary ("ms")
 * can be added later with the same keys. Components call t("nav.chat").
 */
const en = {
  app: {
    name: "RakanSpace",
    tagline: "Satu ruang. Satu pasukan.",
  },
  nav: {
    overview: "Overview",
    chat: "Chat",
    projects: "Projects",
    myTasks: "My Tasks",
    calendar: "Calendar",
    announcements: "Announcements",
    files: "Files",
    reports: "Reports",
    members: "Members",
    settings: "Settings",
    search: "Search",
    notifications: "Notifications",
    profile: "Profile",
    workspace: "Workspace",
    collaborate: "Collaborate",
    manage: "Manage",
  },
  actions: {
    save: "Save changes",
    cancel: "Cancel",
    create: "Create",
    delete: "Delete",
    edit: "Edit",
    remove: "Remove",
    invite: "Invite",
    retry: "Retry",
    upload: "Upload",
    download: "Download",
    preview: "Preview",
    signOut: "Sign out",
    markAllRead: "Mark all as read",
    viewAll: "View all",
    back: "Back",
    continue: "Continue",
    skip: "Skip for now",
  },
  status: {
    todo: "To Do",
    in_progress: "In Progress",
    in_review: "In Review",
    done: "Done",
  },
  priority: {
    low: "Low",
    medium: "Medium",
    high: "High",
    urgent: "Urgent",
  },
  projectStatus: {
    planning: "Planning",
    active: "Active",
    on_hold: "On hold",
    completed: "Completed",
  },
  role: {
    owner: "Owner",
    admin: "Admin",
    manager: "Manager",
    staff: "Staff",
  },
  empty: {
    tasks: "No tasks here yet.",
    myTasks: "You have no open tasks. Nice work!",
    projects: "No projects yet.",
    events: "No upcoming events.",
    announcements: "No announcements yet.",
    files: "No files found.",
    notifications: "You're all caught up.",
    messages: "No messages yet. Start the conversation!",
    activity: "No recent activity.",
    search: "No results found.",
  },
  errors: {
    generic: "Something went wrong. Please try again.",
    notFound: "We couldn't find that page.",
    offline: "You're offline. Messages will be sent when you're back online.",
  },
} as const

type Dict = typeof en

type Join<K, P> = K extends string ? (P extends string ? `${K}.${P}` : never) : never
type Paths<T> = T extends string ? never : { [K in keyof T]: T[K] extends string ? K : Join<K, Paths<T[K]>> }[keyof T]
export type TranslationKey = Paths<Dict>

const dictionaries: Record<string, Dict> = { en }

let locale = "en"

export function setLocale(next: string) {
  if (dictionaries[next]) locale = next
}

export function t(key: TranslationKey, vars?: Record<string, string | number>): string {
  const value = key.split(".").reduce<unknown>((obj, part) => (obj as Record<string, unknown>)?.[part], dictionaries[locale])
  let text = typeof value === "string" ? value : key
  for (const [k, v] of Object.entries(vars ?? {})) text = text.replace(`{${k}}`, String(v))
  return text
}
