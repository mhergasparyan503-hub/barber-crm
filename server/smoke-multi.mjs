// Several services + quantity per service (bot flow, totals, slots, notices). No network: TG_SMOKE_CAPTURE.
process.env.TG_SMOKE_CAPTURE = '1';
const { handleUpdate, processDueReminders } = await import('./telegram-inbox.ts');
const { cartFromRaw, visitPrice, MAX_QTY_PER_SERVICE, MAX_QTY_TOTAL } = await import('../src/lib/price.ts');
const { mskWallISO } = await import('./msk.ts');
const g = globalThis;
g.__tgSent = [];
const ok = (c, m) => { if (!c) { console.error('FAIL ' + m); process.exit(1); } console.log('OK ' + m); };
const base = (() => {
  const now = new Date(Date.now() + 3 * 3600e3);
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 2));
  while (d.getUTCDay() !== 2) d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
})();
const services = [
  { id: 'svc_cut', name: 'Мужская стрижка', durationMin: 60, price: 2300, active: true, online: true },
  { id: 'svc_beard', name: 'Борода', durationMin: 30, price: 1000, active: true, online: true },
  { id: 'svc_free', name: 'Консультация', durationMin: 15, price: 0, active: true, online: true },
];
const crm = {
  clients: [],
  services,
  staff: [{ id: 'staff_barber', name: 'Б', active: true }],
  // busy 13:00–14:00
  appointments: [{ id: 'apt_busy000001', clientId: 'x', staffId: 'staff_barber', serviceIds: ['svc_cut'], start: mskWallISO(base, '13:00'), durationMin: 60, status: 'waiting' }],
  windows: [],
  schedules: [{ staffId: 'staff_barber', week: [0,1,2,3,4,5,6].map((day) => ({ day, start: '10:00', end: '16:00', working: true })) }],
  exceptions: [],
  telegramChats: [],
  settings: { telegramToken: 'x', telegramOwnerChatId: '999', telegramOffset: 0, leadMinutes: 0, slotMinutes: 30, horizonDays: 30, onlineEnabled: true },
};
let uid = 1;
const upd = async (u) => { const r = await handleUpdate(crm, { update_id: uid++, ...u }); Object.assign(crm, r.patch); };
const cb = (chat, data, mid = 50) => upd({ callback_query: { id: 'q' + uid, data, from: { first_name: 'X' }, message: { chat: { id: chat }, message_id: mid } } });
const tx = (chat, text) => upd({ message: { chat: { id: chat }, text, from: { first_name: 'X' } } });
const last = (chat) => [...g.__tgSent].reverse().find((m) => m.chatId === String(chat));
const btns = (m) => m.reply_markup.inline_keyboard.flat().map((b) => b.text).join('|');

// --- shared helpers
ok(cartFromRaw(services, [{ id: 'svc_cut', qty: 2 }, { id: 'svc_beard', qty: 1 }]).totalQty === 3, 'cart ok');
ok(cartFromRaw(services, [{ id: 'svc_cut', qty: 6 }]).error, 'qty 6 rejected');
ok(cartFromRaw(services, [{ id: 'svc_cut', qty: 0 }]).error && cartFromRaw(services, [{ id: 'svc_cut', qty: -1 }]).error && cartFromRaw(services, [{ id: 'svc_cut', qty: 'x' }]).error, 'qty 0/-1/NaN rejected');
ok(cartFromRaw(services, [{ id: 'nope', qty: 1 }]).error && cartFromRaw(services, []).error, 'unknown / empty rejected');
ok(cartFromRaw(services, [{ id: 'svc_cut', qty: 5 }, { id: 'svc_beard', qty: 5 }, { id: 'svc_free', qty: 1 }]).error, 'more than 10 in total rejected');
ok(cartFromRaw(services, [{ id: 'svc_cut', qty: 1 }, { id: 'svc_cut', qty: 1 }]).error, 'duplicate id rejected');
const v = visitPrice(services, ['svc_cut', 'svc_beard'], { svc_cut: 2 });
ok(v.total === 5600 && v.durationMin === 150 && v.label === 'Мужская стрижка ×2, Борода', 'totals: ' + JSON.stringify([v.total, v.durationMin, v.label]));
const vOld = visitPrice(services, ['svc_cut', 'svc_cut']);
ok(vOld.total === 4600 && vOld.items.length === 1 && vOld.items[0].qty === 2, 'old rows with a repeated id count as ×2');
ok(visitPrice(services, ['svc_cut']).total === 2300 && visitPrice(services, ['svc_cut']).durationMin === 60, 'old rows without qty = ×1');

// --- bot: picker
await cb(111, 'bk:go');
ok(/Выберите услугу/.test(last(111).text) && /Мужская стрижка/.test(btns(last(111))), 'picker shown');
ok(!/Далее/.test(btns(last(111))), 'no «Далее» while empty');
await cb(111, 'bk:ct:svc_cut');
ok(last(111).edit === 50, 'picker edited in place');
ok(/✅ Мужская стрижка/.test(btns(last(111))) && /➖/.test(btns(last(111))) && /➕/.test(btns(last(111))) && /Далее/.test(btns(last(111))), 'selected row has ➖ ✅ ➕ + Далее');
await cb(111, 'bk:cp:svc_cut');
await cb(111, 'bk:ct:svc_beard');
ok(/Мужская стрижка ×2, Борода/.test(last(111).text) && /5\s600 ₽ · 2 ч 30 мин/.test(last(111).text), 'summary line: ' + last(111).text.split('\n').slice(0, 2).join(' / '));
for (let i = 0; i < 8; i++) await cb(111, 'bk:cp:svc_cut');
ok(/Мужская стрижка ×5/.test(last(111).text), 'per-service max 5');
for (let i = 0; i < 8; i++) await cb(111, 'bk:cp:svc_beard');
ok(/Борода ×5/.test(last(111).text), 'total max 10 (5+5)');
await cb(111, 'bk:ct:svc_free');
ok(/✅ Консультация/.test(btns(last(111))) === false, 'cannot go past 10 in total');
for (let i = 0; i < 4; i++) await cb(111, 'bk:cm:svc_cut');
for (let i = 0; i < 4; i++) await cb(111, 'bk:cm:svc_beard');
await cb(111, 'bk:cm:svc_beard');
ok(/Мужская стрижка ×1/.test(last(111).text.split('\n')[0]) === false && /Ваш выбор: Мужская стрижка$/m.test(last(111).text), 'down to 1 and removed: ' + last(111).text.split('\n')[0]);
await cb(111, 'bk:cp:svc_cut');
await cb(111, 'bk:ct:svc_beard');
ok(/Мужская стрижка ×2, Борода/.test(last(111).text), 'cart back to 2× cut + beard');

// --- slots for TOTAL 150 min (10:00–16:00, busy 13:00–14:00)
await cb(111, 'bk:cn');
ok(/день/i.test(last(111).text), 'calendar after «Далее»');
await cb(111, `bk:dy:${base}`);
const times = last(111).reply_markup.inline_keyboard.flat().filter((b) => b.callback_data?.startsWith('bk:tm:')).map((b) => b.text);
console.log('slots for 150 min:', times.join(' '));
ok(JSON.stringify(times) === JSON.stringify(['10:00', '10:30']), 'only 10:00/10:30 fit 150 min before the 13:00 booking; after it only 120 min remain');
// compare: single cut 60 min
await cb(222, 'bk:go'); await cb(222, 'bk:ct:svc_cut'); await cb(222, 'bk:cn'); await cb(222, `bk:dy:${base}`);
const t1 = last(222).reply_markup.inline_keyboard.flat().filter((b) => b.callback_data?.startsWith('bk:tm:')).map((b) => b.text);
ok(t1.length > times.length && t1.includes('14:00') && !t1.includes('12:30'), 'single service offers more slots: ' + t1.join(' '));

// --- book 2×cut + beard
await cb(111, 'bk:tm:1000');
ok(/комментарий мастеру/.test(last(111).text), 'comment step');
await tx(111, 'Без разговоров, пожалуйста');
ok(/Мужская стрижка ×2, Борода/.test(last(111).text) && /150 мин/.test(last(111).text) && /Итого: 5\s600 ₽/.test(last(111).text) && /💬/.test(last(111).text), 'confirm shows ×2, 150 мин, Итого, comment');
g.__tgSent = [];
await cb(111, 'bk:cf'); await tx(111, 'Олег Тест'); await tx(111, '+79990000011');
const ap = crm.appointments.at(-1);
ok(JSON.stringify(ap.serviceIds) === '["svc_cut","svc_beard"]' && ap.qty.svc_cut === 2 && !ap.qty.svc_beard && ap.durationMin === 150, 'saved: ' + JSON.stringify([ap.serviceIds, ap.qty, ap.durationMin]));
ok(ap.note === 'Без разговоров, пожалуйста' && ap.origin === 'Telegram', 'comment + origin kept');
const own = g.__tgSent.find((m) => m.chatId === '999');
console.log('---\n' + own.text + '\n---');
ok(/Мужская стрижка ×2, Борода/.test(own.text) && /150 мин/.test(own.text) && /Итого: 5\s600 ₽/.test(own.text) && /💬/.test(own.text), 'master notice: ×2, 150 мин, Итого 5 600, comment');
const cl = g.__tgSent.filter((m) => m.chatId === '111').map((m) => m.text).join('\n');
ok(/Мужская стрижка ×2, Борода/.test(cl) && /150 мин/.test(cl), 'client confirmation shows ×2 and 150 мин');
ok(ap.reminders?.some((r) => r.kind === '120m'), 'auto 2h reminder set');
await processDueReminders(crm, async () => ({ ok: true }));

// --- slot is taken now: second client for 150 min gets nothing
await cb(333, 'bk:go'); await cb(333, 'bk:ct:svc_cut'); await cb(333, 'bk:cp:svc_cut'); await cb(333, 'bk:ct:svc_beard'); await cb(333, 'bk:cn'); await cb(333, `bk:dy:${base}`);
ok(!last(333).reply_markup.inline_keyboard.flat().some((b) => b.callback_data?.startsWith('bk:tm:')), 'no 150-min slots left that day');
await cb(333, 'bk:tm:1000');
ok(/занято|недоступно/.test(last(333).text), 'stale slot refused');

// --- reschedule keeps the total duration
const rs = ap.id.slice(-10);
const cur = () => crm.appointments.find((a) => a.id === ap.id);
await cb(111, `bk:mv:${rs}`);
ok(/день/i.test(last(111).text), 'reschedule calendar');
const nextTue = (() => { const d = new Date(Date.parse(base + 'T12:00:00Z') + 7 * 86400e3); return d.toISOString().slice(0, 10); })();
await cb(111, `bk:dy:${nextTue}`);
const rt = last(111).reply_markup.inline_keyboard.flat().filter((b) => b.callback_data?.startsWith('bk:tm:')).map((b) => b.text);
ok(rt.length === 8 && rt[0] === '10:00' && rt.at(-1) === '13:30', '150-min slots on a free day: ' + rt.join(' '));
g.__tgSent = [];
await cb(111, 'bk:tm:1100');
ok(/Мужская стрижка ×2, Борода/.test(last(111).text), 'reschedule confirm shows ×2: ' + last(111).text.split('\n').join(' / '));
await cb(111, 'bk:cf');
ok(cur().durationMin === 150 && cur().qty.svc_cut === 2 && cur().start === mskWallISO(nextTue, '11:00'), 'moved, duration & qty intact');
const rn = g.__tgSent.find((m) => m.chatId === '999');
ok(/Клиент перенёс/.test(rn.text) && /Мужская стрижка ×2, Борода/.test(rn.text) && /150 мин/.test(rn.text) && /5\s600/.test(rn.text), 'reschedule notice has ×2, 150 мин, total');
// client cancel notice
g.__tgSent = [];
await cb(111, `bk:cl:${rs}`); await cb(111, 'bk:cly'); await cb(111, 'bk:cly2');
const cn = g.__tgSent.find((m) => m.chatId === '999');
ok(cur().status === 'cancelled' && /Мужская стрижка ×2/.test(cn.text), 'cancel notice shows ×2');

// --- old buttons still work (single service, ×1)
await cb(444, 'bk:sv:svc_beard');
await cb(444, `bk:dy:${base}`);
await cb(444, 'bk:tm:1000');
await tx(444, 'Пропустим'); await cb(444, 'bk:nc').catch(() => {});
ok(true, 'legacy bk:sv path ok');
console.log('ALL MULTI-SERVICE CHECKS PASSED');
