process.env.TG_SMOKE_CAPTURE = '1';
const { handleUpdate, processDueReminders } = await import('./telegram-inbox.ts');
const { mskWallISO, morningReminderAt, reminderAtBefore, mskParts, parseApStart } = await import('./msk.ts');

// Dynamic test days: next Monday (≥2 days ahead) … Thursday, Moscow calendar.
const __base = (() => {
  const now = new Date(Date.now() + 3 * 3600e3);
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 2));
  while (d.getUTCDay() !== 1) d.setUTCDate(d.getUTCDate() + 1);
  return d;
})();
const __day = (n) => new Date(__base.getTime() + n * 864e5).toISOString().slice(0, 10);
const D0 = __day(0), D1 = __day(1), D2 = __day(2), D3 = __day(3);
const g = globalThis;
g.__tgSent = [];

const crm = {
  clients: [],
  services: [
    { id: 'svc_cut', name: 'Мужская стрижка', price: 1800, durationMin: 45, active: true, online: true },
  ],
  staff: [{ id: 'staff_barber', name: 'Барбер', active: true }],
  appointments: [],
  windows: [],
  schedules: [{
    staffId: 'staff_barber',
    week: [0,1,2,3,4,5,6].map((day) => ({
      day, start: '10:00', end: '21:00', working: day >= 1, breakStart: '13:00', breakEnd: '14:00',
    })),
  }],
  exceptions: [],
  telegramChats: [],
  settings: {
    studioName: 'ТестШоп',
    telegramToken: '000:SMOKE',
    telegramOwnerChatId: '',
    telegramOffset: 0,
    leadMinutes: 0,
    slotMinutes: 30,
    onlineServiceIds: ['svc_cut'],
  },
};

function last() { return g.__tgSent[g.__tgSent.length - 1]; }
function assert(cond, msg) { if (!cond) throw new Error(msg); }
function hasLabel(arr, s) { return (arr || []).some((x) => String(x || '').includes(s)); }

// 1) plain /start → ReplyKeyboard
let r = await handleUpdate(crm, {
  update_id: 1,
  message: { chat: { id: 111 }, text: '/start', from: { first_name: 'Иван', username: 'ivan' } },
});
Object.assign(crm, r.patch);
const m1 = last();
assert(m1.reply_markup?.keyboard, 'expected ReplyKeyboardMarkup on /start');
assert(m1.reply_markup.resize_keyboard === true, 'resize_keyboard');
const flat = m1.reply_markup.keyboard.flat().map((b) => b.text);
assert(hasLabel(flat, 'Записаться'), 'Записаться btn');
assert(hasLabel(flat, 'Мои записи'), 'Мои записи btn');
assert(hasLabel(flat, 'Написать мастеру'), 'Написать мастеру btn');
console.log('OK /start ReplyKeyboard', flat.join(' | '));

// 2) owner payload only
r = await handleUpdate(crm, {
  update_id: 2,
  message: { chat: { id: 999 }, text: '/start owner', from: { username: 'boss' } },
});
Object.assign(crm, r.patch);
assert(crm.settings.telegramOwnerChatId === '999', 'owner set');
{
  const mo = last();
  assert(mo.reply_markup?.keyboard, 'owner /start must attach ReplyKeyboard');
  const oflat = mo.reply_markup.keyboard.flat().map((b) => b.text);
  assert(hasLabel(oflat, 'Изменить график на день'), 'owner sched btn');
  assert(hasLabel(oflat, 'Перенести клиента'), 'owner move btn');
  assert(hasLabel(oflat, 'Поиск по телефону'), 'owner phone btn');
  assert(hasLabel(oflat, 'Поделиться ссылкой'), 'owner share btn');
  assert(hasLabel(oflat, 'Записать'), 'owner book btn');
  assert(hasLabel(oflat, 'Записи'), 'owner upcoming appts btn');
  assert(!hasLabel(oflat, 'Записаться'), 'owner kb is not client kb');
  console.log('OK owner via start=owner + owner ReplyKeyboard', oflat.join(' | '));
}
// 2b) Меню text resends keyboard
g.__tgSent = [];
r = await handleUpdate(crm, {
  update_id: 21,
  message: { chat: { id: 111 }, text: 'Меню', from: { first_name: 'Иван' } },
});
Object.assign(crm, r.patch);
assert(last().reply_markup?.keyboard, 'Меню → ReplyKeyboard');
console.log('OK Меню → ReplyKeyboard');
// 2c) owner chat plain /start still gets keyboard
g.__tgSent = [];
r = await handleUpdate(crm, {
  update_id: 22,
  message: { chat: { id: 999 }, text: '/start', from: { username: 'boss' } },
});
Object.assign(crm, r.patch);
assert(last().reply_markup?.keyboard, 'owner-chat /start → ReplyKeyboard');
console.log('OK owner-chat /start → ReplyKeyboard');

// 3) plain /start on other chat must NOT steal owner
r = await handleUpdate(crm, {
  update_id: 3,
  message: { chat: { id: 111 }, text: '/start', from: { first_name: 'Иван' } },
});
Object.assign(crm, r.patch);
assert(crm.settings.telegramOwnerChatId === '999', 'owner not stolen');
console.log('OK plain /start does not steal owner');

// 4) text Записаться → inline services (not reply kb only)
g.__tgSent = [];
r = await handleUpdate(crm, {
  update_id: 4,
  message: { chat: { id: 111 }, text: 'Записаться', from: { first_name: 'Иван' } },
});
Object.assign(crm, r.patch);
const mBook = last();
assert(mBook.reply_markup?.inline_keyboard, 'services inline keyboard');
assert(mBook.text.includes('услугу') || mBook.reply_markup.inline_keyboard.length > 0, 'service list');
console.log('OK Записаться → services inline');

// 5) booking callback chain: service → day → time → confirm → name/phone
g.__tgSent = [];
r = await handleUpdate(crm, {
  update_id: 5,
  callback_query: {
    id: 'cq1',
    data: 'bk:sv:svc_cut',
    from: { first_name: 'Иван', username: 'ivan' },
    message: { chat: { id: 111 } },
  },
});
Object.assign(crm, r.patch);
assert(last().reply_markup?.inline_keyboard, 'month calendar inline');
console.log('OK service → calendar');

r = await handleUpdate(crm, {
  update_id: 6,
  callback_query: {
    id: 'cq2',
    data: `bk:dy:${D0}`,
    from: { first_name: 'Иван' },
    message: { chat: { id: 111 } },
  },
});
Object.assign(crm, r.patch);
const slotsMsg = last();
assert(slotsMsg.reply_markup?.inline_keyboard, 'time slots');
// find a real slot button like 10:00 → bk:tm:1000
const slotBtn = slotsMsg.reply_markup.inline_keyboard.flat().find((b) => b.callback_data?.startsWith('bk:tm:'));
assert(slotBtn, 'at least one slot (got: ' + JSON.stringify(slotsMsg.reply_markup.inline_keyboard) + ')');
console.log('OK day → slots', slotBtn.text);

r = await handleUpdate(crm, {
  update_id: 7,
  callback_query: {
    id: 'cq3',
    data: slotBtn.callback_data,
    from: { first_name: 'Иван' },
    message: { chat: { id: 111 } },
  },
});
Object.assign(crm, r.patch);
assert(last().text.includes('Подтвердите'), 'confirm step');
console.log('OK time → confirm');

r = await handleUpdate(crm, {
  update_id: 8,
  callback_query: {
    id: 'cq4',
    data: 'bk:cf',
    from: { first_name: 'Иван', username: 'ivan' },
    message: { chat: { id: 111 } },
  },
});
Object.assign(crm, r.patch);
assert(last().text.includes('зовут') || last().text.includes('телефон'), 'ask name or phone');
console.log('OK confirm → ask contact:', last().text.slice(0, 40));

r = await handleUpdate(crm, {
  update_id: 9,
  message: { chat: { id: 111 }, text: 'Иван Тестов', from: { first_name: 'Иван', username: 'ivan' } },
});
Object.assign(crm, r.patch);
assert(last().text.includes('телефон'), 'ask phone after name');

r = await handleUpdate(crm, {
  update_id: 10,
  message: { chat: { id: 111 }, text: '+79991234567', from: { first_name: 'Иван', username: 'ivan' } },
});
Object.assign(crm, r.patch);
assert(crm.appointments.length === 1, 'appointment created');
assert(crm.appointments[0].source === 'telegram', 'source telegram');
assert(crm.appointments[0].status === 'waiting', 'status waiting');
assert(crm.appointments[0].start.includes('+03:00') || crm.appointments[0].start.includes('T'), 'start field');
assert(crm.clients.some((c) => c.phone.includes('999')), 'client phone');
// owner notified with buttons
const ownerMsg = g.__tgSent.find((m) => m.chatId === '999' && m.text.includes('Новая запись'));
assert(ownerMsg, 'owner notified');
assert(ownerMsg.reply_markup?.inline_keyboard?.flat().some((b) => String(b.text||'').includes('Отменить')), 'owner Отменить');
assert(ownerMsg.reply_markup?.inline_keyboard?.flat().some((b) => String(b.text||'').includes('Перенести')), 'owner Перенести');
// client got reply keyboard refreshed
const clientKb = [...g.__tgSent].reverse().find((m) => m.chatId === '111' && m.reply_markup?.keyboard);
assert(clientKb, 'client reply kb after book');
const flat2 = clientKb.reply_markup.keyboard.flat().map((b) => b.text);
assert(hasLabel(flat2, 'Перенести') || hasLabel(flat2, 'Отменить'), 'upcoming actions on reply kb');
console.log('OK booking complete + owner notify + reply kb', flat2.join(' | '));

// 5b) owner schedule off + share link + phone search
crm.settings.telegramBotUsername = 'OpoveshchenieBot';
g.__tgSent = [];
r = await handleUpdate(crm, {
  update_id: 50,
  message: { chat: { id: 999 }, text: 'Изменить график на день', from: { username: 'boss' } },
});
Object.assign(crm, r.patch);
assert(last().reply_markup?.inline_keyboard, 'owner sched calendar');
r = await handleUpdate(crm, {
  update_id: 51,
  callback_query: {
    id: 'ow1',
    data: `ow:sy:${D1}`,
    from: { username: 'boss' },
    message: { chat: { id: 999 } },
  },
});
Object.assign(crm, r.patch);
assert(last().text.includes(D1), 'ask kind for day');
r = await handleUpdate(crm, {
  update_id: 52,
  callback_query: {
    id: 'ow2',
    data: `ow:sk:off:${D1}`,
    from: { username: 'boss' },
    message: { chat: { id: 999 } },
  },
});
Object.assign(crm, r.patch);
assert(crm.exceptions.some((e) => e.date === D1 && e.type === 'off'), 'exception off saved');
assert(last().reply_markup?.keyboard, 'owner kb after sched');
console.log('OK owner schedule off');

g.__tgSent = [];
r = await handleUpdate(crm, {
  update_id: 53,
  message: { chat: { id: 999 }, text: 'Поделиться ссылкой', from: { username: 'boss' } },
});
Object.assign(crm, r.patch);
{
  const shareMsg = g.__tgSent.find((m) => String(m.text||'').includes('t.me/') || String(m.text||'').includes('OpoveshchenieBot'));
  assert(shareMsg, 'share text with bot link');
  assert(String(shareMsg.text).includes('OpoveshchenieBot'), 'bot link');
  assert(shareMsg.reply_markup?.inline_keyboard || last().reply_markup?.keyboard, 'share markup');
}
console.log('OK owner share link');

g.__tgSent = [];
r = await handleUpdate(crm, {
  update_id: 531,
  message: { chat: { id: 999 }, text: '🔗 Поделиться ссылкой на бота', from: { username: 'boss' } },
});
Object.assign(crm, r.patch);
{
  const shareMsg = g.__tgSent.find((m) => String(m.text||'').includes('OpoveshchenieBot'));
  assert(shareMsg, 'share на бота link');
}
console.log('OK owner share link (на бота)');

g.__tgSent = [];
r = await handleUpdate(crm, {
  update_id: 54,
  message: { chat: { id: 999 }, text: 'Поиск по телефону', from: { username: 'boss' } },
});
Object.assign(crm, r.patch);
r = await handleUpdate(crm, {
  update_id: 55,
  message: { chat: { id: 999 }, text: '9991234567', from: { username: 'boss' } },
});
Object.assign(crm, r.patch);
assert(last().text.includes('Иван') || last().text.includes('999'), 'phone search hit');
console.log('OK owner phone search');

// 5b2) owner «📋 Записи» — paginated upcoming with write/cancel/reschedule
{
  // Dedicated clients so list appts do not become nearest for chat 111 cancel tests
  if (!crm.clients.some((c) => c.id === 'c_list_a')) {
    crm.clients.push({
      id: 'c_list_a',
      name: 'Анна Список',
      phone: '+79990001101',
      telegramChatId: '77701',
    });
  }
  if (!crm.clients.some((c) => c.id === 'c_list_b')) {
    crm.clients.push({
      id: 'c_list_b',
      name: 'Борис Список',
      phone: '+79990001102',
      // no telegram — covers «нет Telegram» path optionally
    });
  }
  const base = Date.now() + 2 * 3600 * 1000;
  for (let i = 0; i < 7; i++) {
    const t = new Date(base + i * 3600 * 1000);
    const p = mskParts(t);
    crm.appointments.push({
      id: `ap_list_${String(i).padStart(2, '0')}_abcdef`,
      clientId: i % 2 === 0 ? 'c_list_a' : 'c_list_b',
      staffId: 'staff_barber',
      serviceIds: ['svc_cut'],
      start: mskWallISO(p.date, p.time),
      durationMin: 45,
      status: 'waiting',
      source: 'telegram',
    });
  }
  g.__tgSent = [];
  r = await handleUpdate(crm, {
    update_id: 551,
    message: { chat: { id: 999 }, text: '📋 Записи', from: { username: 'boss' } },
  });
  Object.assign(crm, r.patch);
  const listMsg = last();
  assert(String(listMsg.text || '').includes('Ближайшие записи'), 'list header');
  assert(/1–5 из \d+/.test(String(listMsg.text || '')), 'page 1 shows 1–5');
  assert(String(listMsg.text || '').includes('стр. 1/'), 'page 1 indicator');
  const ik = listMsg.reply_markup?.inline_keyboard || [];
  const flatIk = ik.flat().map((b) => b.text);
  assert(hasLabel(flatIk, 'Написать'), 'write btn');
  assert(hasLabel(flatIk, 'Отменить'), 'cancel btn');
  assert(hasLabel(flatIk, 'Перенести'), 'reschedule btn');
  assert(hasLabel(flatIk, 'Следующие'), 'next page btn');
  assert(!hasLabel(flatIk, 'Назад'), 'no back on first page');
  const nextBtn = ik.flat().find((b) => String(b.text || '').includes('Следующие'));
  assert(nextBtn?.callback_data === 'ow:apg:1', 'next → page 1');
  // pagination edit
  g.__tgSent = [];
  r = await handleUpdate(crm, {
    update_id: 552,
    callback_query: {
      id: 'owapg1',
      data: 'ow:apg:1',
      from: { username: 'boss' },
      message: { chat: { id: 999 }, message_id: 42 },
    },
  });
  Object.assign(crm, r.patch);
  const page2 = last();
  assert(page2.edit === 42, 'pagination edits same message');
  assert(/6–\d+ из \d+/.test(String(page2.text || '')), 'page 2 starts at 6');
  assert(String(page2.text || '').includes('стр. 2/'), 'page 2 indicator');
  const flat2 = (page2.reply_markup?.inline_keyboard || []).flat().map((b) => b.text);
  assert(hasLabel(flat2, 'Назад'), 'back on page 2');
  // last page only if total <= 10 (we seeded 7 + prior); if more pages, Следующие may remain
  if (String(page2.text || '').match(/стр\. 2\/(\d+)/)?.[1] === '2') {
    assert(!hasLabel(flat2, 'Следующие'), 'no next on last page');
  }
  // Написать wires replyTo
  const writeBtn = ik.flat().find((b) => String(b.callback_data || '').startsWith('ow:msg:'));
  assert(writeBtn, 'ow:msg callback present');
  g.__tgSent = [];
  r = await handleUpdate(crm, {
    update_id: 553,
    callback_query: {
      id: 'owmsg1',
      data: writeBtn.callback_data,
      from: { username: 'boss' },
      message: { chat: { id: 999 } },
    },
  });
  Object.assign(crm, r.patch);
  assert(
    crm.settings._replyTo || (last().text || '').includes('Пишите') || (last().text || '').includes('нет Telegram'),
    'write starts messaging or explains no TG',
  );
  console.log('OK owner Записи list + pagination + actions');
}

// 5c) owner «Записать» — same order as clients, then client name+phone (any client)
g.__tgSent = [];
const apCountBefore = crm.appointments.length;
const clientsBefore = crm.clients.length;
r = await handleUpdate(crm, {
  update_id: 560,
  message: { chat: { id: 999 }, text: '📝 Записать', from: { username: 'boss' } },
});
Object.assign(crm, r.patch);
assert(last().reply_markup?.inline_keyboard, 'owner book → services');
assert(last().text.includes('услугу') || last().reply_markup.inline_keyboard.length > 0, 'owner service list');
console.log('OK owner Записать → services');

r = await handleUpdate(crm, {
  update_id: 561,
  callback_query: {
    id: 'owb1',
    data: 'bk:sv:svc_cut',
    from: { username: 'boss' },
    message: { chat: { id: 999 } },
  },
});
Object.assign(crm, r.patch);
assert(last().reply_markup?.inline_keyboard, 'owner book → calendar');

r = await handleUpdate(crm, {
  update_id: 562,
  callback_query: {
    id: 'owb2',
    data: `bk:dy:${D2}`,
    from: { username: 'boss' },
    message: { chat: { id: 999 } },
  },
});
Object.assign(crm, r.patch);
const owSlots = last();
const owSlotBtn = owSlots.reply_markup.inline_keyboard.flat().find((b) => b.callback_data?.startsWith('bk:tm:'));
assert(owSlotBtn, 'owner book has slot');
r = await handleUpdate(crm, {
  update_id: 563,
  callback_query: {
    id: 'owb3',
    data: owSlotBtn.callback_data,
    from: { username: 'boss' },
    message: { chat: { id: 999 } },
  },
});
Object.assign(crm, r.patch);
assert(last().text.includes('Подтвердите'), 'owner book confirm');
r = await handleUpdate(crm, {
  update_id: 564,
  callback_query: {
    id: 'owb4',
    data: 'bk:cf',
    from: { username: 'boss' },
    message: { chat: { id: 999 } },
  },
});
Object.assign(crm, r.patch);
assert(last().text.includes('Имя клиента') || last().text.toLowerCase().includes('имя'), 'owner asks client name');
r = await handleUpdate(crm, {
  update_id: 565,
  message: { chat: { id: 999 }, text: 'Пётр Walkin', from: { username: 'boss' } },
});
Object.assign(crm, r.patch);
assert(last().text.toLowerCase().includes('телефон'), 'owner asks client phone');
r = await handleUpdate(crm, {
  update_id: 566,
  message: { chat: { id: 999 }, text: '+79990001122', from: { username: 'boss' } },
});
Object.assign(crm, r.patch);
assert(crm.appointments.length === apCountBefore + 1, 'owner booking created appointment');
const owAp = crm.appointments[crm.appointments.length - 1];
assert(owAp.note.includes('мастер') || owAp.source === 'telegram', 'owner booking note/source');
assert(String(owAp.telegramChatId || '') !== '999', 'owner chat not stored as visit TG');
const owClient = crm.clients.find((c) => c.id === owAp.clientId);
assert(owClient, 'owner booking client exists');
assert(String(owClient.phone || '').includes('9990001122') || String(owClient.phone || '').includes('90001122'), 'walk-in phone saved');
assert(owClient.name.includes('Пётр') || owClient.name.includes('Walkin'), 'walk-in name saved');
assert(String(owClient.telegramChatId || '') !== '999', 'owner chat not attached to client');
const owDone = g.__tgSent.filter((m) => m.chatId === '999');
assert(owDone.some((m) => String(m.text||'').includes('Клиент записан') || String(m.text||'').includes('записан')), 'owner got success');
assert(owDone.some((m) => String(m.text||'').includes('напоминан') || String(m.text||'').includes('Напомин')), 'owner reminder prompt');
console.log('OK owner Записать → service→day→time→name→phone + reminder');

// reuse existing client by phone
g.__tgSent = [];
r = await handleUpdate(crm, {
  update_id: 567,
  message: { chat: { id: 999 }, text: 'Записать', from: { username: 'boss' } },
});
Object.assign(crm, r.patch);
r = await handleUpdate(crm, {
  update_id: 568,
  callback_query: { id: 'owb5', data: 'bk:sv:svc_cut', from: { username: 'boss' }, message: { chat: { id: 999 } } },
});
Object.assign(crm, r.patch);
r = await handleUpdate(crm, {
  update_id: 569,
  callback_query: { id: 'owb6', data: `bk:dy:${D3}`, from: { username: 'boss' }, message: { chat: { id: 999 } } },
});
Object.assign(crm, r.patch);
const owSlots2 = last();
const owSlot2 = owSlots2.reply_markup.inline_keyboard.flat().find((b) => b.callback_data?.startsWith('bk:tm:'));
assert(owSlot2, 'owner reuse slot');
r = await handleUpdate(crm, {
  update_id: 570,
  callback_query: { id: 'owb7', data: owSlot2.callback_data, from: { username: 'boss' }, message: { chat: { id: 999 } } },
});
Object.assign(crm, r.patch);
r = await handleUpdate(crm, {
  update_id: 571,
  callback_query: { id: 'owb8', data: 'bk:cf', from: { username: 'boss' }, message: { chat: { id: 999 } } },
});
Object.assign(crm, r.patch);
r = await handleUpdate(crm, {
  update_id: 572,
  message: { chat: { id: 999 }, text: 'Иван Тестов', from: { username: 'boss' } },
});
Object.assign(crm, r.patch);
const clientsMid = crm.clients.length;
r = await handleUpdate(crm, {
  update_id: 573,
  message: { chat: { id: 999 }, text: '+79991234567', from: { username: 'boss' } },
});
Object.assign(crm, r.patch);
assert(crm.clients.length === clientsMid, 'reuse existing client by phone (no new row)');
console.log('OK owner book reuses client by phone');

g.__tgSent = [];
r = await handleUpdate(crm, {
  update_id: 56,
  message: { chat: { id: 999 }, text: 'Меню', from: { username: 'boss' } },
});
Object.assign(crm, r.patch);
{
  const flatOw = last().reply_markup.keyboard.flat().map((b) => b.text);
  assert(hasLabel(flatOw, 'Изменить график на день'), 'owner Меню → owner kb');
  console.log('OK owner Меню → owner ReplyKeyboard');
}

// 6) poll gated
process.env.TELEGRAM_ALLOW_POLL = undefined;
const { pollAndHandle } = await import('./telegram-inbox.ts');
const poll = await pollAndHandle(crm);
assert(poll.replies === 0, 'poll disabled without ALLOW_POLL');
console.log('OK poll gated');

// 7) reminders processDue
const ap = crm.appointments[0];
ap.reminders = [{ at: new Date(Date.now() - 1000).toISOString(), kind: '15m', sent: false }];
const { sent } = await processDueReminders(crm, async (_t, chatId, text, reply_markup) => {
  g.__tgSent.push({ chatId: String(chatId), text, reply_markup });
  return { ok: true };
});
assert(sent === 1, 'reminder sent');
assert(ap.reminders[0].sent === true, 'marked sent');
console.log('OK processDueReminders');

// 8) msk morning
const morn = morningReminderAt(mskWallISO(D0, '15:30'));
assert(morn.includes('T06:00:00.000Z') || new Date(morn).toISOString().includes('06:00'), '09:00 MSK = 06:00Z ' + morn);
console.log('OK morningReminderAt', morn);


// 9) cancel with DOUBLE confirm
g.__tgSent = [];
{
  r = await handleUpdate(crm, {
    update_id: 90,
    message: { chat: { id: 111 }, text: 'Отменить', from: { first_name: 'Иван' } },
  });
  Object.assign(crm, r.patch);
  assert(last().text.includes('Отменить запись?'), 'cancel step1 text');
  assert(last().reply_markup?.inline_keyboard?.flat().some((b) => String(b.text||'').includes('Да') && !String(b.text||'').includes('отменить')), 'cancel step1 Да');
  assert(crm.appointments[0].status !== 'cancelled', 'not cancelled after step1');
  r = await handleUpdate(crm, {
    update_id: 91,
    callback_query: {
      id: 'cq_cly',
      data: 'bk:cly',
      from: { first_name: 'Иван' },
      message: { chat: { id: 111 } },
    },
  });
  Object.assign(crm, r.patch);
  assert(last().text.includes('Точно отменить?'), 'cancel step2 text');
  assert(last().reply_markup?.inline_keyboard?.flat().some((b) => String(b.text||'').includes('Да, отменить')), 'cancel step2 Да отменить');
  assert(crm.appointments[0].status !== 'cancelled', 'not cancelled after step2 prompt');
  r = await handleUpdate(crm, {
    update_id: 92,
    callback_query: {
      id: 'cq_cly2',
      data: 'bk:cly2',
      from: { first_name: 'Иван' },
      message: { chat: { id: 111 } },
    },
  });
  Object.assign(crm, r.patch);
  assert(crm.appointments[0].status === 'cancelled', 'cancelled');
  assert(g.__tgSent.some((m) => m.chatId === '999' && m.text.includes('отменил')), 'owner cancel notify');
  console.log('OK cancel double confirm + owner notify');
}

crm.appointments[0].status = 'waiting';
crm.appointments[0].start = mskWallISO(D2, '11:00');

// 10) reminder presets + prefs
g.__tgSent = [];
{
  const sid = crm.appointments[0].id.slice(-10);
  const cli = crm.clients.find((c) => String(c.telegramChatId) === '111');
  r = await handleUpdate(crm, {
    update_id: 100,
    callback_query: {
      id: 'cq_rt',
      data: `bk:rt:${sid}:30`,
      from: { first_name: 'Иван' },
      message: { chat: { id: 111 } },
    },
  });
  Object.assign(crm, r.patch);
  assert(crm.appointments[0].reminders?.some((x) => x.kind === '30m'), '30m reminder');
  assert(cli.reminderPrefs?.includes(30), 'prefs remembered');
  r = await handleUpdate(crm, {
    update_id: 101,
    callback_query: {
      id: 'cq_ru',
      data: `bk:ru:${sid}`,
      from: { first_name: 'Иван' },
      message: { chat: { id: 111 } },
    },
  });
  Object.assign(crm, r.patch);
  assert(crm.appointments[0].reminders?.some((x) => x.kind === 'morning'), 'morning reminder');
  assert(cli.reminderMorning === true, 'morning pref');
  r = await handleUpdate(crm, {
    update_id: 102,
    callback_query: {
      id: 'cq_rn',
      data: `bk:rn:${sid}`,
      from: { first_name: 'Иван' },
      message: { chat: { id: 111 } },
    },
  });
  Object.assign(crm, r.patch);
  assert((crm.appointments[0].reminders || []).length === 0, 'reminders cleared');
  assert((cli.reminderPrefs || []).length === 0, 'prefs cleared');
  assert(cli.reminderMorning === false, 'morning cleared');
  console.log('OK reminders prefs + Не напоминать');
}

// 11) deep links
g.__tgSent = [];
{
  const cli = crm.clients.find((c) => String(c.telegramChatId) === '111');
  r = await handleUpdate(crm, {
    update_id: 110,
    message: { chat: { id: 222 }, text: `/start c_${cli.id}`, from: { username: 'other' } },
  });
  Object.assign(crm, r.patch);
  assert(String(crm.clients.find((c) => c.id === cli.id).telegramChatId) === '222', 'c_ links chat');
  crm.clients.find((c) => c.id === cli.id).telegramChatId = '111';
  const ap2 = crm.appointments[0];
  r = await handleUpdate(crm, {
    update_id: 111,
    message: { chat: { id: 333 }, text: `/start v_${ap2.id}`, from: { username: 'visit' } },
  });
  Object.assign(crm, r.patch);
  assert(String(crm.clients.find((c) => c.id === ap2.clientId).telegramChatId) === '333', 'v_ links client');
  crm.clients.find((c) => c.id === ap2.clientId).telegramChatId = '111';
  console.log('OK deep links c_ and v_');
}

// 12) free text
g.__tgSent = [];
r = await handleUpdate(crm, {
  update_id: 120,
  message: { chat: { id: 111 }, text: 'Здравствуйте, можно раньше?', from: { first_name: 'Иван' } },
});
Object.assign(crm, r.patch);
assert(g.__tgSent.some((m) => m.chatId === '999' && m.text.includes('✉')), 'owner gets mail');
console.log('OK client free text to owner');

// 13) calendar noop dots
g.__tgSent = [];
r = await handleUpdate(crm, {
  update_id: 130,
  callback_query: {
    id: 'cq_cal',
    data: 'bk:sv:svc_cut',
    from: { first_name: 'Иван' },
    message: { chat: { id: 111 } },
  },
});
Object.assign(crm, r.patch);
{
  const cells = last().reply_markup.inline_keyboard.flat();
  assert(cells.some((b) => b.text === '·' && b.callback_data === 'bk:noop'), 'empty cell noop');
  console.log('OK calendar empty cells');
}

// 14) one reply after booking
{
  r = await handleUpdate(crm, {
    update_id: 140,
    message: { chat: { id: 444 }, text: '/start', from: { first_name: 'Пётр' } },
  });
  Object.assign(crm, r.patch);
  r = await handleUpdate(crm, {
    update_id: 141,
    message: { chat: { id: 444 }, text: 'Записаться', from: { first_name: 'Пётр' } },
  });
  Object.assign(crm, r.patch);
  r = await handleUpdate(crm, {
    update_id: 142,
    callback_query: { id: 'n1', data: 'bk:sv:svc_cut', from: { first_name: 'Пётр' }, message: { chat: { id: 444 } } },
  });
  Object.assign(crm, r.patch);
  r = await handleUpdate(crm, {
    update_id: 143,
    callback_query: { id: 'n2', data: `bk:dy:${D3}`, from: { first_name: 'Пётр' }, message: { chat: { id: 444 } } },
  });
  Object.assign(crm, r.patch);
  const slotBtn2 = last().reply_markup.inline_keyboard.flat().find((b) => b.callback_data?.startsWith('bk:tm:'));
  r = await handleUpdate(crm, {
    update_id: 144,
    callback_query: { id: 'n3', data: slotBtn2.callback_data, from: { first_name: 'Пётр' }, message: { chat: { id: 444 } } },
  });
  Object.assign(crm, r.patch);
  r = await handleUpdate(crm, {
    update_id: 145,
    callback_query: { id: 'n4', data: 'bk:cf', from: { first_name: 'Пётр' }, message: { chat: { id: 444 } } },
  });
  Object.assign(crm, r.patch);
  r = await handleUpdate(crm, {
    update_id: 146,
    message: { chat: { id: 444 }, text: 'Пётр', from: { first_name: 'Пётр' } },
  });
  Object.assign(crm, r.patch);
  g.__tgSent = [];
  r = await handleUpdate(crm, {
    update_id: 147,
    message: { chat: { id: 444 }, text: '+79991112233', from: { first_name: 'Пётр' } },
  });
  Object.assign(crm, r.patch);
  const toClient = g.__tgSent.filter((m) => m.chatId === '444');
  // booking confirm (ReplyKeyboard) + always reminder picker
  assert(toClient.length === 2, 'confirm + reminder after book, got ' + toClient.length);
  assert(!toClient.some((m) => (m.text || '').includes('Управление записью')), 'no manage msg');
  assert(toClient.some((m) => (m.text || '').includes('Поставить напоминание')), 'reminder ask after book');
  console.log('OK confirm + reminder after booking');
}

console.log('\nALL SMOKE PASSED');


// 11) MENU_BOOK_MORE label is «Новая запись» when upcoming exists
{
  const day = D0; // working Monday (closed days are now rejected at confirm)
  crm.clients = [{
    id: 'cli_ret', name: 'Регуляр', phone: '+79991112233', telegramChatId: '555',
  }];
  crm.appointments = [{
    id: 'apt_oldhist01',
    clientId: 'cli_ret',
    staffId: 'staff_barber',
    serviceIds: ['svc_cut'],
    start: mskWallISO(day, '12:00'),
    durationMin: 45,
    status: 'waiting',
    reminders: [],
  }];
  g.__tgSent = [];
  let r = await handleUpdate(crm, {
    update_id: 1101,
    message: { chat: { id: 555 }, text: '/start', from: { first_name: 'Регуляр' } },
  });
  Object.assign(crm, r.patch);
  const flatRet = last().reply_markup.keyboard.flat().map((b) => b.text);
  assert(hasLabel(flatRet, 'Новая запись'), 'Новая запись btn when upcoming');
  assert(!hasLabel(flatRet, 'Записаться ещё'), 'old label gone');
  assert(!hasLabel(flatRet, 'Записаться') || hasLabel(flatRet, 'Новая запись'), 'book-more replaces Записаться row');
  console.log('OK Новая запись on ReplyKeyboard', flatRet.join(' | '));

  // 12) second booking for returning client opens reminder picker
  g.__tgSent = [];
  // seed draft as if they confirmed slot
  crm.settings._draft = crm.settings._draft || {};
  crm.settings._draft['555'] = { serviceId: 'svc_cut', day, time: '15:00' };
  r = await handleUpdate(crm, {
    update_id: 1102,
    callback_query: {
      id: 'cq_ret',
      data: 'bk:cf',
      from: { first_name: 'Регуляр' },
      message: { chat: { id: 555 } },
    },
  });
  Object.assign(crm, r.patch);
  const texts = g.__tgSent.map((m) => m.text || '').join('\n---\n');
  assert(texts.includes('Поставить напоминание') || texts.includes('Когда напомнить'), 'returning → reminder prompt');
  const remMsg = g.__tgSent.find((m) => (m.text || '').includes('Поставить напоминание') || (m.text || '').includes('Когда напомнить'));
  assert(remMsg?.reply_markup?.inline_keyboard, 'reminder inline kb');
  const rflat = remMsg.reply_markup.inline_keyboard.flat().map((b) => b.text);
  assert(hasLabel(rflat, '15 мин') && hasLabel(rflat, 'Не напоминать'), 'reminder presets');
  console.log('OK returning booking → reminder picker');
}

// 13) first-time client ALSO gets reminder picker after booking
{
  g.__tgSent = [];
  const day = mskParts(new Date(Date.now() + 11 * 86400000)).date; // away from D0–D3 used (and closed) by earlier cases
  // linked client with contacts but ZERO prior appointments (= first booking)
  crm.clients = crm.clients.filter((c) => String(c.telegramChatId) !== '777');
  crm.appointments = crm.appointments.filter((a) => String(a.telegramChatId) !== '777' && a.clientId !== 'cli_newbie');
  crm.clients.push({
    id: 'cli_newbie', name: 'Новичок', phone: '+79990001122', telegramChatId: '777',
  });
  crm.settings._draft = crm.settings._draft || {};
  crm.settings._draft['777'] = { serviceId: 'svc_cut', day, time: '16:00' };
  let r = await handleUpdate(crm, {
    update_id: 1103,
    callback_query: {
      id: 'cq_new',
      data: 'bk:cf',
      from: { first_name: 'Новичок' },
      message: { chat: { id: 777 } },
    },
  });
  Object.assign(crm, r.patch);
  const texts = g.__tgSent.map((m) => m.text || '').join('\n');
  assert(texts.includes('Поставить напоминание'), 'first-timer gets reminder prompt');
  const remMsg = g.__tgSent.find((m) => (m.text || '').includes('Поставить напоминание'));
  assert(remMsg?.reply_markup?.inline_keyboard, 'first-timer reminder kb');
  console.log('OK first-time booking → reminder picker');
}

// 14) multi-visit Reminder menu + add-another stack
{
  const day1 = mskParts(new Date(Date.now() + 4 * 86400000)).date;
  const day2 = mskParts(new Date(Date.now() + 6 * 86400000)).date;
  const cli = crm.clients.find((c) => String(c.telegramChatId) === '111') || crm.clients[0];
  cli.telegramChatId = '111';
  const apA = {
    id: 'apt_multi_aaa1',
    clientId: cli.id,
    staffId: 'staff_barber',
    serviceIds: ['svc_cut'],
    start: mskWallISO(day1, '10:00'),
    durationMin: 45,
    status: 'waiting',
    reminders: [{ at: new Date().toISOString(), kind: '30m', sent: false }],
  };
  const apB = {
    id: 'apt_multi_bbb2',
    clientId: cli.id,
    staffId: 'staff_barber',
    serviceIds: ['svc_cut'],
    start: mskWallISO(day2, '14:00'),
    durationMin: 45,
    status: 'waiting',
    reminders: [],
  };
  crm.appointments = [...crm.appointments.filter((a) => a.clientId !== cli.id || a.status === 'cancelled'), apA, apB];
  g.__tgSent = [];
  let r = await handleUpdate(crm, {
    update_id: 1200,
    message: { chat: { id: 111 }, text: 'Напоминание', from: { first_name: 'Иван' } },
  });
  Object.assign(crm, r.patch);
  const pick = g.__tgSent.find((m) => (m.text || '').includes('Какую запись'));
  assert(pick?.reply_markup?.inline_keyboard, 'multi visit pick list');
  const labels = pick.reply_markup.inline_keyboard.flat().map((b) => b.text).join('|');
  assert(labels.includes('нап.') || labels.includes('10:00'), 'list shows visits');
  // pick apA (already has reminder) → still presets
  g.__tgSent = [];
  r = await handleUpdate(crm, {
    update_id: 1201,
    callback_query: {
      id: 'cq_rm_a',
      data: `bk:rm:${apA.id.slice(-10)}`,
      from: { first_name: 'Иван' },
      message: { chat: { id: 111 } },
    },
  });
  Object.assign(crm, r.patch);
  const preset = g.__tgSent.find((m) => (m.text || '').includes('Когда напомнить'));
  assert(preset?.reply_markup?.inline_keyboard, 'presets after pick existing');
  assert((preset.text || '').includes('добавить ещё') || (preset.text || '').includes('Когда напомнить'), 'allow add');
  // set 15m → add-more / done
  g.__tgSent = [];
  r = await handleUpdate(crm, {
    update_id: 1202,
    callback_query: {
      id: 'cq_rt15',
      data: `bk:rt:${apA.id.slice(-10)}:15`,
      from: { first_name: 'Иван' },
      message: { chat: { id: 111 } },
    },
  });
  Object.assign(crm, r.patch);
  assert(apA.reminders.some((x) => x.kind === '15m') && apA.reminders.some((x) => x.kind === '30m'), 'stacked 15m+30m');
  const after = g.__tgSent.find((m) => (m.text || '').includes('установлено'));
  const aflat = after?.reply_markup?.inline_keyboard?.flat().map((b) => b.text) || [];
  assert(hasLabel(aflat, 'Добавить ещё напоминание') && hasLabel(aflat, 'Готово'), 'add-more / done');
  // bk:rm without sid → list again
  g.__tgSent = [];
  r = await handleUpdate(crm, {
    update_id: 1203,
    callback_query: {
      id: 'cq_rm_bare',
      data: 'bk:rm',
      from: { first_name: 'Иван' },
      message: { chat: { id: 111 } },
    },
  });
  Object.assign(crm, r.patch);
  assert(g.__tgSent.some((m) => (m.text || '').includes('Какую запись')), 'bk:rm bare → list');
  console.log('OK multi-visit remind + stack + add-more');
}

