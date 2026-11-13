import {
  AppWindow,
  BadgeCheck,
  CalendarDays,
  ClipboardList,
  Clock,
  Contact,
  FolderKanban,
  GraduationCap,
  LifeBuoy,
  MapPin,
  TrendingUp,
  type LucideIcon,
} from "lucide-react"
import type { LauncherAppBase } from "@/lib/types"
import { cn } from "@/lib/utils"

const ICONS: Record<string, LucideIcon> = {
  "clipboard-list": ClipboardList,
  "badge-check": BadgeCheck,
  "folder-kanban": FolderKanban,
  clock: Clock,
  "calendar-days": CalendarDays,
  "life-buoy": LifeBuoy,
  "trending-up": TrendingUp,
  "graduation-cap": GraduationCap,
  "map-pin": MapPin,
  contact: Contact,
}

/** The plain Lucide icon for an app (used in menus such as the sidebar). */
export function appIconComponent(icon: string): LucideIcon {
  return ICONS[icon] ?? AppWindow
}

/** Rounded gradient app icon. Decorative: the app name is always shown next to it. */
export function AppIcon({
  app,
  size = "lg",
  className,
}: {
  app: Pick<LauncherAppBase, "icon" | "gradient">
  size?: "sm" | "md" | "lg"
  className?: string
}) {
  const Icon = ICONS[app.icon] ?? AppWindow
  return (
    <span
      aria-hidden
      className={cn(
        "inline-flex shrink-0 items-center justify-center text-white shadow-sm",
        size === "lg" && "size-[60px] rounded-2xl [&_svg]:size-7",
        size === "md" && "size-10 rounded-xl [&_svg]:size-5",
        size === "sm" && "size-4 rounded-[5px] [&_svg]:size-2.5",
        className,
      )}
      style={{ backgroundImage: `linear-gradient(135deg, ${app.gradient[0]}, ${app.gradient[1]})` }}
    >
      <Icon />
    </span>
  )
}
