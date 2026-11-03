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
- keeps their messages, comments, files and activity history;
- does not touch their memberships in other workspaces;
- writes an audit event.

Deactivation blocks access but keeps channel/project memberships, so reactivation
restores the previous state.
