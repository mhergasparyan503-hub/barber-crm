import { sendMessage, answerCallback, getUpdates } from './telegram-api';
import { upsertTelegramLink } from './db';

type Crm = {
  clients: any[];
  services: any[];
  staff: any[];
  appointments: any[];
  windows: any[];
  schedules: any[];
  exceptions: any[];
  telegramChats: any[];
  settings: any;
};

const seen = new Set<number>();

function btn(text: string, data: string) {
  return { text: text || '·', callback_data: data };
}
function kb(rows: { text: string; callback_data: string }[][]) {
  return { inline_keyboard: rows };
}

export type InboxResult = {
  offset: number;
  patch: Partial<Crm>;
  replies: number;
};

export async function pollAndHandle(crm: Crm): Promise<InboxResult> {
  const token = crm.settings?.telegramToken;
  if (!token) return { offset: crm.settings?.telegramOffset || 0, patch: {}, replies: 0 };

  let offset = crm.settings?.telegramOffset || 0;
  const res = await getUpdates(token, offset > 0 ? offset : 0, 2);
  if (!res.ok) {
    if (String(res.description || '').includes('409') || res.error_code === 409) {
      const { deleteWebhook } = await import('./telegram-api');
      await deleteWebhook(token);
    }
    return { offset, patch: {}, replies: 0 };
  }

  const patch: Partial<Crm> = {
    clients: [...(crm.clients || [])],
    appointments: [...(crm.appointments || [])],
    telegramChats: [...(crm.telegramChats || [])],
    settings: { ...crm.settings },
  };
  let replies = 0;

  for (const u of res.result || []) {
    if (seen.has(u.update_id)) {
      offset = Math.max(offset, u.update_id + 1);
      continue;
    }
    seen.add(u.update_id);
    offset = Math.max(offset, u.update_id + 1);

    try {
      if (u.message) {
        await handleMessage(token, u.message, patch as Crm);
        replies++;
      } else if (u.callback_query) {
        await handleCallback(token, u.callback_query, patch as Crm);
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
    const payload = text.split(/\s+/)[1] || '';
    if (payload === 'owner') {
      crm.settings.telegramOwnerChatId = chatId;
      await sendMessage(token, chatId, 'Рабочий чат мастера подключён.\n/clients — написать клиенту\n/cancel — сбросить адресата');
      return;
    }
    if (payload.startsWith('c_')) {
      const clientId = payload.slice(2);
      const client = crm.clients.find((c) => c.id === clientId);
      if (client) {
        client.telegramChatId = chatId;
        client.telegramUsername = username;
      }
      linkChat(crm, chatId, username, clientId);
      await upsertTelegramLink(payload, chatId, username);
      await sendClientMenu(token, chatId, crm, clientId);
      return;
    }
    if (payload.startsWith('v_')) {
      linkChat(crm, chatId, username);
      await upsertTelegramLink(payload, chatId, username);
      await sendClientMenu(token, chatId, crm);
      return;
    }
    // plain /start — client, never steal owner
    linkChat(crm, chatId, username);
    await sendClientMenu(token, chatId, crm);
    return;
  }

  if (chatId === String(crm.settings.telegramOwnerChatId)) {
    if (text === '/clients') {
      const rows = crm.clients.filter((c) => c.telegramChatId).slice(0, 20).map((c) => [
        btn(c.name || c.phone || c.id, `toclient:${c.id}`),
      ]);
      if (!rows.length) {
        await sendMessage(token, chatId, 'Нет клиентов с Telegram.');
        return;
      }
      await sendMessage(token, chatId, 'Кому написать?', kb(rows));
      return;
    }
    if (text === '/cancel') {
      (crm.settings as any)._replyTo = null;
      await sendMessage(token, chatId, 'Адресат сброшен.');
      return;
    }
    const replyTo = (crm.settings as any)._replyTo;
    if (replyTo) {
      await sendMessage(token, replyTo, `Мастер:\n${text}`);
      await sendMessage(token, chatId, 'Отправлено.');
      return;
    }
    await sendMessage(token, chatId, 'Выберите клиента: /clients или кнопки в уведомлении.');
    return;
  }

  // client free text → owner
  const client = crm.clients.find((c) => String(c.telegramChatId) === chatId);
  const name = client?.name || username || 'Клиент';
  const owner = crm.settings.telegramOwnerChatId;
  if (owner) {
    const nearest = crm.appointments
      .filter((a) => a.clientId === client?.id && a.status !== 'cancelled' && new Date(a.start) > new Date())
      .sort((a, b) => +new Date(a.start) - +new Date(b.start))[0];
    const rows = [
      [btn('Ответить', `tochat:${chatId}`)],
    ];
    if (nearest) {
      rows.push([
        btn('Отменить', `ow:cl:${nearest.id.slice(-10)}`),
        btn('Перенести', `ow:mv:${nearest.id.slice(-10)}`),
      ]);
      rows.push([btn('Написать', `ow:msg:${nearest.id.slice(-10)}`)]);
    }
    await sendMessage(token, owner, `✉ ${name}\n${text}`, kb(rows));
  }
  await sendMessage(token, chatId, 'Сообщение отправлено мастеру.');
}

async function sendClientMenu(token: string, chatId: string, crm: Crm, clientId?: string) {
  const client =
    crm.clients.find((c) => c.id === clientId) ||
    crm.clients.find((c) => String(c.telegramChatId) === chatId);
  const nearest = client
    ? crm.appointments
        .filter((a) => a.clientId === client.id && a.status !== 'cancelled' && new Date(a.start) > new Date())
        .sort((a, b) => +new Date(a.start) - +new Date(b.start))[0]
    : null;

  if (nearest) {
    const sid = nearest.id.slice(-10);
    await sendMessage(
      token,
      chatId,
      'Ваша ближайшая запись. Выберите действие:',
      kb([
        [btn('Перенести', `bk:mv:${sid}`), btn('Отменить', `bk:cl:${sid}`)],
        [btn('Напоминание', `bk:rm:${sid}`), btn('Записаться ещё', 'bk:go')],
        [btn('Мои записи', 'bk:my'), btn('Написать мастеру', 'bk:chat')],
      ]),
    );
    return;
  }

  await sendMessage(
    token,
    chatId,
    `Добро пожаловать в ${crm.settings.studioName || 'Барбершоп'}!`,
    kb([
      [btn('Записаться', 'bk:go')],
      [btn('Мои записи', 'bk:my')],
      [btn('Написать мастеру', 'bk:chat')],
    ]),
  );
}

function linkChat(crm: Crm, chatId: string, username?: string, clientId?: string) {
  const idx = crm.telegramChats.findIndex((t) => String(t.chatId) === chatId);
  const row = { chatId, username, clientId, linkedAt: new Date().toISOString() };
  if (idx >= 0) crm.telegramChats[idx] = { ...crm.telegramChats[idx], ...row };
  else crm.telegramChats.push(row);
}

function findBySuffix(list: any[], suffix: string) {
  return list.find((x) => String(x.id).endsWith(suffix));
}

async function handleCallback(token: string, cq: any, crm: Crm) {
  const chatId = String(cq.message?.chat?.id);
  const data = cq.data || '';
  await answerCallback(token, cq.id);

  if (data === 'bk:menu' || data === 'bk:ok') {
    await sendClientMenu(token, chatId, crm);
    return;
  }
  if (data === 'bk:go') {
    const services = crm.services.filter((s) => s.active);
    const rows = services.map((s) => [btn(`${s.name} · ${s.price}₽`, `bk:sv:${s.id}`)]);
    rows.push([btn('« Меню', 'bk:menu')]);
    await sendMessage(token, chatId, 'Выберите услугу:', kb(rows));
    return;
  }
  if (data.startsWith('bk:sv:')) {
    const serviceId = data.slice(6);
    (crm.settings as any)._draft = { ...(crm.settings as any)._draft, [chatId]: { serviceId } };
    const now = new Date();
    const ym = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    await sendMonthCalendar(token, chatId, ym);
    return;
  }
  if (data.startsWith('bk:mo:')) {
    await sendMonthCalendar(token, chatId, data.slice(6));
    return;
  }
  if (data.startsWith('bk:dy:')) {
    const day = data.slice(6);
    const draft = ((crm.settings as any)._draft || {})[chatId] || {};
    draft.day = day;
    (crm.settings as any)._draft = { ...(crm.settings as any)._draft, [chatId]: draft };
    const svc = crm.services.find((s) => s.id === draft.serviceId);
    const staffId = crm.staff[0]?.id;
    const slots = computeSlots(crm, staffId, day, svc?.durationMin || 45, draft.ignoreId);
    const rows: any[] = [];
    for (let i = 0; i < slots.length; i += 3) {
      rows.push(
        slots.slice(i, i + 3).map((t) => btn(t, `bk:tm:${t.replace(':', '')}`)),
      );
    }
    if (!rows.length) rows.push([btn('Нет мест', 'bk:go')]);
    rows.push([btn('« Назад', 'bk:go')]);
    await sendMessage(token, chatId, `Время на ${day}:`, kb(rows));
    return;
  }
  if (data.startsWith('bk:tm:')) {
    const hm = data.slice(6);
    const time = hm.slice(0, 2) + ':' + hm.slice(2);
    const draft = ((crm.settings as any)._draft || {})[chatId] || {};
    const svc = crm.services.find((s) => s.id === draft.serviceId);
    const staffId = crm.staff[0]?.id;
    let client = crm.clients.find((c) => String(c.telegramChatId) === chatId);
    if (!client) {
      const id = 'cli_' + Math.random().toString(36).slice(2, 10);
      client = {
        id,
        name: cq.from?.first_name || 'Клиент',
        phone: '',
        telegramChatId: chatId,
        telegramUsername: cq.from?.username,
        createdAt: new Date().toISOString(),
      };
      crm.clients.push(client);
    }
    if (draft.ignoreId) {
      const ap = findBySuffix(crm.appointments, draft.ignoreId);
      if (ap) {
        ap.start = `${draft.day}T${time}:00`;
        ap.status = 'waiting';
        await notifyOwner(token, crm, ap, client, svc, 'Перенос записи');
        await sendMessage(token, chatId, `Перенесено на ${draft.day} ${time}`, kb([[btn('Меню', 'bk:menu')]]));
        return;
      }
    }
    const ap = {
      id: 'apt_' + Math.random().toString(36).slice(2, 10),
      clientId: client.id,
      staffId,
      serviceIds: [svc?.id].filter(Boolean),
      start: `${draft.day}T${time}:00`,
      durationMin: svc?.durationMin || 45,
      status: 'waiting',
      note: 'Telegram',
      source: 'telegram',
      telegramChatId: chatId,
      createdAt: new Date().toISOString(),
    };
    crm.appointments.push(ap);
    await notifyOwner(token, crm, ap, client, svc, 'Новая запись');
    await sendMessage(
      token,
      chatId,
      `${crm.settings.studioName}\n\nВы записаны.\n\n${svc?.name}\n${draft.day} в ${time}\n${svc?.durationMin || 45} мин`,
      kb([
        [btn('Перенести', `bk:mv:${ap.id.slice(-10)}`), btn('Отменить', `bk:cl:${ap.id.slice(-10)}`)],
        [btn('Напоминание', `bk:rm:${ap.id.slice(-10)}`), btn('Меню', 'bk:menu')],
      ]),
    );
    return;
  }
  if (data === 'bk:my') {
    const client = crm.clients.find((c) => String(c.telegramChatId) === chatId);
    const list = crm.appointments
      .filter((a) => a.clientId === client?.id && a.status !== 'cancelled' && new Date(a.start) > new Date())
      .sort((a, b) => +new Date(a.start) - +new Date(b.start));
    if (!list.length) {
      await sendMessage(token, chatId, 'Нет ближайших записей.', kb([[btn('Записаться', 'bk:go')]]));
      return;
    }
    const lines = list
      .map((a) => {
        const svc = crm.services.find((s) => a.serviceIds?.includes(s.id));
        return `• ${a.start.slice(0, 16).replace('T', ' ')} — ${svc?.name || 'услуга'}`;
      })
      .join('\n');
    await sendMessage(token, chatId, lines, kb([[btn('Меню', 'bk:menu')]]));
    return;
  }
  if (data === 'bk:chat') {
    await sendMessage(token, chatId, 'Напишите сообщение — я перешлю мастеру.');
    return;
  }
  if (data === 'bk:x') {
    await sendMessage(token, chatId, 'Отменено.', kb([[btn('Меню', 'bk:menu')]]));
    return;
  }
  if (data.startsWith('bk:cl:')) {
    const ap = findBySuffix(crm.appointments, data.slice(6));
    if (!ap) return;
    await sendMessage(token, chatId, 'Отменить запись?', kb([[btn('Да, отменить', 'bk:cly'), btn('Нет', 'bk:menu')]]));
    (crm.settings as any)._draft = { ...(crm.settings as any)._draft, [chatId]: { cancelId: ap.id } };
    return;
  }
  if (data === 'bk:cly') {
    const draft = ((crm.settings as any)._draft || {})[chatId] || {};
    const ap = crm.appointments.find((a) => a.id === draft.cancelId);
    if (ap) {
      ap.status = 'cancelled';
      await sendMessage(token, chatId, 'Запись отменена.', kb([[btn('Меню', 'bk:menu')]]));
      if (crm.settings.telegramOwnerChatId) {
        await sendMessage(token, crm.settings.telegramOwnerChatId, `Клиент отменил запись ${ap.start}`);
      }
    }
    return;
  }
  if (data.startsWith('bk:mv:')) {
    const ap = findBySuffix(crm.appointments, data.slice(6));
    if (!ap) return;
    (crm.settings as any)._draft = {
      ...(crm.settings as any)._draft,
      [chatId]: { serviceId: ap.serviceIds?.[0], ignoreId: ap.id.slice(-10) },
    };
    const now = new Date();
    const ym = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    await sendMonthCalendar(token, chatId, ym);
    return;
  }
  if (data.startsWith('bk:rm:')) {
    const sid = data.slice(6);
    await sendMessage(
      token,
      chatId,
      'Когда напомнить?',
      kb([
        [btn('15 мин', `bk:rt:${sid}:15`), btn('30 мин', `bk:rt:${sid}:30`)],
        [btn('1 ч', `bk:rt:${sid}:60`), btn('2 ч', `bk:rt:${sid}:120`), btn('3 ч', `bk:rt:${sid}:180`)],
        [btn('Утро 09:00', `bk:ru:${sid}`), btn('Сутки', `bk:rt:${sid}:1440`)],
        [btn('2 дня', `bk:rt:${sid}:2880`), btn('Не напоминать', `bk:rn:${sid}`)],
        [btn('Меню', 'bk:menu')],
      ]),
    );
    return;
  }
  if (data.startsWith('bk:rt:')) {
    const [, sid, min] = data.split(':');
    const ap = findBySuffix(crm.appointments, sid);
    if (!ap) return;
    const mins = Number(min);
    const at = new Date(new Date(ap.start).getTime() - mins * 60000).toISOString();
    ap.reminders = [...(ap.reminders || []), { at, kind: `${mins}m` }];
    const client = crm.clients.find((c) => c.id === ap.clientId);
    if (client) client.reminderPrefs = [...new Set([...(client.reminderPrefs || []), mins])];
    await sendMessage(token, chatId, 'Напоминание установлено.', kb([[btn('Меню', 'bk:menu')]]));
    return;
  }
  if (data.startsWith('bk:ru:')) {
    const ap = findBySuffix(crm.appointments, data.slice(6));
    if (!ap) return;
    const d = new Date(ap.start);
    d.setHours(9, 0, 0, 0);
    ap.reminders = [...(ap.reminders || []), { at: d.toISOString(), kind: 'morning' }];
    await sendMessage(token, chatId, 'Напомню утром в день визита.', kb([[btn('Меню', 'bk:menu')]]));
    return;
  }
  if (data.startsWith('bk:rn:')) {
    const ap = findBySuffix(crm.appointments, data.slice(6));
    if (ap) ap.reminders = [];
    await sendMessage(token, chatId, 'Напоминания отключены.', kb([[btn('Меню', 'bk:menu')]]));
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
    ap.status = 'cancelled';
    const client = crm.clients.find((c) => c.id === ap.clientId);
    if (client?.telegramChatId) {
      await sendMessage(token, client.telegramChatId, 'Мастер отменил вашу запись.');
    }
    // do NOT overwrite appointment telegramChatId with owner chat
    await sendMessage(token, chatId, 'Запись отменена, клиенту отправлено уведомление.');
    return;
  }
  if (data.startsWith('ow:mv:')) {
    const ap = findBySuffix(crm.appointments, data.slice(6));
    if (!ap) return;
    (crm.settings as any)._draft = {
      ...(crm.settings as any)._draft,
      [chatId]: { serviceId: ap.serviceIds?.[0], ignoreId: ap.id.slice(-10), ownerMove: true, apId: ap.id },
    };
    const now = new Date();
    const ym = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
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
  if (data.startsWith('ok:v_') || data.startsWith('no:v_')) {
    const id = data.slice(5);
    const ap = crm.appointments.find((a) => a.id === id || a.id.endsWith(id));
    if (ap) {
      ap.status = data.startsWith('ok:') ? 'confirmed' : 'cancelled';
      await sendMessage(token, chatId, data.startsWith('ok:') ? 'Спасибо, ждём вас!' : 'Запись отменена.');
    }
    return;
  }
}

async function sendMonthCalendar(token: string, chatId: string, ym: string) {
  const [y, m] = ym.split('-').map(Number);
  const first = new Date(y, m - 1, 1);
  const startPad = (first.getDay() + 6) % 7; // Mon-first
  const daysInMonth = new Date(y, m, 0).getDate();
  const rows: any[] = [[btn('←', `bk:mo:${prevMonth(ym)}`), btn(ym, `bk:mo:${ym}`), btn('→', `bk:mo:${nextMonth(ym)}`)]];
  rows.push(['пн', 'вт', 'ср', 'чт', 'пт', 'сб', 'вс'].map((t) => btn(t, 'bk:menu')));
  let row: any[] = [];
  for (let i = 0; i < startPad; i++) row.push(btn('·', 'bk:menu'));
  for (let d = 1; d <= daysInMonth; d++) {
    const ds = `${ym}-${String(d).padStart(2, '0')}`;
    row.push(btn(String(d), `bk:dy:${ds}`));
    if (row.length === 7) {
      rows.push(row);
      row = [];
    }
  }
  while (row.length && row.length < 7) row.push(btn('·', 'bk:menu'));
  if (row.length) rows.push(row);
  rows.push([btn('« Меню', 'bk:menu')]);
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

function computeSlots(crm: Crm, staffId: string, day: string, durationMin: number, ignoreSuffix?: string) {
  // simplified server-side slot calc respecting schedule exceptions roughly
  const date = new Date(day + 'T12:00:00');
  const dow = date.getDay();
  const ex = crm.exceptions?.find((e) => e.staffId === staffId && e.date === day);
  if (ex && (ex.type === 'off' || ex.type === 'vacation' || ex.type === 'sick')) return [];
  const week = crm.schedules?.find((s) => s.staffId === staffId)?.week?.find((w: any) => w.day === dow);
  let start = ex?.type === 'custom' && ex.start ? ex.start : week?.start || '10:00';
  let end = ex?.type === 'custom' && ex.end ? ex.end : week?.end || '21:00';
  if (week && !week.working && ex?.type !== 'custom') return [];
  const step = crm.settings?.slotMinutes || 15;
  const lead = crm.settings?.leadMinutes || 30;
  const slots: string[] = [];
  const [sh, sm] = start.split(':').map(Number);
  const [eh, em] = end.split(':').map(Number);
  let cur = sh * 60 + sm;
  const endM = eh * 60 + em;
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  while (cur + durationMin <= endM) {
    const hh = String(Math.floor(cur / 60)).padStart(2, '0');
    const mm = String(cur % 60).padStart(2, '0');
    const iso = `${day}T${hh}:${mm}:00`;
    if (day === today) {
      const leadLimit = now.getTime() + lead * 60000;
      if (new Date(iso).getTime() < leadLimit) {
        cur += step;
        continue;
      }
    }
    const conflict = crm.appointments.some((a) => {
      if (a.status === 'cancelled') return false;
      if (ignoreSuffix && String(a.id).endsWith(ignoreSuffix)) return false;
      if (a.staffId !== staffId) return false;
      if (!String(a.start).startsWith(day)) return false;
      const as = new Date(a.start).getTime();
      const ae = as + a.durationMin * 60000;
      const bs = new Date(iso).getTime();
      const be = bs + durationMin * 60000;
      return bs < ae && as < be;
    });
    if (!conflict) slots.push(`${hh}:${mm}`);
    cur += step;
  }
  return slots;
}

async function notifyOwner(token: string, crm: Crm, ap: any, client: any, svc: any, title: string) {
  const owner = crm.settings.telegramOwnerChatId;
  if (!owner) return;
  const sid = ap.id.slice(-10);
  const text = `${title}\n\n${client.name}\n${client.phone || '—'}\n${svc?.name || 'услуга'}\n${ap.start.replace('T', ' ').slice(0, 16)}\n${ap.durationMin} мин`;
  await sendMessage(
    token,
    owner,
    text,
    kb([
      [btn('Отменить', `ow:cl:${sid}`), btn('Перенести', `ow:mv:${sid}`)],
      [btn('Написать клиенту', `ow:msg:${sid}`)],
    ]),
  );
}
