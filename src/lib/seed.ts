import type { CrmState, DaySchedule } from './types';

export const STAFF_ID = 'staff_barber';

const defaultWeek = (): DaySchedule[] =>
  [0, 1, 2, 3, 4, 5, 6].map((day) => ({
    day,
    start: '10:00',
    end: '21:00',
    working: day >= 1 && day <= 6,
  }));

export function createSeedState(): CrmState {
  const services = [
    { id: 'svc_cut', name: 'Мужская стрижка', durationMin: 45, price: 1800, category: 'Стрижка', active: true, online: true },
    { id: 'svc_machine', name: 'Стрижка машинкой', durationMin: 30, price: 1200, category: 'Стрижка', active: true, online: true },
    { id: 'svc_fade', name: 'Фейд / модельная', durationMin: 50, price: 2200, category: 'Стрижка', active: true, online: true },
    { id: 'svc_kids', name: 'Детская стрижка', durationMin: 30, price: 1400, category: 'Детское', active: true, online: true },
    { id: 'svc_beard', name: 'Моделирование бороды', durationMin: 30, price: 1200, category: 'Борода', active: true, online: true },
    { id: 'svc_combo', name: 'Стрижка + борода', durationMin: 70, price: 2800, category: 'Стрижка', active: true, online: true },
    { id: 'svc_shave', name: 'Королевское бритьё', durationMin: 45, price: 2000, category: 'Бритьё', active: true, online: true },
    { id: 'svc_camo', name: 'Камуфляж седины', durationMin: 25, price: 1500, category: 'Уход', active: true, online: true },
    { id: 'svc_style', name: 'Укладка', durationMin: 20, price: 800, category: 'Уход', active: true, online: true },
    { id: 'svc_wax', name: 'Воск / брови', durationMin: 15, price: 600, category: 'Другое', active: true, online: true },
  ];

  return {
    clients: [],
    services,
    staff: [{ id: STAFF_ID, name: 'Барбер', color: '#6b7280', active: true }],
    appointments: [],
    windows: [],
    schedules: [{ staffId: STAFF_ID, week: defaultWeek() }],
    exceptions: [],
    telegramChats: [],
    settings: {
      dataVersion: 5,
      studioName: 'Барбершоп',
      subtitle: 'Запись к барберу',
      phone: '',
      address: '',
      soloMode: true,
      onlineEnabled: true,
      leadMinutes: 30,
      horizonDays: 14,
      slotMinutes: 15,
      visitColor: '#6b7280',
      onlineColor: '#6b7280',
      telegramToken: '',
      telegramBotUsername: '',
      telegramOwnerChatId: '',
      telegramOffset: 0,
      messageTemplates: {
        booked: '{studio}\n\nВы записаны.\n\n{service}\n{weekday}, {date} в {time}\n{duration}\n\nЕсли планы изменятся — перенесите или отмените кнопками ниже.',
        reminder: '{name}, напоминание.\n\n{when} запись в {studio}:\n{service}\n{weekday}, {date} в {time}\n\nПодтвердите визит, пожалуйста.',
      },
      studioReminders: { dayBefore: true, hoursBefore: 2 },
      onlineServiceIds: services.map((s) => s.id),
    },
  };
}

export function toBarberShop(state: CrmState): CrmState {
  if ((state.settings?.dataVersion ?? 0) >= 5) return state;
  const seed = createSeedState();
  return {
    ...seed,
    settings: {
      ...seed.settings,
      telegramToken: state.settings?.telegramToken || '',
      telegramBotUsername: state.settings?.telegramBotUsername || '',
      telegramOwnerChatId: state.settings?.telegramOwnerChatId || '',
      telegramOffset: state.settings?.telegramOffset || 0,
      phone: state.settings?.phone || '',
      address: state.settings?.address || '',
      studioName: state.settings?.studioName || seed.settings.studioName,
    },
    telegramChats: state.telegramChats || [],
    clients: [],
    appointments: [],
  };
}

export function uid(prefix = 'id'): string {
  return prefix + '_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}
