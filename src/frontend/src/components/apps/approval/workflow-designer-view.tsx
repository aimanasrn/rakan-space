"use client"

import { useQueryClient } from "@tanstack/react-query"
import { ArrowDown, ArrowUp, Plus, Trash2, UserRound, Users, X } from "lucide-react"
import { useParams, useRouter } from "next/navigation"
import { useState } from "react"
import { toast } from "sonner"
import { LoadingRows } from "@/components/common"
import { ConfirmAction } from "@/components/confirm"
import { FormAlert, TextField, useFormErrors } from "@/components/form"
import { PersonSelect } from "@/components/pickers"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { FieldGroup } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Spinner } from "@/components/ui/spinner"
import { Switch } from "@/components/ui/switch"
import { orgPath, useWorkspace } from "@/components/workspace/workspace-context"
import { useMemberOptions } from "@/hooks/use-workspace-data"
import { api, errorMessage } from "@/lib/api"
import { OPERATORS } from "@/lib/conditions"
import { t } from "@/lib/i18n"
import type { ApprovalWorkflow, ApproverDefinition, ConditionOperator, Role, UserSummary, WorkflowStep } from "@/lib/types"
import { LoadError, ModuleHeader } from "../shared"
import { approvalKeys, useWorkflow } from "./use-approvals"

const ROLES: Role[] = ["owner", "admin", "manager", "staff"]

const emptyStep = (n: number): WorkflowStep => ({ name: `Step ${n}`, mode: "any", approvers: [{ type: "manager" }], condition: null, sla_hours: null, escalate_to: null })

/** Create (/workflows/new) or edit (/workflows/{id}) a workflow. */
export function WorkflowDesignerView() {
  const { workflowId } = useParams<{ workflowId?: string }>()
  const id = workflowId ? Number(workflowId) : null
  const { slug } = useWorkspace()
  const workflow = useWorkflow(slug, id)

  if (id !== null && workflow.isPending) {
    return (
      <div className="mx-auto max-w-4xl p-4 md:p-8">
        <LoadingRows rows={6} />
      </div>
    )
  }
  if (id !== null && workflow.error) {
    return (
      <div className="mx-auto max-w-4xl p-4 md:p-8">
        <LoadError error={workflow.error} onRetry={() => workflow.refetch()} what="Workflow" />
      </div>
    )
  }
  return <Designer key={workflow.data?.id ?? "new"} initial={workflow.data ?? null} />
}

function Designer({ initial }: { initial: ApprovalWorkflow | null }) {
  const { slug, href } = useWorkspace()
  const router = useRouter()
  const qc = useQueryClient()
  const members = useMemberOptions(slug)
  const people = (members.data ?? []).map((m) => m.user)
  const { errors, formError, capture, reset, setErrors } = useFormErrors()
  const [name, setName] = useState(initial?.name ?? "")
  const [description, setDescription] = useState(initial?.description ?? "")
  const [active, setActive] = useState(initial?.is_active ?? true)
  const [steps, setSteps] = useState<WorkflowStep[]>(initial?.steps?.length ? initial.steps : [emptyStep(1)])
  const [saving, setSaving] = useState(false)

  const update = (i: number, patch: Partial<WorkflowStep>) => setSteps((list) => list.map((s, n) => (n === i ? { ...s, ...patch } : s)))
  const move = (i: number, delta: number) =>
    setSteps((list) => {
      const next = [...list]
      const [item] = next.splice(i, 1)
      next.splice(i + delta, 0, item)
      return next
    })

  async function save() {
    reset()
    const clientErrors: Record<string, string> = {}
    if (name.trim().length < 2) clientErrors.name = "Give the workflow a name."
    steps.forEach((s, i) => {
      if (!s.name.trim()) clientErrors[`steps.${i}.name`] = "Name this step."
      if (!s.approvers.length) clientErrors[`steps.${i}.approvers`] = "Add at least one approver."
      if (s.condition && !s.condition.field.trim()) clientErrors[`steps.${i}.condition.field`] = "Enter the field to check."
      if (s.escalate_to && !s.sla_hours) clientErrors[`steps.${i}.sla_hours`] = "Set a time limit to use escalation."
    })
    if (Object.keys(clientErrors).length) return setErrors(clientErrors)

    const body = {
      name: name.trim(),
      description: description.trim() || null,
      is_active: active,
      steps: steps.map((s) => ({
        name: s.name.trim(),
        mode: s.mode,
        approvers: s.approvers.map((a) => (a.type === "user" ? { type: "user", user_id: a.user_id } : a)),
        condition: s.condition ? { field: s.condition.field.trim(), operator: s.condition.operator, value: s.condition.value ?? null } : null,
        sla_hours: s.sla_hours || null,
        escalate_to: s.escalate_to?.id ?? null,
      })),
    }
    setSaving(true)
    try {
      const { data } = initial
        ? await api<{ data: ApprovalWorkflow }>(orgPath(slug, `/approval/workflows/${initial.id}`), { method: "PUT", body })
        : await api<{ data: ApprovalWorkflow }>(orgPath(slug, "/approval/workflows"), { method: "POST", body })
      toast.success(initial ? "Workflow saved. Requests already in progress keep their original steps." : "Workflow created.")
      qc.invalidateQueries({ queryKey: approvalKeys.all(slug) })
      if (!initial) router.replace(href(`/apps/approval/workflows/${data.id}`))
    } catch (e) {
      capture(e)
    } finally {
      setSaving(false)
    }
  }

  async function remove() {
    if (!initial) return
    try {
      await api(orgPath(slug, `/approval/workflows/${initial.id}`), { method: "DELETE" })
      toast.success("Workflow deleted.")
      qc.invalidateQueries({ queryKey: approvalKeys.all(slug) })
      router.replace(href("/apps/approval/workflows"))
    } catch (e) {
      toast.error(errorMessage(e))
    }
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-4 md:p-8">
      <ModuleHeader
        app="approval"
        title={initial ? initial.name : "New workflow"}
        back={{ href: href("/apps/approval/workflows"), label: "Workflows" }}
        actions={
          <>
            {initial ? (
              <ConfirmAction
                trigger={
                  <Button variant="ghost">
                    <Trash2 aria-hidden /> Delete
                  </Button>
                }
                title="Delete this workflow?"
                description="Workflows that have been used cannot be deleted; turn them off instead."
                onConfirm={remove}
              />
            ) : null}
            <Button onClick={save} disabled={saving}>
              {saving ? <Spinner /> : null} {initial ? "Save workflow" : "Create workflow"}
            </Button>
          </>
        }
      />
      <FormAlert message={formError} />

      <Card>
        <CardContent>
          <FieldGroup>
            <TextField id="workflow-name" label="Name" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} required error={errors.name} />
            <TextField id="workflow-description" label="Description" textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={1000} error={errors.description} />
            <label className="flex items-center gap-2 text-sm">
              <Switch checked={active} onCheckedChange={setActive} /> Active (can be used for new requests)
            </label>
          </FieldGroup>
        </CardContent>
      </Card>

      <section aria-labelledby="steps-heading" className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 id="steps-heading" className="text-lg font-semibold">
            Steps
          </h2>
          <p className="text-sm text-muted-foreground">Steps run top to bottom.</p>
        </div>
        {errors.steps ? <p className="text-sm text-destructive">{errors.steps}</p> : null}
        <ol className="space-y-3">
          {steps.map((step, i) => (
            <li key={i}>
              <StepEditor
                index={i}
                step={step}
                people={people}
                errors={errors}
                onChange={(patch) => update(i, patch)}
                onMove={(d) => move(i, d)}
                onRemove={steps.length > 1 ? () => setSteps((list) => list.filter((_, n) => n !== i)) : undefined}
                isFirst={i === 0}
                isLast={i === steps.length - 1}
              />
            </li>
          ))}
        </ol>
        <Button variant="outline" onClick={() => setSteps((list) => [...list, emptyStep(list.length + 1)])} disabled={steps.length >= 20}>
          <Plus aria-hidden /> Add step
        </Button>
      </section>
    </div>
  )
}

function StepEditor({
  index,
  step,
  people,
  errors,
  onChange,
  onMove,
  onRemove,
  isFirst,
  isLast,
}: {
  index: number
  step: WorkflowStep
  people: UserSummary[]
  errors: Record<string, string | undefined>
  onChange: (patch: Partial<WorkflowStep>) => void
  onMove: (delta: number) => void
  onRemove?: () => void
  isFirst: boolean
  isLast: boolean
}) {
  const prefix = `steps.${index}`
  const [pick, setPick] = useState<number | null>(null)
  const hasManager = step.approvers.some((a) => a.type === "manager")
  const add = (a: ApproverDefinition) => onChange({ approvers: [...step.approvers, a] })
  const removeApprover = (n: number) => onChange({ approvers: step.approvers.filter((_, i) => i !== n) })

  const label = (a: ApproverDefinition) =>
    a.type === "manager" ? "Requester's reporting manager" : a.type === "role" ? `Anyone with role ${t(`role.${a.role}`)}` : (a.user?.name ?? people.find((p) => p.id === a.user_id)?.name ?? "Member")

  return (
    <Card>
      <CardHeader className="flex flex-row items-center gap-3">
        <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-medium text-primary-foreground" aria-hidden>
          {index + 1}
        </span>
        <CardTitle className="flex-1">
          <Label htmlFor={`${prefix}-name`} className="sr-only">
            Step {index + 1} name
          </Label>
          <Input id={`${prefix}-name`} value={step.name} onChange={(e) => onChange({ name: e.target.value })} maxLength={120} aria-invalid={!!errors[`${prefix}.name`]} />
        </CardTitle>
        <div className="flex gap-1">
          <Button variant="ghost" size="icon-sm" onClick={() => onMove(-1)} disabled={isFirst} aria-label={`Move step ${index + 1} up`}>
            <ArrowUp />
          </Button>
          <Button variant="ghost" size="icon-sm" onClick={() => onMove(1)} disabled={isLast} aria-label={`Move step ${index + 1} down`}>
            <ArrowDown />
          </Button>
          {onRemove ? (
            <Button variant="ghost" size="icon-sm" onClick={onRemove} aria-label={`Remove step ${index + 1}`}>
              <Trash2 />
            </Button>
          ) : null}
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        {errors[`${prefix}.name`] ? <p className="text-sm text-destructive">{errors[`${prefix}.name`]}</p> : null}

        <div className="space-y-2">
          <p className="text-sm font-medium">Approvers</p>
          <ul className="flex flex-wrap gap-2">
            {step.approvers.map((a, n) => (
              <li key={n}>
                <Badge variant="secondary" className="gap-1.5 py-1 pr-1">
                  {a.type === "user" ? <UserRound className="size-3" aria-hidden /> : <Users className="size-3" aria-hidden />}
                  {label(a)}
                  <button type="button" onClick={() => removeApprover(n)} className="rounded-sm p-0.5 hover:bg-muted" aria-label={`Remove ${label(a)}`}>
                    <X className="size-3" />
                  </button>
                </Badge>
              </li>
            ))}
          </ul>
          {errors[`${prefix}.approvers`] ? <p className="text-sm text-destructive">{errors[`${prefix}.approvers`]}</p> : null}
          <div className="flex flex-wrap items-center gap-2">
            <div className="w-56">
              <PersonSelect
                id={`${prefix}-person`}
                people={people.filter((p) => !step.approvers.some((a) => a.type === "user" && a.user_id === p.id))}
                value={pick}
                placeholder="Add a person…"
                allowNone={false}
                onChange={(userId) => {
                  if (userId) add({ type: "user", user_id: userId, user: people.find((p) => p.id === userId) ?? null })
                  setPick(null)
                }}
              />
            </div>
            <Select value="" onValueChange={(role) => add({ type: "role", role: role as Role })}>
              <SelectTrigger className="w-44" aria-label="Add a role">
                <SelectValue placeholder="Add a role…" />
              </SelectTrigger>
              <SelectContent>
                {ROLES.filter((r) => !step.approvers.some((a) => a.type === "role" && a.role === r)).map((r) => (
                  <SelectItem key={r} value={r}>
                    {t(`role.${r}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {!hasManager ? (
              <Button type="button" variant="outline" size="sm" onClick={() => add({ type: "manager" })}>
                <Plus aria-hidden /> Reporting manager
              </Button>
            ) : null}
          </div>
          <p className="text-xs text-muted-foreground">The requester never approves their own request. If nobody is available, Owners and Admins approve instead.</p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor={`${prefix}-mode`}>When several people can approve</Label>
            <Select value={step.mode} onValueChange={(v) => onChange({ mode: v as "any" | "all" })}>
              <SelectTrigger id={`${prefix}-mode`} className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="any">Any one of them is enough</SelectItem>
                <SelectItem value="all">Everyone must approve (in parallel)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <TextField
            id={`${prefix}-sla`}
            label="Time limit (hours, optional)"
            type="number"
            min={1}
            max={720}
            value={step.sla_hours ?? ""}
            onChange={(e) => onChange({ sla_hours: e.target.value ? Number(e.target.value) : null })}
            error={errors[`${prefix}.sla_hours`]}
            description="Approvers get a reminder when it runs out."
          />
        </div>

        {step.sla_hours ? (
          <div className="space-y-2 sm:w-1/2">
            <Label htmlFor={`${prefix}-escalate`}>Escalate to (at twice the time limit)</Label>
            <PersonSelect
              id={`${prefix}-escalate`}
              people={people}
              value={step.escalate_to?.id ?? null}
              placeholder="No escalation"
              onChange={(userId) => onChange({ escalate_to: userId ? (people.find((p) => p.id === userId) ?? null) : null })}
            />
            {errors[`${prefix}.escalate_to`] ? <p className="text-sm text-destructive">{errors[`${prefix}.escalate_to`]}</p> : null}
          </div>
        ) : null}

        <div className="space-y-3 rounded-lg border p-3">
          <label className="flex items-center gap-2 text-sm font-medium">
            <Checkbox
              checked={!!step.condition}
              onCheckedChange={(on) => onChange({ condition: on ? { field: "amount", operator: "gt", value: "" } : null })}
            />
            Only run this step when…
          </label>
          {step.condition ? (
            <div className="grid gap-2 sm:grid-cols-3">
              <div>
                <Label htmlFor={`${prefix}-cond-field`} className="sr-only">
                  Field
                </Label>
                <Input
                  id={`${prefix}-cond-field`}
                  value={step.condition.field}
                  placeholder="Field, e.g. amount"
                  onChange={(e) => onChange({ condition: { ...step.condition!, field: e.target.value } })}
                  aria-invalid={!!errors[`${prefix}.condition.field`]}
                />
              </div>
              <Select value={step.condition.operator} onValueChange={(v) => onChange({ condition: { ...step.condition!, operator: v as ConditionOperator } })}>
                <SelectTrigger aria-label="Comparison" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {OPERATORS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {OPERATORS.find((o) => o.value === step.condition!.operator)?.needsValue ? (
                <div>
                  <Label htmlFor={`${prefix}-cond-value`} className="sr-only">
                    Value
                  </Label>
                  <Input
                    id={`${prefix}-cond-value`}
                    value={String(step.condition.value ?? "")}
                    placeholder="Value, e.g. 5000"
                    onChange={(e) => onChange({ condition: { ...step.condition!, value: e.target.value } })}
                  />
                </div>
              ) : null}
              <p className="text-xs text-muted-foreground sm:col-span-3">
                Use a form field&apos;s key (shown in the form builder) or <code>amount</code> for requests made in the Approval app. Otherwise the step is skipped.
              </p>
              {errors[`${prefix}.condition.field`] ? <p className="text-sm text-destructive sm:col-span-3">{errors[`${prefix}.condition.field`]}</p> : null}
            </div>
          ) : null}
        </div>
      </CardContent>
    </Card>
  )
}
