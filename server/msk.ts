/** Barber CRM wall-clock timezone: Europe/Moscow (UTC+3, no DST). */
export const MSK_OFFSET = '+03:00';
const MSK_MS = 3 * 60 * 60 * 1000;

const HAS_TZ = /([zZ]|[+-]\d{2}:?\d{2})$/;

/** Parse appointment/window start. Naive ISO (no Z/offset) = Moscow wall clock. */
export function parseApStart(start: string | Date | null | undefined): Date {
  if (start instanceof Date) return start;
  const s = String(start || '').trim();
  if (!s) return new Date(NaN);
  if (HAS_TZ.test(s)) return new Date(s);
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return new Date(`${s}T00:00:00${MSK_OFFSET}`);
  // YYYY-MM-DDTHH:mm or YYYY-MM-DDTHH:mm:ss(.sss)
  const bare = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(s) ? `${s}:00` : s;
  return new Date(`${bare}${MSK_OFFSET}`);
}

/** Store Telegram (and similar) wall times with explicit Moscow offset. */
export function mskWallISO(day: string, timeHm: string): string {
  const t = timeHm.length === 5 ? `${timeHm}:00` : timeHm;
  return `${day}T${t}${MSK_OFFSET}`;
}

/** Calendar date + HH:mm in Europe/Moscow. */
export function mskParts(d: Date): { date: string; time: string } {
  const x = new Date(d.getTime() + MSK_MS);
  const pad = (n: number) => String(n).padStart(2, '0');
  return {
    date: `${x.getUTCFullYear()}-${pad(x.getUTCMonth() + 1)}-${pad(x.getUTCDate())}`,
    time: `${pad(x.getUTCHours())}:${pad(x.getUTCMinutes())}`,
  };
}

/** Reminder N minutes before visit (absolute UTC ISO). */
export function reminderAtBefore(start: string, mins: number): string {
  return new Date(parseApStart(start).getTime() - mins * 60_000).toISOString();
}

/** Morning 09:00 Moscow on the visit's Moscow calendar day. */
export function morningReminderAt(start: string): string {
  const { date } = mskParts(parseApStart(start));
  return new Date(`${date}T09:00:00${MSK_OFFSET}`).toISOString();
}
