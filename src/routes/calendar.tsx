import { useMemo, useRef, useState } from 'react';
import {
  addMonths,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isSameMonth,
  startOfMonth,
  startOfWeek,
} from 'date-fns';
import { ru } from 'date-fns/locale';
import { useNavigate } from '@tanstack/react-router';
import { useCrm } from '@/lib/store';
import { WEEKDAY_SHORT } from '@/lib/format';
import { cn } from '@/lib/cn';
import { mskDateKey, parseApStart } from '@/lib/msk';
import { STAFF_ID } from '@/lib/seed';
import { getDayPlan } from '@/lib/schedule';
import { useLongPress } from '@/lib/useLongPress';
import { DayMenuSheet } from '@/components/DayMenuSheet';

export function CalendarPage() {
  const [cursor, setCursor] = useState(() => startOfMonth(new Date()));
  const appointments = useCrm((s) => s.appointments);
  const schedules = useCrm((s) => s.schedules);
  const exceptions = useCrm((s) => s.exceptions);
  const [menuDay, setMenuDay] = useState<string | null>(null);
  const longPress = useLongPress();
  const nav = useNavigate();
  const swipe = useRef<{ x: number } | null>(null);

  const busyDays = useMemo(() => {
    const set = new Set<string>();
    for (const a of appointments) {
      if (a.status === 'cancelled') continue;
      set.add(mskDateKey(parseApStart(a.start)));
    }
    return set;
  }, [appointments]);

  const days = useMemo(() => {
    const start = startOfWeek(startOfMonth(cursor), { weekStartsOn: 1 });
    const end = endOfWeek(endOfMonth(cursor), { weekStartsOn: 1 });
    return eachDayOfInterval({ start, end });
  }, [+cursor]);

  const labels = ['пн', 'вт', 'ср', 'чт', 'пт', 'сб', 'вс'];

  return (
    <div
      className="flex-1 overflow-y-auto bg-white p-4"
      onTouchStart={(e) => {
        swipe.current = { x: e.touches[0].clientX };
      }}
      onTouchEnd={(e) => {
        if (!swipe.current) return;
        const dx = e.changedTouches[0].clientX - swipe.current.x;
        if (Math.abs(dx) > 50) setCursor((c) => addMonths(c, dx < 0 ? 1 : -1));
        swipe.current = null;
      }}
    >
      <div className="flex items-center justify-between mb-4">
        <button type="button" className="px-3 py-2 text-accent font-medium" onClick={() => setCursor((c) => addMonths(c, -1))}>
          ‹
        </button>
        <h2 className="font-semibold capitalize">{format(cursor, 'LLLL yyyy', { locale: ru })}</h2>
        <button type="button" className="px-3 py-2 text-accent font-medium" onClick={() => setCursor((c) => addMonths(c, 1))}>
          ›
        </button>
      </div>
      <div className="grid grid-cols-7 gap-1 mb-1">
        {labels.map((l) => (
          <div key={l} className="text-center text-[10px] text-gray-400 uppercase py-1">
            {l}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {days.map((d) => {
          const key = mskDateKey(d);
          const inMonth = isSameMonth(d, cursor);
          const today = key === mskDateKey(new Date());
          const busy = busyDays.has(key);
          const plan = getDayPlan(
            schedules.find((x) => x.staffId === STAFF_ID),
            exceptions,
            STAFF_ID,
            key,
          );
          const ex = exceptions.find((e) => e.staffId === STAFF_ID && e.date === key);
          const off = !plan.working;
          const custom = !!ex && plan.working;
          return (
            <button
              key={key}
              type="button"
              data-day={key}
              {...longPress(
                () => setMenuDay(key),
                () => setMenuDay(key),
              )}
              className={cn(
                'aspect-square rounded-xl flex flex-col items-center justify-center text-sm relative select-none',
                !inMonth && 'text-gray-300',
                inMonth && off && 'bg-gray-100 text-gray-400',
                inMonth && custom && 'bg-amber-50',
                today && 'ring-2 ring-accent',
                inMonth && !off && 'hover:bg-gray-50',
              )}
            >
              {inMonth && custom && ex?.start && ex?.end && (
                <span className="absolute top-0.5 text-[8px] leading-none tracking-tighter whitespace-nowrap text-amber-700">
                  {ex.start}–{ex.end}
                </span>
              )}
              <span className={cn(inMonth && off && ex && 'line-through')}>{format(d, 'd')}</span>
              {inMonth && off && <span className="text-[8px] leading-none">вых</span>}
              {busy && <span className="absolute bottom-1.5 h-1.5 w-1.5 rounded-full bg-accent" />}
            </button>
          );
        })}
      </div>
      <div className="mt-4 space-y-1 text-[11px] text-gray-500">
        <div className="flex items-center gap-2">
          <span className="inline-block h-3 w-3 rounded bg-gray-100 border border-gray-200" /> выходной
          <span className="inline-block h-3 w-3 rounded bg-amber-50 border border-amber-200 ml-3" /> своё время
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-accent ml-3" /> есть записи
        </div>
        <p>Нажмите на дату: открыть журнал, сделать выходным или изменить время работы.</p>
      </div>
      {menuDay && (
        <DayMenuSheet
          dayKey={menuDay}
          onClose={() => setMenuDay(null)}
          onOpenJournal={() => nav({ to: '/', search: { day: menuDay } })}
        />
      )}
    </div>
  );
}
