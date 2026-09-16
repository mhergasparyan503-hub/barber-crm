import { sendMessage, answerCallback, getUpdates } from './telegram-api';
import { parseApStart, mskWallISO, mskParts, reminderAtBefore, morningReminderAt } from './msk';
import { claimUpdateId } from './tg-dedup';

type Crm = {
  clients: any[];
  services: any[];
  staff: any[];
  appointments: any[];
  windows: any[];
  schedules: any[];
  exceptions: any[];
  telegramChats?: any[];
  settings: any;
};


function btn(text: string, data: string) {
  return { text: text || '·', callback_data: data };
}
function kb(rows: { text: string; callback_data: string }[][]) {
  return { inline_keyboard: rows };
}

/** Persistent bottom ReplyKeyboard (grid icon next to message field). */
function rbtn(text: string) {
  return { text: text || '·' };
}
function replyKb(rows: { text: string }[][]) {
  return {
    keyboard: rows,
    resize_keyboard: true,
    is_persistent: true,
  };
}

const MENU_BOOK = '📅 Записаться';
const MENU_BOOK_MORE = '🆕 Новая запись';
const MENU_MY = '📋 Мои записи';
const MENU_CHAT = '✉️ Написать мастеру';
const MENU_MOVE = '🔁 Перенести';
const MENU_CANCEL = '❌ Отменить';
const MENU_REMIND = '🔔 Напоминание';

/** Owner ReplyKeyboard (when chatId === telegramOwnerChatId). */
const OW_SCHED = '📆 Изменить график на день';
const OW_MOVE = '🔁 Перенести клиента';
const OW_PHONE = '🔍 Поиск по телефону';
const OW_SHARE = '🔗 Поделиться ссылкой';
const OW_CLIENTS = '👥 Клиенты';
const OW_TODAY = '📍 Сегодня';

/** Match ReplyKeyboard tap: emoji label or plain legacy label. */
function menuPlain(label: string): string {
  return String(label || '')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/^[\p{Extended_Pictographic}\p{Emoji_Presentation}\uFE0F\u200D\s]+/u, '')
    .trim();
}
function menuEq(text: string, ...labels: string[]): boolean {
  const t = String(text || '').trim();
  if (!t) return false;
  const tp = menuPlain(t);
  for (const label of labels) {
    const l = String(label || '').trim();
    const lp = menuPlain(l);
    if (t === l || t === lp || tp === l || tp === lp) return true;
    if (lp && (t.endsWith(lp) || tp.endsWith(lp))) return true;
  }
  return false;
}

function findUpcomingForClient(crm: Crm, clientId?: string | null) {
  if (!clientId) return [];
  return crm.appointments
    .filter(
      (a) =>
        a.clientId === clientId && isBookedStatus(a.status) && parseApStart(apStart(a)) > new Date(),
    )
    .sort((a, b) => +parseApStart(apStart(a)) - +parseApStart(apStart(b)));
}

function findNearestUpcoming(crm: Crm, clientId?: string | null) {
  return findUpcomingForClient(crm, clientId)[0] || null;
}

function clientReplyKeyboard(crm: Crm, chatId: string, clientId?: string) {
  const client =
    crm.clients.find((c) => c.id === clientId) ||
    crm.clients.find((c) => String(c.telegramChatId) === chatId);
  const nearest = findNearestUpcoming(crm, client?.id);
  const rows: { text: string }[][] = [
    [rbtn(MENU_BOOK), rbtn(MENU_MY)],
    [rbtn(MENU_CHAT)],
  ];
  if (nearest) {
    rows.unshift([rbtn(MENU_MOVE), rbtn(MENU_CANCEL), rbtn(MENU_REMIND)]);
    rows[1] = [rbtn(MENU_BOOK_MORE), rbtn(MENU_MY)];
  }
  return replyKb(rows);
}

function isOwnerChat(crm: Crm, chatId: string): boolean {
  const ownerId = String(crm.settings?.telegramOwnerChatId || '');
  return !!ownerId && chatId === ownerId;
}

function ownerReplyKeyboard() {
  return replyKb([
    [rbtn(OW_SCHED), rbtn(OW_MOVE)],
    [rbtn(OW_PHONE), rbtn(OW_SHARE)],
    [rbtn(OW_CLIENTS), rbtn(OW_TODAY)],
  ]);
}

async function sendOwnerMenu(token: string, chatId: string, crm: Crm, text?: string) {
  await sendMessage(
    token,
    chatId,
    text ||
      'Меню мастера.\nКнопки внизу: график, перенос, поиск, ссылка.\n/clients — написать клиенту · /cancel — сброс адресата.',
    ownerReplyKeyboard(),
  );
}

function publicBaseUrl(crm: Crm): string {
  return (
    process.env.PUBLIC_URL ||
    (crm.settings as any)?.publicUrl ||
    'https://barber.bars-ai.com'
  ).replace(/\/$/, '');
}

function botUsername(crm: Crm): string {
  return String(crm.settings?.telegramBotUsername || '').replace(/^@/, '');
}

function parseOwnerDate(text: string): string | null {
  const t = text.trim().toLowerCase();
  const today = mskParts(new Date()).date;
  if (t === 'сегодня' || t === 'today') return today;
  if (t === 'завтра' || t === 'tomorrow') {
    const d = new Date(Date.now() + 24 * 3600 * 1000);
    return mskParts(d).date;
  }
  const iso = t.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const dmy = t.match(/^(\d{1,2})[./](\d{1,2})(?:[./](\d{2,4}))?$/);
  if (dmy) {
    const dd = dmy[1].padStart(2, '0');
    const mm = dmy[2].padStart(2, '0');
    let yy = dmy[3] || today.slice(0, 4);
    if (yy.length === 2) yy = '20' + yy;
    return `${yy}-${mm}-${dd}`;
  }
  return null;
}

function parseHoursRange(text: string): { start: string; end: string; breakStart?: string; breakEnd?: string } | null {
  const t = text.trim().toLowerCase().replace(/[–—]/g, '-');
  const main = t.match(/(\d{1,2}):?(\d{2})\s*-\s*(\d{1,2}):?(\d{2})/);
  if (!main) return null;
  const start = `${main[1].padStart(2, '0')}:${main[2]}`;
  const end = `${main[3].padStart(2, '0')}:${main[4]}`;
  const br = t.match(/(?:перерыв|break)\s*(\d{1,2}):?(\d{2})\s*-\s*(\d{1,2}):?(\d{2})/);
  if (br) {
    return {
      start,
      end,
      breakStart: `${br[1].padStart(2, '0')}:${br[2]}`,
      breakEnd: `${br[3].padStart(2, '0')}:${br[4]}`,
    };
  }
  return { start, end };
}

function upsertException(crm: Crm, staffId: string, date: string, ex: Record<string, unknown>) {
  if (!crm.exceptions) crm.exceptions = [];
  const idx = crm.exceptions.findIndex((e) => e.staffId === staffId && e.date === date);
  const id = idx >= 0 ? crm.exceptions[idx].id : 'ex_' + Math.random().toString(36).slice(2, 10);
  const row = { id, staffId, date, ...ex };
  if (idx >= 0) crm.exceptions[idx] = row;
  else crm.exceptions.push(row);
}

function clearDayException(crm: Crm, staffId: string, date: string) {
  crm.exceptions = (crm.exceptions || []).filter((e) => !(e.staffId === staffId && e.date === date));
}

function phoneLast10(raw: string): string {
  const d = digitsOnly(normalizePhone(raw) || raw);
  return d.slice(-10);
}

function findClientsByPhone(crm: Crm, raw: string) {
  const needle = phoneLast10(raw);
  if (needle.length < 7) return [];
  return (crm.clients || []).filter((c) => phoneLast10(c.phone || '').endsWith(needle) || phoneLast10(c.phone || '') === needle);
}

async function sendOwnerSchedCalendar(token: string, chatId: string, ym: string) {
  const [y, m] = ym.split('-').map(Number);
  const dow = new Date(`${ym}-01T12:00:00+03:00`).getDay();
  const startPad = (dow + 6) % 7;
  const daysInMonth = new Date(y, m, 0).getDate();
  const rows: any[] = [
    [btn('←', `ow:sm:${prevMonth(ym)}`), btn(ym, `ow:sm:${ym}`), btn('→', `ow:sm:${nextMonth(ym)}`)],
  ];
  rows.push(['пн', 'вт', 'ср', 'чт', 'пт', 'сб', 'вс'].map((t) => btn(t, 'ow:noop')));
  let row: any[] = [];
  for (let i = 0; i < startPad; i++) row.push(btn('·', 'ow:noop'));
  for (let d = 1; d <= daysInMonth; d++) {
    const ds = `${ym}-${String(d).padStart(2, '0')}`;
    row.push(btn(String(d), `ow:sy:${ds}`));
    if (row.length === 7) {
      rows.push(row);
      row = [];
    }
  }
  while (row.length && row.length < 7) row.push(btn('·', 'ow:noop'));
  if (row.length) rows.push(row);
  rows.push([btn('« 📋 Меню', 'ow:menu')]);
  await sendMessage(token, chatId, 'Выберите день для графика (или напишите ДД.ММ / сегодня / завтра):', kb(rows));
}

async function askSchedKind(token: string, chatId: string, day: string) {
  await sendMessage(
    token,
    chatId,
    `День ${day}. Какой режим?`,
    kb([
      [btn('Рабочий (как в шаблоне)', `ow:sk:work:${day}`)],
      [btn('Выходной', `ow:sk:off:${day}`)],
      [btn('Свои часы', `ow:sk:custom:${day}`)],
      [btn('« 📋 Меню', 'ow:menu')],
    ]),
  );
}

async function listUpcomingForOwner(token: string, chatId: string, crm: Crm, clientFilterId?: string) {
  const now = new Date();
  let list = (crm.appointments || [])
    .filter((a) => isBookedStatus(a.status) && parseApStart(apStart(a)) > now)
    .sort((a, b) => +parseApStart(apStart(a)) - +parseApStart(apStart(b)));
  if (clientFilterId) list = list.filter((a) => a.clientId === clientFilterId);
  list = list.slice(0, 10);
  if (!list.length) {
    await sendMessage(token, chatId, 'Нет ближайших записей.', ownerReplyKeyboard());
    return;
  }
  const rows = list.map((a) => {
    const c = crm.clients.find((x) => x.id === a.clientId);
    const svc = crm.services.find((s) => a.serviceIds?.includes(s.id));
    const p = mskParts(parseApStart(apStart(a)));
    const label = `${p.date.slice(5)} ${p.time} ${c?.name || 'Клиент'}${svc ? ' · ' + svc.name : ''}`.slice(0, 64);
    return [btn(label, `ow:mv:${a.id.slice(-10)}`)];
  });
  rows.push([btn('« 📋 Меню', 'ow:menu')]);
  await sendMessage(token, chatId, 'Выберите запись для переноса:', kb(rows));
}

async function showOwnerToday(token: string, chatId: string, crm: Crm) {
  const today = mskParts(new Date()).date;
  const list = (crm.appointments || [])
    .filter(
      (a) =>
        isBookedStatus(a.status) && mskParts(parseApStart(apStart(a))).date === today,
    )
    .sort((a, b) => +parseApStart(apStart(a)) - +parseApStart(apStart(b)));
  if (!list.length) {
    await sendMessage(token, chatId, `На сегодня (${today}) записей нет.`, ownerReplyKeyboard());
    return;
  }
  const lines = list
    .map((a) => {
      const c = crm.clients.find((x) => x.id === a.clientId);
      const svc = crm.services.find((s) => a.serviceIds?.includes(s.id));
      const p = mskParts(parseApStart(apStart(a)));
      return `• ${p.time} — ${c?.name || 'Клиент'} · ${svc?.name || 'услуга'} · ${c?.phone || '—'}`;
    })
    .join('\n');
  await sendMessage(token, chatId, `Сегодня ${today}:\n${lines}`, ownerReplyKeyboard());
}

async function shareBotLink(token: string, chatId: string, crm: Crm) {
  const uname = botUsername(crm);
  const base = publicBaseUrl(crm);
  const book = `${base}/book`;
  if (!uname) {
    await sendMessage(
      token,
      chatId,
      'Сначала укажите username бота в настройках CRM (или нажмите «Проверить бота»).\n\nОнлайн-запись: ' + book,
      ownerReplyKeyboard(),
    );
    return;
  }
  const botLink = `https://t.me/${uname}`;
  const shareUrl =
    `https://t.me/share/url?url=${encodeURIComponent(botLink)}` +
    `&text=${encodeURIComponent('Запись к барберу — нажмите Start и «Записаться»')}`;
  const body =
    `Ссылка на бота для клиентов:\n${botLink}\n\n` +
    `Пусть нажмут Start → Записаться.\n\n` +
    `Онлайн-запись на сайте:\n${book}`;
  // Inline URL buttons (reply keyboard stays persistent from prior messages)
  await sendMessage(token, chatId, body, {
    inline_keyboard: [
      [{ text: 'Открыть бота', url: botLink }],
      [{ text: 'Поделиться в Telegram', url: shareUrl }],
      [{ text: 'Онлайн-запись', url: book }],
    ],
  });
  await sendMessage(token, chatId, 'Можно переслать ссылку выше клиенту.', ownerReplyKeyboard());
}

async function showPhoneSearchResult(token: string, chatId: string, crm: Crm, rawPhone: string) {
  const found = findClientsByPhone(crm, rawPhone);
  if (!found.length) {
    await sendMessage(token, chatId, 'Клиенты не найдены. Попробуйте ещё раз или «Меню».', ownerReplyKeyboard());
    return;
  }
  for (const c of found.slice(0, 5)) {
    const upcoming = (crm.appointments || [])
      .filter(
        (a) =>
          a.clientId === c.id && isBookedStatus(a.status) && parseApStart(apStart(a)) > new Date(),
      )
      .sort((a, b) => +parseApStart(apStart(a)) - +parseApStart(apStart(b)))[0];
    const last = (crm.appointments || [])
      .filter((a) => a.clientId === c.id && isBookedStatus(a.status))
      .sort((a, b) => +parseApStart(apStart(b)) - +parseApStart(apStart(a)))[0];
    let visitLine = 'Нет визитов';
    if (upcoming) {
      const p = mskParts(parseApStart(apStart(upcoming)));
      visitLine = `Ближайший: ${p.date} ${p.time}`;
    } else if (last) {
      const p = mskParts(parseApStart(apStart(last)));
      visitLine = `Последний: ${p.date} ${p.time}`;
    }
    const rows: any[] = [[btn('📞 Позвонить', `ow:tel:${c.id}`)]];
    if (upcoming) rows.push([btn('🔁 Перенести', `ow:mv:${upcoming.id.slice(-10)}`)]);
    if (c.telegramChatId) rows.push([btn('✉️ Написать', `toclient:${c.id}`)]);
    rows.push([btn('« 📋 Меню', 'ow:menu')]);
    await sendMessage(
      token,
      chatId,
      `${c.name || 'Клиент'}\n${c.phone || '—'}\n${visitLine}`,
      kb(rows),
    );
  }
}

async function handleOwnerMenuText(
  token: string,
  chatId: string,
  crm: Crm,
  text: string,
): Promise<boolean> {
  if (menuEq(text, 'Меню', '📋 Меню') || text === '/menu') {
    await sendOwnerMenu(token, chatId, crm);
    console.log('tg owner Меню → ReplyKeyboard chat', chatId);
    return true;
  }
  if (menuEq(text, OW_SCHED)) {
    setDraft(crm, chatId, { ...(getDraft(crm, chatId) || {}), await: 'ow_sched_date', ownerFlow: 'sched' });
    const ym = mskParts(new Date()).date.slice(0, 7);
    await sendOwnerSchedCalendar(token, chatId, ym);
    return true;
  }
  if (menuEq(text, OW_MOVE)) {
    setDraft(crm, chatId, { ...(getDraft(crm, chatId) || {}), await: undefined, ownerFlow: 'move' });
    await sendMessage(
      token,
      chatId,
      'Перенос: выберите запись ниже или пришлите телефон клиента.',
      ownerReplyKeyboard(),
    );
    setDraft(crm, chatId, { ...getDraft(crm, chatId), await: 'ow_move_phone' });
    await listUpcomingForOwner(token, chatId, crm);
    return true;
  }
  if (menuEq(text, OW_PHONE)) {
    setDraft(crm, chatId, { await: 'ow_phone', ownerFlow: 'phone' });
    await sendMessage(token, chatId, 'Введите телефон (цифры):');
    return true;
  }
  // Match current emoji label, plain text, and older «…на бота» wording
  if (
    menuEq(
      text,
      OW_SHARE,
      'Поделиться ссылкой',
      'Поделиться ссылкой на бота',
      '🔗 Поделиться ссылкой на бота',
    ) || /поделиться\s+ссылк/i.test(menuPlain(text))
  ) {
    await shareBotLink(token, chatId, crm);
    return true;
  }
  if (menuEq(text, OW_CLIENTS) || text === '/clients') {
    const rows = crm.clients
      .filter((c) => c.telegramChatId)
      .slice(0, 20)
      .map((c) => [btn(c.name || c.phone || c.id, `toclient:${c.id}`)]);
    if (!rows.length) {
      await sendMessage(token, chatId, 'Нет клиентов с Telegram.', ownerReplyKeyboard());
      return true;
    }
    await sendMessage(token, chatId, 'Кому написать?', kb(rows));
    return true;
  }
  if (menuEq(text, OW_TODAY)) {
    await showOwnerToday(token, chatId, crm);
    return true;
  }
  return false;
}

export type InboxResult = {
  offset: number;
  patch: Partial<Crm>;
  replies: number;
};

function cloneCrm(crm: Crm): Crm {
  return {
    clients: [...(crm.clients || [])],
    appointments: [...(crm.appointments || [])],
    telegramChats: [...(crm.telegramChats || [])],
    services: [...(crm.services || [])],
    staff: [...(crm.staff || [])],
    windows: [...(crm.windows || [])],
    schedules: [...(crm.schedules || [])],
    exceptions: [...(crm.exceptions || [])],
    settings: { ...(crm.settings || {}) },
  };
}

function staffIdOf(crm: Crm): string {
  const active = (crm.staff || []).find((s: any) => s.active !== false);
  return active?.id || crm.staff?.[0]?.id || 'staff_barber';
}

/** Mobile CRM uses `start` (not startsAt) and status waiting|cancelled. */
function apStart(a: any): string {
  return a?.start || a?.startsAt || '';
}

function isBookedStatus(status: string | undefined): boolean {
  return status !== 'cancelled' && status !== 'no_show';
}


function reminderPickerKeyboard(sid: string) {
  return kb([
    [btn('⏱ 15 мин', `bk:rt:${sid}:15`), btn('⏱ 30 мин', `bk:rt:${sid}:30`)],
    [btn('⏱ 1 ч', `bk:rt:${sid}:60`), btn('⏱ 2 ч', `bk:rt:${sid}:120`), btn('⏱ 3 ч', `bk:rt:${sid}:180`)],
    [btn('🌅 Утро 09:00', `bk:ru:${sid}`), btn('📆 Сутки', `bk:rt:${sid}:1440`)],
    [btn('📆 2 дня', `bk:rt:${sid}:2880`), btn('✏️ Своё…', `bk:rw:${sid}`)],
    [btn('🔕 Не напоминать', `bk:rn:${sid}`)],
    [btn('📋 Меню', 'bk:menu')],
  ]);
}

function reminderAfterSetKeyboard(sid: string) {
  return kb([
    [btn('➕ Добавить ещё напоминание', `bk:rm:${sid}`)],
    [btn('✅ Готово', 'bk:menu')],
  ]);
}

async function sendReminderPicker(
  token: string,
  chatId: string,
  sid: string,
  prompt = 'Когда напомнить?',
) {
  await sendMessage(token, chatId, prompt, reminderPickerKeyboard(sid));
}

/** ReplyKeyboard «Напоминание» / bk:rm without visit: pick visit if several, else presets. */
async function startClientRemindFlow(
  token: string,
  chatId: string,
  crm: Crm,
  clientId?: string | null,
) {
  const client =
    crm.clients.find((c) => c.id === clientId) ||
    crm.clients.find((c) => String(c.telegramChatId) === chatId);
  const list = findUpcomingForClient(crm, client?.id);
  if (!list.length) {
    await sendMessage(token, chatId, 'Нет ближайшей записи.', clientReplyKeyboard(crm, chatId, client?.id));
    return;
  }
  if (list.length === 1) {
    const ap = list[0];
    const has = (ap.reminders || []).length > 0;
    const prompt = has
      ? 'Когда напомнить? Можно добавить ещё к уже установленным.'
      : 'Когда напомнить?';
    await sendReminderPicker(token, chatId, ap.id.slice(-10), prompt);
    return;
  }
  const rows = list.map((a) => {
    const svc = crm.services.find((s) => a.serviceIds?.includes(s.id));
    const p = mskParts(parseApStart(apStart(a)));
    const n = (a.reminders || []).length;
    const rem = n ? ` · ${n} нап.` : '';
    const label = `${p.date.slice(5)} ${p.time}${svc ? ' · ' + svc.name : ''}${rem}`.slice(0, 64);
    return [btn(label, `bk:rm:${a.id.slice(-10)}`)];
  });
  rows.push([btn('📋 Меню', 'bk:menu')]);
  await sendMessage(token, chatId, 'Какую запись напомнить?', kb(rows));
}


function digitsOnly(v: string): string {
  return (v || '').replace(/\D/g, '');
}

function normalizePhone(raw: string): string {
  let d = digitsOnly(raw);
  if (d.length === 11 && (d.startsWith('8') || d.startsWith('7'))) d = d.slice(1);
  if (d.length === 10) return '+7' + d;
  if (d.length === 11 && d.startsWith('7')) return '+' + d;
  if (raw.trim().startsWith('+') && d.length >= 10) return '+' + d;
  return d ? '+7' + d.slice(-10) : '';
}

function phoneOk(raw: string): boolean {
  return digitsOnly(normalizePhone(raw) || raw).length >= 10;
}

const WEEKDAY_RU = ['воскресенье', 'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота'];

function weekdayRu(start: string | Date): string {
  const d = typeof start === 'string' ? parseApStart(start) : start;
  if (!Number.isFinite(+d)) return '';
  // MSK calendar weekday
  const { date } = mskParts(d);
  const dow = new Date(`${date}T12:00:00+03:00`).getDay();
  return WEEKDAY_RU[dow] || '';
}

function fillTemplate(
  tpl: string,
  vars: Record<string, string | number | undefined | null>,
): string {
  let out = String(tpl);
  for (const [k, v] of Object.entries(vars)) {
    out = out.replaceAll(`{${k}}`, v == null ? '' : String(v));
  }
  return out;
}

function getDraft(crm: Crm, chatId: string): any {
  return ((crm.settings as any)._draft || {})[chatId] || {};
}

function setDraft(crm: Crm, chatId: string, draft: any) {
  (crm.settings as any)._draft = { ...(crm.settings as any)._draft, [chatId]: draft };
}

function clearDraftAwait(crm: Crm, chatId: string) {
  const d = getDraft(crm, chatId);
  delete d.await;
  setDraft(crm, chatId, d);
}


function formatCancelVisitSummary(crm: Crm, ap: any, forOwner: boolean): string {
  const p = mskParts(parseApStart(apStart(ap)));
  const svc = crm.services.find((s) => ap.serviceIds?.includes(s.id));
  const client = crm.clients.find((c) => c.id === ap.clientId);
  const when = `${p.date} в ${p.time}${svc ? ` — ${svc.name}` : ''}`;
  if (forOwner) {
    return `${client?.name || 'Клиент'}\n${client?.phone || '—'}\n${when}`;
  }
  return when;
}

async function promptCancelStep1(
  token: string,
  chatId: string,
  crm: Crm,
  ap: any,
  opts: { forOwner: boolean },
) {
  const prev = getDraft(crm, chatId) || {};
  // Idempotent: same visit already in confirm step — do not send a second prompt.
  if (prev.cancelId === ap.id && Number(prev.cancelConfirm) >= 1) {
    return;
  }
  setDraft(crm, chatId, { ...prev, cancelId: ap.id, cancelConfirm: 1 });
  const summary = formatCancelVisitSummary(crm, ap, opts.forOwner);
  const yes = opts.forOwner ? 'ow:cly' : 'bk:cly';
  const no = opts.forOwner ? 'ow:menu' : 'bk:menu';
  await sendMessage(
    token,
    chatId,
    `${summary}\n\nОтменить запись?`,
    kb([[btn('✅ Да', yes), btn('❌ Нет', no)]]),
  );
}

async function promptCancelStep2(token: string, chatId: string, crm: Crm, forOwner: boolean) {
  const draft = getDraft(crm, chatId);
  if (Number(draft.cancelConfirm) >= 2) {
    return;
  }
  setDraft(crm, chatId, { ...draft, cancelConfirm: 2 });
  const yes = forOwner ? 'ow:cly2' : 'bk:cly2';
  const no = forOwner ? 'ow:menu' : 'bk:menu';
  await sendMessage(
    token,
    chatId,
    'Точно отменить? Это нельзя отменить.',
    kb([[btn('❌ Да, отменить', yes), btn('✅ Нет, оставить', no)]]),
  );
}

async function performClientCancel(token: string, chatId: string, crm: Crm) {
  const draft = getDraft(crm, chatId);
  const ap = crm.appointments.find((a) => a.id === draft.cancelId);
  setDraft(crm, chatId, {});
  if (!ap) {
    await sendMessage(token, chatId, 'Запись не найдена.', kb([[btn('📋 Меню', 'bk:menu')]]));
    return;
  }
  if (ap.status === 'cancelled') {
    await sendMessage(token, chatId, 'Запись уже отменена.', kb([[btn('📋 Меню', 'bk:menu')]]));
    return;
  }
  ap.status = 'cancelled';
  await sendMessage(token, chatId, 'Запись отменена.', kb([[btn('📋 Меню', 'bk:menu')]]));
  if (crm.settings.telegramOwnerChatId) {
    const when = mskParts(parseApStart(apStart(ap)));
    await sendMessage(
      token,
      crm.settings.telegramOwnerChatId,
      `Клиент отменил запись ${when.date} ${when.time}`,
    );
  }
}

async function performOwnerCancel(token: string, chatId: string, crm: Crm) {
  const draft = getDraft(crm, chatId);
  const ap = crm.appointments.find((a) => a.id === draft.cancelId);
  setDraft(crm, chatId, {});
  if (!ap) {
    await sendMessage(token, chatId, 'Запись не найдена.', ownerReplyKeyboard());
    return;
  }
  if (ap.status === 'cancelled') {
    await sendMessage(token, chatId, 'Запись уже отменена.', ownerReplyKeyboard());
    return;
  }
  ap.status = 'cancelled';
  const client = crm.clients.find((c) => c.id === ap.clientId);
  if (client?.telegramChatId) {
    await sendMessage(token, client.telegramChatId, 'Мастер отменил вашу запись.');
  }
  await sendMessage(token, chatId, 'Запись отменена, клиенту отправлено уведомление.', ownerReplyKeyboard());
}


/** Process a single Telegram update (webhook). Mutates a CRM clone and returns it as patch. */
export async function handleUpdate(crm: Crm, update: any): Promise<InboxResult> {
  const token = crm.settings?.telegramToken;
  if (!token) return { offset: crm.settings?.telegramOffset || 0, patch: {}, replies: 0 };

  let offset = Math.max(crm.settings?.telegramOffset || 0, (update?.update_id || 0) + 1);
  const patch = cloneCrm(crm);
  let replies = 0;

  // Dedup is owned by claimUpdateId (webhook claims in dev.ts; poll claims below).
  try {
    if (update?.message) {
      await handleMessage(token, update.message, patch);
      replies++;
    } else if (update?.callback_query) {
      await handleCallback(token, update.callback_query, patch);
      replies++;
    }
  } catch (e) {
    console.error('tg handle', e);
  }

  (patch.settings as any).telegramOffset = offset;
  return { offset, patch, replies };
}

export async function pollAndHandle(crm: Crm): Promise<InboxResult> {
  const token = crm.settings?.telegramToken;
  if (!token) return { offset: crm.settings?.telegramOffset || 0, patch: {}, replies: 0 };

  let offset = crm.settings?.telegramOffset || 0;
  // Calling getUpdates cancels an active Telegram webhook. Production uses /api/telegram.
  if (process.env.TELEGRAM_ALLOW_POLL !== '1') {
    return { offset, patch: {}, replies: 0 };
  }
  const res = await getUpdates(token, offset > 0 ? offset : 0, 2);
  if (!res.ok) {
    return { offset, patch: {}, replies: 0 };
  }

  const patch = cloneCrm(crm);
  let replies = 0;

  for (const u of res.result || []) {
    if (!claimUpdateId(u.update_id, offset)) {
      offset = Math.max(offset, (u.update_id || 0) + 1);
      continue;
    }
    offset = Math.max(offset, u.update_id + 1);

    const msgText = (u.message?.text || u.callback_query?.data || '').slice(0, 60);
    console.log(
      'tg update',
      u.update_id,
      u.message ? 'message' : u.callback_query ? 'callback' : 'other',
      JSON.stringify(msgText),
    );

    try {
      if (u.message) {
        await handleMessage(token, u.message, patch);
        replies++;
      } else if (u.callback_query) {
        await handleCallback(token, u.callback_query, patch);
        replies++;
      }
    } catch (e) {
      console.error('tg handle', e);
    }
  }

  (patch.settings as any).telegramOffset = offset;
  return { offset, patch, replies };
}

async function handleMessage(token: string, msg: any, crm: Crm) {
  const chatId = String(msg.chat.id);
  const text = (msg.text || '').trim();
  const username = msg.from?.username;

  if (text.startsWith('/start')) {
    const rawPayload = text.split(/\s+/)[1] || '';
    const payload = rawPayload.trim().toLowerCase();
    const ownerId = String(crm.settings.telegramOwnerChatId || '');
    if (payload === 'owner') {
      crm.settings.telegramOwnerChatId = chatId;
      await sendOwnerMenu(
        token,
        chatId,
        crm,
        'Рабочий чат мастера подключён.\nКнопки внизу — меню мастера.\n/clients — написать клиенту · /cancel — сброс адресата.',
      );
      console.log('tg /start owner → owner ReplyKeyboard chat', chatId);
      return;
    }
    if (ownerId && chatId === ownerId && !rawPayload.startsWith('c_') && !rawPayload.startsWith('v_')) {
      await sendOwnerMenu(
        token,
        chatId,
        crm,
        'Вы в рабочем чате мастера.\nКнопки внизу — меню мастера (график, перенос, поиск, ссылка).',
      );
      console.log('tg /start owner-chat → owner ReplyKeyboard chat', chatId);
      return;
    }
    if (rawPayload.startsWith('c_')) {
      const clientId = rawPayload.slice(2);
      const client = crm.clients.find((c) => c.id === clientId);
      if (client) {
        client.telegramChatId = chatId;
        client.telegramUsername = username;
      }
      linkChat(crm, chatId, username, clientId);
      await sendClientMenu(token, chatId, crm, clientId);
      console.log('tg /start c_ → ReplyKeyboard chat', chatId, 'has_reply_markup', true);
      return;
    }
    if (rawPayload.startsWith('v_')) {
      const visitId = rawPayload.slice(2);
      const ap =
        crm.appointments.find((a) => a.id === visitId) ||
        findBySuffix(crm.appointments, visitId);
      let clientId: string | undefined;
      if (ap) {
        const client = crm.clients.find((c) => c.id === ap.clientId);
        if (client) {
          client.telegramChatId = chatId;
          client.telegramUsername = username;
          clientId = client.id;
        }
        if (!ap.telegramChatId) ap.telegramChatId = chatId;
      }
      linkChat(crm, chatId, username, clientId);
      await sendClientMenu(token, chatId, crm, clientId);
      console.log('tg /start v_ → ReplyKeyboard chat', chatId, 'has_reply_markup', true);
      return;
    }
    // plain /start — client, never steal owner
    linkChat(crm, chatId, username);
    await sendClientMenu(token, chatId, crm);
    console.log('tg /start → ReplyKeyboard chat', chatId, 'has_reply_markup', true);
    return;
  }

  // Owner ReplyKeyboard + owner drafts first
  if (isOwnerChat(crm, chatId)) {
    const owHandled = await handleOwnerMenuText(token, chatId, crm, text);
    if (owHandled) return;

    if (text === '/cancel') {
      (crm.settings as any)._replyTo = null;
      clearDraftAwait(crm, chatId);
      setDraft(crm, chatId, {});
      await sendMessage(token, chatId, 'Адресат и черновик сброшены.', ownerReplyKeyboard());
      return;
    }

    const od = getDraft(crm, chatId);
    if (od.await === 'ow_sched_date' && text && !text.startsWith('/')) {
      const day = parseOwnerDate(text);
      if (!day) {
        await sendMessage(token, chatId, 'Не понял дату. Пример: 15.09, 2026-09-15, сегодня, завтра');
        return;
      }
      setDraft(crm, chatId, { ...od, schedDay: day, await: undefined });
      await askSchedKind(token, chatId, day);
      return;
    }
    if (od.await === 'ow_sched_hours' && text && !text.startsWith('/')) {
      const hours = parseHoursRange(text);
      if (!hours) {
        await sendMessage(
          token,
          chatId,
          'Формат: 10:00-21:00 или 10:00-21:00 перерыв 13:00-14:00',
        );
        return;
      }
      const day = od.schedDay;
      const sid = staffIdOf(crm);
      upsertException(crm, sid, day, {
        type: 'custom',
        start: hours.start,
        end: hours.end,
        breakStart: hours.breakStart,
        breakEnd: hours.breakEnd,
      });
      setDraft(crm, chatId, {});
      const br =
        hours.breakStart && hours.breakEnd
          ? `, перерыв ${hours.breakStart}-${hours.breakEnd}`
          : '';
      await sendMessage(
        token,
        chatId,
        `График на ${day}: свои часы ${hours.start}-${hours.end}${br}. Сохранено.`,
        ownerReplyKeyboard(),
      );
      return;
    }
    if (od.await === 'ow_phone' && text && !text.startsWith('/')) {
      clearDraftAwait(crm, chatId);
      setDraft(crm, chatId, {});
      await showPhoneSearchResult(token, chatId, crm, text);
      return;
    }
    if (od.await === 'ow_move_phone' && text && !text.startsWith('/') && phoneOk(text)) {
      const found = findClientsByPhone(crm, text);
      clearDraftAwait(crm, chatId);
      if (!found.length) {
        await sendMessage(token, chatId, 'Клиент не найден по телефону.', ownerReplyKeyboard());
        return;
      }
      await listUpcomingForOwner(token, chatId, crm, found[0].id);
      return;
    }

    const replyTo = (crm.settings as any)._replyTo;
    if (replyTo && text && !text.startsWith('/')) {
      await sendMessage(token, replyTo, `Мастер:\n${text}`);
      await sendMessage(token, chatId, 'Отправлено.', ownerReplyKeyboard());
      return;
    }

    // Optional: still allow client menu labels in owner chat for QA
    const clientMenuTry = await handleClientMenuText(token, chatId, crm, text, msg.from);
    if (clientMenuTry) return;

    await sendMessage(
      token,
      chatId,
      'Меню мастера внизу экрана, или /clients · /cancel.',
      ownerReplyKeyboard(),
    );
    return;
  }

  // ReplyKeyboard taps (client menu) — before free-text / name collection.
  {
    const handledMenu = await handleClientMenuText(token, chatId, crm, text, msg.from);
    if (handledMenu) return;
  }

  // Collect name / phone for new booking
  const draft = getDraft(crm, chatId);
  if (draft.await === 'name' && text && !text.startsWith('/')) {
    setDraft(crm, chatId, { ...draft, name: text.slice(0, 80), await: 'phone' });
    await sendMessage(token, chatId, 'Укажите телефон (+7…):');
    return;
  }
  if (draft.await === 'phone' && text && !text.startsWith('/')) {
    if (!phoneOk(text)) {
      await sendMessage(token, chatId, 'Не похоже на телефон. Пример: +7 999 123-45-67');
      return;
    }
    const phone = normalizePhone(text);
    setDraft(crm, chatId, { ...draft, phone, await: undefined });
    await finalizeBooking(token, chatId, crm, msg.from);
    return;
  }
  if (draft.await === 'remind_custom' && text && !text.startsWith('/')) {
    const sid = draft.remindSid;
    const ap = findBySuffix(crm.appointments, sid);
    clearDraftAwait(crm, chatId);
    if (!ap) {
      await sendMessage(token, chatId, 'Запись не найдена.', kb([[btn('📋 Меню', 'bk:menu')]]));
      return;
    }
    const mins = parseCustomReminder(text, apStart(ap));
    if (mins == null) {
      await sendMessage(
        token,
        chatId,
        'Не понял. Примеры: «за 45 минут», «10:00», «15.09 09:30»',
        kb([[btn('🔔 Напоминание', `bk:rm:${sid}`), btn('📋 Меню', 'bk:menu')]]),
      );
      return;
    }
    const at = reminderAtBefore(apStart(ap), mins);
    ap.reminders = [
      ...(ap.reminders || []).filter((r: any) => r.kind !== `custom_${mins}`),
      { at, kind: `custom_${mins}`, sent: false },
    ];
    await sendMessage(token, chatId, 'Напоминание установлено.', reminderAfterSetKeyboard(sid));
    return;
  }

  // client free text → owner
  const client = crm.clients.find((c) => String(c.telegramChatId) === chatId);
  const name = client?.name || username || 'Клиент';
  const owner = crm.settings.telegramOwnerChatId;
  if (owner) {
    const nearest = crm.appointments
      .filter(
        (a) =>
          a.clientId === client?.id && isBookedStatus(a.status) && parseApStart(apStart(a)) > new Date(),
      )
      .sort((a, b) => +parseApStart(apStart(a)) - +parseApStart(apStart(b)))[0];
    const rows = [[btn('💬 Ответить', `tochat:${chatId}`)]];
    if (nearest) {
      rows.push([
        btn('❌ Отменить', `ow:cl:${nearest.id.slice(-10)}`),
        btn('🔁 Перенести', `ow:mv:${nearest.id.slice(-10)}`),
      ]);
      rows.push([btn('✉️ Написать', `ow:msg:${nearest.id.slice(-10)}`)]);
    }
    await sendMessage(token, owner, `✉ ${name}\n${text}`, kb(rows));
  }
  await sendMessage(token, chatId, 'Сообщение отправлено мастеру.');
}

async function sendClientMenu(token: string, chatId: string, crm: Crm, clientId?: string) {
  const client =
    crm.clients.find((c) => c.id === clientId) ||
    crm.clients.find((c) => String(c.telegramChatId) === chatId);
  const nearest = findNearestUpcoming(crm, client?.id);
  const markup = clientReplyKeyboard(crm, chatId, client?.id);
  if (nearest) {
    const p = mskParts(parseApStart(apStart(nearest)));
    const svc = crm.services.find((s) => nearest.serviceIds?.includes(s.id));
    await sendMessage(
      token,
      chatId,
      `Ваша ближайшая запись: ${p.date} в ${p.time}${svc ? ` — ${svc.name}` : ''}.\nВыберите действие кнопками внизу (иконка сетки у поля ввода).`,
      markup,
    );
    return;
  }
  await sendMessage(
    token,
    chatId,
    `Добро пожаловать в ${crm.settings.studioName || 'Барбершоп'}!\n\nМеню внизу экрана: Записаться, Мои записи, Написать мастеру.`,
    markup,
  );
}

/** Handle ReplyKeyboard text taps (same flows as inline bk:*). */
async function handleClientMenuText(
  token: string,
  chatId: string,
  crm: Crm,
  text: string,
  from?: any,
): Promise<boolean> {
  const client = crm.clients.find((c) => String(c.telegramChatId) === chatId);
  const nearest = findNearestUpcoming(crm, client?.id);

  if (menuEq(text, 'Меню', '📋 Меню') || text === '/menu') {
    await sendClientMenu(token, chatId, crm);
    console.log('tg Меню → ReplyKeyboard chat', chatId, 'has_reply_markup', true);
    return true;
  }
  if (menuEq(text, MENU_BOOK, MENU_BOOK_MORE, 'Записаться ещё')) {
    clearDraftAwait(crm, chatId);
    await startBookingServices(token, chatId, crm);
    return true;
  }
  if (menuEq(text, MENU_MY)) {
    await showMyAppointments(token, chatId, crm);
    return true;
  }
  if (menuEq(text, MENU_CHAT)) {
    await sendMessage(token, chatId, 'Напишите сообщение — я перешлю мастеру.');
    return true;
  }
  if (menuEq(text, MENU_MOVE)) {
    if (!nearest) {
      await sendMessage(token, chatId, 'Нет ближайшей записи для переноса.', clientReplyKeyboard(crm, chatId));
      return true;
    }
    setDraft(crm, chatId, {
      serviceId: nearest.serviceIds?.[0],
      ignoreId: nearest.id.slice(-10),
    });
    const ym = mskParts(new Date()).date.slice(0, 7);
    await sendMonthCalendar(token, chatId, ym);
    return true;
  }
  if (menuEq(text, MENU_CANCEL)) {
    if (!nearest) {
      await sendMessage(token, chatId, 'Нет ближайшей записи для отмены.', clientReplyKeyboard(crm, chatId));
      return true;
    }
    await promptCancelStep1(token, chatId, crm, nearest, { forOwner: false });
    return true;
  }
  if (menuEq(text, MENU_REMIND)) {
    await startClientRemindFlow(token, chatId, crm, client?.id);
    return true;
  }
  void from;
  return false;
}

function linkChat(crm: Crm, chatId: string, username?: string, clientId?: string) {
  if (!crm.telegramChats) crm.telegramChats = [];
  const idx = crm.telegramChats.findIndex((t) => String(t.chatId) === chatId);
  const row = { chatId, username, clientId, linkedAt: new Date().toISOString() };
  if (idx >= 0) crm.telegramChats[idx] = { ...crm.telegramChats[idx], ...row };
  else crm.telegramChats.push(row);
}

function findBySuffix(list: any[], suffix: string) {
  return list.find((x) => String(x.id).endsWith(suffix));
}

function listBookableServices(crm: Crm) {
  const ids: string[] | undefined = crm.settings?.onlineServiceIds;
  return (crm.services || []).filter((s) => {
    if (s.active === false) return false;
    if (ids?.length) return ids.includes(s.id);
    return s.online !== false;
  });
}

async function startBookingServices(token: string, chatId: string, crm: Crm) {
  const services = listBookableServices(crm);
  const rows = services.map((s) => [btn(`${s.name} · ${s.price}₽`, `bk:sv:${s.id}`)]);
  if (!rows.length) {
    await sendMessage(token, chatId, 'Нет доступных услуг.', kb([[btn('« 📋 Меню', 'bk:menu')]]));
    return;
  }
  rows.push([btn('« 📋 Меню', 'bk:menu')]);
  await sendMessage(token, chatId, 'Выберите услугу:', kb(rows));
}

async function showMyAppointments(token: string, chatId: string, crm: Crm) {
  const client = crm.clients.find((c) => String(c.telegramChatId) === chatId);
  const list = crm.appointments
    .filter(
      (a) =>
        a.clientId === client?.id && isBookedStatus(a.status) && parseApStart(apStart(a)) > new Date(),
    )
    .sort((a, b) => +parseApStart(apStart(a)) - +parseApStart(apStart(b)));
  if (!list.length) {
    await sendMessage(token, chatId, 'Нет ближайших записей.', kb([[btn('📅 Записаться', 'bk:go')]]));
    return;
  }
  const lines = list
    .map((a) => {
      const svc = crm.services.find((s) => a.serviceIds?.includes(s.id));
      const p = mskParts(parseApStart(apStart(a)));
      return `• ${p.date} ${p.time} — ${svc?.name || 'услуга'}`;
    })
    .join('\n');
  await sendMessage(token, chatId, lines, kb([[btn('📋 Меню', 'bk:menu')]]));
}

async function handleCallback(token: string, cq: any, crm: Crm) {
  const chatId = String(cq.message?.chat?.id);
  const data = cq.data || '';
  await answerCallback(token, cq.id);

  if (data === 'bk:menu' || data === 'bk:ok' || data === 'ow:menu') {
    if (isOwnerChat(crm, chatId)) {
      await sendOwnerMenu(token, chatId, crm);
    } else {
      await sendClientMenu(token, chatId, crm);
    }
    return;
  }
  if (data === 'ow:noop' || data === 'bk:noop') {
    return;
  }
  if (data === 'bk:go') {
    await startBookingServices(token, chatId, crm);
    return;
  }
  if (data.startsWith('bk:sv:')) {
    const serviceId = data.slice(6);
    setDraft(crm, chatId, { ...(getDraft(crm, chatId) || {}), serviceId, ignoreId: undefined });
    const now = new Date();
    const ym = `${mskParts(now).date.slice(0, 7)}`;
    await sendMonthCalendar(token, chatId, ym);
    return;
  }
  if (data.startsWith('bk:mo:')) {
    await sendMonthCalendar(token, chatId, data.slice(6));
    return;
  }
  if (data.startsWith('bk:dy:')) {
    const day = data.slice(6);
    const draft = getDraft(crm, chatId);
    draft.day = day;
    setDraft(crm, chatId, draft);
    const svc = crm.services.find((s) => s.id === draft.serviceId);
    const sid = staffIdOf(crm);
    const slots = computeSlots(crm, sid, day, svc?.durationMin || 45, draft.ignoreId);
    const rows: any[] = [];
    for (let i = 0; i < slots.length; i += 3) {
      rows.push(slots.slice(i, i + 3).map((t) => btn(t, `bk:tm:${t.replace(':', '')}`)));
    }
    if (!rows.length) rows.push([btn('Нет мест', 'bk:go')]);
    rows.push([btn('« Назад', 'bk:go')]);
    await sendMessage(token, chatId, `Время на ${day}:`, kb(rows));
    return;
  }
  if (data.startsWith('bk:tm:')) {
    const hm = data.slice(6);
    const time = hm.slice(0, 2) + ':' + hm.slice(2);
    const draft = getDraft(crm, chatId);
    draft.time = time;
    setDraft(crm, chatId, draft);
    const svc = crm.services.find((s) => s.id === draft.serviceId);

    // Owner reschedule path: apply immediately
    if (draft.ownerMove && draft.ignoreId) {
      await applyReschedule(token, chatId, crm, cq.from);
      return;
    }

    // Client reschedule (has ignoreId): confirm then apply
    if (draft.ignoreId) {
      await sendMessage(
        token,
        chatId,
        `Перенести на ${draft.day} в ${time}?\n${svc?.name || 'услуга'}`,
        kb([[btn('🔁 Да, перенести', 'bk:cf'), btn('❌ Отмена', 'bk:x')]]),
      );
      return;
    }

    await sendMessage(
      token,
      chatId,
      `Подтвердите запись:\n\n${svc?.name || 'услуга'}\n${draft.day} в ${time}\n${svc?.durationMin || 45} мин`,
      kb([[btn('✅ Подтвердить', 'bk:cf'), btn('❌ Отмена', 'bk:x')]]),
    );
    return;
  }
  if (data === 'bk:cf') {
    const draft = getDraft(crm, chatId);
    if (draft.ignoreId) {
      await applyReschedule(token, chatId, crm, cq.from);
      return;
    }
    let client = crm.clients.find((c) => String(c.telegramChatId) === chatId);
    const needName = !client?.name || client.name === 'Клиент' || !String(client.name).trim();
    const needPhone = !client?.phone || !phoneOk(client.phone);
    if (!client || needName || needPhone) {
      if (!client) {
        // placeholder; filled on finalize
      }
      if (needName) {
        setDraft(crm, chatId, { ...draft, await: 'name', firstName: cq.from?.first_name });
        await sendMessage(token, chatId, 'Как вас зовут?');
        return;
      }
      setDraft(crm, chatId, { ...draft, await: 'phone' });
      await sendMessage(token, chatId, 'Укажите телефон (+7…):');
      return;
    }
    await finalizeBooking(token, chatId, crm, cq.from);
    return;
  }
  if (data === 'bk:my') {
    await showMyAppointments(token, chatId, crm);
    return;
  }
  if (data === 'bk:chat') {
    await sendMessage(token, chatId, 'Напишите сообщение — я перешлю мастеру.');
    return;
  }
  if (data === 'bk:x') {
    clearDraftAwait(crm, chatId);
    setDraft(crm, chatId, {});
    await sendMessage(token, chatId, 'Отменено.', kb([[btn('📋 Меню', 'bk:menu')]]));
    return;
  }
  if (data.startsWith('bk:cl:')) {
    const ap = findBySuffix(crm.appointments, data.slice(6));
    if (!ap) return;
    await promptCancelStep1(token, chatId, crm, ap, { forOwner: false });
    return;
  }
  if (data === 'bk:cly') {
    const draft = getDraft(crm, chatId);
    if (!draft.cancelId) {
      await sendMessage(token, chatId, 'Запись не найдена.', kb([[btn('📋 Меню', 'bk:menu')]]));
      return;
    }
    await promptCancelStep2(token, chatId, crm, false);
    return;
  }
  if (data === 'bk:cly2') {
    await performClientCancel(token, chatId, crm);
    return;
  }
  if (data.startsWith('bk:mv:')) {
    const ap = findBySuffix(crm.appointments, data.slice(6));
    if (!ap) return;
    setDraft(crm, chatId, {
      serviceId: ap.serviceIds?.[0],
      ignoreId: ap.id.slice(-10),
    });
    const now = new Date();
    const ym = mskParts(now).date.slice(0, 7);
    await sendMonthCalendar(token, chatId, ym);
    return;
  }
  if (data === 'bk:rm' || data === 'bk:rm:') {
    await startClientRemindFlow(token, chatId, crm);
    return;
  }
  if (data.startsWith('bk:rm:')) {
    const sid = data.slice(6);
    if (!sid) {
      await startClientRemindFlow(token, chatId, crm);
      return;
    }
    const ap = findBySuffix(crm.appointments, sid);
    const has = ap && (ap.reminders || []).length > 0;
    const prompt = has
      ? 'Когда напомнить? Можно добавить ещё к уже установленным.'
      : 'Когда напомнить?';
    await sendReminderPicker(token, chatId, sid, prompt);
    return;
  }
  if (data.startsWith('bk:rt:')) {
    // data = bk:rt:<sid>:<mins> — must skip both "bk" and "rt"
    const parts = data.split(':');
    const sid = parts[2] || '';
    const mins = Number(parts[3]);
    const ap = findBySuffix(crm.appointments, sid);
    if (!ap || !Number.isFinite(mins) || mins <= 0) {
      await sendMessage(token, chatId, 'Не удалось установить напоминание.', kb([[btn('📋 Меню', 'bk:menu')]]));
      return;
    }
    const at = reminderAtBefore(apStart(ap), mins);
    ap.reminders = [
      ...(ap.reminders || []).filter((r: any) => r.kind !== `${mins}m`),
      { at, kind: `${mins}m`, sent: false },
    ];
    const client = crm.clients.find((c) => c.id === ap.clientId);
    if (client) client.reminderPrefs = [...new Set([...(client.reminderPrefs || []), mins])];
    await sendMessage(token, chatId, 'Напоминание установлено.', reminderAfterSetKeyboard(sid));
    return;
  }
  if (data.startsWith('bk:ru:')) {
    const ap = findBySuffix(crm.appointments, data.slice(6));
    if (!ap) {
      await sendMessage(token, chatId, 'Запись не найдена.', kb([[btn('📋 Меню', 'bk:menu')]]));
      return;
    }
    const at = morningReminderAt(apStart(ap));
    ap.reminders = [
      ...(ap.reminders || []).filter((r: any) => r.kind !== 'morning'),
      { at, kind: 'morning', sent: false },
    ];
    const client = crm.clients.find((c) => c.id === ap.clientId);
    if (client) client.reminderMorning = true;
    const sid = ap.id.slice(-10);
    await sendMessage(token, chatId, 'Напомню утром в день визита.', reminderAfterSetKeyboard(sid));
    return;
  }
  if (data.startsWith('bk:rn:')) {
    const ap = findBySuffix(crm.appointments, data.slice(6));
    if (ap) {
      ap.reminders = [];
      const client = crm.clients.find((c) => c.id === ap.clientId);
      if (client) {
        client.reminderPrefs = [];
        client.reminderMorning = false;
      }
    }
    await sendMessage(token, chatId, 'Напоминания отключены.', kb([[btn('📋 Меню', 'bk:menu')]]));
    return;
  }
  if (data.startsWith('bk:rw:')) {
    const sid = data.slice(6);
    setDraft(crm, chatId, { ...getDraft(crm, chatId), await: 'remind_custom', remindSid: sid });
    await sendMessage(
      token,
      chatId,
      'Напишите, когда напомнить.\nПримеры: «за 45 минут», «10:00», «15.09 09:30»',
    );
    return;
  }
  // Owner schedule calendar
  if (data.startsWith('ow:sm:')) {
    await sendOwnerSchedCalendar(token, chatId, data.slice(6));
    return;
  }
  if (data.startsWith('ow:sy:')) {
    const day = data.slice(6);
    setDraft(crm, chatId, { ...getDraft(crm, chatId), schedDay: day, await: undefined, ownerFlow: 'sched' });
    await askSchedKind(token, chatId, day);
    return;
  }
  if (data.startsWith('ow:sk:')) {
    // ow:sk:work|off|custom:YYYY-MM-DD
    const rest = data.slice(6);
    const kind = rest.split(':')[0];
    const day = rest.slice(kind.length + 1);
    const sid = staffIdOf(crm);
    if (!day) {
      await sendMessage(token, chatId, 'День не указан.', ownerReplyKeyboard());
      return;
    }
    if (kind === 'off') {
      upsertException(crm, sid, day, { type: 'off' });
      setDraft(crm, chatId, {});
      await sendMessage(token, chatId, `График на ${day}: выходной. Сохранено.`, ownerReplyKeyboard());
      return;
    }
    if (kind === 'work') {
      clearDayException(crm, sid, day);
      setDraft(crm, chatId, {});
      await sendMessage(
        token,
        chatId,
        `График на ${day}: рабочий по шаблону недели. Исключение снято.`,
        ownerReplyKeyboard(),
      );
      return;
    }
    if (kind === 'custom') {
      setDraft(crm, chatId, { schedDay: day, await: 'ow_sched_hours', ownerFlow: 'sched' });
      await sendMessage(
        token,
        chatId,
        'Укажите часы, например: 10:00-21:00\nОпционально: 10:00-21:00 перерыв 13:00-14:00',
      );
      return;
    }
    return;
  }
  if (data.startsWith('ow:tel:')) {
    const id = data.slice(7);
    const c = crm.clients.find((x) => x.id === id);
    if (c?.phone) {
      await sendMessage(
        token,
        chatId,
        `Позвонить: ${c.phone}\ntel:${digitsOnly(normalizePhone(c.phone) || c.phone)}`,
        ownerReplyKeyboard(),
      );
    } else {
      await sendMessage(token, chatId, 'Телефон не указан.', ownerReplyKeyboard());
    }
    return;
  }

  if (data.startsWith('toclient:')) {
    const id = data.slice(9);
    const c = crm.clients.find((x) => x.id === id);
    if (c?.telegramChatId) {
      (crm.settings as any)._replyTo = c.telegramChatId;
      await sendMessage(token, chatId, `Пишите — уйдёт клиенту ${c.name}. /cancel — сброс.`);
    }
    return;
  }
  if (data.startsWith('tochat:')) {
    (crm.settings as any)._replyTo = data.slice(7);
    await sendMessage(token, chatId, 'Пишите — уйдёт в этот чат. /cancel — сброс.');
    return;
  }
  if (data.startsWith('ow:cl:')) {
    const ap = findBySuffix(crm.appointments, data.slice(6));
    if (!ap) return;
    await promptCancelStep1(token, chatId, crm, ap, { forOwner: true });
    return;
  }
  if (data === 'ow:cly') {
    const draft = getDraft(crm, chatId);
    if (!draft.cancelId) {
      await sendMessage(token, chatId, 'Запись не найдена.', ownerReplyKeyboard());
      return;
    }
    await promptCancelStep2(token, chatId, crm, true);
    return;
  }
  if (data === 'ow:cly2') {
    await performOwnerCancel(token, chatId, crm);
    return;
  }
  if (data.startsWith('ow:mv:')) {
    const ap = findBySuffix(crm.appointments, data.slice(6));
    if (!ap) return;
    setDraft(crm, chatId, {
      serviceId: ap.serviceIds?.[0],
      ignoreId: ap.id.slice(-10),
      ownerMove: true,
      apId: ap.id,
    });
    const now = new Date();
    const ym = mskParts(now).date.slice(0, 7);
    await sendMonthCalendar(token, chatId, ym);
    return;
  }
  if (data.startsWith('ow:msg:')) {
    const ap = findBySuffix(crm.appointments, data.slice(7));
    const client = crm.clients.find((c) => c.id === ap?.clientId);
    if (client?.telegramChatId) {
      (crm.settings as any)._replyTo = client.telegramChatId;
      await sendMessage(token, chatId, `Пишите клиенту ${client.name}.`);
    }
    return;
  }
  if (data.startsWith('ok:v_')) {
    const id = data.slice(5);
    const ap = crm.appointments.find((a) => a.id === id || a.id.endsWith(id));
    if (ap) {
      // Mobile statuses: waiting | cancelled (no "confirmed")
      ap.status = 'waiting';
      await sendMessage(token, chatId, 'Спасибо, ждём вас!');
    }
    return;
  }
  if (data.startsWith('no:v_')) {
    const id = data.slice(5);
    const ap = crm.appointments.find((a) => a.id === id || a.id.endsWith(id));
    if (!ap) return;
    await promptCancelStep1(token, chatId, crm, ap, { forOwner: false });
    return;
  }
}

async function applyReschedule(token: string, chatId: string, crm: Crm, from?: any) {
  const draft = getDraft(crm, chatId);
  const ap = findBySuffix(crm.appointments, draft.ignoreId) || crm.appointments.find((a) => a.id === draft.apId);
  if (!ap || !draft.day || !draft.time) {
    await sendMessage(token, chatId, 'Не удалось перенести.', kb([[btn('📋 Меню', 'bk:menu')]]));
    return;
  }
  const svc = crm.services.find((s) => s.id === draft.serviceId || ap.serviceIds?.includes(s.id));
  ap.start = mskWallISO(draft.day, draft.time);
  ap.status = 'waiting';
  // Never overwrite visit telegramChatId with owner chat
  const client = crm.clients.find((c) => c.id === ap.clientId);
  await notifyOwner(token, crm, ap, client || { name: 'Клиент', phone: '' }, svc, 'Перенос записи');
  if (draft.ownerMove && client?.telegramChatId) {
    await sendMessage(
      token,
      client.telegramChatId,
      `Мастер перенёс вашу запись на ${draft.day} в ${draft.time}`,
      kb([[btn('📋 Меню', 'bk:menu')]]),
    );
  }
  const doneKb = isOwnerChat(crm, chatId)
    ? ownerReplyKeyboard()
    : clientReplyKeyboard(crm, chatId, client?.id);
  await sendMessage(token, chatId, `Перенесено на ${draft.day} ${draft.time}`, doneKb);
  setDraft(crm, chatId, {});
  void from;
}

async function finalizeBooking(token: string, chatId: string, crm: Crm, from?: any) {
  const draft = getDraft(crm, chatId);
  if (!draft.day || !draft.time || !draft.serviceId) {
    await sendMessage(token, chatId, 'Черновик записи устарел. Начните снова.', kb([[btn('📅 Записаться', 'bk:go')]]));
    return;
  }
  const svc = crm.services.find((s) => s.id === draft.serviceId);
  const sid = staffIdOf(crm);
  let client = crm.clients.find((c) => String(c.telegramChatId) === chatId);
  if (!client) {
    const id = 'cli_' + Math.random().toString(36).slice(2, 10);
    client = {
      id,
      name: draft.name || from?.first_name || 'Клиент',
      phone: draft.phone || '',
      telegramChatId: chatId,
      telegramUsername: from?.username,
      createdAt: new Date().toISOString(),
    };
    crm.clients.push(client);
  } else {
    if (draft.name) client.name = draft.name;
    if (draft.phone) client.phone = draft.phone;
    client.telegramChatId = chatId;
    if (from?.username) client.telegramUsername = from.username;
  }
  linkChat(crm, chatId, from?.username, client.id);

  // Apply default reminder prefs from client
  const prefs: number[] = client.reminderPrefs || [];
  const startIso = mskWallISO(draft.day, draft.time);
  const reminders: any[] = prefs.map((mins) => ({
    at: reminderAtBefore(startIso, mins),
    kind: `${mins}m`,
    sent: false,
  }));
  if (client.reminderMorning) {
    reminders.push({ at: morningReminderAt(startIso), kind: 'morning', sent: false });
  }

  const ap: any = {
    id: 'apt_' + Math.random().toString(36).slice(2, 10),
    clientId: client.id,
    staffId: sid,
    serviceIds: [svc?.id].filter(Boolean),
    start: startIso,
    durationMin: svc?.durationMin || 45,
    status: 'waiting',
    note: 'Telegram',
    source: 'telegram',
    telegramChatId: chatId,
    color: crm.settings?.onlineColor || crm.settings?.visitColor,
    reminders,
    createdAt: new Date().toISOString(),
  };
  crm.appointments.push(ap);
  setDraft(crm, chatId, {});
  await notifyOwner(token, crm, ap, client, svc, 'Новая запись');
  const tpl =
    crm.settings?.messageTemplates?.booked ||
    '{studio}\n\nВы записаны.\n\n{service}\n{weekday}, {date} в {time}\n{duration}\n\nЕсли планы изменятся — перенесите или отмените кнопками ниже.';
  const text = fillTemplate(tpl, {
    studio: crm.settings.studioName || 'Барбершоп',
    service: svc?.name || 'услуга',
    date: draft.day,
    time: draft.time,
    duration: `${svc?.durationMin || 45} мин`,
    weekday: weekdayRu(startIso),
    name: client.name || '',
    phone: client.phone || '',
    address: crm.settings?.address || '',
  });
  // One reply: ReplyKeyboard already has Перенести/Отменить/Напоминание when upcoming exists
  await sendMessage(token, chatId, text, clientReplyKeyboard(crm, chatId, client.id));
  // Always offer reminder picker (first-time and returning)
  let prompt = 'Запись подтверждена. Поставить напоминание?';
  if (prefs.length || client.reminderMorning) {
    prompt += '\n(Уже применены ваши сохранённые настройки — можно изменить.)';
  }
  await sendReminderPicker(token, chatId, ap.id.slice(-10), prompt);
}

async function sendMonthCalendar(token: string, chatId: string, ym: string) {
  const [y, m] = ym.split('-').map(Number);
  const first = new Date(Date.UTC(y, m - 1, 1));
  // Mon-first pad using MSK noon of the 1st
  const dow = new Date(`${ym}-01T12:00:00+03:00`).getDay();
  const startPad = (dow + 6) % 7;
  const daysInMonth = new Date(y, m, 0).getDate();
  const rows: any[] = [
    [btn('←', `bk:mo:${prevMonth(ym)}`), btn(ym, `bk:mo:${ym}`), btn('→', `bk:mo:${nextMonth(ym)}`)],
  ];
  rows.push(['пн', 'вт', 'ср', 'чт', 'пт', 'сб', 'вс'].map((t) => btn(t, 'bk:noop')));
  let row: any[] = [];
  for (let i = 0; i < startPad; i++) row.push(btn('·', 'bk:noop'));
  for (let d = 1; d <= daysInMonth; d++) {
    const ds = `${ym}-${String(d).padStart(2, '0')}`;
    row.push(btn(String(d), `bk:dy:${ds}`));
    if (row.length === 7) {
      rows.push(row);
      row = [];
    }
  }
  while (row.length && row.length < 7) row.push(btn('·', 'bk:noop'));
  if (row.length) rows.push(row);
  rows.push([btn('« 📋 Меню', 'bk:menu')]);
  void first;
  await sendMessage(token, chatId, 'Выберите день:', kb(rows));
}

function prevMonth(ym: string) {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(y, m - 2, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}
function nextMonth(ym: string) {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(y, m, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function hmToMin(hm: string): number {
  const [h, m] = hm.split(':').map(Number);
  return h * 60 + m;
}

function computeSlots(crm: Crm, staffId: string, day: string, durationMin: number, ignoreSuffix?: string) {
  const date = new Date(day + 'T12:00:00+03:00');
  const dow = date.getDay();
  const ex = crm.exceptions?.find((e) => e.staffId === staffId && e.date === day);
  if (ex && (ex.type === 'off' || ex.type === 'vacation' || ex.type === 'sick')) return [];
  const week = crm.schedules?.find((s) => s.staffId === staffId)?.week?.find((w: any) => w.day === dow);
  let start = ex?.type === 'custom' && ex.start ? ex.start : week?.start || '10:00';
  let end = ex?.type === 'custom' && ex.end ? ex.end : week?.end || '21:00';
  if (week && !week.working && ex?.type !== 'custom') return [];
  const breakStart =
    ex?.type === 'custom' && ex.breakStart ? ex.breakStart : week?.breakStart;
  const breakEnd = ex?.type === 'custom' && ex.breakEnd ? ex.breakEnd : week?.breakEnd;
  const step = crm.settings?.slotMinutes || 15;
  const lead = crm.settings?.leadMinutes || 30;
  const horizon = Number(crm.settings?.horizonDays ?? 14);
  const slots: string[] = [];
  let cur = hmToMin(start);
  const endM = hmToMin(end);
  const now = new Date();
  const today = mskParts(now).date;
  if (Number.isFinite(horizon) && horizon >= 0) {
    const maxDate = new Date(now.getTime() + horizon * 24 * 3600 * 1000);
    const maxDay = mskParts(maxDate).date;
    if (day > maxDay) return [];
  }
  const brS = breakStart ? hmToMin(breakStart) : null;
  const brE = breakEnd ? hmToMin(breakEnd) : null;

  while (cur + durationMin <= endM) {
    const hh = String(Math.floor(cur / 60)).padStart(2, '0');
    const mm = String(cur % 60).padStart(2, '0');
    const iso = mskWallISO(day, `${hh}:${mm}`);
    if (day === today) {
      const leadLimit = now.getTime() + lead * 60000;
      if (parseApStart(iso).getTime() < leadLimit) {
        cur += step;
        continue;
      }
    }
    // break overlap
    if (brS != null && brE != null) {
      const be = cur + durationMin;
      if (cur < brE && brS < be) {
        cur += step;
        continue;
      }
    }
    const conflict = crm.appointments.some((a) => {
      if (!isBookedStatus(a.status)) return false;
      if (ignoreSuffix && String(a.id).endsWith(ignoreSuffix)) return false;
      if (a.staffId !== staffId) return false;
      if (mskParts(parseApStart(apStart(a))).date !== day) return false;
      const as = parseApStart(apStart(a)).getTime();
      const ae = as + (a.durationMin || 45) * 60000;
      const bs = parseApStart(iso).getTime();
      const be = bs + durationMin * 60000;
      return bs < ae && as < be;
    });
    const winBusy = (crm.windows || []).some((w) => {
      if (w.staffId !== staffId) return false;
      if (mskParts(parseApStart(w.start)).date !== day) return false;
      const as = parseApStart(w.start).getTime();
      const ae = as + (w.durationMin || 0) * 60000;
      const bs = parseApStart(iso).getTime();
      const be = bs + durationMin * 60000;
      return bs < ae && as < be;
    });
    if (!conflict && !winBusy) slots.push(`${hh}:${mm}`);
    cur += step;
  }
  return slots;
}

async function notifyOwner(token: string, crm: Crm, ap: any, client: any, svc: any, title: string) {
  const owner = crm.settings.telegramOwnerChatId;
  if (!owner) return;
  const sid = ap.id.slice(-10);
  const when = mskParts(parseApStart(apStart(ap)));
  const text = `${title}\n\n${client?.name || 'Клиент'}\n${client?.phone || '—'}\n${svc?.name || 'услуга'}\n${when.date} ${when.time}\n${ap.durationMin} мин`;
  await sendMessage(
    token,
    owner,
    text,
    kb([
      [btn('❌ Отменить', `ow:cl:${sid}`), btn('🔁 Перенести', `ow:mv:${sid}`)],
      [btn('✉️ Написать клиенту', `ow:msg:${sid}`)],
    ]),
  );
}

/** Parse free-text reminder: "за 45 минут", "10:00", "15.09 09:30" → minutes before visit */
function parseCustomReminder(text: string, start: string): number | null {
  const t = text.trim().toLowerCase().replace(',', '.');
  const before = t.match(/за\s+(\d+)\s*(мин|минут|м|час|часа|часов|ч)/);
  if (before) {
    const n = Number(before[1]);
    const unit = before[2];
    if (unit.startsWith('ч')) return n * 60;
    return n;
  }
  const visit = parseApStart(start);
  if (!Number.isFinite(+visit)) return null;
  // HH:mm today relative to visit day
  const hm = t.match(/^(\d{1,2}):(\d{2})$/);
  if (hm) {
    const { date } = mskParts(visit);
    const at = new Date(`${date}T${hm[1].padStart(2, '0')}:${hm[2]}:00+03:00`);
    const mins = Math.round((visit.getTime() - at.getTime()) / 60000);
    return mins > 0 ? mins : null;
  }
  const dmy = t.match(/^(\d{1,2})[./](\d{1,2})(?:[./](\d{2,4}))?\s+(\d{1,2}):(\d{2})$/);
  if (dmy) {
    const dd = dmy[1].padStart(2, '0');
    const mm = dmy[2].padStart(2, '0');
    let yy = dmy[3] || String(mskParts(visit).date.slice(0, 4));
    if (yy.length === 2) yy = '20' + yy;
    const at = new Date(`${yy}-${mm}-${dd}T${dmy[4].padStart(2, '0')}:${dmy[5]}:00+03:00`);
    const mins = Math.round((visit.getTime() - at.getTime()) / 60000);
    return mins > 0 ? mins : null;
  }
  return null;
}

/** Server-side due-reminder delivery (production webhook has no browser TelegramBridge). */
export async function processDueReminders(crm: Crm, send = sendMessage): Promise<{ sent: number; crm: Crm }> {
  const token = crm.settings?.telegramToken;
  if (!token) return { sent: 0, crm };
  const now = Date.now();
  let sent = 0;
  const tpl =
    crm.settings?.messageTemplates?.reminder ||
    '{name}, напоминание.\n\n{when} запись в {studio}:\n{service}\n{weekday}, {date} в {time}\n\nПодтвердите визит, пожалуйста.';

  for (const a of crm.appointments || []) {
    if (a.status === 'cancelled') continue;
    const client = (crm.clients || []).find((c) => c.id === a.clientId);
    const chat = a.telegramChatId || client?.telegramChatId;
    const startMs = parseApStart(apStart(a)).getTime();
    if (Number.isFinite(startMs) && startMs <= now) {
      for (const r of a.reminders || []) {
        if (!r.sent) r.sent = true;
      }
      continue;
    }
    for (const r of a.reminders || []) {
      if (r.sent) continue;
      const when = new Date(r.at).getTime();
      if (!Number.isFinite(when) || when > now) continue;
      if (!chat) {
        r.sent = true;
        continue;
      }
      const svc = (crm.services || []).find((x) => a.serviceIds?.includes(x.id));
      const parts = mskParts(parseApStart(apStart(a)));
      const text = fillTemplate(tpl, {
        name: client?.name || '',
        studio: crm.settings?.studioName || '',
        service: svc?.name || '',
        weekday: weekdayRu(apStart(a)),
        date: parts.date,
        time: parts.time,
        when: 'Скоро',
        address: crm.settings?.address || '',
        phone: client?.phone || '',
        duration: `${a.durationMin || 45} мин`,
      });
      const sid = String(a.id).slice(-10);
      // ok:v_ / no:v_ — keep callback_data short (≤64 bytes)
      const vid = String(a.id).slice(0, 24);
      try {
        const res = await send(
          token,
          chat,
          text,
          kb([
            [btn('✅ Подтверждаю', `ok:v_${vid}`), btn('❌ Не смогу', `no:v_${vid}`)],
            [btn('🔔 Напоминание', `bk:rm:${sid}`), btn('📋 Меню', 'bk:menu')],
          ]),
        );
        if (res && res.ok === false) {
          console.error('reminder send fail', res.description || res);
        } else {
          r.sent = true;
          sent++;
        }
      } catch (e) {
        console.error('reminder send', e);
      }
    }
  }
  return { sent, crm };
}
