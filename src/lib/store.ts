import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { eachYmd, morningReminderAt, parseApStart } from './msk';
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
const nowIso = () => new Date().toISOString();

/** Keep reminders relative to the visit when its time changes. */
function shiftReminders(list: Appointment['reminders'], oldStart: string, newStart: string) {
  if (!list?.length) return list;
  const delta = parseApStart(newStart).getTime() - parseApStart(oldStart).getTime();
  if (!Number.isFinite(delta) || delta === 0) return list;
  const now = Date.now();
  return list.map((r) => {
    const at =
      r.kind === 'morning'
        ? morningReminderAt(newStart)
        : new Date(new Date(r.at).getTime() + delta).toISOString();
    return { ...r, at, sent: new Date(at).getTime() <= now };
  });
}

export const useCrm = create<Store>()(
  persist(
    (set, get) => ({
      ...seed,
      replaceSettings: (patch) => set((s) => ({ settings: { ...s.settings, ...patch } })),
      addClient: (c) => {
        const id = c.id || uid('cli');
        set((s) => ({
          clients: [...s.clients, { ...c, id, createdAt: nowIso(), updatedAt: nowIso() }],
        }));
        return id;
      },
      updateClient: (id, patch) =>
        set((s) => ({
          clients: s.clients.map((c) => (c.id === id ? { ...c, ...patch, updatedAt: nowIso() } : c)),
        })),
      deleteClient: (id) =>
        set((s) => {
          const removed = s.appointments
            .filter((a) => a.clientId === id && parseApStart(a.start) >= new Date())
            .map((a) => a.id);
          return {
            clients: s.clients.filter((c) => c.id !== id),
            appointments: s.appointments.filter((a) => !removed.includes(a.id)),
            deletedAppointmentIds: [...(s.deletedAppointmentIds || []), ...removed].slice(-300),
            deletedClientIds: [...(s.deletedClientIds || []).filter((x) => x !== id), id].slice(-300),
          };
        }),
      addService: (svc) =>
        set((s) => ({ services: [...s.services, { ...svc, id: svc.id || uid('svc') }] })),
      updateService: (id, patch) =>
        set((s) => ({ services: s.services.map((x) => (x.id === id ? { ...x, ...patch } : x)) })),
      deleteService: (id) => set((s) => ({ services: s.services.filter((x) => x.id !== id) })),
      upsertAppointment: (a) =>
        set((s) => {
          const prev = s.appointments.find((x) => x.id === a.id);
          const deletedAppointmentIds = (s.deletedAppointmentIds || []).filter((id) => id !== a.id);
          let next: Appointment = { ...a, updatedAt: nowIso() };
          // Moved but reminders untouched → keep them relative to the new time.
          if (
            prev &&
            prev.start !== a.start &&
            JSON.stringify(prev.reminders || []) === JSON.stringify(a.reminders || [])
          ) {
            next = { ...next, reminders: shiftReminders(a.reminders, prev.start, a.start) };
          }
          return {
            deletedAppointmentIds,
            appointments: prev
              ? s.appointments.map((x) => (x.id === a.id ? next : x))
              : [...s.appointments, next],
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
          appointments: s.appointments.map((x) =>
            x.id === id
              ? { ...x, start, reminders: shiftReminders(x.reminders, x.start, start), updatedAt: nowIso() }
              : x,
          ),
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
          return { exceptions: next, exceptionsUpdatedAt: nowIso() };
        }),
      clearExceptionsRange: (staffId, from, to) =>
        set((s) => ({
          exceptions: s.exceptions.filter(
            (e) => !(e.staffId === staffId && e.date >= from && e.date <= to),
          ),
          exceptionsUpdatedAt: nowIso(),
        })),
      resetJournal: () =>
        set((s) => ({
          appointments: [],
          windows: [],
          clients: get().clients,
          deletedAppointmentIds: [
            ...(s.deletedAppointmentIds || []),
            ...s.appointments.map((a) => a.id),
          ].slice(-1000),
        })),
      getSnapshot: () => {
        const s = get();
        return {
          clients: s.clients,
          services: s.services,
          staff: s.staff,
          appointments: s.appointments,
          deletedAppointmentIds: s.deletedAppointmentIds || [],
          deletedClientIds: s.deletedClientIds || [],
          windows: s.windows,
          schedules: s.schedules,
          exceptions: s.exceptions,
          exceptionsUpdatedAt: s.exceptionsUpdatedAt,
          telegramChats: s.telegramChats || [],
          settings: s.settings,
        };
      },
      mergeTelegramPatch: (patch) =>
        set((s) => ({
          clients: patch.clients ?? s.clients,
          appointments: patch.appointments ?? s.appointments,
          deletedAppointmentIds: patch.deletedAppointmentIds ?? s.deletedAppointmentIds,
          deletedClientIds: patch.deletedClientIds ?? s.deletedClientIds,
          exceptions: patch.exceptions ?? s.exceptions,
          exceptionsUpdatedAt: patch.exceptionsUpdatedAt ?? s.exceptionsUpdatedAt,
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
        deletedClientIds: s.deletedClientIds || [],
        windows: s.windows,
        schedules: s.schedules,
        exceptions: s.exceptions,
        exceptionsUpdatedAt: s.exceptionsUpdatedAt,
        telegramChats: s.telegramChats || [],
        settings: s.settings,
      }),
    },
  ),
);
