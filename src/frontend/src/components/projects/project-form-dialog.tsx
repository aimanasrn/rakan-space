"use client"

import { useQueryClient } from "@tanstack/react-query"
import { useRouter } from "next/navigation"
import { useState } from "react"
import { toast } from "sonner"
import { FormAlert, TextField, useFormErrors } from "@/components/form"
import { PeoplePicker, PersonSelect } from "@/components/pickers"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { FieldGroup } from "@/components/ui/field"
import { Label } from "@/components/ui/label"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Spinner } from "@/components/ui/spinner"
import { orgPath, useWorkspace } from "@/components/workspace/workspace-context"
import { useMemberOptions } from "@/hooks/use-workspace-data"
import { api } from "@/lib/api"
import { t } from "@/lib/i18n"
import type { Project, ProjectStatus } from "@/lib/types"

export function ProjectFormDialog({ open, onOpenChange, project }: { open: boolean; onOpenChange: (o: boolean) => void; project?: Project }) {
  const { slug, me, href } = useWorkspace()
  const router = useRouter()
  const qc = useQueryClient()
  const members = useMemberOptions(slug)
  const people = (members.data ?? []).map((m) => m.user)
  const { errors, formError, capture, reset } = useFormErrors()
  const [pending, setPending] = useState(false)
  const [status, setStatus] = useState<ProjectStatus>(project?.status ?? "planning")
  const [visibility, setVisibility] = useState(project?.visibility ?? "restricted")
  const [managerId, setManagerId] = useState<number | null>(project?.manager?.id ?? me.id)
  const [memberIds, setMemberIds] = useState<number[]>([])

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    reset()
    setPending(true)
    const form = new FormData(e.currentTarget)
    const body = {
      name: form.get("name"),
      description: form.get("description") || null,
      start_date: form.get("start_date") || null,
      target_date: form.get("target_date") || null,
      status,
      visibility,
      manager_id: managerId,
      ...(project ? {} : { member_ids: memberIds }),
    }
    try {
      const { data } = await api<{ data: Project }>(orgPath(slug, project ? `/projects/${project.id}` : "/projects"), {
        method: project ? "PATCH" : "POST",
        body,
      })
      qc.invalidateQueries({ queryKey: ["projects", slug] })
      qc.invalidateQueries({ queryKey: ["project", slug, data.id] })
      toast.success(project ? "Project updated." : "Project created.")
      onOpenChange(false)
      if (!project) router.push(href(`/projects/${data.id}`))
    } catch (error) {
      capture(error)
    } finally {
      setPending(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{project ? "Edit project" : "New project"}</DialogTitle>
          <DialogDescription>{project ? "Update project details." : "Projects group tasks, files and the people working on them."}</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} noValidate>
          <FieldGroup>
            <FormAlert message={formError} />
            <TextField id="name" label="Project name" required defaultValue={project?.name} error={errors.name} />
            <TextField id="description" label="Description" textarea rows={3} defaultValue={project?.description ?? ""} error={errors.description} />
            <div className="grid gap-4 sm:grid-cols-2">
              <TextField id="start_date" label="Start date" type="date" defaultValue={project?.start_date ?? ""} error={errors.start_date} />
              <TextField id="target_date" label="Target date" type="date" defaultValue={project?.target_date ?? ""} error={errors.target_date} />
              <div className="space-y-2">
                <Label htmlFor="project-status">Status</Label>
                <Select value={status} onValueChange={(v) => setStatus(v as ProjectStatus)}>
                  <SelectTrigger id="project-status" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(["planning", "active", "on_hold", "completed"] as const).map((s) => (
                      <SelectItem key={s} value={s}>
                        {t(`projectStatus.${s}`)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="project-manager">Project manager</Label>
                <PersonSelect id="project-manager" people={people} value={managerId} onChange={setManagerId} allowNone={false} placeholder="Choose a manager" />
              </div>
            </div>
            <fieldset className="space-y-2">
              <legend className="text-sm font-medium">Visibility</legend>
              <RadioGroup value={visibility} onValueChange={(v) => setVisibility(v as Project["visibility"])}>
                <div className="flex items-start gap-2">
                  <RadioGroupItem value="restricted" id="vis-restricted" className="mt-0.5" />
                  <Label htmlFor="vis-restricted" className="block font-normal">
                    <span className="font-medium">Project members only</span>
                    <span className="block text-xs text-muted-foreground">Only people added to the project (and workspace admins) can see it.</span>
                  </Label>
                </div>
                <div className="flex items-start gap-2">
                  <RadioGroupItem value="organization" id="vis-org" className="mt-0.5" />
                  <Label htmlFor="vis-org" className="block font-normal">
                    <span className="font-medium">Everyone in the workspace can view</span>
                    <span className="block text-xs text-muted-foreground">Only project members can add tasks or comment.</span>
                  </Label>
                </div>
              </RadioGroup>
            </fieldset>
            {!project ? (
              <div className="space-y-2">
                <Label htmlFor="project-members">Members</Label>
                <PeoplePicker id="project-members" people={people} value={memberIds} onChange={setMemberIds} exclude={[me.id, ...(managerId ? [managerId] : [])]} placeholder="Add teammates" />
              </div>
            ) : null}
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
                {t("actions.cancel")}
              </Button>
              <Button type="submit" disabled={pending}>
                {pending ? <Spinner /> : null}
                {project ? t("actions.save") : "Create project"}
              </Button>
            </DialogFooter>
          </FieldGroup>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export function ProjectMembersDialog({ open, onOpenChange, project }: { open: boolean; onOpenChange: (o: boolean) => void; project: Project }) {
  const { slug } = useWorkspace()
  const qc = useQueryClient()
  const members = useMemberOptions(slug)
  const people = (members.data ?? []).map((m) => m.user)
  const initial = project.members ?? []
  const [ids, setIds] = useState<number[]>(initial.filter((m) => m.role === "member").map((m) => m.user.id))
  const [managers, setManagers] = useState<number[]>(initial.filter((m) => m.role === "manager").map((m) => m.user.id))
  const [pending, setPending] = useState(false)

  async function save() {
    setPending(true)
    try {
      await api(orgPath(slug, `/projects/${project.id}/members`), {
        method: "PUT",
        body: {
          members: [...managers.map((id) => ({ user_id: id, role: "manager" })), ...ids.filter((id) => !managers.includes(id)).map((id) => ({ user_id: id, role: "member" }))],
        },
      })
      toast.success("Project members updated.")
      qc.invalidateQueries({ queryKey: ["project", slug, project.id] })
      qc.invalidateQueries({ queryKey: ["projects", slug] })
      onOpenChange(false)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not update members.")
    } finally {
      setPending(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Project members</DialogTitle>
          <DialogDescription>People removed from the project lose access and their open tasks become unassigned.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="pm-managers">Managers</Label>
            <PeoplePicker id="pm-managers" people={people} value={managers} onChange={setManagers} placeholder="Project managers" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="pm-members">Members</Label>
            <PeoplePicker id="pm-members" people={people} value={ids} onChange={setIds} exclude={managers} placeholder="Project members" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {t("actions.cancel")}
          </Button>
          <Button onClick={save} disabled={pending}>
            {pending ? <Spinner /> : null}
            {t("actions.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
