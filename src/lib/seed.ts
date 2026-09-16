import type { CrmState, DaySchedule } from './types';

export const STAFF_ID = 'staff_barber';
export const DATA_VERSION = 8;

const defaultWeek = (): DaySchedule[] =>
  [0, 1, 2, 3, 4, 5, 6].map((day) => ({
    day,
    start: '10:00',
    end: '21:00',
    working: day >= 1 && day <= 6,
  }));

function telegramDefaults(from?: Partial<CrmState['settings']>) {
  return {
    telegramToken: from?.telegramToken || '',
    telegramBotUsername: from?.telegramBotUsername || '',
    telegramOwnerChatId: from?.telegramOwnerChatId || '',
    telegramOffset: typeof from?.telegramOffset === 'number' ? from.telegramOffset : 0,
  };
}

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
      dataVersion: DATA_VERSION,
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
      onlineServiceIds: services.map((s) => s.id),
      messageTemplates: {
        booked:
          '{studio}\n\nВы записаны.\n\n{service}\n{date} в {time}\n{duration}\n\nЕсли планы изменятся — перенесите или отмените кнопками ниже.',
        reminder: 'Напоминание\n{studio}\n{name}, жду вас\n{service}\n{date} в {time}',
      },
      ...telegramDefaults(),
    },
  };
}

export function migrateState(state: CrmState): CrmState {
  const seed = createSeedState();
  const prev = state?.settings || ({} as CrmState['settings']);

  // Soft-fill telegram fields even when already at current version (PIN/data untouched)
  if ((prev.dataVersion ?? 0) >= DATA_VERSION) {
    return {
      ...state,
      telegramChats: state.telegramChats || [],
      settings: {
        ...prev,
        ...telegramDefaults(prev),
        messageTemplates: prev.messageTemplates || seed.settings.messageTemplates,
        dataVersion: DATA_VERSION,
      },
    };
  }

  return {
    ...seed,
    clients: state.clients || [],
    appointments: (state.appointments || []).map((a) => ({
      ...a,
      status: a.status === 'cancelled' ? 'cancelled' : 'waiting',
      source:
        a.source === 'online' || a.source === 'telegram' ? a.source : 'journal',
    })),
    windows: state.windows || [],
    schedules: state.schedules?.length ? state.schedules : seed.schedules,
    exceptions: state.exceptions || [],
    telegramChats: state.telegramChats || [],
    services: state.services?.length ? state.services : seed.services,
    staff: state.staff?.length ? state.staff : seed.staff,
    settings: {
      ...seed.settings,
      phone: prev.phone || '',
      address: prev.address || '',
      studioName: prev.studioName || seed.settings.studioName,
      subtitle: prev.subtitle || seed.settings.subtitle,
      soloMode: prev.soloMode ?? true,
      onlineEnabled: prev.onlineEnabled ?? true,
      leadMinutes: prev.leadMinutes ?? 30,
      horizonDays: prev.horizonDays ?? 14,
      slotMinutes: prev.slotMinutes ?? 15,
      visitColor: prev.visitColor || '#6b7280',
      onlineColor: prev.onlineColor || '#6b7280',
      onlineServiceIds: prev.onlineServiceIds || seed.settings.onlineServiceIds,
      ...telegramDefaults(prev),
      dataVersion: DATA_VERSION,
    },
  };
}

export function uid(prefix = 'id'): string {
  return prefix + '_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}
