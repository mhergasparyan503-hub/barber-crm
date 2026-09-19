import { addMinutes, isBefore } from 'date-fns';
import { getDayPlan, overlaps } from './schedule';
import type { CrmState } from './types';
import { addYmd, mskDateKey, mskDayNoon, mskParts, parseApStart } from './msk';

export function freeSlots(opts: {
  state: CrmState;
  staffId: string;
  day: Date | string;
  durationMin: number;
  leadMinutes?: number;
  ignoreAppointmentId?: string;
  now?: Date;
}): string[] {
  const { state, staffId, durationMin, ignoreAppointmentId } = opts;
  const dayKey = typeof opts.day === 'string' ? opts.day : mskDateKey(opts.day);
  const day = typeof opts.day === 'string' ? mskDayNoon(opts.day) : opts.day;
  const lead = opts.leadMinutes ?? state.settings.leadMinutes;
  const step = state.settings.slotMinutes || 15;
  const now = opts.now ?? new Date();
  const schedule = state.schedules.find((s) => s.staffId === staffId);
  const plan = getDayPlan(schedule, state.exceptions, staffId, dayKey);
  if (!plan.working || !plan.start || !plan.end) return [];

  const appts = state.appointments.filter(
    (a) =>
      a.staffId === staffId &&
      a.status !== 'cancelled' &&
      a.id !== ignoreAppointmentId &&
      mskDateKey(parseApStart(a.start)) === dayKey,
  );
  const wins = state.windows.filter(
    (w) => w.staffId === staffId && mskDateKey(parseApStart(w.start)) === dayKey,
  );

  const slots: string[] = [];
  let cursor = plan.start;
  const latest = addMinutes(plan.end, -durationMin);
  const earliest = addMinutes(now, lead);
  const isToday = dayKey === mskDateKey(now);

  while (cursor <= latest) {
    const inBreak =
      plan.breakStart &&
      plan.breakEnd &&
      overlaps(
        cursor,
        durationMin,
        plan.breakStart,
        (plan.breakEnd.getTime() - plan.breakStart.getTime()) / 60000,
      );
    const busyAppt = appts.some((a) => overlaps(cursor, durationMin, parseApStart(a.start), a.durationMin));
    const busyWin = wins.some((w) => overlaps(cursor, durationMin, parseApStart(w.start), w.durationMin));
    const tooSoon = isToday && isBefore(cursor, earliest);
    if (!inBreak && !busyAppt && !busyWin && !tooSoon) {
      slots.push(mskParts(cursor).time);
    }
    cursor = addMinutes(cursor, step);
  }
  void day;
  return slots;
}

export function availableDays(state: CrmState, staffId: string, durationMin: number, from = new Date()) {
  const days: string[] = [];
  let cur = mskDateKey(from);
  for (let i = 0; i < state.settings.horizonDays; i++) {
    if (freeSlots({ state, staffId, day: cur, durationMin }).length) {
      days.push(cur);
    }
    cur = addYmd(cur, 1);
  }
  return days;
}

export function hasConflict(
  state: CrmState,
  staffId: string,
  start: Date,
  durationMin: number,
  ignoreAppointmentId?: string,
): string | null {
  const schedule = state.schedules.find((s) => s.staffId === staffId);
  const dayKey = mskDateKey(start);
  const plan = getDayPlan(schedule, state.exceptions, staffId, dayKey);
  if (!plan.working || !plan.start || !plan.end) return 'Нет в графике';
  const end = addMinutes(start, durationMin);
  if (start < plan.start || end > plan.end) return 'Вне рабочих часов';
  if (
    plan.breakStart &&
    plan.breakEnd &&
    overlaps(start, durationMin, plan.breakStart, (plan.breakEnd.getTime() - plan.breakStart.getTime()) / 60000)
  ) {
    return 'Перерыв';
  }
  const busy = state.appointments.some(
    (a) =>
      a.staffId === staffId &&
      a.status !== 'cancelled' &&
      a.id !== ignoreAppointmentId &&
      mskDateKey(parseApStart(a.start)) === dayKey &&
      overlaps(start, durationMin, parseApStart(a.start), a.durationMin),
  );
  if (busy) return 'Слот занят';
  const winBusy = state.windows.some(
    (w) =>
      w.staffId === staffId &&
      mskDateKey(parseApStart(w.start)) === dayKey &&
      overlaps(start, durationMin, parseApStart(w.start), w.durationMin),
  );
  if (winBusy) return 'Пустое окно';
  return null;
}
