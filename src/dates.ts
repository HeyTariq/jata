/** Local-time date helpers. Dates are `YYYY-MM-DD` strings throughout. */

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const pad = (n: number) => String(n).padStart(2, "0");

export function toISO(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Local midnight of an ISO date, safe from the UTC parsing of `new Date(s)`. */
export function fromISO(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
}

export const today = (): string => toISO(new Date());

export function addDays(iso: string, days: number): string {
  const d = fromISO(iso);
  d.setDate(d.getDate() + days);
  return toISO(d);
}

export function addMonths(iso: string, months: number): string {
  const d = fromISO(iso);
  d.setMonth(d.getMonth() + months);
  return toISO(d);
}

/** The Sunday on or before `iso`, matching the heatmap's column layout. */
export function startOfWeek(iso: string): string {
  const d = fromISO(iso);
  return addDays(iso, -d.getDay());
}

export const startOfMonth = (iso: string): string => `${iso.slice(0, 7)}-01`;

export const weekday = (iso: string): number => fromISO(iso).getDay();

export const monthName = (iso: string): string => MONTHS[fromISO(iso).getMonth()];

/** "Mar 4, 2026" */
export function formatDate(iso: string): string {
  const d = fromISO(iso);
  return `${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}

/** "Wed, Mar 4, 2026" */
export function formatDateFull(iso: string): string {
  return `${WEEKDAYS[weekday(iso)]}, ${formatDate(iso)}`;
}

/** Clock time of a unix timestamp, in the user's locale. */
export function formatTime(at: number): string {
  return new Date(at * 1000).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
}

/** Short, human label for a due date: "Today", "Tomorrow", "Mar 4". */
export function formatDue(iso: string): string {
  const days = daysUntil(iso);
  if (days === 0) return "Today";
  if (days === 1) return "Tomorrow";
  if (days === -1) return "Yesterday";
  const d = fromISO(iso);
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return sameYear ? `${MONTHS[d.getMonth()]} ${d.getDate()}` : formatDate(iso);
}

export function daysUntil(iso: string): number {
  const ms = fromISO(iso).getTime() - fromISO(today()).getTime();
  return Math.round(ms / 86_400_000);
}

export const isValidISO = (s: string): boolean =>
  /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(fromISO(s).getTime());

/** Time-of-day greeting for the default list header. */
export function greeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}
