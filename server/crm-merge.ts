/**
 * Server-side snapshot safety:
 *  - withCrmLock: serialize every load → modify → save of data/crm-snapshot.json
 *    (webhook, reminders, browser flush, public booking) so they can't overwrite each other.
 *  - stampChanges: mark appointments/clients/exceptions changed on the server with updatedAt.
 *  - mergeIncoming: merge a browser flush into the server snapshot instead of blind overwrite
 *    (keeps bot/online bookings the browser hasn't pulled yet, bot drafts, sent reminders…).
 */

let chain: Promise<unknown> = Promise.resolve();

export function withCrmLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = chain.then(fn, fn);
  chain = run.catch(() => undefined);
  return run;
}

type Rem = { at: string; kind: string; sent?: boolean };

function mergeSent(chosen: Rem[] | undefined, other: Rem[] | undefined): Rem[] | undefined {
  if (!chosen || !other?.length) return chosen;
  return chosen.map((r) => {
    if (r.sent) return r;
    const o = other.find((x) => x.kind === r.kind && x.at === r.at);
    return o?.sent ? { ...r, sent: true } : r;
  });
}

const ts = (x: any) => String(x?.updatedAt || '');

function pickAppt(inc: any, prev: any): any {
  let chosen: any;
  if (ts(prev) > ts(inc)) chosen = { ...prev };
  else {
    chosen = { ...inc };
    // Legacy rows without timestamps: never un-cancel a visit cancelled via the bot.
    if (!inc.updatedAt && !prev.updatedAt && prev.status === 'cancelled') chosen.status = 'cancelled';
  }
  const other = chosen === inc ? prev : inc;
  chosen.reminders = mergeSent(chosen.reminders, other.reminders);
  if (!chosen.telegramChatId && other.telegramChatId) chosen.telegramChatId = other.telegramChatId;
  return chosen;
}

function pickClient(inc: any, prev: any): any {
  const newer = ts(prev) > ts(inc) ? prev : inc;
  const older = newer === inc ? prev : inc;
  return {
    ...newer,
    telegramChatId: newer.telegramChatId || older.telegramChatId,
    telegramUsername: newer.telegramUsername || older.telegramUsername,
    reminderPrefs: newer.reminderPrefs ?? older.reminderPrefs,
    reminderMorning: newer.reminderMorning ?? older.reminderMorning,
  };
}

export function mergeIncoming(prev: any, incoming: any): any {
  if (!prev || typeof prev !== 'object') return incoming;
  if (!incoming || typeof incoming !== 'object') return prev;
  const out: any = { ...incoming };

  // Appointments
  const aTomb = new Set<string>(incoming.deletedAppointmentIds || []);
  const prevA = new Map<string, any>((prev.appointments || []).map((a: any) => [a.id, a]));
  const incA: any[] = Array.isArray(incoming.appointments) ? incoming.appointments : [];
  const incAIds = new Set(incA.map((a) => a.id));
  out.appointments = [
    ...incA.map((a) => (prevA.has(a.id) ? pickAppt(a, prevA.get(a.id)) : a)),
    ...(prev.appointments || []).filter((a: any) => !incAIds.has(a.id) && !aTomb.has(a.id)),
  ];
  out.deletedAppointmentIds = [];

  // Clients
  const cTomb = new Set<string>(incoming.deletedClientIds || []);
  const prevC = new Map<string, any>((prev.clients || []).map((c: any) => [c.id, c]));
  const incC: any[] = Array.isArray(incoming.clients) ? incoming.clients : [];
  const incCIds = new Set(incC.map((c) => c.id));
  out.clients = [
    ...incC.map((c) => (prevC.has(c.id) ? pickClient(c, prevC.get(c.id)) : c)),
    ...(prev.clients || []).filter((c: any) => !incCIds.has(c.id) && !cTomb.has(c.id)),
  ];
  out.deletedClientIds = [];

  // Exceptions (day schedule) — bot can edit them too.
  if (String(prev.exceptionsUpdatedAt || '') > String(incoming.exceptionsUpdatedAt || '')) {
    out.exceptions = prev.exceptions || [];
    out.exceptionsUpdatedAt = prev.exceptionsUpdatedAt;
  }

  // Telegram chats: union, server wins.
  const chats = new Map<string, any>();
  for (const c of incoming.telegramChats || []) chats.set(String(c.chatId), c);
  for (const c of prev.telegramChats || []) chats.set(String(c.chatId), { ...chats.get(String(c.chatId)), ...c });
  out.telegramChats = [...chats.values()];

  // Settings: keep server-only fields (bot drafts, offset, token, owner chat).
  const ps = prev.settings || {};
  const is = incoming.settings || {};
  out.settings = {
    ...ps,
    ...is,
    telegramOffset: Number(ps.telegramOffset || 0),
    telegramToken: is.telegramToken || ps.telegramToken || '',
    // Owner chat is set only by the bot (/start owner) or the reset endpoint — server is the authority.
    telegramOwnerChatId: 'telegramOwnerChatId' in ps ? ps.telegramOwnerChatId || '' : is.telegramOwnerChatId || '',
    telegramBotUsername: is.telegramBotUsername || ps.telegramBotUsername || '',
    _draft: ps._draft,
  };
  if (!out.settings._draft) delete out.settings._draft;

  // Never let a partial/empty browser flush wipe schedule/staff/services.
  for (const k of ['schedules', 'staff', 'services']) {
    if ((!Array.isArray(out[k]) || !out[k].length) && prev[k]?.length) out[k] = prev[k];
  }
  if (!Array.isArray(out.windows)) out.windows = prev.windows || [];
  if (!Array.isArray(out.exceptions)) out.exceptions = prev.exceptions || [];
  return out;
}

/** Stamp updatedAt on rows the server changed (prev → next). Mutates next. */
export function stampChanges(prev: any, next: any): any {
  if (!prev || !next) return next;
  const now = new Date().toISOString();
  for (const key of ['appointments', 'clients'] as const) {
    const before = new Map<string, string>(
      (prev[key] || []).map((x: any) => [x.id, JSON.stringify({ ...x, updatedAt: undefined })]),
    );
    for (const row of next[key] || []) {
      const b = before.get(row.id);
      if (b === undefined || b !== JSON.stringify({ ...row, updatedAt: undefined })) row.updatedAt = now;
    }
  }
  if (JSON.stringify(prev.exceptions || []) !== JSON.stringify(next.exceptions || [])) {
    next.exceptionsUpdatedAt = now;
  }
  return next;
}

/** Public (no-login) view of the CRM for /book: no clients, no token, no names. */
export function publicView(snap: any): any {
  const s = snap?.settings || {};
  return {
    clients: [],
    services: snap?.services || [],
    staff: snap?.staff || [],
    appointments: (snap?.appointments || [])
      .filter((a: any) => a.status !== 'cancelled')
      .map((a: any) => ({
        id: a.id,
        clientId: '',
        staffId: a.staffId,
        serviceIds: [],
        start: a.start,
        durationMin: a.durationMin,
        status: a.status,
        source: a.source,
        createdAt: '',
      })),
    windows: (snap?.windows || []).map((w: any) => ({
      id: w.id,
      staffId: w.staffId,
      start: w.start,
      durationMin: w.durationMin,
    })),
    schedules: snap?.schedules || [],
    exceptions: snap?.exceptions || [],
    telegramChats: [],
    settings: {
      dataVersion: s.dataVersion,
      studioName: s.studioName,
      subtitle: s.subtitle,
      phone: s.phone,
      address: s.address,
      soloMode: s.soloMode,
      onlineEnabled: s.onlineEnabled,
      leadMinutes: s.leadMinutes,
      horizonDays: s.horizonDays,
      slotMinutes: s.slotMinutes,
      visitColor: s.visitColor,
      onlineColor: s.onlineColor,
      onlineServiceIds: s.onlineServiceIds || [],
      telegramToken: '',
      telegramBotUsername: s.telegramBotUsername || '',
      telegramOwnerChatId: '',
      telegramOffset: 0,
    },
  };
}
