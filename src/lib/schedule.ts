import type { ScheduleException, StaffSchedule } from './types';
import { mskDateKey, mskDow, mskWallISO, parseApStart } from './msk';

export function parseHm(hm: string, day: Date | string): Date {
  const key = typeof day === 'string' ? day : mskDateKey(day);
  const t = hm.length === 5 ? hm : hm.slice(0, 5);
  return parseApStart(mskWallISO(key, t));
}

export function getDayPlan(
  schedule: StaffSchedule | undefined,
  exceptions: ScheduleException[],
  staffId: string,
  day: Date | string,
) {
  const key = typeof day === 'string' ? day : mskDateKey(day);
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
        start: parseHm(ex.start, key),
        end: parseHm(ex.end, key),
        breakStart: ex.breakStart ? parseHm(ex.breakStart, key) : null,
        breakEnd: ex.breakEnd ? parseHm(ex.breakEnd, key) : null,
      };
    }
  }
  const dow = mskDow(key);
  const wd = schedule?.week.find((w) => w.day === dow);
  if (!wd || !wd.working) {
    return { working: false as const, type: 'off' as const, start: null, end: null, breakStart: null, breakEnd: null };
  }
  return {
    working: true as const,
    type: 'work' as const,
    start: parseHm(wd.start, key),
    end: parseHm(wd.end, key),
    breakStart: wd.breakStart ? parseHm(wd.breakStart, key) : null,
    breakEnd: wd.breakEnd ? parseHm(wd.breakEnd, key) : null,
  };
}

export function overlaps(aStart: Date, aDur: number, bStart: Date, bDur: number) {
  const aEnd = aStart.getTime() + aDur * 60000;
  const bEnd = bStart.getTime() + bDur * 60000;
  return aStart.getTime() < bEnd && bStart.getTime() < aEnd;
}
