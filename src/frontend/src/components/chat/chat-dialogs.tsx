"use client"

import { useQuery, useQueryClient } from "@tanstack/react-query"
import { Hash, Lock } from "lucide-react"
import { useRouter } from "next/navigation"
import { useState } from "react"
import { toast } from "sonner"
import { UserAvatar } from "@/components/common"
import { FormAlert, TextField, useFormErrors } from "@/components/form"
import { PeoplePicker } from "@/components/pickers"
import { Button } from "@/components/ui/button"
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { FieldGroup } from "@/components/ui/field"
import { Label } from "@/components/ui/label"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Spinner } from "@/components/ui/spinner"
import { orgPath, useWorkspace } from "@/components/workspace/workspace-context"
import { keys, useMemberOptions } from "@/hooks/use-workspace-data"
import { api, errorMessage } from "@/lib/api"
import type { ConversationDetail } from "@/lib/types"

export function NewChannelDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { slug, me, href } = useWorkspace()
  const router = useRouter()
  const qc = useQueryClient()
  const members = useMemberOptions(slug)
  const { errors, formError, capture, reset } = useFormErrors()
  const [visibility, setVisibility] = useState<"public" | "private">("public")
  const [memberIds, setMemberIds] = useState<number[]>([])
  const [pending, setPending] = useState(false)

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    reset()
    setPending(true)
    const form = new FormData(e.currentTarget)
    try {
      const { data } = await api<{ data: ConversationDetail }>(orgPath(slug, "/channels"), {
        method: "POST",
        body: { name: String(form.get("name") ?? "").trim().toLowerCase(), topic: form.get("topic") || null, visibility, member_ids: memberIds },
      })
      qc.invalidateQueries({ queryKey: keys.conversations(slug) })
      onOpenChange(false)
      setMemberIds([])
      router.push(href(`/chat/${data.id}`))
    } catch (error) {
      capture(error)
    } finally {
      setPending(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Create a channel</DialogTitle>
          <DialogDescription>Channels are where your team talks about a topic or project.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} noValidate>
          <FieldGroup>
            <FormAlert message={formError} />
            <TextField id="name" label="Name" placeholder="e.g. marketing" required error={errors.name} description="Lowercase letters, numbers, hyphens and underscores." />
            <TextField id="topic" label="Topic (optional)" error={errors.topic} />
            <fieldset className="space-y-2">
              <legend className="text-sm font-medium">Visibility</legend>
              <RadioGroup value={visibility} onValueChange={(v) => setVisibility(v as "public" | "private")}>
                <div className="flex items-start gap-2">
                  <RadioGroupItem id="ch-public" value="public" className="mt-0.5" />
                  <Label htmlFor="ch-public" className="block font-normal">
                    <span className="flex items-center gap-1 font-medium">
                      <Hash className="size-3.5" aria-hidden /> Public
                    </span>
                    <span className="block text-xs text-muted-foreground">Anyone in the workspace can find, read and join.</span>
                  </Label>
                </div>
                <div className="flex items-start gap-2">
                  <RadioGroupItem id="ch-private" value="private" className="mt-0.5" />
                  <Label htmlFor="ch-private" className="block font-normal">
                    <span className="flex items-center gap-1 font-medium">
                      <Lock className="size-3.5" aria-hidden /> Private
                    </span>
                    <span className="block text-xs text-muted-foreground">Only invited members can see it — including admins and owners.</span>
                  </Label>
                </div>
              </RadioGroup>
            </fieldset>
            <div className="space-y-2">
              <Label htmlFor="ch-members">Add members</Label>
              <PeoplePicker id="ch-members" people={(members.data ?? []).map((m) => m.user)} value={memberIds} onChange={setMemberIds} exclude={[me.id]} />
            </div>
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={pending}>
                {pending ? <Spinner /> : null}
                Create channel
              </Button>
            </DialogFooter>
          </FieldGroup>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export function NewDirectMessageDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { slug, me, href } = useWorkspace()
  const router = useRouter()
  const qc = useQueryClient()
  const members = useMemberOptions(slug)

  async function start(userId: number) {
    try {
      const { data } = await api<{ data: ConversationDetail }>(orgPath(slug, "/direct-conversations"), { method: "POST", body: { user_id: userId } })
      qc.invalidateQueries({ queryKey: keys.conversations(slug) })
      onOpenChange(false)
      router.push(href(`/chat/${data.id}`))
    } catch (e) {
      toast.error(errorMessage(e))
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="p-0 sm:max-w-md">
        <DialogHeader className="px-4 pt-4">
          <DialogTitle>New direct message</DialogTitle>
          <DialogDescription>Private 1:1 conversation inside this workspace.</DialogDescription>
        </DialogHeader>
        <Command>
          <CommandInput placeholder="Search people…" />
          <CommandList>
            <CommandEmpty>No one found.</CommandEmpty>
            <CommandGroup>
              {(members.data ?? [])
                .filter((m) => m.user.id !== me.id)
                .map((m) => (
                  <CommandItem key={m.user.id} value={`${m.user.name} ${m.user.email}`} onSelect={() => start(m.user.id)}>
                    <UserAvatar user={m.user} className="size-7" />
                    <span className="flex-1">
                      <span className="block">{m.user.name}</span>
                      <span className="block text-xs text-muted-foreground">{m.user.job_title ?? m.user.email}</span>
                    </span>
                  </CommandItem>
                ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </DialogContent>
    </Dialog>
  )
}

export function BrowseChannelsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { slug, href } = useWorkspace()
  const router = useRouter()
  const channels = useQuery({
    queryKey: ["browse-channels", slug],
    enabled: open,
    queryFn: async () => (await api<{ data: { id: number; name: string; topic: string | null; members_count: number; is_member: boolean }[] }>(orgPath(slug, "/conversations/browse"))).data,
  })
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="p-0 sm:max-w-md">
        <DialogHeader className="px-4 pt-4">
          <DialogTitle>Browse public channels</DialogTitle>
          <DialogDescription>Private channels only appear once someone adds you.</DialogDescription>
        </DialogHeader>
        <Command>
          <CommandInput placeholder="Search channels…" />
          <CommandList>
            <CommandEmpty>{channels.isLoading ? "Loading…" : "No channels found."}</CommandEmpty>
            <CommandGroup>
              {channels.data?.map((c) => (
                <CommandItem
                  key={c.id}
                  value={`${c.name} ${c.topic ?? ""}`}
                  onSelect={() => {
                    onOpenChange(false)
                    router.push(href(`/chat/${c.id}`))
                  }}
                >
                  <Hash aria-hidden />
                  <span className="flex-1">
                    <span className="block">{c.name}</span>
                    <span className="block text-xs text-muted-foreground">
                      {c.members_count} members{c.topic ? ` · ${c.topic}` : ""}
                    </span>
                  </span>
                  {c.is_member ? <span className="text-xs text-muted-foreground">Joined</span> : null}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </DialogContent>
    </Dialog>
  )
}

export function ChannelMembersDialog({ open, onOpenChange, conversation }: { open: boolean; onOpenChange: (o: boolean) => void; conversation: ConversationDetail }) {
  const { slug, me } = useWorkspace()
  const qc = useQueryClient()
  const members = useMemberOptions(slug)
  const [toAdd, setToAdd] = useState<number[]>([])
  const [pending, setPending] = useState(false)
  const canManage = conversation.permissions.manage
  const memberIds = conversation.members.map((m) => m.user.id)

  const refresh = () => {
    qc.invalidateQueries({ queryKey: keys.conversation(slug, conversation.id) })
    qc.invalidateQueries({ queryKey: keys.conversations(slug) })
  }

  async function add() {
    setPending(true)
    try {
      await api(orgPath(slug, `/conversations/${conversation.id}/members`), { method: "POST", body: { user_ids: toAdd } })
      setToAdd([])
      refresh()
      toast.success("Members added.")
    } catch (e) {
      toast.error(errorMessage(e))
    } finally {
      setPending(false)
    }
  }

  async function remove(userId: number) {
    try {
      await api(orgPath(slug, `/conversations/${conversation.id}/members/${userId}`), { method: "DELETE" })
      refresh()
      toast.success("Member removed.")
    } catch (e) {
      toast.error(errorMessage(e))
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Members of #{conversation.name}</DialogTitle>
          <DialogDescription>{conversation.members.length} members</DialogDescription>
        </DialogHeader>
        {canManage ? (
          <div className="space-y-2">
            <Label htmlFor="add-members">Add people</Label>
            <PeoplePicker id="add-members" people={(members.data ?? []).map((m) => m.user)} value={toAdd} onChange={setToAdd} exclude={memberIds} />
            <Button size="sm" onClick={add} disabled={!toAdd.length || pending}>
              {pending ? <Spinner /> : null} Add
            </Button>
          </div>
        ) : null}
        <ul className="max-h-80 space-y-2 overflow-y-auto">
          {conversation.members.map((m) => (
            <li key={m.user.id} className="flex items-center gap-2 text-sm">
              <UserAvatar user={m.user} className="size-7" />
              <span className="flex-1 truncate">
                {m.user.name}
                {m.role === "admin" ? <span className="ml-1 text-xs text-muted-foreground">(channel admin)</span> : null}
              </span>
              {canManage && m.user.id !== me.id ? (
                <Button variant="ghost" size="sm" onClick={() => remove(m.user.id)}>
                  Remove
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      </DialogContent>
    </Dialog>
  )
}
