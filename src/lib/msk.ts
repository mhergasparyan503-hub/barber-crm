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
  const bare = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(s) ? `${s}:00` : s;
  return new Date(`${bare}${MSK_OFFSET}`);
}

/** Store wall times with explicit Moscow offset. */
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

export type ReminderItem = { at: string; sent?: boolean; kind: string };

export const REMINDER_PRESETS: { id: string; label: string; mins?: number; morning?: boolean }[] = [
  { id: '15', label: '15 мин', mins: 15 },
  { id: '30', label: '30 мин', mins: 30 },
  { id: '60', label: '1 ч', mins: 60 },
  { id: '120', label: '2 ч', mins: 120 },
  { id: '180', label: '3 ч', mins: 180 },
  { id: 'morning', label: 'Утро 09:00 МСК', morning: true },
  { id: '1440', label: 'Сутки', mins: 1440 },
  { id: '2880', label: '2 дня', mins: 2880 },
];

export function buildReminders(
  startIso: string,
  selectedIds: string[],
  customMins?: number | null,
): ReminderItem[] {
  const out: ReminderItem[] = [];
  const seen = new Set<string>();
  for (const id of selectedIds) {
    const p = REMINDER_PRESETS.find((x) => x.id === id);
    if (!p) continue;
    if (p.morning) {
      if (seen.has('morning')) continue;
      seen.add('morning');
      out.push({ at: morningReminderAt(startIso), kind: 'morning', sent: false });
    } else if (p.mins != null) {
      const kind = `${p.mins}m`;
      if (seen.has(kind)) continue;
      seen.add(kind);
      out.push({ at: reminderAtBefore(startIso, p.mins), kind, sent: false });
    }
  }
  if (customMins != null && customMins > 0) {
    const kind = `custom_${customMins}`;
    if (!seen.has(kind)) {
      out.push({ at: reminderAtBefore(startIso, customMins), kind, sent: false });
    }
  }
  return out;
}

/** Day-of-week 0=Sun..6=Sat for a Moscow calendar YYYY-MM-DD (TZ-safe). */
export function mskDow(ymd: string): number {
  return new Date(`${ymd}T12:00:00${MSK_OFFSET}`).getUTCDay();
}

/** Moscow calendar YYYY-MM-DD for a Date (or "now"). */
export function mskDateKey(d: Date = new Date()): string {
  return mskParts(d).date;
}

/** Parse YYYY-MM-DD as Moscow calendar day → Date at noon MSK (stable for UI). */
export function mskDayNoon(ymd: string): Date {
  return new Date(`${ymd}T12:00:00${MSK_OFFSET}`);
}

/** Add N calendar days to a YYYY-MM-DD (Moscow date arithmetic, no TZ drift). */
export function addYmd(ymd: string, days: number): string {
  const [y, m, d] = ymd.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
}

/** Inclusive list of YYYY-MM-DD from..to (Moscow calendar strings). */
export function eachYmd(from: string, to: string): string[] {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || from > to) return [];
  const out: string[] = [];
  let cur = from;
  let guard = 0;
  while (cur <= to && guard < 366) {
    out.push(cur);
    cur = addYmd(cur, 1);
    guard++;
  }
  return out;
}
