import { config } from "./config"

/**
 * Thin fetch wrapper for the Laravel API.
 * - Cookie-based Sanctum SPA auth (credentials: "include").
 * - Sends the XSRF token from the XSRF-TOKEN cookie on mutating requests.
 * - Normalises errors into ApiError (status, message, field errors).
 */

export class ApiError extends Error {
  status: number
  errors: Record<string, string[]>
  data: unknown

  constructor(status: number, message: string, errors: Record<string, string[]> = {}, data?: unknown) {
    super(message)
    this.status = status
    this.errors = errors
    this.data = data
  }

  /** First validation message for a field, if any. */
  field(name: string): string | undefined {
    return this.errors[name]?.[0]
  }
}

type Query = Record<string, string | number | boolean | null | undefined>

export interface RequestOptions {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE"
  body?: unknown
  query?: Query
  signal?: AbortSignal
}

function readCookie(name: string): string | null {
  if (typeof document === "undefined") return null
  const match = document.cookie.split("; ").find((row) => row.startsWith(name + "="))
  return match ? decodeURIComponent(match.split("=").slice(1).join("=")) : null
}

let csrfPromise: Promise<void> | null = null

export async function ensureCsrfCookie(force = false): Promise<void> {
  if (!force && readCookie("XSRF-TOKEN")) return
  csrfPromise ??= fetch(`${config.apiUrl}/sanctum/csrf-cookie`, { credentials: "include" })
    .then(() => undefined)
    .finally(() => {
      csrfPromise = null
    })
  return csrfPromise
}

export function buildUrl(path: string, query?: Query): string {
  const url = new URL(path.startsWith("http") ? path : `${config.apiUrl}${path}`)
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value !== undefined && value !== null && value !== "") url.searchParams.set(key, String(value))
  }
  return url.toString()
}

export async function api<T = unknown>(path: string, options: RequestOptions = {}): Promise<T> {
  const method = options.method ?? "GET"
  const isForm = typeof FormData !== "undefined" && options.body instanceof FormData

  if (method !== "GET") await ensureCsrfCookie()

  const send = () => {
    const headers: Record<string, string> = { Accept: "application/json", "X-Requested-With": "XMLHttpRequest" }
    const xsrf = readCookie("XSRF-TOKEN")
    if (xsrf && method !== "GET") headers["X-XSRF-TOKEN"] = xsrf
    if (options.body !== undefined && !isForm) headers["Content-Type"] = "application/json"

    return fetch(buildUrl(path, options.query), {
      method,
      credentials: "include",
      headers,
      signal: options.signal,
      body: options.body === undefined ? undefined : isForm ? (options.body as FormData) : JSON.stringify(options.body),
    })
  }

  let response: Response
  try {
    response = await send()
    // CSRF token expired (419): refresh it once and retry.
    if (response.status === 419) {
      await ensureCsrfCookie(true)
      response = await send()
    }
  } catch (e) {
    if ((e as Error).name === "AbortError") throw e
    throw new ApiError(0, "Cannot reach the server. Check your connection and try again.")
  }

  if (response.status === 204) return undefined as T

  const text = await response.text()
  let data: unknown = undefined
  try {
    data = text ? JSON.parse(text) : undefined
  } catch {
    data = undefined
  }

  if (!response.ok) {
    const payload = (data ?? {}) as { message?: string; errors?: Record<string, string[]> }
    const fallback =
      response.status === 403
        ? "You do not have permission to do that."
        : response.status === 404
          ? "Not found."
          : response.status === 429
            ? "Too many attempts. Please wait a moment and try again."
            : "Something went wrong. Please try again."
    throw new ApiError(response.status, payload.message || fallback, payload.errors ?? {}, data)
  }

  return data as T
}

/** Upload a file to the organisation's pending attachments. */
export async function uploadAttachment(slug: string, file: File) {
  const form = new FormData()
  form.append("file", file)
  return api<{ data: import("./types").Attachment }>(`/api/orgs/${slug}/attachments`, { method: "POST", body: form })
}

export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    const first = Object.values(error.errors)[0]?.[0]
    return first ?? error.message
  }
  return error instanceof Error ? error.message : "Something went wrong."
}
