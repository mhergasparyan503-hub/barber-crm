import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { eachYmd } from './msk';
import type {
  Appointment,
  Client,
  CrmState,
  ScheduleException,
  Service,
  Settings,
  TimeWindow,
} from './types';
import { createSeedState, migrateState, uid } from './seed';

type Actions = {
  replaceSettings: (patch: Partial<Settings>) => void;
  addClient: (c: Omit<Client, 'id' | 'createdAt'> & { id?: string }) => string;
  updateClient: (id: string, patch: Partial<Client>) => void;
  deleteClient: (id: string) => void;
  addService: (s: Omit<Service, 'id'> & { id?: string }) => void;
  updateService: (id: string, patch: Partial<Service>) => void;
  deleteService: (id: string) => void;
  upsertAppointment: (a: Appointment) => void;
  deleteAppointment: (id: string) => void;
  moveAppointment: (id: string, start: string) => void;
  addWindow: (w: Omit<TimeWindow, 'id'> & { id?: string }) => void;
  deleteWindow: (id: string) => void;
  setWeekTemplate: (staffId: string, week: CrmState['schedules'][0]['week']) => void;
  applyExceptionRange: (
    staffId: string,
    from: string,
    to: string,
    ex: Omit<ScheduleException, 'id' | 'staffId' | 'date'>,
  ) => void;
  clearExceptionsRange: (staffId: string, from: string, to: string) => void;
  resetJournal: () => void;
  getSnapshot: () => CrmState;
  mergeTelegramPatch: (patch: Partial<CrmState>) => void;
};

export type Store = CrmState & Actions;

const seed = createSeedState();

export const useCrm = create<Store>()(
  persist(
    (set, get) => ({
      ...seed,
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
      upsertAppointment: (a) =>
        set((s) => {
          const exists = s.appointments.some((x) => x.id === a.id);
          const deletedAppointmentIds = (s.deletedAppointmentIds || []).filter((id) => id !== a.id);
          return {
            deletedAppointmentIds,
            appointments: exists
              ? s.appointments.map((x) => (x.id === a.id ? a : x))
              : [...s.appointments, a],
          };
        }),
      deleteAppointment: (id) =>
        set((s) => {
          const prev = s.deletedAppointmentIds || [];
          const deletedAppointmentIds = prev.includes(id)
            ? prev
            : [...prev, id].slice(-300);
          return {
            appointments: s.appointments.filter((x) => x.id !== id),
            deletedAppointmentIds,
          };
        }),
      moveAppointment: (id, start) =>
        set((s) => ({
          appointments: s.appointments.map((x) => (x.id === id ? { ...x, start } : x)),
        })),
      addWindow: (w) =>
        set((s) => ({ windows: [...s.windows, { ...w, id: w.id || uid('win') }] })),
      deleteWindow: (id) => set((s) => ({ windows: s.windows.filter((x) => x.id !== id) })),
      setWeekTemplate: (staffId, week) =>
        set((s) => {
          const has = s.schedules.some((sc) => sc.staffId === staffId);
          if (!has) return { schedules: [...s.schedules, { staffId, week }] };
          return {
            schedules: s.schedules.map((sc) => (sc.staffId === staffId ? { ...sc, week } : sc)),
          };
        }),
      applyExceptionRange: (staffId, from, to, ex) =>
        set((s) => {
          // Iterate YYYY-MM-DD as Moscow calendar strings — never parseISO/UTC midnight.
          const next = s.exceptions.filter(
            (e) => !(e.staffId === staffId && e.date >= from && e.date <= to),
          );
          for (const date of eachYmd(from, to)) {
            next.push({
              id: uid('ex'),
              staffId,
              date,
              ...ex,
            });
          }
          return { exceptions: next };
        }),
      clearExceptionsRange: (staffId, from, to) =>
        set((s) => ({
          exceptions: s.exceptions.filter(
            (e) => !(e.staffId === staffId && e.date >= from && e.date <= to),
          ),
        })),
      resetJournal: () => set({ appointments: [], windows: [], clients: get().clients }),
      getSnapshot: () => {
        const s = get();
        return {
          clients: s.clients,
          services: s.services,
          staff: s.staff,
          appointments: s.appointments,
          deletedAppointmentIds: s.deletedAppointmentIds || [],
          windows: s.windows,
          schedules: s.schedules,
          exceptions: s.exceptions,
          telegramChats: s.telegramChats || [],
          settings: s.settings,
        };
      },
      mergeTelegramPatch: (patch) =>
        set((s) => ({
          clients: patch.clients ?? s.clients,
          appointments: patch.appointments ?? s.appointments,
          deletedAppointmentIds: patch.deletedAppointmentIds ?? s.deletedAppointmentIds,
          telegramChats: patch.telegramChats ?? s.telegramChats,
          settings: patch.settings ? { ...s.settings, ...patch.settings } : s.settings,
        })),
    }),
    {
      name: 'barber-crm-v1',
      version: 8,
      migrate: (persisted) => migrateState(persisted as CrmState),
      partialize: (s) => ({
        clients: s.clients,
        services: s.services,
        staff: s.staff,
        appointments: s.appointments,
        deletedAppointmentIds: s.deletedAppointmentIds || [],
        windows: s.windows,
        schedules: s.schedules,
        exceptions: s.exceptions,
        telegramChats: s.telegramChats || [],
        settings: s.settings,
      }),
    },
  ),
);
