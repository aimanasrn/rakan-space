"use client"

import { useQuery, useQueryClient } from "@tanstack/react-query"
import {
  AlertCircle,
  ArrowLeft,
  Compass,
  Hash,
  Loader2,
  Lock,
  LogOut,
  MessageSquarePlus,
  MessagesSquare,
  MoreHorizontal,
  Pencil,
  Plus,
  Reply,
  RotateCcw,
  SendHorizontal,
  Trash2,
  Users,
  X,
} from "lucide-react"
import Link from "next/link"
import { useParams, usePathname, useRouter, useSearchParams } from "next/navigation"
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import { toast } from "sonner"
import { AttachmentChip, AttachmentList, UploadButton, useUploader } from "@/components/attachments"
import { BrowseChannelsDialog, ChannelMembersDialog, NewChannelDialog, NewDirectMessageDialog } from "@/components/chat/chat-dialogs"
import { useConversationMessages, type PendingMessage } from "@/components/chat/use-conversation-messages"
import { EmptyState, ErrorState, LoadingRows, RichText, UserAvatar } from "@/components/common"
import { ConfirmAction } from "@/components/confirm"
import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Skeleton } from "@/components/ui/skeleton"
import { Textarea } from "@/components/ui/textarea"
import { orgPath, useWorkspace } from "@/components/workspace/workspace-context"
import { keys, useConversations, useMemberOptions } from "@/hooks/use-workspace-data"
import { api, ApiError, errorMessage } from "@/lib/api"
import { formatInstantDate, formatTime, zonedParts } from "@/lib/datetime"
import { subscribeConversation } from "@/lib/realtime"
import type { Conversation, ConversationDetail, Message, UserSummary } from "@/lib/types"
import { cn } from "@/lib/utils"

// ----------------------------------------------------------------- Layout

export function ChatLayout({ children }: { children: React.ReactNode }) {
  const { conversationId } = useParams<{ conversationId?: string }>()
  const open = !!conversationId
  return (
    <div className="flex h-[calc(100svh-3.5rem)] min-h-0">
      <aside className={cn("w-full shrink-0 border-r md:w-72", open && "hidden md:block")} aria-label="Conversations">
        <ConversationList />
      </aside>
      <section className={cn("min-w-0 flex-1", !open && "hidden md:flex")}>{children}</section>
    </div>
  )
}

function ConversationList() {
  const { slug, href } = useWorkspace()
  const pathname = usePathname()
  const { data, isLoading, error, refetch } = useConversations(slug)
  const [dialog, setDialog] = useState<"channel" | "dm" | "browse" | null>(null)
  const channels = (data ?? []).filter((c) => c.type === "channel")
  const dms = (data ?? []).filter((c) => c.type === "direct")

  const item = (c: Conversation) => {
    const active = pathname === href(`/chat/${c.id}`)
    return (
      <li key={c.id}>
        <Link
          href={href(`/chat/${c.id}`)}
          aria-current={active ? "page" : undefined}
          className={cn(
            "flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors hover:bg-muted",
            active && "bg-accent text-accent-foreground",
            c.unread_count > 0 && "font-semibold",
          )}
        >
          {c.type === "direct" ? (
            <UserAvatar user={c.partner} className="size-5" />
          ) : c.visibility === "private" ? (
            <Lock className="size-4 shrink-0 text-muted-foreground" aria-label="Private channel" />
          ) : (
            <Hash className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          )}
          <span className="min-w-0 flex-1 truncate">{c.name}</span>
          {c.unread_count > 0 ? (
            <span className="rounded-full bg-primary px-1.5 text-xs font-medium text-primary-foreground" aria-label={`${c.unread_count} unread`}>
              {c.unread_count > 99 ? "99+" : c.unread_count}
            </span>
          ) : null}
        </Link>
      </li>
    )
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b px-3 py-2.5">
        <h1 className="font-semibold">Chat</h1>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="icon-sm" variant="ghost" aria-label="New conversation">
              <Plus />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={() => setDialog("channel")}>
              <Hash /> New channel
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setDialog("dm")}>
              <MessageSquarePlus /> New direct message
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setDialog("browse")}>
              <Compass /> Browse channels
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <nav className="flex-1 space-y-4 overflow-y-auto p-2">
        {isLoading ? <LoadingRows rows={6} /> : null}
        {error ? <ErrorState error={error} onRetry={() => refetch()} /> : null}
        {data ? (
          <>
            <div>
              <h2 className="px-2 pb-1 text-xs font-medium tracking-wide text-muted-foreground uppercase">Channels</h2>
              <ul className="space-y-0.5">{channels.map(item)}</ul>
              <Button variant="ghost" size="sm" className="mt-1 w-full justify-start text-muted-foreground" onClick={() => setDialog("browse")}>
                <Compass /> Browse channels
              </Button>
            </div>
            <div>
              <h2 className="px-2 pb-1 text-xs font-medium tracking-wide text-muted-foreground uppercase">Direct messages</h2>
              <ul className="space-y-0.5">{dms.map(item)}</ul>
              <Button variant="ghost" size="sm" className="mt-1 w-full justify-start text-muted-foreground" onClick={() => setDialog("dm")}>
                <MessageSquarePlus /> New message
              </Button>
            </div>
          </>
        ) : null}
      </nav>
      <NewChannelDialog open={dialog === "channel"} onOpenChange={(o) => setDialog(o ? "channel" : null)} />
      <NewDirectMessageDialog open={dialog === "dm"} onOpenChange={(o) => setDialog(o ? "dm" : null)} />
      <BrowseChannelsDialog open={dialog === "browse"} onOpenChange={(o) => setDialog(o ? "browse" : null)} />
    </div>
  )
}

export function ChatHomeView() {
  return (
    <div className="flex flex-1 items-center justify-center p-6">
      <EmptyState icon={MessagesSquare} title="Pick a conversation" description="Choose a channel or direct message, or start a new one." className="border-none" />
    </div>
  )
}

// ----------------------------------------------------------- Conversation

export function ConversationView() {
  const { conversationId } = useParams<{ conversationId: string }>()
  const id = Number(conversationId)
  const { slug, href, me } = useWorkspace()
  const qc = useQueryClient()
  const router = useRouter()
  const [membersOpen, setMembersOpen] = useState(false)

  const conversation = useQuery({
    queryKey: keys.conversation(slug, id),
    queryFn: async () => (await api<{ data: ConversationDetail }>(orgPath(slug, `/conversations/${id}`))).data,
  })
  const c = conversation.data

  // Subscribe while viewing (covers public channels the user has not joined).
  useEffect(() => (c ? subscribeConversation(c.id) : undefined), [c?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const refresh = () => {
    qc.invalidateQueries({ queryKey: keys.conversation(slug, id) })
    qc.invalidateQueries({ queryKey: keys.conversations(slug) })
  }

  async function join() {
    try {
      await api(orgPath(slug, `/conversations/${id}/join`), { method: "POST" })
      refresh()
    } catch (e) {
      toast.error(errorMessage(e))
    }
  }

  async function leave() {
    try {
      await api(orgPath(slug, `/conversations/${id}/leave`), { method: "POST" })
      qc.invalidateQueries({ queryKey: keys.conversations(slug) })
      toast.success("You left the channel.")
      router.replace(href("/chat"))
    } catch (e) {
      toast.error(errorMessage(e))
    }
  }

  if (conversation.isLoading) {
    return (
      <div className="flex-1 space-y-4 p-4">
        <Skeleton className="h-8 w-48" />
        <LoadingRows rows={6} />
      </div>
    )
  }
  if (conversation.error || !c) {
    const notFound = conversation.error instanceof ApiError && conversation.error.status === 404
    return (
      <div className="flex flex-1 items-center justify-center p-6">
        <EmptyState
          title={notFound ? "Conversation not available" : "Couldn't load this conversation"}
          description={notFound ? "It may be private, or you are no longer a member." : undefined}
          action={
            <Button asChild variant="outline">
              <Link href={href("/chat")}>Back to chat</Link>
            </Button>
          }
        />
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col">
      <header className="flex items-center gap-2 border-b px-3 py-2">
        <Button variant="ghost" size="icon-sm" className="md:hidden" asChild>
          <Link href={href("/chat")} aria-label="Back to conversations">
            <ArrowLeft />
          </Link>
        </Button>
        {c.type === "direct" ? <UserAvatar user={c.partner} className="size-7" /> : c.visibility === "private" ? <Lock className="size-4" aria-label="Private" /> : <Hash className="size-4" aria-hidden />}
        <div className="min-w-0 flex-1">
          <h1 className="truncate font-semibold">{c.name}</h1>
          {c.topic || c.type === "direct" ? <p className="truncate text-xs text-muted-foreground">{c.type === "direct" ? (c.partner?.job_title ?? "Direct message") : c.topic}</p> : null}
        </div>
        {c.type === "channel" ? (
          <Button variant="ghost" size="sm" onClick={() => setMembersOpen(true)} aria-label={`${c.members.length} members`}>
            <Users /> <span className="hidden sm:inline">{c.members.length}</span>
          </Button>
        ) : null}
        {c.permissions.leave || c.permissions.manage ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-sm" aria-label="Channel options">
                <MoreHorizontal />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {c.permissions.manage ? (
                <DropdownMenuItem onSelect={() => setMembersOpen(true)}>
                  <Users /> Manage members
                </DropdownMenuItem>
              ) : null}
              {c.permissions.leave ? (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem variant="destructive" onSelect={leave}>
                    <LogOut /> Leave channel
                  </DropdownMenuItem>
                </>
              ) : null}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </header>
      <MessagePane key={c.id} conversation={c} me={me} onJoin={join} />
      {c.type === "channel" ? <ChannelMembersDialog open={membersOpen} onOpenChange={setMembersOpen} conversation={c} /> : null}
    </div>
  )
}

function dayLabel(iso: string, tz: string) {
  const key = zonedParts(iso, tz).dateKey
  const today = zonedParts(new Date(), tz).dateKey
  const yesterday = zonedParts(new Date(Date.now() - 86400000), tz).dateKey
  if (key === today) return "Today"
  if (key === yesterday) return "Yesterday"
  return formatInstantDate(iso, tz, { weekday: "long" })
}

function MessagePane({ conversation, me, onJoin }: { conversation: ConversationDetail; me: UserSummary; onJoin: () => void }) {
  const { slug, org } = useWorkspace()
  const qc = useQueryClient()
  const params = useSearchParams()
  const tz = org.timezone
  const state = useConversationMessages(slug, conversation.id, me, true)
  const scroller = useRef<HTMLDivElement>(null)
  const nearBottom = useRef(true)
  const prevHeight = useRef<number | null>(null)
  const [replyTo, setReplyTo] = useState<Message | null>(null)
  const [editing, setEditing] = useState<Message | null>(null)
  const highlight = params.get("message") ? Number(params.get("message")) : null

  const names = useMemo(() => conversation.members.map((m) => m.user.name), [conversation.members])

  // Keep the view pinned to the bottom when new messages arrive and the user is near it.
  useLayoutEffect(() => {
    const el = scroller.current
    if (!el) return
    if (prevHeight.current !== null) {
      el.scrollTop = el.scrollHeight - prevHeight.current
      prevHeight.current = null
    } else if (nearBottom.current) {
      el.scrollTop = el.scrollHeight
    }
  }, [state.messages, state.pending])

  useEffect(() => {
    if (highlight && state.status === "ready") {
      document.getElementById(`message-${highlight}`)?.scrollIntoView({ block: "center" })
    }
  }, [highlight, state.status])

  // Mark as read when the newest message changes while visible.
  const lastId = state.messages.length ? state.messages[state.messages.length - 1].id : null
  useEffect(() => {
    if (!lastId || !conversation.is_member || document.visibilityState !== "visible") return
    if (conversation.last_read_message_id && lastId <= conversation.last_read_message_id) return
    api(orgPath(slug, `/conversations/${conversation.id}/read`), { method: "POST", body: { message_id: lastId } })
      .then(() => qc.invalidateQueries({ queryKey: keys.conversations(slug) }))
      .catch(() => undefined)
  }, [lastId, conversation.id, conversation.is_member, conversation.last_read_message_id, slug, qc])

  const onScroll = () => {
    const el = scroller.current
    if (!el) return
    nearBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120
    if (el.scrollTop < 80 && state.hasMore && !state.loadingOlder) {
      prevHeight.current = el.scrollHeight
      void state.loadOlder()
    }
  }

  async function remove(m: Message) {
    try {
      const { data } = await api<{ data: Message }>(orgPath(slug, `/conversations/${conversation.id}/messages/${m.id}`), { method: "DELETE" })
      state.replace(data)
    } catch (e) {
      toast.error(errorMessage(e))
    }
  }

  // Day separators and grouping of consecutive messages from the same person (within 5 minutes).
  const layout = useMemo(
    () =>
      state.messages.map((m, i) => {
        const prev = state.messages[i - 1]
        const day = zonedParts(m.created_at, tz).dateKey
        const showDay = !prev || zonedParts(prev.created_at, tz).dateKey !== day
        const grouped = !showDay && !!prev && prev.user_id === m.user_id && !m.parent && new Date(m.created_at).getTime() - new Date(prev.created_at).getTime() < 5 * 60000
        return { m, showDay, grouped }
      }),
    [state.messages, tz],
  )

  return (
    <>
      <div ref={scroller} onScroll={onScroll} className="min-h-0 flex-1 overflow-y-auto px-3 py-4 md:px-5" role="log" aria-live="polite" aria-label={`Messages in ${conversation.name}`}>
        {state.status === "loading" ? <LoadingRows rows={5} /> : null}
        {state.status === "error" ? <ErrorState error={state.error} /> : null}
        {state.loadingOlder ? (
          <div className="flex justify-center py-2" role="status">
            <Loader2 className="size-4 animate-spin" aria-hidden />
            <span className="sr-only">Loading older messages</span>
          </div>
        ) : null}
        {state.status === "ready" && !state.hasMore ? (
          <div className="mb-6 space-y-1 border-b pb-4">
            <p className="font-semibold">{conversation.type === "direct" ? `This is the start of your conversation with ${conversation.name}.` : `Welcome to #${conversation.name}`}</p>
            {conversation.topic ? <p className="text-sm text-muted-foreground">{conversation.topic}</p> : null}
          </div>
        ) : null}
        {state.status === "ready" && !state.messages.length && !state.pending.length ? <p className="text-center text-sm text-muted-foreground">No messages yet. Say hello 👋</p> : null}
        <ol className="space-y-0.5">
          {layout.map(({ m, showDay, grouped }) => {
            return (
              <li key={m.id}>
                {showDay ? (
                  <div className="my-3 flex items-center gap-3 text-xs text-muted-foreground" role="separator">
                    <span className="h-px flex-1 bg-border" />
                    {dayLabel(m.created_at, tz)}
                    <span className="h-px flex-1 bg-border" />
                  </div>
                ) : null}
                <MessageItem
                  message={m}
                  grouped={!!grouped}
                  mine={m.user_id === me.id}
                  canModerate={conversation.permissions.manage}
                  canPost={conversation.permissions.post}
                  highlighted={highlight === m.id}
                  names={names}
                  tz={tz}
                  onReply={() => setReplyTo(m)}
                  onEdit={() => setEditing(m)}
                  onDelete={() => remove(m)}
                  editing={editing?.id === m.id}
                  onEditDone={(updated) => {
                    if (updated) state.replace(updated)
                    setEditing(null)
                  }}
                />
              </li>
            )
          })}
          {state.pending.map((p) => (
            <li key={p.client_id}>
              <PendingItem p={p} me={me} onRetry={() => state.retry(p.client_id)} onDiscard={() => state.discard(p.client_id)} />
            </li>
          ))}
        </ol>
      </div>
      {conversation.permissions.post ? (
        <Composer
          conversation={conversation}
          replyTo={replyTo}
          onCancelReply={() => setReplyTo(null)}
          onSend={(body, mentions, attachments) => {
            nearBottom.current = true
            state.send(body, mentions, replyTo, attachments)
            setReplyTo(null)
          }}
        />
      ) : conversation.permissions.join ? (
        <div className="flex items-center justify-between gap-3 border-t bg-muted/40 px-4 py-3 text-sm">
          <span>You are previewing #{conversation.name}.</span>
          <Button onClick={onJoin}>Join channel</Button>
        </div>
      ) : (
        <p className="border-t bg-muted/40 px-4 py-3 text-sm text-muted-foreground">{conversation.archived ? "This channel is archived." : "You can't post in this conversation."}</p>
      )}
    </>
  )
}

function MessageItem({
  message: m,
  grouped,
  mine,
  canModerate,
  canPost,
  highlighted,
  names,
  tz,
  onReply,
  onEdit,
  onDelete,
  editing,
  onEditDone,
}: {
  message: Message
  grouped: boolean
  mine: boolean
  canModerate: boolean
  canPost: boolean
  highlighted: boolean
  names: string[]
  tz: string
  onReply: () => void
  onEdit: () => void
  onDelete: () => void
  editing: boolean
  onEditDone: (m?: Message) => void
}) {
  const [confirm, setConfirm] = useState(false)
  return (
    <article
      id={`message-${m.id}`}
      className={cn("group relative flex gap-3 rounded-md px-2 py-1 hover:bg-muted/50", !grouped && "mt-2", highlighted && "bg-accent/60")}
      aria-label={`${m.user?.name ?? "Former member"} at ${formatTime(m.created_at, tz)}`}
    >
      <div className="w-8 shrink-0">{grouped ? null : <UserAvatar user={m.user} />}</div>
      <div className="min-w-0 flex-1">
        {!grouped ? (
          <p className="flex items-baseline gap-2">
            <span className="text-sm font-semibold">{m.user?.name ?? "Former member"}</span>
            <time className="text-xs text-muted-foreground" dateTime={m.created_at}>
              {formatTime(m.created_at, tz)}
            </time>
          </p>
        ) : null}
        {m.parent ? (
          <p className="mb-1 border-l-2 border-primary/50 pl-2 text-xs text-muted-foreground">
            <Reply className="mr-1 inline size-3" aria-hidden />
            {m.parent.deleted ? "Original message deleted" : `${m.parent.user_name ?? "Former member"}: ${m.parent.excerpt ?? ""}`}
          </p>
        ) : null}
        {m.deleted ? (
          <p className="text-sm text-muted-foreground italic">This message was deleted.</p>
        ) : editing ? (
          <EditMessage message={m} onDone={onEditDone} />
        ) : (
          <>
            {m.body ? (
              <p className="text-sm break-words whitespace-pre-wrap">
                <RichText text={m.body} highlight={names} />
                {m.edited ? <span className="ml-1 text-xs text-muted-foreground">(edited)</span> : null}
              </p>
            ) : null}
            {m.attachments.length ? (
              <div className="mt-1.5">
                <AttachmentList items={m.attachments} />
              </div>
            ) : null}
          </>
        )}
      </div>
      {!m.deleted && !editing && (canPost || mine || canModerate) ? (
        <div className="absolute top-0 right-2 hidden gap-0.5 rounded-md border bg-background p-0.5 shadow-sm group-focus-within:flex group-hover:flex">
          {canPost ? (
            <Button variant="ghost" size="icon-xs" onClick={onReply} aria-label="Reply">
              <Reply />
            </Button>
          ) : null}
          {mine ? (
            <Button variant="ghost" size="icon-xs" onClick={onEdit} aria-label="Edit message">
              <Pencil />
            </Button>
          ) : null}
          {mine || canModerate ? (
            <Button variant="ghost" size="icon-xs" onClick={() => setConfirm(true)} aria-label="Delete message">
              <Trash2 />
            </Button>
          ) : null}
        </div>
      ) : null}
      <ConfirmAction open={confirm} onOpenChange={setConfirm} title="Delete message?" description="Everyone in the conversation will see that a message was deleted." onConfirm={onDelete} />
    </article>
  )
}

function EditMessage({ message, onDone }: { message: Message; onDone: (m?: Message) => void }) {
  const { slug } = useWorkspace()
  const [body, setBody] = useState(message.body ?? "")
  const [pending, setPending] = useState(false)
  async function save() {
    if (!body.trim()) return
    setPending(true)
    try {
      const { data } = await api<{ data: Message }>(orgPath(slug, `/conversations/${message.conversation_id}/messages/${message.id}`), { method: "PATCH", body: { body } })
      onDone(data)
    } catch (e) {
      toast.error(errorMessage(e))
      setPending(false)
    }
  }
  return (
    <div className="space-y-2">
      <Textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        aria-label="Edit message"
        autoFocus
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault()
            save()
          }
          if (e.key === "Escape") onDone()
        }}
      />
      <div className="flex gap-2">
        <Button size="sm" onClick={save} disabled={pending}>
          Save
        </Button>
        <Button size="sm" variant="ghost" onClick={() => onDone()}>
          Cancel
        </Button>
      </div>
    </div>
  )
}

function PendingItem({ p, me, onRetry, onDiscard }: { p: PendingMessage; me: UserSummary; onRetry: () => void; onDiscard: () => void }) {
  return (
    <article className="mt-2 flex gap-3 rounded-md px-2 py-1" aria-label={p.status === "failed" ? "Message failed to send" : "Sending message"}>
      <UserAvatar user={me} />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold">{me.name}</p>
        {p.body ? <p className={cn("text-sm break-words whitespace-pre-wrap", p.status === "sending" && "opacity-60")}>{p.body}</p> : null}
        {p.attachments.length ? (
          <div className="mt-1 flex flex-wrap gap-2 opacity-70">
            {p.attachments.map((a) => (
              <AttachmentChip key={a.id} attachment={a} className="w-56" />
            ))}
          </div>
        ) : null}
        {p.status === "sending" ? (
          <p className="flex items-center gap-1 text-xs text-muted-foreground" role="status">
            <Loader2 className="size-3 animate-spin" aria-hidden /> Sending…
          </p>
        ) : (
          <p className="flex flex-wrap items-center gap-2 text-xs text-destructive" role="alert">
            <AlertCircle className="size-3" aria-hidden /> {p.error ?? "Failed to send."}
            <Button variant="outline" size="xs" onClick={onRetry}>
              <RotateCcw /> Retry
            </Button>
            <Button variant="ghost" size="xs" onClick={onDiscard}>
              Discard
            </Button>
          </p>
        )}
      </div>
    </article>
  )
}

function Composer({
  conversation,
  replyTo,
  onCancelReply,
  onSend,
}: {
  conversation: ConversationDetail
  replyTo: Message | null
  onCancelReply: () => void
  onSend: (body: string, mentions: number[], attachments: import("@/lib/types").Attachment[]) => void
}) {
  const { slug, me } = useWorkspace()
  const orgMembers = useMemberOptions(slug)
  const uploader = useUploader(slug)
  // Unsent drafts survive navigation (one composer instance per conversation).
  const draftKey = `rakanspace:draft:${slug}:${conversation.id}`
  const [body, setBody] = useState(() => (typeof window === "undefined" ? "" : (localStorage.getItem(draftKey) ?? "")))
  const [mentionQuery, setMentionQuery] = useState<string | null>(null)
  const [mentionIndex, setMentionIndex] = useState(0)
  const [mentioned, setMentioned] = useState<UserSummary[]>([])
  const textarea = useRef<HTMLTextAreaElement>(null)

  // Mentionable people: channel members (public channels: anyone in the workspace).
  const candidates = useMemo(() => {
    const pool = conversation.visibility === "public" ? (orgMembers.data ?? []).map((m) => m.user) : conversation.members.map((m) => m.user)
    return pool.filter((u) => u.id !== me.id)
  }, [conversation, orgMembers.data, me.id])
  const suggestions = mentionQuery === null ? [] : candidates.filter((u) => u.name.toLowerCase().includes(mentionQuery.toLowerCase())).slice(0, 6)

  useEffect(() => {
    if (body) localStorage.setItem(draftKey, body)
    else localStorage.removeItem(draftKey)
  }, [body, draftKey])
  useEffect(() => {
    if (replyTo) textarea.current?.focus()
  }, [replyTo])

  const updateMentionQuery = useCallback((value: string, caret: number) => {
    const before = value.slice(0, caret)
    const match = /(?:^|\s)@([\p{L}\p{N} .'-]{0,30})$/u.exec(before)
    setMentionQuery(match ? match[1] : null)
    setMentionIndex(0)
  }, [])

  function insertMention(user: UserSummary) {
    const el = textarea.current
    if (!el) return
    const caret = el.selectionStart
    const before = body.slice(0, caret).replace(/@([\p{L}\p{N} .'-]{0,30})$/u, `@${user.name} `)
    const next = before + body.slice(caret)
    setBody(next)
    setMentioned((m) => (m.some((x) => x.id === user.id) ? m : [...m, user]))
    setMentionQuery(null)
    requestAnimationFrame(() => {
      el.focus()
      el.setSelectionRange(before.length, before.length)
    })
  }

  function submit() {
    const text = body.trim()
    if ((!text && !uploader.items.length) || uploader.uploading) return
    const mentions = mentioned.filter((u) => text.includes(`@${u.name}`)).map((u) => u.id)
    onSend(text, mentions, uploader.items)
    setBody("")
    setMentioned([])
    uploader.clear()
  }

  return (
    <div className="border-t p-3">
      {replyTo ? (
        <div className="mb-2 flex items-center gap-2 rounded-md bg-muted px-3 py-1.5 text-xs">
          <Reply className="size-3" aria-hidden />
          <span className="min-w-0 flex-1 truncate">
            Replying to <strong>{replyTo.user?.name ?? "Former member"}</strong>: {replyTo.body}
          </span>
          <Button variant="ghost" size="icon-xs" onClick={onCancelReply} aria-label="Cancel reply">
            <X />
          </Button>
        </div>
      ) : null}
      {uploader.items.length ? (
        <div className="mb-2 flex flex-wrap gap-2">
          {uploader.items.map((a) => (
            <AttachmentChip key={a.id} attachment={a} onRemove={() => uploader.remove(a.id)} className="w-56" />
          ))}
        </div>
      ) : null}
      <div className="relative flex items-end gap-2 rounded-xl border bg-background p-1.5 focus-within:ring-2 focus-within:ring-ring/50">
        {suggestions.length ? (
          <ul role="listbox" aria-label="Mention someone" className="absolute bottom-full left-0 mb-2 w-64 overflow-hidden rounded-lg border bg-popover p-1 shadow-md">
            {suggestions.map((u, i) => (
              <li
                key={u.id}
                role="option"
                aria-selected={i === mentionIndex}
                className={cn("flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm", i === mentionIndex && "bg-accent")}
                onMouseDown={(e) => {
                  e.preventDefault()
                  insertMention(u)
                }}
              >
                <UserAvatar user={u} className="size-6" /> {u.name}
              </li>
            ))}
          </ul>
        ) : null}
        <UploadButton onFiles={uploader.add} uploading={uploader.uploading} iconOnly label="Attach files" />
        <label htmlFor="composer" className="sr-only">
          Message {conversation.type === "channel" ? `#${conversation.name}` : conversation.name}
        </label>
        <Textarea
          id="composer"
          ref={textarea}
          rows={1}
          value={body}
          placeholder={`Message ${conversation.type === "channel" ? `#${conversation.name}` : conversation.name}`}
          className="max-h-40 min-h-9 flex-1 resize-none border-0 bg-transparent px-1 shadow-none focus-visible:ring-0 dark:bg-transparent"
          onChange={(e) => {
            setBody(e.target.value)
            updateMentionQuery(e.target.value, e.target.selectionStart)
          }}
          onKeyDown={(e) => {
            if (suggestions.length) {
              if (e.key === "ArrowDown") {
                e.preventDefault()
                setMentionIndex((i) => (i + 1) % suggestions.length)
                return
              }
              if (e.key === "ArrowUp") {
                e.preventDefault()
                setMentionIndex((i) => (i - 1 + suggestions.length) % suggestions.length)
                return
              }
              if (e.key === "Enter" || e.key === "Tab") {
                e.preventDefault()
                insertMention(suggestions[mentionIndex])
                return
              }
              if (e.key === "Escape") {
                setMentionQuery(null)
                return
              }
            }
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault()
              submit()
            }
          }}
        />
        <Button size="icon" onClick={submit} disabled={(!body.trim() && !uploader.items.length) || uploader.uploading} aria-label="Send message">
          <SendHorizontal />
        </Button>
      </div>
      <p className="mt-1 hidden text-xs text-muted-foreground sm:block">
        <kbd>Enter</kbd> to send · <kbd>Shift</kbd>+<kbd>Enter</kbd> for a new line · <kbd>@</kbd> to mention
      </p>
    </div>
  )
}

