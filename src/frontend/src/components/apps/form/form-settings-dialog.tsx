"use client"

import { useQueryClient } from "@tanstack/react-query"
import { useState } from "react"
import { toast } from "sonner"
import { useWorkflowOptions } from "@/components/apps/approval/use-approvals"
import { ConfirmAction } from "@/components/confirm"
import { FormAlert, TextField, useFormErrors } from "@/components/form"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { FieldGroup } from "@/components/ui/field"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Spinner } from "@/components/ui/spinner"
import { Switch } from "@/components/ui/switch"
import { orgPath, useWorkspace } from "@/components/workspace/workspace-context"
import { useDepartments } from "@/hooks/use-workspace-data"
import { api, errorMessage } from "@/lib/api"
import { t } from "@/lib/i18n"
import type { FormDetail, Role } from "@/lib/types"
import { useRouter } from "next/navigation"
import { formKeys } from "./use-forms"

const ROLES: Role[] = ["owner", "admin", "manager", "staff"]

export function FormSettingsDialog({ form, open, onOpenChange, fieldKeys }: { form: FormDetail; open: boolean; onOpenChange: (o: boolean) => void; fieldKeys: string[] }) {
  const { slug, href } = useWorkspace()
  const router = useRouter()
  const qc = useQueryClient()
  const workflows = useWorkflowOptions(slug, open)
  const departments = useDepartments(slug)
  const { errors, formError, capture, reset, setErrors } = useFormErrors()
  const [workflowId, setWorkflowId] = useState(form.workflow ? String(form.workflow.id) : "none")
  const [roles, setRoles] = useState<Role[]>(form.audience.roles)
  const [departmentIds, setDepartmentIds] = useState<number[]>(form.audience.department_ids)
  const [allowMultiple, setAllowMultiple] = useState(form.allow_multiple)
  const [pending, setPending] = useState(false)

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    reset()
    const data = new FormData(e.currentTarget)
    const name = String(data.get("name") ?? "").trim()
    if (name.length < 2) return setErrors({ name: "Give the form a name." })
    setPending(true)
    try {
      const { data: updated } = await api<{ data: FormDetail }>(orgPath(slug, `/forms/${form.id}`), {
        method: "PATCH",
        body: {
          name,
          description: String(data.get("description") ?? "").trim() || null,
          // Only sent when changed, so a workflow that was turned off later does not block other edits.
          ...(workflowId !== (form.workflow ? String(form.workflow.id) : "none") ? { workflow_id: workflowId === "none" ? null : Number(workflowId) } : {}),
          audience: { roles, department_ids: departmentIds },
          allow_multiple: allowMultiple,
        },
      })
      qc.setQueryData(formKeys.form(slug, form.id), updated)
      qc.invalidateQueries({ queryKey: formKeys.all(slug), predicate: (q) => q.queryKey[2] !== "form" })
      toast.success("Settings saved.")
      onOpenChange(false)
    } catch (error) {
      capture(error)
    } finally {
      setPending(false)
    }
  }

  async function remove() {
    try {
      await api(orgPath(slug, `/forms/${form.id}`), { method: "DELETE" })
      toast.success("Form deleted.")
      qc.invalidateQueries({ queryKey: formKeys.all(slug) })
      router.replace(href("/apps/form?tab=manage"))
    } catch (e) {
      toast.error(errorMessage(e))
    }
  }

  const selectedWorkflow = workflows.data?.find((w) => String(w.id) === workflowId)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Form settings</DialogTitle>
          <DialogDescription>These apply immediately, including to the published version.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} noValidate>
          <FieldGroup>
            <FormAlert message={formError} />
            <TextField id="name" label="Name" defaultValue={form.name} required maxLength={160} error={errors.name} />
            <TextField id="description" label="Description" textarea rows={3} defaultValue={form.description ?? ""} maxLength={2000} error={errors.description} />

            <div className="space-y-2">
              <Label htmlFor="form-workflow">Approval workflow</Label>
              <Select value={workflowId} onValueChange={setWorkflowId}>
                <SelectTrigger id="form-workflow" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No approval needed</SelectItem>
                  {workflows.data?.map((w) => (
                    <SelectItem key={w.id} value={String(w.id)}>
                      {w.name}
                    </SelectItem>
                  ))}
                  {form.workflow && !workflows.data?.some((w) => w.id === form.workflow!.id) ? (
                    <SelectItem value={String(form.workflow.id)}>{form.workflow.name} (turned off)</SelectItem>
                  ) : null}
                </SelectContent>
              </Select>
              {errors.workflow_id ? <p className="text-sm text-destructive">{errors.workflow_id}</p> : null}
              <p className="text-xs text-muted-foreground">
                Each response is sent through this workflow. Step conditions can use field keys such as {fieldKeys.slice(0, 3).map((k) => <code key={k} className="mx-0.5">{k}</code>)}.
                {selectedWorkflow ? ` (${selectedWorkflow.steps_count} step${selectedWorkflow.steps_count === 1 ? "" : "s"})` : ""}
              </p>
            </div>

            <fieldset className="space-y-2">
              <legend className="text-sm font-medium">Who can fill it in</legend>
              <p className="text-xs text-muted-foreground">Leave everything unticked for everyone in the workspace.</p>
              <div className="flex flex-wrap gap-x-4 gap-y-2">
                {ROLES.map((r) => (
                  <label key={r} className="flex items-center gap-2 text-sm">
                    <Checkbox checked={roles.includes(r)} onCheckedChange={(on) => setRoles((list) => (on ? [...list, r] : list.filter((x) => x !== r)))} />
                    {t(`role.${r}`)}
                  </label>
                ))}
              </div>
              {departments.data?.length ? (
                <div className="flex flex-wrap gap-x-4 gap-y-2 pt-1">
                  {departments.data.map((d) => (
                    <label key={d.id} className="flex items-center gap-2 text-sm">
                      <Checkbox
                        checked={departmentIds.includes(d.id)}
                        onCheckedChange={(on) => setDepartmentIds((list) => (on ? [...list, d.id] : list.filter((x) => x !== d.id)))}
                      />
                      {d.name}
                    </label>
                  ))}
                </div>
              ) : null}
              {errors["audience.department_ids"] ? <p className="text-sm text-destructive">{errors["audience.department_ids"]}</p> : null}
            </fieldset>

            <label className="flex items-center justify-between gap-2 text-sm">
              Allow more than one response per person
              <Switch checked={allowMultiple} onCheckedChange={setAllowMultiple} />
            </label>
          </FieldGroup>
          <DialogFooter className="mt-6 sm:justify-between">
            {form.permissions.delete ? (
              <ConfirmAction
                trigger={
                  <Button type="button" variant="ghost" className="text-destructive">
                    Delete form
                  </Button>
                }
                title="Delete this form?"
                description="Forms with responses cannot be deleted; close them instead."
                onConfirm={remove}
              />
            ) : (
              <span />
            )}
            <div className="flex gap-2">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={pending}>
                {pending ? <Spinner /> : null} Save settings
              </Button>
            </div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
