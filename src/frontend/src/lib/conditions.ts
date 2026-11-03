import type { Condition, ConditionOperator, FormFieldDef } from "./types"

/**
 * Client copy of App\Support\Conditions (backend). Keep the two in step:
 * the server re-checks everything, this only drives what the UI shows.
 */
export const OPERATORS: { value: ConditionOperator; label: string; needsValue: boolean }[] = [
  { value: "eq", label: "is", needsValue: true },
  { value: "neq", label: "is not", needsValue: true },
  { value: "gt", label: "is greater than", needsValue: true },
  { value: "gte", label: "is at least", needsValue: true },
  { value: "lt", label: "is less than", needsValue: true },
  { value: "lte", label: "is at most", needsValue: true },
  { value: "contains", label: "contains", needsValue: true },
  { value: "filled", label: "is filled in", needsValue: false },
  { value: "empty", label: "is empty", needsValue: false },
]

const isEmpty = (v: unknown) => v === null || v === undefined || v === "" || v === false || (Array.isArray(v) && v.length === 0)
const isNumeric = (v: unknown) => (typeof v === "number" && Number.isFinite(v)) || (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v)))

function equals(actual: unknown, expected: unknown): boolean {
  if (Array.isArray(actual)) return actual.map(String).includes(String(expected ?? ""))
  if (isNumeric(actual) && isNumeric(expected)) return Number(actual) === Number(expected)
  return String(actual ?? "").trim().toLowerCase() === String(expected ?? "").trim().toLowerCase()
}

export function matchesCondition(condition: Condition | null | undefined, data: Record<string, unknown>): boolean {
  if (!condition || !condition.field || !condition.operator) return true
  const actual = data[condition.field]
  const expected = condition.value
  switch (condition.operator) {
    case "filled":
      return !isEmpty(actual)
    case "empty":
      return isEmpty(actual)
    case "eq":
      return equals(actual, expected)
    case "neq":
      return !equals(actual, expected)
    case "contains":
      if (Array.isArray(actual)) return actual.map(String).includes(String(expected ?? ""))
      return expected !== null && expected !== undefined && expected !== "" && String(actual ?? "").toLowerCase().includes(String(expected).toLowerCase())
    case "gt":
    case "gte":
    case "lt":
    case "lte": {
      if (isEmpty(actual) || Array.isArray(actual) || expected === null || expected === undefined || expected === "") return false
      const cmp = isNumeric(actual) && isNumeric(expected) ? Math.sign(Number(actual) - Number(expected)) : String(actual).localeCompare(String(expected))
      return condition.operator === "gt" ? cmp > 0 : condition.operator === "gte" ? cmp >= 0 : condition.operator === "lt" ? cmp < 0 : cmp <= 0
    }
    default:
      return false
  }
}

/** Keys of fields currently shown, evaluated top to bottom like the server does. */
export function visibleFieldKeys(fields: FormFieldDef[], values: Record<string, unknown>): Set<string> {
  const shown = new Set<string>()
  const effective: Record<string, unknown> = {}
  for (const field of fields) {
    if (!matchesCondition(field.visibility, effective)) continue
    shown.add(field.key)
    if (field.key in values) effective[field.key] = values[field.key]
  }
  return shown
}

export function describeCondition(condition: Condition, label = condition.field): string {
  const op = OPERATORS.find((o) => o.value === condition.operator)
  return `${label} ${op?.label ?? condition.operator}${op?.needsValue ? ` ${condition.value ?? ""}` : ""}`.trim()
}
