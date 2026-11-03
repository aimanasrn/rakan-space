import { Award, Rocket, TrendingUp, Users, type LucideIcon } from "lucide-react"
import { cn } from "@/lib/utils"

/** Built-in banner illustrations, used when a banner has no uploaded image. */
const ILLUSTRATIONS: Record<string, { icon: LucideIcon; from: string; to: string; label: string }> = {
  excellence: { icon: Award, from: "#f59e0b", to: "#ef4444", label: "Award" },
  rocket: { icon: Rocket, from: "#6366f1", to: "#ec4899", label: "Rocket" },
  team: { icon: Users, from: "#14b8a6", to: "#3b82f6", label: "Team" },
  growth: { icon: TrendingUp, from: "#22c55e", to: "#0ea5e9", label: "Growth" },
}

export const ILLUSTRATION_OPTIONS = Object.entries(ILLUSTRATIONS).map(([value, { label }]) => ({ value, label }))

export function BannerIllustration({ name, className }: { name: string | null; className?: string }) {
  const art = ILLUSTRATIONS[name ?? ""] ?? ILLUSTRATIONS.excellence
  const Icon = art.icon
  return (
    <div aria-hidden className={cn("relative flex items-center justify-center", className)}>
      <div className="absolute size-32 rounded-full opacity-30 blur-2xl" style={{ background: art.from }} />
      <div className="absolute top-2 right-4 size-10 rounded-full opacity-60" style={{ background: art.to }} />
      <div className="absolute bottom-3 left-6 size-6 rounded-full bg-white/30" />
      <div
        className="relative flex size-24 rotate-3 items-center justify-center rounded-3xl text-white shadow-xl"
        style={{ backgroundImage: `linear-gradient(135deg, ${art.from}, ${art.to})` }}
      >
        <Icon className="size-12" strokeWidth={1.5} />
      </div>
    </div>
  )
}
