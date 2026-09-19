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

export function CalendarPage() {
  const [cursor, setCursor] = useState(() => startOfMonth(new Date()));
  const appointments = useCrm((s) => s.appointments);
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
          return (
            <button
              key={key}
              type="button"
              onClick={() => nav({ to: '/', search: { day: key } })}
              className={cn(
                'aspect-square rounded-xl flex flex-col items-center justify-center text-sm relative',
                !inMonth && 'text-gray-300',
                today && 'ring-2 ring-accent',
                inMonth && 'hover:bg-gray-50',
              )}
            >
              {format(d, 'd')}
              {busy && <span className="absolute bottom-1.5 h-1.5 w-1.5 rounded-full bg-accent" />}
            </button>
          );
        })}
      </div>
    </div>
  );
}
