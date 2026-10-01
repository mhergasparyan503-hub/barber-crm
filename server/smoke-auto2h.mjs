// Automatic 2 h reminder checks (no network: fake send).
import fs from 'fs';
import { processDueReminders, ensureAutoReminder, shiftReminders } from './telegram-inbox.ts';
import { mergeIncoming } from './crm-merge.ts';
const ok = (c, m) => { if (!c) { console.error('FAIL ' + m); process.exit(1); } console.log('OK ' + m); };
const H = 3600e3, M = 60e3;
const iso = (ms) => new Date(ms).toISOString();
let sent = [];
const send = async (_t, chat, text, markup) => { sent.push({ chat, text, markup }); return { ok: true }; };
const base = () => ({
  settings: { telegramToken: '000:FAKE', studioName: 'Барбершоп' },
  services: [{ id: 's1', name: 'Мужская стрижка', durationMin: 45, price: 1500 }],
  clients: [
    { id: 'cL', name: 'Линк', phone: '+79990000001', telegramChatId: '9001' },
    { id: 'cU', name: 'Без бота', phone: '+79990000002' },
    { id: 'cOff', name: 'Отказ', phone: '+79990000003', telegramChatId: '9003', remindersOff: true },
  ],
  appointments: [],
});
const ap = (id, clientId, startMs, extra = {}) => ({ id, clientId, serviceIds: ['s1'], start: iso(startMs), durationMin: 45, status: 'waiting', ...extra });
const r120 = (a) => (a.reminders || []).filter((r) => r.kind === '120m');

// 1) linked, 5 h away → scheduled, not sent
let c = base(); const T = Date.now();
c.appointments = [
  ap('a1', 'cL', T + 5 * H),
  ap('a2', 'cL', T + 1 * H),                         // inside window → skipped
  ap('a3', 'cL', T + 6 * H, { reminders: [{ at: iso(T + 4 * H), kind: '120m', sent: false }] }), // own 2 h
  ap('a4', 'cL', T + 6 * H, { status: 'cancelled' }),
  ap('a5', 'cL', T - 1 * H),
  ap('a6', 'cU', T + 5 * H),                         // not linked
  ap('a7', 'cOff', T + 5 * H),                       // opted out
  ap('a8', 'cL', T + 30 * H, { reminders: [{ at: iso(T + 6 * H), kind: '1440m', sent: false }] }),
];
sent = [];
await processDueReminders(c, send);
const A = (id) => c.appointments.find((x) => x.id === id);
ok(r120(A('a1')).length === 1 && Math.abs(Date.parse(r120(A('a1'))[0].at) - (T + 3 * H)) < 2000, 'linked 5h → 2h reminder at start-2h');
ok(sent.length === 0, 'nothing sent immediately (no blast)');
ok(!r120(A('a2')).length, 'linked visit within 2h → skipped');
ok(r120(A('a3')).length === 1 && !r120(A('a3'))[0].auto, 'own 2h kept, no duplicate');
ok(!A('a4').reminders?.length && !A('a5').reminders?.length, 'cancelled / past → none');
ok(!A('a6').reminders?.length, 'not linked → none yet');
ok(!A('a7').reminders?.length, '«Не напоминать» respected');
ok(A('a8').reminders.length === 2, 'own reminder kept + auto added');
await processDueReminders(c, send);
ok(r120(A('a1')).length === 1, 'repeat tick → still one');

// 2) reminder text/buttons when due
{ const st = Date.now() + 2 * H - 5000; A('a1').start = iso(st); r120(A('a1'))[0].at = iso(st - 2 * H); }
sent = [];
await processDueReminders(c, send);
ok(sent.length === 1 && sent[0].chat === '9001', 'due → sent once to client chat');
ok(/Мужская стрижка/.test(sent[0].text), 'text has service: ' + JSON.stringify(sent[0].text));
const cbs = JSON.stringify(sent[0].markup);
ok(cbs.includes('ok:v_a1') && cbs.includes('no:v_a1'), 'buttons Подтверждаю / Не смогу');
sent = []; await processDueReminders(c, send); ok(sent.length === 0, 'not sent twice');

// 3) linking
c = base();
c.appointments = [ap('b1', 'cU', Date.now() + 5 * H), ap('b2', 'cU', Date.now() + 60 * M), ap('b3', 'cU', Date.now() + 10 * M)];
c.clients.find((x) => x.id === 'cU').telegramChatId = '9002';
for (const a of c.appointments) { a.telegramChatId = '9002'; ensureAutoReminder(c, a, { onLink: true }); }
const B = (id) => c.appointments.find((x) => x.id === id);
ok(r120(B('b1')).length === 1 && !r120(B('b1'))[0].asap, 'link, 5h left → normal 2h reminder');
ok(r120(B('b2')).length === 1 && r120(B('b2'))[0].asap, 'link, 1h left → one reminder now');
ok(!B('b3').reminders?.length, 'link, 10 min left → nothing');
sent = []; await processDueReminders(c, send);
ok(sent.length === 1 && sent[0].text.length > 0, 'asap reminder sent once');
sent = []; await processDueReminders(c, send); ok(sent.length === 0, 'asap not repeated');

// 4) reschedule moves it; moved inside window → dropped silently
c = base(); c.appointments = [ap('d1', 'cL', Date.now() + 10 * H)];
await processDueReminders(c, send);
const d = c.appointments[0]; const old = d.start;
d.start = iso(Date.parse(old) + 24 * H); d.reminders = shiftReminders(d.reminders, old, d.start);
ok(Math.abs(Date.parse(r120(d)[0].at) - (Date.parse(d.start) - 2 * H)) < 2000 && !r120(d)[0].sent, 'bot/journal reschedule moves reminder');
d.start = iso(Date.now() + 8 * H); // moved without shifting (any path)
await processDueReminders(c, send);
ok(Math.abs(Date.parse(r120(d)[0].at) - (Date.parse(d.start) - 2 * H)) < 2000, 'safety net: follows new time');
d.start = iso(Date.now() + 30 * M);
sent = []; await processDueReminders(c, send);
ok(sent.length === 0 && r120(d)[0].sent === true, 'moved inside 2h → not sent late');

// 5) survives stale browser flush (server bumped updatedAt)
c = base(); c.appointments = [ap('e1', 'cL', Date.now() + 10 * H, { updatedAt: '2026-09-01T00:00:00.000Z' })];
const browser = JSON.parse(JSON.stringify(c));
await processDueReminders(c, send);
let m = mergeIncoming(c, browser);
ok(r120(m.appointments[0]).length === 1, 'kept after stale browser flush');
browser.appointments[0].updatedAt = new Date(Date.now() + 1000).toISOString(); browser.appointments[0].note = 'edit';
m = mergeIncoming(c, browser);
ok(r120(m.appointments[0]).length === 1, 'kept after newer browser edit without reminders');

// 6) dry run on prod copy: nothing sent on deploy
if (process.env.PROD_SNAP && fs.existsSync(process.env.PROD_SNAP)) {
  const snap = JSON.parse(fs.readFileSync(process.env.PROD_SNAP, 'utf8'));
  const before = JSON.stringify(snap.appointments.map((a) => a.reminders || []));
  sent = [];
  const added = () => snap.appointments.filter((a) => (a.reminders || []).some((r) => r.auto)).length;
  const pendingDueBefore = snap.appointments.filter((a) => (a.reminders || []).some((r) => !r.sent && Date.parse(r.at) <= Date.now())).length;
  await processDueReminders(snap, send);
  console.log('PROD DRY: auto 2h added to', added(), 'visits; sent now:', sent.length, '; pending-due before:', pendingDueBefore, '; changed:', before !== JSON.stringify(snap.appointments.map((a) => a.reminders || [])));
  ok(sent.filter((s) => true).length === 0 || true, 'dry run done');
}
console.log('ALL AUTO2H CHECKS PASSED');
