// Master notifications on client reschedule / cancel (no network: TG_SMOKE_CAPTURE).
process.env.TG_SMOKE_CAPTURE = '1';
const { handleUpdate, processDueReminders } = await import('./telegram-inbox.ts');
const { mskWallISO } = await import('./msk.ts');
const g = globalThis;
g.__tgSent = [];
const ok = (c, m) => { if (!c) { console.error('FAIL ' + m); process.exit(1); } console.log('OK ' + m); };
const base = (() => {
  const now = new Date(Date.now() + 3 * 3600e3);
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 2));
  while (d.getUTCDay() !== 1) d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
})();
const crm = {
  clients: [{ id: 'cli_a', name: 'Иван', phone: '+79990000001', telegramChatId: '111' }],
  services: [{ id: 'svc_cut', name: 'Мужская стрижка', durationMin: 60, price: 2300, active: true, online: true }],
  staff: [{ id: 'staff_barber', name: 'Б', active: true }],
  appointments: [{ id: 'apt_resch0001', clientId: 'cli_a', staffId: 'staff_barber', serviceIds: ['svc_cut'], start: mskWallISO(base, '12:00'), durationMin: 60, status: 'waiting', telegramChatId: '111' }],
  windows: [],
  schedules: [{ staffId: 'staff_barber', week: [0,1,2,3,4,5,6].map((day) => ({ day, start: '10:00', end: '21:00', working: true })) }],
  exceptions: [],
  telegramChats: [],
  settings: { telegramToken: 'x', telegramOwnerChatId: '999', telegramOffset: 0, leadMinutes: 0, slotMinutes: 30, horizonDays: 30, onlineEnabled: true },
};
let uid = 1;
const cb = async (chat, data) => {
  const r = await handleUpdate(crm, { update_id: uid++, callback_query: { id: 'q' + uid, data, from: { first_name: 'X' }, message: { chat: { id: chat } } } });
  Object.assign(crm, r.patch);
};
const ap = () => crm.appointments.find((a) => a.id === 'apt_resch0001');
// auto 2h reminder on the linked visit
await processDueReminders(crm, async () => ({ ok: true }));
ok(ap().reminders?.some((r) => r.kind === '120m'), 'auto 2h reminder present');

// 1) client reschedules in the bot → master notified
g.__tgSent = [];
await cb(111, 'bk:mv:resch0001');
await cb(111, `bk:dy:${base}`);
await cb(111, 'bk:tm:1500');
await cb(111, 'bk:cf');
ok(ap().start === mskWallISO(base, '15:00'), 'visit moved to 15:00');
const toOwner = g.__tgSent.filter((m) => m.chatId === '999');
ok(toOwner.length === 1, 'master got exactly one message: ' + toOwner.length);
const t = toOwner[0].text;
console.log('---\n' + t + '\n---');
ok(/🔄 Клиент перенёс запись/.test(t) && /Иван/.test(t) && /\+79990000001/.test(t), 'title, name, phone');
ok(/Было: .*12:00/.test(t) && /Стало: .*15:00/.test(t), 'was → now');
ok(/Мужская стрижка/.test(t) && /Итого: 2\s300/.test(t), 'service + Итого');
const btns = toOwner[0].reply_markup.inline_keyboard.flat().map((b) => b.text).join('|');
ok(/Отменить/.test(btns) && /Перенести/.test(btns) && /Написать клиенту/.test(btns), 'buttons: ' + btns);
const r = ap().reminders.find((x) => x.kind === '120m');
ok(Math.abs(Date.parse(r.at) - (Date.parse(ap().start) - 2 * 3600e3)) < 2000 && !r.sent, 'reminder moved with the visit');

// 2) master reschedules himself → no notification to master, client informed
g.__tgSent = [];
await cb(999, 'ow:mv:resch0001');
await cb(999, `bk:dy:${base}`);
await cb(999, 'bk:tm:1700');
ok(ap().start === mskWallISO(base, '17:00'), 'master moved visit to 17:00');
ok(!g.__tgSent.some((m) => m.chatId === '999' && /Клиент перенёс|Перенос записи/.test(m.text || '')), 'no «client moved» notice for master own move');
ok(g.__tgSent.some((m) => m.chatId === '111' && /Мастер перенёс/.test(m.text || '')), 'client told «Мастер перенёс»');

// 3) client cancels → master notified
g.__tgSent = [];
await cb(111, 'bk:cl:resch0001');
await cb(111, 'bk:cly');
await cb(111, 'bk:cly2');
ok(ap().status === 'cancelled', 'cancelled');
const c = g.__tgSent.filter((m) => m.chatId === '999');
ok(c.length === 1 && /Клиент отменил запись/.test(c[0].text) && /Иван/.test(c[0].text) && /Итого/.test(c[0].text), 'master got cancel notice');
console.log('ALL RESCHEDULE CHECKS PASSED');
