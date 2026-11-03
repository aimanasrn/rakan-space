export type Role = "owner" | "admin" | "manager" | "staff"
export type TaskStatus = "todo" | "in_progress" | "in_review" | "done"
export type TaskPriority = "low" | "medium" | "high" | "urgent"
export type ProjectStatus = "planning" | "active" | "on_hold" | "completed"

export interface UserSummary {
  id: number
  name: string
  avatar_url: string | null
  job_title: string | null
}

export interface OrganizationSummary {
  id: number
  name: string
  slug: string
  description: string | null
  timezone: string
  industry: string | null
  website: string | null
  logo_url: string | null
  onboarding_completed: boolean
  role: Role
}

export interface Me {
  id: number
  name: string
  email: string
  email_verified: boolean
  avatar_url: string | null
  job_title: string | null
  phone: string | null
  organizations: OrganizationSummary[]
}

export interface OrgPermissions {
  manage_settings: boolean
  manage_members: boolean
  invite_members: boolean
  assignable_roles: Role[]
  manage_departments: boolean
  transfer_ownership: boolean
  view_audit_log: boolean
  create_projects: boolean
  publish_announcements: boolean
  create_org_events: boolean
  view_reports: boolean
}

export interface Organization extends Omit<OrganizationSummary, "role"> {
  membership: { id: number; role: Role }
  members_count: number
  permissions: OrgPermissions
  created_at: string
}

export interface Department {
  id: number
  name: string
  description: string | null
  members_count?: number
  members?: UserSummary[]
}

export interface Membership {
  id: number
  role: Role
  status: "active" | "deactivated" | "removed"
  joined_at: string | null
  user: UserSummary & { email: string; phone: string | null }
  departments?: Department[]
}

export interface Invitation {
  id: number
  email: string
  role: Role
  status: "pending" | "accepted" | "revoked" | "expired"
  department: { id: number; name: string } | null
  invited_by: UserSummary | null
  expires_at: string
  last_sent_at: string | null
  created_at: string
}

export interface Attachment {
  id: number
  name: string
  extension: string
  mime_type: string
  size: number
  is_image: boolean
  previewable: boolean
  download_url: string
  preview_url: string | null
  uploader?: UserSummary | null
  source: string | null
  source_id: number | null
  created_at: string
  context?: { type: string; label: string; sublabel: string | null; link: string } | null
}

export interface Project {
  id: number
  name: string
  description: string | null
  status: ProjectStatus
  visibility: "organization" | "restricted"
  start_date: string | null
  target_date: string | null
  archived: boolean
  archived_at: string | null
  manager?: UserSummary | null
  members?: { role: "manager" | "member"; user: UserSummary }[]
  members_count?: number
  progress?: { total: number; done: number; open: number; overdue: number; percent: number }
  permissions?: { manage: boolean; contribute: boolean }
  created_at: string
  updated_at: string
}

export interface ChecklistItem {
  id: number
  body: string
  is_done: boolean
  position: number
}

export interface Task {
  id: number
  project_id: number
  project?: { id: number; name: string }
  title: string
  description: string | null
  status: TaskStatus
  priority: TaskPriority
  due_date: string | null
  position: number
  completed_at: string | null
  assignee?: UserSummary | null
  creator?: UserSummary | null
  checklist?: ChecklistItem[]
  checklist_total?: number
  checklist_done?: number
  comments_count?: number
  attachments?: Attachment[]
  permissions?: { update: boolean; delete: boolean }
  created_at: string
  updated_at: string
}

export interface TaskComment {
  id: number
  body: string
  user: UserSummary | null
  can_delete: boolean
  created_at: string
}

export interface Activity {
  id: number
  event: string
  actor: UserSummary | null
  subject_type: string | null
  subject_id: number | null
  project_id: number | null
  properties: Record<string, unknown>
  created_at: string
}

export interface Conversation {
  id: number
  type: "channel" | "direct"
  name: string
  topic: string | null
  visibility: "public" | "private"
  archived: boolean
  is_member: boolean
  partner: UserSummary | null
  last_read_message_id: number | null
  unread_count: number
  last_message_at: string | null
}

export interface ConversationDetail extends Conversation {
  members: { role: "admin" | "member"; user: UserSummary }[]
  permissions: { post: boolean; manage: boolean; join: boolean; leave: boolean }
}

export interface Message {
  id: number
  conversation_id: number
  client_id: string
  user: UserSummary | null
  user_id: number | null
  body: string | null
  mentions: number[]
  parent: { id: number; user_name: string | null; excerpt: string | null; deleted: boolean } | null
  attachments: Attachment[]
  edited: boolean
  deleted: boolean
  created_at: string
  edited_at: string | null
}

export interface CalendarEvent {
  id: number
  title: string
  description: string | null
  location: string | null
  meeting_url: string | null
  starts_at: string
  ends_at: string
  audience: "everyone" | "participants"
  reminder_minutes: number | null
  creator: UserSummary | null
  participants: UserSummary[]
  can_manage: boolean
}

export interface Deadline {
  id: number
  title: string
  due_date: string
  status: TaskStatus
  priority: TaskPriority
  project: { id: number; name: string }
  assignee: UserSummary | null
}

export interface Announcement {
  id: number
  title: string
  body: string
  audience: "organization" | "department"
  department: { id: number; name: string } | null
  author: UserSummary | null
  pinned: boolean
  requires_acknowledgement: boolean
  acknowledged: boolean
  acknowledgements_count: number
  attachments: Attachment[]
  can_manage: boolean
  created_at: string
  updated_at: string
}

export interface AppNotification {
  id: string
  type: string
  title: string
  body: string | null
  link: string | null
  actor: UserSummary | null
  read: boolean
  created_at: string
}

export interface Paginated<T> {
  data: T[]
  meta: { current_page: number; last_page: number; total: number; per_page?: number; [key: string]: unknown }
  links?: unknown
}
