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
  manage_apps: boolean
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
  manager?: UserSummary | null
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

// ------------------------------------------------------------- App launcher

export type AppAbility = "view" | "create" | "edit" | "delete" | "approve" | "admin"
export type ConfigurableRole = "manager" | "staff"

export interface LauncherAppBase {
  id: number
  key: string
  name: string
  tagline: string
  description: string
  icon: string
  gradient: [string, string]
  category: string
  /** Workspace-relative path, e.g. "/apps/form". */
  path: string
}

export interface InstalledApp extends LauncherAppBase {
  pinned: boolean
  abilities: AppAbility[]
}

export interface MarketplaceApp extends LauncherAppBase {
  request_pending: boolean
}

export interface LauncherBanner {
  id: number
  title: string
  description: string | null
  cta_label: string | null
  cta_url: string | null
  image_url: string | null
  illustration: string | null
  is_active: boolean
  is_live: boolean
  sort_order: number
  starts_at: string | null
  ends_at: string | null
  updated_at: string | null
}

export interface LauncherData {
  banners: LauncherBanner[]
  installed: InstalledApp[]
  marketplace: MarketplaceApp[]
  can_manage: boolean
}

export interface AdminApp extends LauncherAppBase {
  installed: boolean
  installed_at: string | null
  role_abilities: Record<ConfigurableRole, AppAbility[]>
  pending_requests: number
}

export interface AppAccessRequest {
  id: number
  status: "pending" | "approved" | "rejected"
  note: string | null
  app: LauncherAppBase
  user: UserSummary
  decided_by: UserSummary | null
  decided_at: string | null
  created_at: string
}

// ----------------------------------------------------------------- Approval

export type ConditionOperator = "eq" | "neq" | "gt" | "gte" | "lt" | "lte" | "contains" | "filled" | "empty"

export interface Condition {
  field: string
  operator: ConditionOperator
  value?: string | number | null
}

export type ApproverDefinition =
  | { type: "user"; user_id: number; user?: UserSummary | null }
  | { type: "role"; role: Role }
  | { type: "manager" }

export interface WorkflowStep {
  id?: number
  position?: number
  name: string
  mode: "any" | "all"
  approvers: ApproverDefinition[]
  condition: Condition | null
  sla_hours: number | null
  escalate_to: UserSummary | null
}

export interface ApprovalWorkflow {
  id: number
  name: string
  description: string | null
  is_active: boolean
  steps_count?: number
  requests_count?: number
  steps?: WorkflowStep[]
  created_by?: UserSummary | null
  updated_at: string
}

export type ApprovalStatus = "pending" | "approved" | "rejected" | "returned" | "cancelled"

export interface ApprovalRequestSummary {
  id: number
  title: string
  summary: string | null
  status: ApprovalStatus
  entity_type: string
  entity_id: number | null
  link: string | null
  round: number
  requester: UserSummary
  workflow: { id: number; name: string } | null
  current_step: { id: number; name: string; position: number; due_at: string | null; overdue: boolean; waiting_on: string[] } | null
  my_turn: boolean
  submitted_at: string
  completed_at: string | null
}

export interface ApprovalStepDetail {
  id: number
  position: number
  name: string
  mode: "any" | "all"
  status: "waiting" | "pending" | "approved" | "rejected" | "returned" | "skipped" | "cancelled"
  condition: Condition | null
  activated_at: string | null
  completed_at: string | null
  due_at: string | null
  approvers: {
    user: UserSummary | null
    source: string
    delegated_from: UserSummary | null
    decision: "approved" | "rejected" | "returned" | null
    comment: string | null
    decided_at: string | null
  }[]
}

export interface ApprovalRequestDetail extends ApprovalRequestSummary {
  data: Record<string, unknown>
  rounds: { round: number; steps: ApprovalStepDetail[] }[]
  history: {
    id: number
    action: string
    actor: UserSummary | null
    comment: string | null
    step: string | null
    properties: Record<string, unknown> | null
    created_at: string
  }[]
  permissions: { decide: boolean; resubmit: boolean; cancel: boolean }
}

export interface ApprovalSummary {
  inbox: number
  my_pending: number
  my_returned: number
  overdue: number
  can_create: boolean
  can_manage: boolean
}

export interface ApprovalDelegation {
  id: number
  delegator: UserSummary
  delegate: UserSummary
  starts_at: string
  ends_at: string
  reason: string | null
  status: "active" | "scheduled" | "ended" | "revoked"
  can_revoke: boolean
}

// --------------------------------------------------------------------- Form

export type FieldType = "text" | "textarea" | "number" | "date" | "dropdown" | "radio" | "checkbox" | "file" | "signature" | "table"
export type TableColumnType = "text" | "number" | "date" | "dropdown"

export interface TableColumn {
  key?: string
  label: string
  type: TableColumnType
  choices?: string[]
}

export interface FormFieldDef {
  key: string
  type: FieldType
  label: string
  help_text: string | null
  required: boolean
  options: { choices?: string[]; columns?: TableColumn[] } | null
  validation: { min?: number; max?: number; min_length?: number; max_length?: number; max_files?: number; max_rows?: number } | null
  visibility: Condition | null
}

export type FormStatus = "draft" | "published" | "closed"

export interface FormSummary {
  id: number
  name: string
  description: string | null
  status: FormStatus
  audience: { roles: Role[]; department_ids: number[] }
  workflow: { id: number; name: string } | null
  allow_multiple: boolean
  version: number | null
  has_unpublished_changes?: boolean
  submissions_count?: number
  my_submissions_count?: number
  created_by: UserSummary | null
  published_at: string | null
  updated_at: string
  permissions: { manage: boolean; delete: boolean; fill: boolean }
}

export interface FormDetail extends FormSummary {
  fields: FormFieldDef[]
  draft_fields: FormFieldDef[] | null
}

export type SubmissionStatus = "submitted" | "pending_approval" | "approved" | "rejected" | "returned" | "withdrawn"

export interface FormSubmissionSummary {
  id: number
  reference: string
  status: SubmissionStatus
  form: { id: number; name: string }
  version: number
  submitter: UserSummary
  approval_request_id: number | null
  submitted_at: string
  updated_at: string
  permissions: { resubmit: boolean; withdraw: boolean }
}

export interface FormSubmissionDetail extends FormSubmissionSummary {
  fields: FormFieldDef[]
  values: Record<string, unknown>
  attachments: Attachment[]
  approval: { id: number; status: ApprovalStatus; current_step: string | null; can_view: boolean } | null
}

// ---------------------------------------------------------------- Timesheet

export type TimesheetStatus = "draft" | "pending_approval" | "approved" | "rejected" | "returned"

export interface TimesheetEntry {
  id?: number
  project_id: number | null
  task_id: number | null
  project_name: string | null
  task_title: string | null
  /** YYYY-MM-DD */
  work_date: string
  minutes: number
  note: string | null
}

export interface TimesheetSummary {
  /** null for a week with nothing saved yet */
  id: number | null
  week_start: string
  week_end: string
  status: TimesheetStatus
  total_minutes: number
  user?: UserSummary
  approval_request_id: number | null
  submitted_at: string | null
  updated_at: string | null
  permissions: { edit: boolean; submit: boolean; withdraw: boolean }
}

export interface TimesheetDetail extends TimesheetSummary {
  entries: TimesheetEntry[]
  approval: {
    id: number
    status: ApprovalStatus
    current_step: string | null
    can_view: boolean
    comment: string | null
    decided_by: string | null
  } | null
}

export interface TimesheetProjectOption {
  id: number
  name: string
}

export interface TimesheetTaskOption {
  id: number
  title: string
  status: TaskStatus
  assigned_to_me: boolean
}

export type TimesheetReportGroup = "project" | "member" | "task" | "week"

export interface TimesheetReport {
  from: string
  to: string
  group_by: TimesheetReportGroup
  total_minutes: number
  members: number
  rows: { key: string; label: string; sublabel: string | null; minutes: number }[]
}

export interface TimesheetSettings {
  workflow_id: number | null
  workflows: { id: number; name: string; description: string | null; steps_count: number }[]
}

// ----------------------------------------------------------------- Helpdesk

export type TicketStatus = "open" | "in_progress" | "waiting" | "resolved" | "closed"
export type TicketPriority = "low" | "medium" | "high" | "urgent"
export type SlaState = "met" | "missed" | "due_soon" | "pending" | "none"

export interface SlaTarget {
  due_at: string | null
  met_at: string | null
  state: SlaState
}

export interface TicketSummary {
  id: number
  reference: string
  subject: string
  status: TicketStatus
  priority: TicketPriority
  category: string | null
  requester: UserSummary
  assignee: UserSummary | null
  sla: { first_response: SlaTarget; resolution: SlaTarget }
  created_at: string
  last_activity_at: string | null
  resolved_at: string | null
  closed_at: string | null
}

export interface TicketMessage {
  id: number
  body: string
  internal: boolean
  author: UserSummary | null
  from_requester: boolean
  attachments: Attachment[]
  created_at: string
}

export interface TicketDetail extends TicketSummary {
  description: string
  attachments: Attachment[]
  messages: TicketMessage[]
  activity: { id: number; event: string; actor: string | null; from: string | null; to: string | null; created_at: string }[]
  permissions: { work: boolean; reply: boolean; resolve: boolean; delete: boolean }
}

export interface HelpdeskSummary {
  is_agent: boolean
  can_raise: boolean
  can_manage: boolean
  categories: string[]
  counts: { my_open: number; assigned: number | null; unassigned: number | null; missed: number | null }
}

export interface CannedResponse {
  id: number
  title: string
  body: string
}

export interface HelpdeskSettings {
  sla: Record<TicketPriority, { first_response_hours: number; resolution_hours: number }>
  categories: string[]
  auto_close_days: number
  agents: UserSummary[]
}

// -------------------------------------------------------- Opportunity (CRM)

export type StageKind = "open" | "won" | "lost"

export interface CrmStage {
  id: number
  name: string
  position: number
  probability: number
  kind: StageKind
}

export interface CrmRef {
  id: number
  name: string
}

export interface CrmSummary {
  can_create: boolean
  see_all: boolean
  can_delete: boolean
  can_manage_pipeline: boolean
  currency: string
  stages: CrmStage[]
  open_tasks: number
}

export interface CrmOpportunity {
  id: number
  name: string
  amount: number
  stage_id: number
  account: CrmRef | null
  contact: CrmRef | null
  owner: UserSummary | null
  expected_close_date: string | null
  lost_reason: string | null
  closed_at: string | null
  position: number
  updated_at: string | null
  permissions: { edit: boolean }
}

export type CrmActivityType = "note" | "call" | "meeting" | "email" | "task"

export interface CrmActivity {
  id: number
  type: CrmActivityType
  subject: string
  body: string | null
  due_at: string | null
  done_at: string | null
  user: UserSummary | null
  opportunity: CrmRef | null
  account: CrmRef | null
  created_at: string
  permissions: { edit: boolean }
}

export interface CrmOpportunityDetail extends CrmOpportunity {
  description: string | null
  activities: CrmActivity[]
  history: { id: number; event: string; actor: string | null; from: string | null; to: string | null; created_at: string }[]
  permissions: { edit: boolean; delete: boolean; reassign: boolean }
}

export interface CrmAccount {
  id: number
  name: string
  industry: string | null
  website: string | null
  phone: string | null
  address: string | null
  notes: string | null
  owner: UserSummary | null
  contacts_count: number | null
  updated_at: string | null
  permissions: { edit: boolean; delete: boolean }
}

export interface CrmContact {
  id: number
  name: string
  email: string | null
  phone: string | null
  job_title: string | null
  account: CrmRef | null
  permissions: { edit: boolean; delete: boolean }
}

export interface CrmAccountDetail extends CrmAccount {
  contacts: CrmContact[]
  opportunities: CrmOpportunity[]
  activities: CrmActivity[]
}

export interface CrmForecast {
  currency: string
  current_month: string
  months: { month: string; open_amount: number; weighted_amount: number; won_amount: number; count: number }[]
  overdue: { open_amount: number; weighted_amount: number; count: number }
  undated: { open_amount: number; weighted_amount: number; count: number }
  stages: (CrmStage & { count: number; amount: number })[]
}
