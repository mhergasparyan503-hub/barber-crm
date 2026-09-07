import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type {
  Appointment,
  Client,
  CrmState,
  ScheduleException,
  Service,
  Settings,
  Staff,
  TimeWindow,
} from './types';
import { createSeedState, toBarberShop, uid } from './seed';

type Actions = {
  hydrateMerge: (remote: Partial<CrmState> | null) => void;
  replaceSettings: (patch: Partial<Settings>) => void;
  addClient: (c: Omit<Client, 'id' | 'createdAt'> & { id?: string }) => string;
  updateClient: (id: string, patch: Partial<Client>) => void;
  deleteClient: (id: string) => void;
  addService: (s: Omit<Service, 'id'> & { id?: string }) => void;
  updateService: (id: string, patch: Partial<Service>) => void;
  deleteService: (id: string) => void;
  addStaff: (s: Omit<Staff, 'id'> & { id?: string }) => void;
  updateStaff: (id: string, patch: Partial<Staff>) => void;
  deleteStaff: (id: string) => void;
  upsertAppointment: (a: Appointment) => void;
  deleteAppointment: (id: string) => void;
  moveAppointment: (id: string, start: string, staffId?: string) => void;
  addWindow: (w: Omit<TimeWindow, 'id'> & { id?: string }) => void;
  deleteWindow: (id: string) => void;
  setWeekTemplate: (staffId: string, week: CrmState['schedules'][0]['week']) => void;
  setExceptions: (list: ScheduleException[]) => void;
  applyExceptionRange: (
    staffId: string,
    from: string,
    to: string,
    ex: Omit<ScheduleException, 'id' | 'staffId' | 'date'>,
  ) => void;
  clearExceptionsRange: (staffId: string, from: string, to: string) => void;
  mergeTelegramPatch: (patch: Partial<CrmState>) => void;
  getSnapshot: () => CrmState;
};

export type Store = CrmState & Actions;

const seed = createSeedState();

function richer(a: CrmState, b: CrmState): CrmState {
  const aScore =
    (a.settings?.telegramToken ? 10 : 0) +
    (a.telegramChats?.length || 0) +
    (a.appointments?.length || 0) +
    (a.clients?.length || 0);
  const bScore =
    (b.settings?.telegramToken ? 10 : 0) +
    (b.telegramChats?.length || 0) +
    (b.appointments?.length || 0) +
    (b.clients?.length || 0);
  return bScore > aScore ? b : a;
}

export const useCrm = create<Store>()(
  persist(
    (set, get) => ({
      ...seed,
      hydrateMerge: (remote) => {
        if (!remote) return;
        const local = get().getSnapshot();
        const merged = toBarberShop(richer(local, { ...seed, ...remote, settings: { ...seed.settings, ...remote.settings } } as CrmState));
        set({
          clients: merged.clients,
          services: merged.services,
          staff: merged.staff,
          appointments: merged.appointments,
          windows: merged.windows,
          schedules: merged.schedules,
          exceptions: merged.exceptions,
          telegramChats: merged.telegramChats,
          settings: merged.settings,
        });
      },
      replaceSettings: (patch) => set((s) => ({ settings: { ...s.settings, ...patch } })),
      addClient: (c) => {
        const id = c.id || uid('cli');
        set((s) => ({
          clients: [...s.clients, { ...c, id, createdAt: new Date().toISOString() }],
        }));
        return id;
      },
      updateClient: (id, patch) =>
        set((s) => ({ clients: s.clients.map((c) => (c.id === id ? { ...c, ...patch } : c)) })),
      deleteClient: (id) =>
        set((s) => ({
          clients: s.clients.filter((c) => c.id !== id),
          appointments: s.appointments.filter(
            (a) => !(a.clientId === id && new Date(a.start) >= new Date()),
          ),
        })),
      addService: (svc) =>
        set((s) => ({ services: [...s.services, { ...svc, id: svc.id || uid('svc') }] })),
      updateService: (id, patch) =>
        set((s) => ({ services: s.services.map((x) => (x.id === id ? { ...x, ...patch } : x)) })),
      deleteService: (id) => set((s) => ({ services: s.services.filter((x) => x.id !== id) })),
      addStaff: (st) => {
        set((s) => {
          const id = st.id || uid('staff');
          const week = seed.schedules[0].week.map((d) => ({ ...d }));
          return {
            staff: [...s.staff, { ...st, id }],
            schedules: [...s.schedules, { staffId: id, week }],
            settings: { ...s.settings, soloMode: s.staff.length + 1 <= 1 },
          };
        });
      },
      updateStaff: (id, patch) =>
        set((s) => ({ staff: s.staff.map((x) => (x.id === id ? { ...x, ...patch } : x)) })),
      deleteStaff: (id) =>
        set((s) => ({
          staff: s.staff.filter((x) => x.id !== id),
          schedules: s.schedules.filter((x) => x.staffId !== id),
          settings: { ...s.settings, soloMode: s.staff.filter((x) => x.id !== id).length <= 1 },
        })),
      upsertAppointment: (a) =>
        set((s) => {
          const exists = s.appointments.some((x) => x.id === a.id);
          return {
            appointments: exists
              ? s.appointments.map((x) => (x.id === a.id ? a : x))
              : [...s.appointments, a],
          };
        }),
      deleteAppointment: (id) =>
        set((s) => ({ appointments: s.appointments.filter((x) => x.id !== id) })),
      moveAppointment: (id, start, staffId) =>
        set((s) => ({
          appointments: s.appointments.map((x) =>
            x.id === id ? { ...x, start, staffId: staffId || x.staffId } : x,
          ),
        })),
      addWindow: (w) =>
        set((s) => ({ windows: [...s.windows, { ...w, id: w.id || uid('win') }] })),
      deleteWindow: (id) => set((s) => ({ windows: s.windows.filter((x) => x.id !== id) })),
      setWeekTemplate: (staffId, week) =>
        set((s) => ({
          schedules: s.schedules.map((sc) => (sc.staffId === staffId ? { ...sc, week } : sc)),
        })),
      setExceptions: (list) => set({ exceptions: list }),
      applyExceptionRange: (staffId, from, to, ex) =>
        set((s) => {
          const start = new Date(from + 'T12:00:00');
          const end = new Date(to + 'T12:00:00');
          const next = s.exceptions.filter(
            (e) => !(e.staffId === staffId && e.date >= from && e.date <= to),
          );
          for (let d = new Date(start), i = 0; d <= end && i < 366; d.setDate(d.getDate() + 1), i++) {
            const date = d.toISOString().slice(0, 10);
            next.push({ ...ex, id: uid('ex'), staffId, date });
          }
          return { exceptions: next };
        }),
      clearExceptionsRange: (staffId, from, to) =>
        set((s) => ({
          exceptions: s.exceptions.filter(
            (e) => !(e.staffId === staffId && e.date >= from && e.date <= to),
          ),
        })),
      mergeTelegramPatch: (patch) =>
        set((s) => ({
          clients: patch.clients
            ? mergeById(s.clients, patch.clients)
            : s.clients,
          appointments: patch.appointments
            ? mergeById(s.appointments, patch.appointments)
            : s.appointments,
          telegramChats: patch.telegramChats
            ? mergeById(s.telegramChats.map((t) => ({ ...t, id: t.chatId })), patch.telegramChats.map((t) => ({ ...t, id: t.chatId }))).map(({ id, ...rest }) => rest as typeof s.telegramChats[0])
            : s.telegramChats,
          settings: patch.settings
            ? {
                ...s.settings,
                telegramOwnerChatId:
                  patch.settings.telegramOwnerChatId || s.settings.telegramOwnerChatId,
                telegramBotUsername:
                  patch.settings.telegramBotUsername || s.settings.telegramBotUsername,
                telegramOffset:
                  patch.settings.telegramOffset ?? s.settings.telegramOffset,
                // never wipe token/schedule from bot patch
                telegramToken: s.settings.telegramToken || patch.settings.telegramToken || '',
              }
            : s.settings,
        })),
      getSnapshot: () => {
        const s = get();
        return {
          clients: s.clients,
          services: s.services,
          staff: s.staff,
          appointments: s.appointments,
          windows: s.windows,
          schedules: s.schedules,
          exceptions: s.exceptions,
          telegramChats: s.telegramChats,
          settings: s.settings,
        };
      },
    }),
    { name: 'barber-crm-v1', version: 5 },
  ),
);

function mergeById<T extends { id: string }>(local: T[], remote: T[]): T[] {
  const map = new Map(local.map((x) => [x.id, x]));
  for (const r of remote) map.set(r.id, { ...map.get(r.id), ...r });
  return [...map.values()];
}
