/** System labels the server puts into `note` for bot / online bookings — not real comments. */
const SYSTEM_NOTES = new Set(['Онлайн-запись', 'Telegram', 'Telegram (мастер)']);

/** The visit comment to show (master's or client's), or '' when there is none. */
export function visitComment(a: { note?: string } | null | undefined): string {
  const n = String(a?.note || '').trim();
  if (!n || SYSTEM_NOTES.has(n)) return '';
  return n;
}
