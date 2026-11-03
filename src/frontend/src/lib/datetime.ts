/**
 * Time zone helpers built on Intl, so every timestamp renders in the
 * organisation's configured time zone regardless of the browser's zone.
 *
 * - Instants (events, messages) are ISO-8601 strings from the API (UTC).
 * - Task deadlines are date-only "YYYY-MM-DD" strings and are never converted
 *   through a time zone, so they cannot shift across days.
 */

const LOCALE = "en-MY"

function parts(date: Date, timeZone: string) {
  const formatted = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(date)
  const v = Object.fromEntries(formatted.map((p) => [p.type, p.value]))
  return { year: +v.year, month: +v.month, day: +v.day, hour: +v.hour % 24, minute: +v.minute, second: +v.second }
}

/** Offset of `timeZone` from UTC at the given instant, in minutes. */
export function tzOffsetMinutes(date: Date, timeZone: string): number {
  const p = parts(date, timeZone)
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second)
  return Math.round((asUtc - date.getTime()) / 60000)
}

/** "YYYY-MM-DD" + "HH:mm" in `timeZone` → UTC Date. */
export function zonedToUtc(dateKey: string, time: string, timeZone: string): Date {
  const [y, m, d] = dateKey.split("-").map(Number)
  const [hh, mm] = time.split(":").map(Number)
  const guess = Date.UTC(y, m - 1, d, hh, mm)
  let ts = guess - tzOffsetMinutes(new Date(guess), timeZone) * 60000
  const corrected = guess - tzOffsetMinutes(new Date(ts), timeZone) * 60000
  if (corrected !== ts) ts = corrected
  return new Date(ts)
}

/** Calendar date and wall-clock time of an instant in `timeZone`. */
export function zonedParts(value: string | Date, timeZone: string): { dateKey: string; time: string } {
  const p = parts(typeof value === "string" ? new Date(value) : value, timeZone)
  const pad = (n: number) => String(n).padStart(2, "0")
  return { dateKey: `${p.year}-${pad(p.month)}-${pad(p.day)}`, time: `${pad(p.hour)}:${pad(p.minute)}` }
}

export function todayKey(timeZone: string): string {
  return zonedParts(new Date(), timeZone).dateKey
}

export function formatDateTime(value: string, timeZone: string, opts: Intl.DateTimeFormatOptions = {}): string {
  return new Intl.DateTimeFormat(LOCALE, {
    timeZone,
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    ...opts,
  }).format(new Date(value))
}

export function formatTime(value: string, timeZone: string): string {
  return new Intl.DateTimeFormat(LOCALE, { timeZone, hour: "numeric", minute: "2-digit" }).format(new Date(value))
}

export function formatInstantDate(value: string, timeZone: string, opts: Intl.DateTimeFormatOptions = {}): string {
  return new Intl.DateTimeFormat(LOCALE, { timeZone, day: "numeric", month: "short", year: "numeric", ...opts }).format(new Date(value))
}

/** Formats a date-only "YYYY-MM-DD" value without any time zone shift. */
export function formatDateKey(dateKey: string, opts: Intl.DateTimeFormatOptions = {}): string {
  const [y, m, d] = dateKey.split("-").map(Number)
  return new Intl.DateTimeFormat(LOCALE, { timeZone: "UTC", day: "numeric", month: "short", year: "numeric", ...opts }).format(
    new Date(Date.UTC(y, m - 1, d)),
  )
}

/** Whole days from today (in `timeZone`) to a date key. Negative = past. */
export function daysUntil(dateKey: string, timeZone: string): number {
  const toUtc = (k: string) => {
    const [y, m, d] = k.split("-").map(Number)
    return Date.UTC(y, m - 1, d)
  }
  return Math.round((toUtc(dateKey) - toUtc(todayKey(timeZone))) / 86400000)
}

export function relativeDue(dateKey: string, timeZone: string): string {
  const days = daysUntil(dateKey, timeZone)
  if (days === 0) return "Due today"
  if (days === 1) return "Due tomorrow"
  if (days === -1) return "Overdue by 1 day"
  if (days < 0) return `Overdue by ${-days} days`
  if (days < 7) return `Due in ${days} days`
  return `Due ${formatDateKey(dateKey, { year: undefined })}`
}

export function timeAgo(value: string): string {
  const seconds = Math.round((Date.now() - new Date(value).getTime()) / 1000)
  const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" })
  if (Math.abs(seconds) < 60) return "just now"
  const minutes = Math.round(seconds / 60)
  if (Math.abs(minutes) < 60) return rtf.format(-minutes, "minute")
  const hours = Math.round(minutes / 60)
  if (Math.abs(hours) < 24) return rtf.format(-hours, "hour")
  const days = Math.round(hours / 24)
  if (Math.abs(days) < 30) return rtf.format(-days, "day")
  return new Intl.DateTimeFormat(LOCALE, { day: "numeric", month: "short", year: "numeric" }).format(new Date(value))
}

export function addDaysToKey(dateKey: string, days: number): string {
  const [y, m, d] = dateKey.split("-").map(Number)
  const date = new Date(Date.UTC(y, m - 1, d + days))
  return date.toISOString().slice(0, 10)
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

/** Common IANA zones offered in settings (the API accepts any valid zone). */
export const TIMEZONES = [
  "Asia/Kuala_Lumpur",
  "Asia/Singapore",
  "Asia/Jakarta",
  "Asia/Bangkok",
  "Asia/Manila",
  "Asia/Hong_Kong",
  "Asia/Tokyo",
  "Asia/Kolkata",
  "Asia/Dubai",
  "Australia/Sydney",
  "Europe/London",
  "Europe/Berlin",
  "America/New_York",
  "America/Los_Angeles",
  "UTC",
]
