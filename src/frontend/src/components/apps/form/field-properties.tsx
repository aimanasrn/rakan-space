"use client"

import { Plus, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { OPERATORS } from "@/lib/conditions"
import type { ConditionOperator, FormFieldDef, TableColumn, TableColumnType } from "@/lib/types"
import { KEY_PATTERN, keyFromLabel, typeInfo, uniqueKey } from "./field-types"

/** Settings for the selected field. Fully controlled by the builder. */
export function FieldProperties({
  field,
  earlierFields,
  takenKeys,
  onChange,
}: {
  field: FormFieldDef
  earlierFields: FormFieldDef[]
  takenKeys: string[]
  onChange: (patch: Partial<FormFieldDef>) => void
}) {
  const v = field.validation ?? {}
  const setRule = (rule: keyof NonNullable<FormFieldDef["validation"]>, value: string) => {
    const next = { ...v, [rule]: value === "" ? undefined : Number(value) }
    Object.keys(next).forEach((k) => next[k as keyof typeof next] === undefined && delete next[k as keyof typeof next])
    onChange({ validation: Object.keys(next).length ? next : null })
  }
  const keyInvalid = !KEY_PATTERN.test(field.key) || takenKeys.includes(field.key)

  return (
    <div className="space-y-5">
      <p className="text-xs text-muted-foreground">{typeInfo(field.type).label}</p>

      <div className="space-y-2">
        <Label htmlFor="prop-label">Label</Label>
        <Input
          id="prop-label"
          value={field.label}
          maxLength={200}
          onChange={(e) => {
            const label = e.target.value
            // Keep the key following the label until someone edits the key themselves.
            const autoKey = uniqueKey(keyFromLabel(field.label), takenKeys) === field.key
            onChange(autoKey ? { label, key: uniqueKey(keyFromLabel(label || "field"), takenKeys) } : { label })
          }}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="prop-key">Key</Label>
        <Input
          id="prop-key"
          value={field.key}
          maxLength={60}
          className="font-mono text-xs"
          aria-invalid={keyInvalid}
          aria-describedby="prop-key-help"
          onChange={(e) => onChange({ key: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "_") })}
        />
        <p id="prop-key-help" className={keyInvalid ? "text-xs text-destructive" : "text-xs text-muted-foreground"}>
          {keyInvalid ? "Use a unique key: lowercase letters, numbers and _, starting with a letter." : "Used in approval conditions, e.g. amount > 5000."}
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="prop-help">Help text</Label>
        <Textarea id="prop-help" rows={2} maxLength={500} value={field.help_text ?? ""} onChange={(e) => onChange({ help_text: e.target.value || null })} />
      </div>

      <label className="flex items-center justify-between gap-2 text-sm">
        Required
        <Switch checked={field.required} onCheckedChange={(required) => onChange({ required })} />
      </label>

      {field.type === "dropdown" || field.type === "radio" || field.type === "checkbox" ? (
        <ChoicesEditor label="Choices" choices={field.options?.choices ?? []} onChange={(choices) => onChange({ options: { choices } })} />
      ) : null}

      {field.type === "table" ? <ColumnsEditor columns={field.options?.columns ?? []} onChange={(columns) => onChange({ options: { columns } })} /> : null}

      <fieldset className="space-y-3">
        <legend className="text-sm font-medium">Validation</legend>
        {field.type === "number" ? (
          <div className="grid grid-cols-2 gap-2">
            <NumberRule id="rule-min" label="Minimum" value={v.min} onChange={(x) => setRule("min", x)} />
            <NumberRule id="rule-max" label="Maximum" value={v.max} onChange={(x) => setRule("max", x)} />
          </div>
        ) : null}
        {field.type === "text" || field.type === "textarea" ? (
          <div className="grid grid-cols-2 gap-2">
            <NumberRule id="rule-minlen" label="Min length" value={v.min_length} onChange={(x) => setRule("min_length", x)} />
            <NumberRule id="rule-maxlen" label="Max length" value={v.max_length} onChange={(x) => setRule("max_length", x)} />
          </div>
        ) : null}
        {field.type === "file" ? <NumberRule id="rule-files" label="Max files (1–10)" value={v.max_files} onChange={(x) => setRule("max_files", x)} /> : null}
        {field.type === "table" ? <NumberRule id="rule-rows" label="Max rows (1–100)" value={v.max_rows} onChange={(x) => setRule("max_rows", x)} /> : null}
        {["date", "dropdown", "radio", "checkbox", "signature"].includes(field.type) ? <p className="text-xs text-muted-foreground">Only “Required” applies to this field type.</p> : null}
      </fieldset>

      <VisibilityEditor field={field} earlierFields={earlierFields} onChange={(visibility) => onChange({ visibility })} />
    </div>
  )
}

function NumberRule({ id, label, value, onChange }: { id: string; label: string; value?: number; onChange: (v: string) => void }) {
  return (
    <div className="space-y-1">
      <Label htmlFor={id} className="text-xs">
        {label}
      </Label>
      <Input id={id} type="number" step="any" value={value ?? ""} onChange={(e) => onChange(e.target.value)} />
    </div>
  )
}

function ChoicesEditor({ label, choices, onChange }: { label: string; choices: string[]; onChange: (choices: string[]) => void }) {
  return (
    <fieldset className="space-y-2">
      <legend className="text-sm font-medium">{label}</legend>
      <ul className="space-y-1.5">
        {choices.map((choice, i) => (
          <li key={i} className="flex gap-1">
            <Input aria-label={`Choice ${i + 1}`} value={choice} maxLength={200} onChange={(e) => onChange(choices.map((c, n) => (n === i ? e.target.value : c)))} />
            <Button type="button" variant="ghost" size="icon-sm" onClick={() => onChange(choices.filter((_, n) => n !== i))} aria-label={`Remove choice ${i + 1}`} disabled={choices.length <= 1}>
              <X />
            </Button>
          </li>
        ))}
      </ul>
      <Button type="button" variant="outline" size="sm" onClick={() => onChange([...choices, `Option ${choices.length + 1}`])} disabled={choices.length >= 200}>
        <Plus aria-hidden /> Add choice
      </Button>
    </fieldset>
  )
}

function ColumnsEditor({ columns, onChange }: { columns: TableColumn[]; onChange: (columns: TableColumn[]) => void }) {
  const set = (i: number, patch: Partial<TableColumn>) => onChange(columns.map((c, n) => (n === i ? { ...c, ...patch } : c)))
  return (
    <fieldset className="space-y-2">
      <legend className="text-sm font-medium">Columns</legend>
      <ul className="space-y-3">
        {columns.map((col, i) => (
          <li key={i} className="space-y-1.5 rounded-lg border p-2">
            <div className="flex gap-1">
              <Input
                aria-label={`Column ${i + 1} label`}
                value={col.label}
                maxLength={120}
                onChange={(e) => set(i, { label: e.target.value, key: uniqueKey(keyFromLabel(e.target.value || "column"), columns.filter((_, n) => n !== i).map((c) => c.key ?? "")) })}
              />
              <Button type="button" variant="ghost" size="icon-sm" onClick={() => onChange(columns.filter((_, n) => n !== i))} aria-label={`Remove column ${i + 1}`} disabled={columns.length <= 1}>
                <X />
              </Button>
            </div>
            <Select value={col.type} onValueChange={(type) => set(i, { type: type as TableColumnType, choices: type === "dropdown" ? (col.choices?.length ? col.choices : ["Option 1"]) : undefined })}>
              <SelectTrigger aria-label={`Column ${i + 1} type`} className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="text">Text</SelectItem>
                <SelectItem value="number">Number</SelectItem>
                <SelectItem value="date">Date</SelectItem>
                <SelectItem value="dropdown">Dropdown</SelectItem>
              </SelectContent>
            </Select>
            {col.type === "dropdown" ? <ChoicesEditor label="Column choices" choices={col.choices ?? []} onChange={(choices) => set(i, { choices })} /> : null}
          </li>
        ))}
      </ul>
      <Button type="button" variant="outline" size="sm" onClick={() => onChange([...columns, { key: `column_${columns.length + 1}`, label: `Column ${columns.length + 1}`, type: "text" }])} disabled={columns.length >= 20}>
        <Plus aria-hidden /> Add column
      </Button>
    </fieldset>
  )
}

function VisibilityEditor({ field, earlierFields, onChange }: { field: FormFieldDef; earlierFields: FormFieldDef[]; onChange: (v: FormFieldDef["visibility"]) => void }) {
  const rule = field.visibility
  const source = earlierFields.find((f) => f.key === rule?.field)
  const op = OPERATORS.find((o) => o.value === rule?.operator)
  const candidates = earlierFields.filter((f) => !["file", "signature", "table"].includes(f.type))

  return (
    <fieldset className="space-y-2 rounded-lg border p-3">
      <legend className="px-1 text-sm font-medium">Show / hide</legend>
      <label className="flex items-center gap-2 text-sm">
        <Checkbox
          checked={!!rule}
          disabled={!candidates.length}
          onCheckedChange={(on) => onChange(on && candidates.length ? { field: candidates[candidates.length - 1].key, operator: "eq", value: candidates[candidates.length - 1].options?.choices?.[0] ?? "" } : null)}
        />
        Only show this field when…
      </label>
      {!candidates.length ? <p className="text-xs text-muted-foreground">Add a field above this one to use show/hide rules.</p> : null}
      {rule ? (
        <div className="space-y-2">
          <Select value={rule.field} onValueChange={(key) => onChange({ ...rule, field: key, value: earlierFields.find((f) => f.key === key)?.options?.choices?.[0] ?? "" })}>
            <SelectTrigger aria-label="Field to check" className="w-full">
              <SelectValue placeholder="Choose a field" />
            </SelectTrigger>
            <SelectContent>
              {candidates.map((f) => (
                <SelectItem key={f.key} value={f.key}>
                  {f.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={rule.operator} onValueChange={(o) => onChange({ ...rule, operator: o as ConditionOperator })}>
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
          {op?.needsValue ? (
            source?.options?.choices?.length ? (
              <Select value={String(rule.value ?? "")} onValueChange={(value) => onChange({ ...rule, value })}>
                <SelectTrigger aria-label="Value" className="w-full">
                  <SelectValue placeholder="Choose a value" />
                </SelectTrigger>
                <SelectContent>
                  {source.options.choices.map((c) => (
                    <SelectItem key={c} value={c}>
                      {c}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <Input aria-label="Value" value={String(rule.value ?? "")} type={source?.type === "number" ? "number" : source?.type === "date" ? "date" : "text"} onChange={(e) => onChange({ ...rule, value: e.target.value })} />
            )
          ) : null}
          <p className="text-xs text-muted-foreground">Hidden fields are never required and their answers are not saved.</p>
        </div>
      ) : null}
    </fieldset>
  )
}
