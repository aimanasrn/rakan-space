"use client"

import { AttachmentChip } from "@/components/attachments"
import { formatDateKey } from "@/lib/datetime"
import type { Attachment, FormFieldDef } from "@/lib/types"

/** Read-only answers, in form order. Fields hidden when submitting have no value and are left out. */
export function SubmissionValues({ fields, values, attachments }: { fields: FormFieldDef[]; values: Record<string, unknown>; attachments: Attachment[] }) {
  const byId = new Map(attachments.map((a) => [a.id, a]))
  const answered = fields.filter((f) => values[f.key] !== undefined && values[f.key] !== null)

  if (!answered.length) return <p className="text-sm text-muted-foreground">No answers.</p>

  return (
    <dl className="divide-y">
      {answered.map((f) => (
        <div key={f.key} className="grid gap-1 py-3 sm:grid-cols-[14rem_1fr] sm:gap-4">
          <dt className="text-sm text-muted-foreground">{f.label}</dt>
          <dd className="min-w-0 text-sm">
            <Value field={f} value={values[f.key]} files={byId} />
          </dd>
        </div>
      ))}
    </dl>
  )
}

function Value({ field, value, files }: { field: FormFieldDef; value: unknown; files: Map<number, Attachment> }) {
  switch (field.type) {
    case "date":
      return <>{formatDateKey(String(value))}</>
    case "number":
      return <span className="tabular-nums">{Number(value).toLocaleString()}</span>
    case "checkbox":
      return <>{(value as string[]).join(", ")}</>
    case "textarea":
      return <p className="whitespace-pre-wrap">{String(value)}</p>
    case "file":
      return (
        <div className="flex flex-wrap gap-2">
          {(value as number[]).map((id) => (files.get(id) ? <AttachmentChip key={id} attachment={files.get(id)!} className="w-64" /> : <span key={id}>File unavailable</span>))}
        </div>
      )
    case "signature": {
      const file = files.get(value as number)
      return file?.preview_url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={file.preview_url} alt={`${field.label} (signature)`} className="h-16 rounded border bg-white object-contain p-1" />
      ) : (
        <>Signed</>
      )
    }
    case "table": {
      const columns = field.options?.columns ?? []
      const rows = value as Record<string, unknown>[]
      return (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr>
                {columns.map((c) => (
                  <th key={c.key} scope="col" className="px-2 py-1.5 text-left font-medium">
                    {c.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <tr key={i} className="border-t">
                  {columns.map((c) => (
                    <td key={c.key} className="px-2 py-1.5">
                      {row[c.key ?? ""] === undefined ? "—" : c.type === "date" ? formatDateKey(String(row[c.key!])) : String(row[c.key!])}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )
    }
    default:
      return <>{String(value)}</>
  }
}
