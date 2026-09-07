import { addMinutes, format, parse, setHours, setMinutes, startOfDay } from 'date-fns';
import type { Appointment, ScheduleException, StaffSchedule, TimeWindow } from './types';

export function parseHm(hm: string, day: Date): Date {
  const [h, m] = hm.split(':').map(Number);
  return setMinutes(setHours(startOfDay(day), h), m);
}

export function getDayPlan(
  schedule: StaffSchedule | undefined,
  exceptions: ScheduleException[],
  staffId: string,
  day: Date,
) {
  const key = format(day, 'yyyy-MM-dd');
  const ex = exceptions.find((e) => e.staffId === staffId && e.date === key);
  if (ex) {
    if (ex.type === 'off' || ex.type === 'vacation' || ex.type === 'sick') {
      return { working: false as const, type: ex.type, start: null as Date | null, end: null as Date | null, breakStart: null as Date | null, breakEnd: null as Date | null };
    }
    if (ex.type === 'custom' && ex.start && ex.end) {
      return {
        working: true as const,
        type: ex.type,
        start: parseHm(ex.start, day),
        end: parseHm(ex.end, day),
        breakStart: ex.breakStart ? parseHm(ex.breakStart, day) : null,
        breakEnd: ex.breakEnd ? parseHm(ex.breakEnd, day) : null,
      };
    }
  }
  const dow = day.getDay();
  const wd = schedule?.week.find((w) => w.day === dow);
  if (!wd || !wd.working) {
    return { working: false as const, type: 'off' as const, start: null, end: null, breakStart: null, breakEnd: null };
  }
  return {
    working: true as const,
    type: 'work' as const,
    start: parseHm(wd.start, day),
    end: parseHm(wd.end, day),
    breakStart: wd.breakStart ? parseHm(wd.breakStart, day) : null,
    breakEnd: wd.breakEnd ? parseHm(wd.breakEnd, day) : null,
  };
}

/** Gray off-bands for journal column (minutes from journalStart hour) */
export function offBands(
  plan: ReturnType<typeof getDayPlan>,
  journalStartHour = 8,
  journalEndHour = 22,
): { startMin: number; endMin: number }[] {
  const bands: { startMin: number; endMin: number }[] = [];
  const total = (journalEndHour - journalStartHour) * 60;
  if (!plan.working || !plan.start || !plan.end) {
    return [{ startMin: 0, endMin: total }];
  }
  const toMin = (d: Date) => d.getHours() * 60 + d.getMinutes() - journalStartHour * 60;
  const s = Math.max(0, toMin(plan.start));
  const e = Math.min(total, toMin(plan.end));
  if (s > 0) bands.push({ startMin: 0, endMin: s });
  if (e < total) bands.push({ startMin: e, endMin: total });
  if (plan.breakStart && plan.breakEnd) {
    bands.push({ startMin: toMin(plan.breakStart), endMin: toMin(plan.breakEnd) });
  }
  return bands;
}

export function overlaps(aStart: Date, aDur: number, bStart: Date, bDur: number) {
  const aEnd = addMinutes(aStart, aDur);
  const bEnd = addMinutes(bStart, bDur);
  return aStart < bEnd && bStart < aEnd;
}
