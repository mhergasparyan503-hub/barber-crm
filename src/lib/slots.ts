import { addDays, addMinutes, format, isBefore, startOfDay } from 'date-fns';
import { getDayPlan, overlaps } from './schedule';
import type { Appointment, CrmState, TimeWindow } from './types';

export function freeSlots(opts: {
  state: CrmState;
  staffId: string;
  day: Date;
  durationMin: number;
  leadMinutes?: number;
  ignoreAppointmentId?: string;
  now?: Date;
}): string[] {
  const { state, staffId, day, durationMin, ignoreAppointmentId } = opts;
  const lead = opts.leadMinutes ?? state.settings.leadMinutes;
  const step = state.settings.slotMinutes || 15;
  const now = opts.now ?? new Date();
  const schedule = state.schedules.find((s) => s.staffId === staffId);
  const plan = getDayPlan(schedule, state.exceptions, staffId, day);
  if (!plan.working || !plan.start || !plan.end) return [];

  const appts = state.appointments.filter(
    (a) =>
      a.staffId === staffId &&
      a.status !== 'cancelled' &&
      a.id !== ignoreAppointmentId &&
      format(new Date(a.start), 'yyyy-MM-dd') === format(day, 'yyyy-MM-dd'),
  );
  const wins = state.windows.filter(
    (w) => w.staffId === staffId && format(new Date(w.start), 'yyyy-MM-dd') === format(day, 'yyyy-MM-dd'),
  );

  const slots: string[] = [];
  let cursor = plan.start;
  const latest = addMinutes(plan.end, -durationMin);
  const earliest = addMinutes(now, lead);

  while (cursor <= latest) {
    const inBreak =
      plan.breakStart &&
      plan.breakEnd &&
      overlaps(cursor, durationMin, plan.breakStart, (plan.breakEnd.getTime() - plan.breakStart.getTime()) / 60000);
    const busyAppt = appts.some((a) => overlaps(cursor, durationMin, new Date(a.start), a.durationMin));
    const busyWin = wins.some((w) => overlaps(cursor, durationMin, new Date(w.start), w.durationMin));
    const tooSoon = isBefore(cursor, earliest) && format(day, 'yyyy-MM-dd') === format(now, 'yyyy-MM-dd');
    if (!inBreak && !busyAppt && !busyWin && !tooSoon) {
      slots.push(format(cursor, 'HH:mm'));
    }
    cursor = addMinutes(cursor, step);
  }
  return slots;
}

export function availableDays(state: CrmState, staffId: string, durationMin: number, from = new Date()) {
  const days: string[] = [];
  for (let i = 0; i < state.settings.horizonDays; i++) {
    const d = startOfDay(addDays(from, i));
    if (freeSlots({ state, staffId, day: d, durationMin }).length) {
      days.push(format(d, 'yyyy-MM-dd'));
    }
  }
  return days;
}
