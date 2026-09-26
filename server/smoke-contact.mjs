process.env.TG_SMOKE_CAPTURE = '1';
const { handleUpdate, processDueReminders } = await import('./telegram-inbox.ts');
const g = globalThis; g.__tgSent = [];
const start = new Date(Date.now() + 2 * 864e5).toISOString();
const crm = {
  clients: [
    { id: 'cli_v', name: 'Вячеслав', phone: '+79161234565' },
    { id: 'cli_other', name: 'Другой', phone: '+79990001122' },
  ],
  services: [{ id: 'svc_cut', name: 'Мужская стрижка', price: 1800, durationMin: 60, active: true, online: true }],
  staff: [{ id: 'staff_barber', name: 'Барбер', active: true }],
  appointments: [
    { id: 'apt_v1', clientId: 'cli_v', staffId: 'staff_barber', serviceIds: ['svc_cut'], start, durationMin: 60, status: 'waiting', source: 'journal', reminders: [{ at: new Date(Date.now() - 1000).toISOString(), kind: 'custom_1', sent: false }] },
    { id: 'apt_o1', clientId: 'cli_other', staffId: 'staff_barber', serviceIds: ['svc_cut'], start, durationMin: 60, status: 'waiting', source: 'journal' },
  ],
  windows: [], schedules: [{ staffId: 'staff_barber', week: [0,1,2,3,4,5,6].map((day) => ({ day, start: '10:00', end: '21:00', working: true })) }],
  exceptions: [], telegramChats: [],
  settings: { studioName: 'Т', telegramToken: '000:SMOKE', telegramOwnerChatId: '999', telegramOffset: 0, leadMinutes: 0, slotMinutes: 30, telegramBotUsername: 'TestBot' },
};
const ok = (c, m) => { if (!c) { console.error('FAIL', m, JSON.stringify(g.__tgSent.slice(-2))); process.exit(1); } console.log('OK', m); };
const last = () => g.__tgSent[g.__tgSent.length - 1];
let id = 1;
const up = async (message) => { const r = await handleUpdate(crm, { update_id: id++, message: { chat: { id: 555 }, from: { id: 555, first_name: 'V' }, ...message } }); Object.assign(crm, r.patch); };
await up({ text: '/start' });
ok(last().reply_markup.keyboard.flat().some((b) => b.request_contact), 'unlinked /start shows share-phone button');
ok(/Поделиться номером/.test(last().text), 'welcome hints share phone');
await up({ text: '📋 Мои записи' });
ok(/Поделиться номером/.test(last().text), 'Мои записи unlinked → asks phone');
await up({ contact: { phone_number: '79161234565', user_id: 777 } });
ok(/свой номер/.test(last().text) && !crm.clients[0].telegramChatId, 'foreign contact refused');
await up({ contact: { phone_number: '+7 (999) 000-11-22'.replace(/\D/g, ''), user_id: 555 } });
ok(crm.clients[1].telegramChatId === '555', 'own contact links matched client (other)');
// reset: test Вячеслав with 8-prefix
crm.clients[1].telegramChatId = undefined; crm.appointments[1].telegramChatId = undefined;
await up({ contact: { phone_number: '89161234565', user_id: 555 } });
ok(crm.clients[0].telegramChatId === '555', '8-prefix phone links Вячеслав');
ok(crm.appointments[0].telegramChatId === '555', 'upcoming visit gets chat for reminders');
ok(/Ваши записи/.test(last().text) && !/Другой/.test(last().text), 'shows his appointments only');
ok(crm.clients.length === 2, 'no duplicate clients');
await up({ text: '📋 Мои записи' });
ok(/Ваши записи/.test(last().text) && last().text.split('•').length === 2, 'Мои записи lists exactly his visit');
g.__tgSent = [];
const r = await processDueReminders(crm); if (r?.patch) Object.assign(crm, r.patch);
ok(g.__tgSent.some((m) => String(m.chatId) === '555'), 'reminder delivered to linked chat');
// v_ deep link for a new chat
g.__tgSent = [];
const r2 = await handleUpdate(crm, { update_id: id++, message: { chat: { id: 666 }, from: { id: 666 }, text: '/start v_apt_o1' } }); Object.assign(crm, r2.patch);
ok(crm.clients[1].telegramChatId === '666' && crm.appointments[1].telegramChatId === '666', 'v_ deep link links client + visit');
console.log('ALL CONTACT CHECKS PASSED');
