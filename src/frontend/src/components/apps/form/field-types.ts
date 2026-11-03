import {
  AlignLeft,
  Calendar,
  CheckSquare,
  ChevronDownSquare,
  CircleDot,
  Hash,
  Paperclip,
  PenLine,
  Table2,
  Type,
  type LucideIcon,
} from "lucide-react"
import type { FieldType, FormFieldDef } from "@/lib/types"

export const FIELD_TYPES: { type: FieldType; label: string; icon: LucideIcon }[] = [
  { type: "text", label: "Short text", icon: Type },
  { type: "textarea", label: "Long text", icon: AlignLeft },
  { type: "number", label: "Number", icon: Hash },
  { type: "date", label: "Date", icon: Calendar },
  { type: "dropdown", label: "Dropdown", icon: ChevronDownSquare },
  { type: "radio", label: "Single choice", icon: CircleDot },
  { type: "checkbox", label: "Checkboxes", icon: CheckSquare },
  { type: "file", label: "File upload", icon: Paperclip },
  { type: "signature", label: "Signature", icon: PenLine },
  { type: "table", label: "Table / repeater", icon: Table2 },
]

export const typeInfo = (type: FieldType) => FIELD_TYPES.find((t) => t.type === type) ?? FIELD_TYPES[0]

export const KEY_PATTERN = /^[a-z][a-z0-9_]{0,59}$/

/** Same rules as the server's FormSchema::keyFromLabel. */
export function keyFromLabel(label: string): string {
  let key = label
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 50)
  if (!key || !/^[a-z]/.test(key)) key = `field_${key}`
  return key.replace(/_+$/, "")
}

export function uniqueKey(base: string, taken: string[]): string {
  let candidate = base
  let n = 2
  while (taken.includes(candidate)) candidate = `${base.slice(0, 55)}_${n++}`
  return candidate
}

export function newField(type: FieldType, taken: string[]): FormFieldDef {
  const label = typeInfo(type).label
  const base: FormFieldDef = { key: uniqueKey(keyFromLabel(label), taken), type, label, help_text: null, required: false, options: null, validation: null, visibility: null }
  if (type === "dropdown" || type === "radio" || type === "checkbox") base.options = { choices: ["Option 1", "Option 2"] }
  if (type === "table") base.options = { columns: [{ key: "item", label: "Item", type: "text" }, { key: "qty", label: "Qty", type: "number" }] }
  if (type === "file") base.validation = { max_files: 3 }
  return base
}
