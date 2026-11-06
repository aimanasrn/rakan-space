# Permission matrix

Roles belong to an **organisation membership**, not to the user. The same person
can be an Owner in one workspace and Staff in another. Every API request under
`/api/orgs/{slug}` re-reads the caller's *active* membership, so role changes,
deactivation and removal take effect on the very next request.

All rules live in the backend: [`app/Support/Permissions.php`](../src/backend/app/Support/Permissions.php)
(resource access, also used by search, the files list and real-time channel
authorisation) and the controllers' role checks. The frontend only hides
controls; it never decides access.

## Organisation-level roles

| Capability | Owner | Admin | Manager | Staff |
|---|:-:|:-:|:-:|:-:|
| View workspace, member directory, departments | ✓ | ✓ | ✓ | ✓ |
| Edit organisation profile, logo, time zone | ✓ | ✓ | – | – |
| Invite members (resend / revoke invitations) | ✓ | ✓ | – | – |
| Roles that can be granted by invitation | Admin, Manager, Staff | Manager, Staff | – | – |
| Change roles | any role (incl. Owner) | Manager ↔ Staff only | – | – |
| Act on Owners / Admins (role, deactivate, remove) | ✓ | – | – | – |
| Deactivate / reactivate / remove members | ✓ | ✓ (not Owners/Admins) | – | – |
| Transfer ownership | ✓ | – | – | – |
| Manage departments and department members | ✓ | ✓ | – | – |
| View audit log | ✓ | ✓ | – | – |
| Set a member's reporting manager | ✓ | ✓ | – | – |
| Install / uninstall apps, set app permissions, decide access requests | ✓ | ✓ | – | – |
| Manage launcher banners | ✓ | ✓ | – | – |
| Request access to a marketplace app | – (install directly) | – (install directly) | ✓ | ✓ |
| Create projects | ✓ | ✓ | ✓ | – |
| View **all** projects (incl. restricted), manage any project | ✓ | ✓ | – | – |
| Delete projects (others can archive) | ✓ | ✓ | – | – |
| Publish announcements – whole organisation | ✓ | ✓ | ✓ | – |
| Publish announcements – a department | ✓ (any) | ✓ (any) | ✓ (own departments) | – |
| Create organisation-wide events | ✓ | ✓ | ✓ | – |
| Create events for selected participants | ✓ | ✓ | ✓ | ✓ |
| Create channels, start direct messages | ✓ | ✓ | ✓ | ✓ |
| View reports (limited to projects they can access) | ✓ | ✓ | ✓ | – |
| Leave the workspace | ✓ (not the final Owner) | ✓ | ✓ | ✓ |

**Final Owner protection.** The last active Owner cannot be demoted, deactivated,
removed or leave. Ownership must be transferred first (password confirmation
required). Owner can never be granted through an invitation.

**Privilege escalation.** Nobody can change their own role through the members
API, and an invitation's role is validated against the inviter's assignable roles.

## Resource-level rules

Organisation membership alone does **not** grant access to private channels,
direct messages or restricted projects. Owner/Admin management rights deliberately
do **not** include private conversations.

| Resource | Who can see it | Who can change it |
|---|---|---|
| Public channel | Every active member (read, then join to post) | Channel admins; org Owners/Admins may moderate (rename, archive, remove messages) |
| Private channel | Channel members only (not Owners/Admins) | Channel admins |
| Direct message | The two participants only | Author edits/deletes own messages |
| Message | Anyone who can see the conversation | Author edits; author or channel admin deletes |
| Project – "members only" | Project members, org Owners/Admins | Project managers, org Owners/Admins |
| Project – "organisation" | Every active member (read-only for non-members) | Project managers, org Owners/Admins |
| Task | Anyone who can see the project | Edit/status: assignee, creator (while a project member), project managers, Owners/Admins. Delete: project managers, Owners/Admins |
| Task comment / files | Anyone who can see the project | Project members add; author or project manager deletes |
| Event – participants | Participants and the organiser (not other Owners/Admins) | Organiser; Owners/Admins only if they are participants |
| Event – everyone | Every active member | Organiser, Owners/Admins |
| Announcement – organisation | Every active member | Author, Owners/Admins |
| Announcement – department | Department members, author, Owners/Admins | Author, Owners/Admins |
| Acknowledgement status | Author, Owners/Admins | – |
| Attachment | Follows its parent's **current** permissions. Unattached uploads: uploader only | Uploader; or whoever manages the parent |
| Notifications | The recipient, within that organisation | The recipient (mark read) |

Archived projects are read-only for everyone.

## Apps (launcher)

Apps are installed per organisation. Inside an installed app, each member has
abilities from this list: **view, create, edit, delete, approve, admin**. Every
ability implies *view*; a role with no abilities does not see the app at all
(the launcher hides it and `GET /apps/{key}` returns 404).

| Role | Default abilities | Configurable |
|---|---|:-:|
| Owner, Admin | all | – (always all) |
| Manager | view, create, edit, approve (Form: view, create, approve) | ✓ per app |
| Staff | view, create (Form: view) | ✓ per app |

Rules (`Permissions::appAbilitiesMap()`, `canUseApp()`, `canManageApps()`):

- App abilities cover only the app's own data. They never open private
  channels, direct messages or private events.
- Pins are per user and only possible for apps the user can open.
- Banners are visible to members while active and inside their start/end
  window; Owners/Admins also see inactive ones. Banner images follow the same rule.
- Uninstalling removes the app and everyone's pins; role settings are kept for
  a reinstall. Removing a member deletes their pins and pending requests in
  that workspace only, and clears them as reporting manager of others there.

### Form

All `/forms` and `/form-submissions` endpoints require the Form app to be
installed and the role to have **view** (otherwise 404).

| Ability | Meaning |
|---|---|
| view | Fill in published forms you are in the audience for; see your own responses |
| create | Build forms; manage (edit, publish, close, see responses of) forms **you created** |
| edit | Manage **every** form |
| delete | Delete any form (only forms without responses can be deleted) |
| admin | See every response in the workspace |

- **Audience**: roles and/or departments; empty = everyone. Members outside the
  audience get 404 for the form, even with the ID.
- **A response is visible to**: the person who submitted it, people who manage
  its form, Form admins, and participants of its approval request. Its files
  follow the same rule (they do not appear in the Files page or search).
- Uploaded files must be the submitter's own, not yet attached uploads.

### Approval

| Who | Can |
|---|---|
| Requester | See the request, withdraw it, resubmit it when returned |
| Approver on any step (incl. the person who delegated, escalation and admin-cover approvers) | See the request; decide only while it is their turn |
| Approval **admin** ability (Owners/Admins by default) | Design workflows, see every request (**All requests**) |
| Approval **create** ability | Make requests directly in the Approval app |
| Anyone else | 404 |

- Being an approver does not need the Approval app; a request never gets stuck
  because a role lost the app.
- The requester is never an approver of their own request. If a step resolves to
  nobody, Owners/Admins approve instead ("admin cover"), so nothing is approved
  automatically. Reject and return need a comment.
- Delegations are created by the delegator for themselves only. The delegate must
  be an active member of the same workspace.

### Timesheet

All `/timesheet/*` endpoints require the Timesheet app to be installed and the
role to have **view** (otherwise 404).

| Ability | Meaning |
|---|---|
| view | Log, submit and withdraw your own weeks; see your team's sheets (below) |
| admin | See every timesheet (**All timesheets**), workspace-wide reports, choose the approval workflow |

| Who | Can see a timesheet |
|---|---|
| Its owner | Always; only the owner changes or withdraws it |
| The owner's **current** reporting manager | Yes (follows the reporting line, so a new manager takes over) |
| Participants of its approval request (and Approval admins) | Yes |
| Timesheet **admin** ability (Owners/Admins by default) | Every sheet |
| Anyone else | 404 |

- Time can be logged only to projects the member contributes to (project member
  or manager, not archived) and to tasks of that project, or as **General** time.
  Projects or tasks that don't exist, belong to another workspace or are not
  available to the member all get the same validation message. Rows already on
  a sheet may stay after the project is archived or the member leaves it.
- People who can see a sheet see the project and task names on it, even for a
  restricted project they are not on (they need them to approve the week).
- **Reports** count submitted and approved weeks only (never drafts): the sheets
  the member can see, plus all hours on projects they manage. Admins see everything.
- Submitted weeks go through the workflow chosen in Timesheet settings. By default
  a "Timesheet approval" workflow (reporting manager, admin cover when there is
  none) is created on first use. Pending and approved weeks are locked.

## Real-time channels

| Channel | Authorised when |
|---|---|
| `private-user.{id}` | The authenticated user's own id |
| `private-conversation.{id}` | `Permissions::canViewConversation()` at subscribe time |

Broadcast payloads carry identifiers only (`message_id`, `client_id`, …). Clients
fetch content through the API, which re-checks permissions. A connection that was
authorised before access was revoked therefore never receives new content, and
re-subscribing is refused. When access is removed the server also sends
`access.revoked` on the user channel so the UI navigates away immediately.

## Membership removal

Removing a member (status `removed`):

- revokes workspace access immediately (all routes return 404);
- deletes their channel, project and department memberships **in that workspace only**;
- removes them from future events in that workspace;
- unassigns their open tasks (completed tasks keep the assignee for history);
- ends their approval delegations there and hands their waiting approvals on
  (to the other approvers on the step, or to Owners/Admins); their decisions,
  requests, form responses and timesheets are kept;
- keeps their messages, comments, files and activity history;
- does not touch their memberships in other workspaces;
- writes an audit event.

Deactivation blocks access but keeps channel/project memberships, so reactivation
restores the previous state.
