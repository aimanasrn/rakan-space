"use client"

import {
  BarChart3,
  Building2,
  CalendarDays,
  Check,
  ChevronsUpDown,
  FolderKanban,
  FolderOpen,
  LayoutDashboard,
  ListChecks,
  Megaphone,
  MessagesSquare,
  Plus,
  Settings,
  Users,
} from "lucide-react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { BrandMark } from "@/components/common"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  useSidebar,
} from "@/components/ui/sidebar"
import { useConversations } from "@/hooks/use-workspace-data"
import { t, type TranslationKey } from "@/lib/i18n"
import { useWorkspace } from "./workspace-context"

interface NavItem {
  key: TranslationKey
  path: string
  icon: typeof LayoutDashboard
  show?: boolean
  badge?: number
}

export function AppSidebar() {
  const { org, me, slug, href } = useWorkspace()
  const pathname = usePathname()
  const { setOpenMobile } = useSidebar()
  const { data: conversations } = useConversations(slug)
  const unreadChat = (conversations ?? []).reduce((sum, c) => sum + (c.is_member ? c.unread_count : 0), 0)

  const groups: { label: TranslationKey; items: NavItem[] }[] = [
    {
      label: "nav.workspace",
      items: [
        { key: "nav.overview", path: "", icon: LayoutDashboard },
        { key: "nav.chat", path: "/chat", icon: MessagesSquare, badge: unreadChat },
        { key: "nav.projects", path: "/projects", icon: FolderKanban },
        { key: "nav.myTasks", path: "/tasks", icon: ListChecks },
        { key: "nav.calendar", path: "/calendar", icon: CalendarDays },
      ],
    },
    {
      label: "nav.collaborate",
      items: [
        { key: "nav.announcements", path: "/announcements", icon: Megaphone },
        { key: "nav.files", path: "/files", icon: FolderOpen },
        { key: "nav.reports", path: "/reports", icon: BarChart3, show: org.permissions.view_reports },
      ],
    },
    {
      label: "nav.manage",
      items: [
        { key: "nav.members", path: "/members", icon: Users },
        { key: "nav.settings", path: "/settings", icon: Settings },
      ],
    },
  ]

  const isActive = (path: string) => {
    const full = href(path)
    return path === "" ? pathname === full : pathname === full || pathname.startsWith(full + "/")
  }

  return (
    <Sidebar collapsible="icon" variant="sidebar">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <SidebarMenuButton size="lg" className="data-[state=open]:bg-sidebar-accent" aria-label={`Current workspace: ${org.name}. Switch workspace`}>
                  {org.logo_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={org.logo_url} alt="" className="size-8 rounded-lg object-cover" />
                  ) : (
                    <BrandMark />
                  )}
                  <span className="grid flex-1 text-left leading-tight">
                    <span className="truncate font-semibold">{org.name}</span>
                    <span className="truncate text-xs text-muted-foreground">{t(`role.${org.membership.role}`)}</span>
                  </span>
                  <ChevronsUpDown className="ml-auto size-4" aria-hidden />
                </SidebarMenuButton>
              </DropdownMenuTrigger>
              <DropdownMenuContent className="w-64" align="start">
                <DropdownMenuLabel className="text-xs text-muted-foreground">Workspaces</DropdownMenuLabel>
                {me.organizations.map((o) => (
                  <DropdownMenuItem key={o.id} asChild>
                    <Link href={`/w/${o.slug}`} onClick={() => setOpenMobile(false)}>
                      <Building2 aria-hidden />
                      <span className="flex-1 truncate">{o.name}</span>
                      {o.slug === slug ? <Check className="size-4" aria-label="Current" /> : null}
                    </Link>
                  </DropdownMenuItem>
                ))}
                <DropdownMenuSeparator />
                <DropdownMenuItem asChild>
                  <Link href="/onboarding?step=create">
                    <Plus aria-hidden /> Create workspace
                  </Link>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        {groups.map((group) => (
          <SidebarGroup key={group.label}>
            <SidebarGroupLabel>{t(group.label)}</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {group.items
                  .filter((i) => i.show !== false)
                  .map((item) => (
                    <SidebarMenuItem key={item.key}>
                      <SidebarMenuButton asChild isActive={isActive(item.path)} tooltip={t(item.key)}>
                        <Link href={href(item.path)} onClick={() => setOpenMobile(false)} aria-current={isActive(item.path) ? "page" : undefined}>
                          <item.icon aria-hidden />
                          <span>{t(item.key)}</span>
                        </Link>
                      </SidebarMenuButton>
                      {item.badge ? (
                        <SidebarMenuBadge className="rounded-full bg-primary text-primary-foreground" aria-label={`${item.badge} unread`}>
                          {item.badge > 99 ? "99+" : item.badge}
                        </SidebarMenuBadge>
                      ) : null}
                    </SidebarMenuItem>
                  ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>
      <SidebarFooter>
        <p className="px-2 text-xs text-muted-foreground group-data-[collapsible=icon]:hidden">{t("app.tagline")}</p>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  )
}
