// Regression checks for the Sep-2026 QA fixes (no network: TG_SMOKE_CAPTURE).
process.env.TG_SMOKE_CAPTURE = '1';
const { handleUpdate } = await import('./telegram-inbox.ts');
const { mskWallISO } = await import('./msk.ts');
const { mergeIncoming, stampChanges, publicView } = await import('./crm-merge.ts');
const g = globalThis;
g.__tgSent = [];
const assert = (c, m) => { if (!c) throw new Error(m); };
const last = () => g.__tgSent[g.__tgSent.length - 1];
const base = (() => {
  const now = new Date(Date.now() + 3 * 3600e3);
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 2));
  while (d.getUTCDay() !== 1) d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
})();
const crm = {
  clients: [{ id: 'cli_a', name: 'А', phone: '+79990000001', telegramChatId: '111' }],
  services: [{ id: 'svc_cut', name: 'Стрижка', durationMin: 60, price: 1, active: true, online: true }],
  staff: [{ id: 'staff_barber', name: 'Б', active: true }],
  appointments: [],
  windows: [],
  schedules: [{ staffId: 'staff_barber', week: [0,1,2,3,4,5,6].map((day) => ({ day, start: '10:00', end: '21:00', working: true })) }],
  exceptions: [],
  telegramChats: [],
  settings: { telegramToken: 'x', telegramOwnerChatId: '999', telegramOffset: 0, leadMinutes: 0, slotMinutes: 30, horizonDays: 30, onlineEnabled: true },
};
const cb = async (chat, data, id) => {
  const r = await handleUpdate(crm, { update_id: id, callback_query: { id: 'q' + id, data, from: { first_name: 'X' }, message: { chat: { id: chat } } } });
  Object.assign(crm, r.patch);
};
// 1) slot taken between choice and confirm → refused, no double booking
await cb(111, 'bk:sv:svc_cut', 1);
await cb(111, `bk:dy:${base}`, 2);
await cb(111, 'bk:tm:1000', 3);
crm.appointments.push({ id: 'apt_web1', clientId: 'x', staffId: 'staff_barber', serviceIds: [], start: mskWallISO(base, '10:00'), durationMin: 60, status: 'waiting' });
await cb(111, 'bk:cf', 4);
assert(crm.appointments.length === 1, 'double booking prevented');
assert(/занято/.test(last().text), 'busy message: ' + last().text);
console.log('OK slot re-check at confirm');
// 2) stale time button
await cb(111, 'bk:tm:1030', 5);
assert(/занято/.test(last().text), 'stale busy time refused');
console.log('OK stale time button refused');
// 3) reschedule uses real visit duration (120) and shifts reminders
crm.appointments = [{ id: 'apt_long0001', clientId: 'cli_a', staffId: 'staff_barber', serviceIds: ['svc_cut'], start: mskWallISO(base, '12:00'), durationMin: 120, status: 'waiting', telegramChatId: '111',
  reminders: [{ at: new Date(new Date(mskWallISO(base, '12:00')).getTime() - 3600e3).toISOString(), kind: '60m', sent: false }] },
  { id: 'apt_other001', clientId: 'x', staffId: 'staff_barber', serviceIds: [], start: mskWallISO(base, '16:00'), durationMin: 60, status: 'waiting' }];
await cb(111, 'bk:mv:ong0001', 6);
await cb(111, `bk:dy:${base}`, 7);
const times = last().reply_markup.inline_keyboard.flat().map((b) => b.text);
assert(!times.includes('15:00') && !times.includes('14:30') && times.includes('14:00'), 'reschedule slots respect 120 min: ' + times.join(','));
await cb(111, 'bk:tm:1800', 8);
await cb(111, 'bk:cf', 9);
const moved = crm.appointments.find((a) => a.id === 'apt_long0001');
assert(moved.start === mskWallISO(base, '18:00'), 'moved');
assert(moved.reminders[0].at === new Date(new Date(mskWallISO(base, '18:00')).getTime() - 3600e3).toISOString(), 'reminder shifted');
console.log('OK reschedule duration + reminder shift');
// 4) confirm on cancelled visit does not resurrect it
moved.status = 'cancelled';
await cb(111, 'ok:v_apt_long0001', 10);
assert(moved.status === 'cancelled' && /отменена/.test(last().text), 'no resurrect');
console.log('OK confirm on cancelled visit');
// 5) /start owner from stranger refused
const r5 = await handleUpdate(crm, { update_id: 11, message: { chat: { id: 777 }, text: '/start owner', from: { first_name: 'Evil' } } });
Object.assign(crm, r5.patch);
assert(crm.settings.telegramOwnerChatId === '999', 'owner not hijacked');
console.log('OK owner hijack refused');
// 6) merge: browser flush keeps bot booking, drafts, cancels, sent flags; tombstone deletes
const prev = JSON.parse(JSON.stringify(crm));
prev.settings._draft = { 999: { ownerBook: true } };
prev.appointments = [
  { id: 'a_bot', status: 'waiting', start: 'x', updatedAt: '2026-01-02' },
  { id: 'a_cancel', status: 'cancelled', start: 'x', updatedAt: '2026-01-03', reminders: [{ at: 't', kind: '60m', sent: true }] },
  { id: 'a_del', status: 'waiting', start: 'x' },
];
prev.exceptions = [{ id: 'e1', date: base, type: 'off' }];
prev.exceptionsUpdatedAt = '2026-01-05';
const inc = { ...JSON.parse(JSON.stringify(prev)), settings: { ...prev.settings, _draft: undefined, telegramToken: '' },
  appointments: [{ id: 'a_cancel', status: 'waiting', start: 'x', updatedAt: '2026-01-01', reminders: [{ at: 't', kind: '60m', sent: false }] }, { id: 'a_web', status: 'waiting', start: 'y' }],
  deletedAppointmentIds: ['a_del'], exceptions: [], exceptionsUpdatedAt: '2026-01-01' };
const m = mergeIncoming(prev, inc);
const ids = m.appointments.map((a) => a.id).sort().join(',');
assert(ids === 'a_bot,a_cancel,a_web', 'merge ids ' + ids);
assert(m.appointments.find((a) => a.id === 'a_cancel').status === 'cancelled', 'cancel kept');
assert(m.appointments.find((a) => a.id === 'a_cancel').reminders[0].sent === true, 'sent kept');
assert(m.settings._draft?.[999]?.ownerBook && m.settings.telegramToken === 'x', 'drafts/token kept');
assert(m.exceptions.length === 1, 'bot exception kept');
const stamped = stampChanges({ appointments: [{ id: 'z', s: 1 }], clients: [] }, { appointments: [{ id: 'z', s: 2 }], clients: [] });
assert(stamped.appointments[0].updatedAt, 'stamp');
const pv = publicView(crm);
assert(!pv.settings.telegramToken && !pv.clients.length && pv.appointments.every((a) => !a.clientId), 'public view clean');
console.log('OK merge / stamp / public view');
console.log('\nALL FIX CHECKS PASSED');
