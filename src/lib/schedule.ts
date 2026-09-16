import { setHours, setMinutes, startOfDay, format } from 'date-fns';
import type { ScheduleException, StaffSchedule } from './types';

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
      return {
        working: false as const,
        type: ex.type,
        start: null as Date | null,
        end: null as Date | null,
        breakStart: null as Date | null,
        breakEnd: null as Date | null,
      };
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

export function overlaps(aStart: Date, aDur: number, bStart: Date, bDur: number) {
  const aEnd = aStart.getTime() + aDur * 60000;
  const bEnd = bStart.getTime() + bDur * 60000;
  return aStart.getTime() < bEnd && bStart.getTime() < aEnd;
}
