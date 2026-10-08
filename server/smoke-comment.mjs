// Optional client comment in the bot booking flow (no network: TG_SMOKE_CAPTURE).
process.env.TG_SMOKE_CAPTURE = '1';
const { handleUpdate, cleanComment, commentLine } = await import('./telegram-inbox.ts');
const g = globalThis;
g.__tgSent = [];
const ok = (c, m) => { if (!c) { console.error('FAIL ' + m); process.exit(1); } console.log('OK ' + m); };
const base = (() => {
  const now = new Date(Date.now() + 3 * 3600e3);
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 2));
  while (d.getUTCDay() !== 2) d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
})();
const crm = {
  clients: [],
  services: [{ id: 'svc_cut', name: 'Мужская стрижка', durationMin: 60, price: 2300, active: true, online: true }],
  staff: [{ id: 'staff_barber', name: 'Б', active: true }],
  appointments: [],
  windows: [],
  schedules: [{ staffId: 'staff_barber', week: [0,1,2,3,4,5,6].map((day) => ({ day, start: '10:00', end: '21:00', working: true })) }],
  exceptions: [],
  telegramChats: [],
  settings: { telegramToken: 'x', telegramOwnerChatId: '999', telegramOffset: 0, leadMinutes: 0, slotMinutes: 30, horizonDays: 30, onlineEnabled: true },
};
let uid = 1;
const upd = async (u) => { const r = await handleUpdate(crm, { update_id: uid++, ...u }); Object.assign(crm, r.patch); };
const cb = (chat, data) => upd({ callback_query: { id: 'q' + uid, data, from: { first_name: 'X' }, message: { chat: { id: chat } } } });
const tx = (chat, text) => upd({ message: { chat: { id: chat }, text, from: { first_name: 'X' } } });
const last = (chat) => [...g.__tgSent].reverse().find((m) => m.chatId === String(chat));

// sanitizer
ok(cleanComment('  привет\u0000\u0007 мир \r\n\r\n\r\n\r\nещё ') === 'привет мир\n\nещё', 'control chars / newlines cleaned');
ok(cleanComment('я'.repeat(600)).length === 300, 'capped at 300');
ok(cleanComment('<b>x</b> & "y"') === '<b>x</b> & "y"', 'html kept literal (plain-text messages, no parse_mode)');
ok(cleanComment('   ') === '' && cleanComment(undefined) === '', 'empty → nothing');

// 1) client types a comment
await cb(111, 'bk:sv:svc_cut');
await cb(111, `bk:dy:${base}`);
await cb(111, 'bk:tm:1200');
ok(/Хотите оставить комментарий мастеру/.test(last(111).text), 'comment step after time');
ok(last(111).reply_markup.inline_keyboard.flat().some((b) => b.text.includes('Пропустить') && b.callback_data === 'bk:nc'), 'skip button');
await tx(111, '/start');
ok(!g.__tgSent.some((m) => /💬/.test(m.text || '')), '/command is not captured as comment');
await cb(111, 'bk:sv:svc_cut');
await cb(111, `bk:dy:${base}`);
await cb(111, 'bk:tm:1200');
await tx(111, 'Мои записи');
ok(!g.__tgSent.some((m) => /💬/.test(m.text || '')), 'menu button text is not captured as comment');
await cb(111, 'bk:sv:svc_cut');
await cb(111, `bk:dy:${base}`);
await cb(111, 'bk:tm:1200');
await tx(111, 'Покороче виски,\u0007 бороду не трогать <b>');
ok(/Подтвердите запись/.test(last(111).text) && /💬 Покороче виски, бороду не трогать <b>/.test(last(111).text), 'confirm shows comment');
g.__tgSent = [];
await cb(111, 'bk:cf');
await tx(111, 'Олег Тест');
await tx(111, '+79990000011');
const ap = crm.appointments.at(-1);
ok(ap && ap.note === 'Покороче виски, бороду не трогать <b>' && ap.origin === 'Telegram', 'saved as note, origin separate: ' + JSON.stringify([ap?.note, ap?.origin]));
const own = g.__tgSent.filter((m) => m.chatId === '999');
console.log('---\n' + own.map((m) => m.text).join('\n---\n') + '\n---');
ok(own.length === 1 && /💬 Покороче виски/.test(own[0].text), 'master notification has 💬 comment');

// 2) client skips
await cb(222, 'bk:sv:svc_cut');
await cb(222, `bk:dy:${base}`);
await cb(222, 'bk:tm:1500');
await cb(222, 'bk:nc');
ok(/Подтвердите запись/.test(last(222).text) && !/💬/.test(last(222).text), 'skip → confirm without comment');
g.__tgSent = [];
await cb(222, 'bk:cf');
await tx(222, 'Пётр');
await tx(222, '+79990000022');
const ap2 = crm.appointments.at(-1);
ok(ap2.id !== ap.id && !ap2.note && ap2.origin === 'Telegram', 'skipped → no note');
ok(!/💬/.test(g.__tgSent.find((m) => m.chatId === '999')?.text || 'x💬'), 'master notification without 💬');
ok(commentLine({ note: 'Telegram' }) === '' && commentLine(ap) !== '', 'commentLine');

// 3) owner booking: no comment step
await tx(999, 'Записать');
await cb(999, 'bk:sv:svc_cut');
await cb(999, `bk:dy:${base}`);
await cb(999, 'bk:tm:1700');
ok(!/комментарий мастеру/.test(last(999).text), 'owner flow has no comment step');
console.log('ALL COMMENT CHECKS PASSED');
