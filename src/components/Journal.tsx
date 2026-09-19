import { useEffect, useMemo, useRef, useState } from 'react';
import {
  addDays,
  addMinutes,
  format,
  startOfDay,
  startOfWeek,
  differenceInMinutes,
} from 'date-fns';
import { ru } from 'date-fns/locale';
import { useCrm } from '@/lib/store';
import { STAFF_ID } from '@/lib/seed';
import { getDayPlan } from '@/lib/schedule';
import { WEEKDAY_SHORT } from '@/lib/format';
import { telHref, smsHref } from '@/lib/phone';
import { cn } from '@/lib/cn';
import type { BookingMode } from './BookingSheet';
import { mskDateKey, mskDow, parseApStart } from '@/lib/msk';

const PX_PER_HOUR = 64;
const SLOT_MIN = 15;

export function Journal({
  day,
  onDayChange,
  onBooking,
}: {
  day: Date;
  onDayChange: (d: Date) => void;
  onBooking: (mode: BookingMode) => void;
}) {
  const state = useCrm();
  const schedule = state.schedules.find((s) => s.staffId === STAFF_ID);
  const plan = getDayPlan(schedule, state.exceptions, STAFF_ID, day);
  const [now, setNow] = useState(() => new Date());
  const [menu, setMenu] = useState<{
    x: number;
    y: number;
    appointmentId: string;
  } | null>(null);
  const [slotMenu, setSlotMenu] = useState<Date | null>(null);
  const longPressTimer = useRef<number | null>(null);
  const longPressed = useRef(false);
  const stripRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const stripSwipe = useRef<{ x: number; moved: boolean } | null>(null);
  const gridSwipe = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30000);
    return () => clearInterval(t);
  }, []);

  const weekStart = startOfWeek(day, { weekStartsOn: 1 });
  const weekDays = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)), [+weekStart]);

  const dayKey = mskDateKey(day);
  const dayAppts = state.appointments.filter(
    (a) =>
      a.staffId === STAFF_ID &&
      a.status !== 'cancelled' &&
      mskDateKey(parseApStart(a.start)) === dayKey,
  );
  const dayWins = state.windows.filter(
    (w) => w.staffId === STAFF_ID && mskDateKey(parseApStart(w.start)) === dayKey,
  );

  const gridStart = plan.working && plan.start ? plan.start : null;
  const gridEnd = plan.working && plan.end ? plan.end : null;
  const totalMin = gridStart && gridEnd ? differenceInMinutes(gridEnd, gridStart) : 0;
  const totalH = totalMin / 60;
  const heightPx = totalH * PX_PER_HOUR;

  function minFromTop(d: Date) {
    if (!gridStart) return 0;
    return differenceInMinutes(d, gridStart);
  }

  function clearLP() {
    if (longPressTimer.current) {
      window.clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  }

  function onCardPointerDown(e: React.PointerEvent, appointmentId: string) {
    longPressed.current = false;
    const x = e.clientX;
    const y = e.clientY;
    clearLP();
    longPressTimer.current = window.setTimeout(() => {
      longPressed.current = true;
      setMenu({ x, y, appointmentId });
      try {
        navigator.vibrate?.(12);
      } catch {}
    }, 450);
  }

  function onCardPointerUp(appointmentId: string) {
    clearLP();
    if (longPressed.current) return;
    onBooking({ kind: 'edit', appointmentId });
  }

  // strip swipe ±7 days without accidental day tap
  function onStripTouchStart(e: React.TouchEvent) {
    stripSwipe.current = { x: e.touches[0].clientX, moved: false };
  }
  function onStripTouchMove(e: React.TouchEvent) {
    if (!stripSwipe.current) return;
    if (Math.abs(e.touches[0].clientX - stripSwipe.current.x) > 12) stripSwipe.current.moved = true;
  }
  function onStripTouchEnd(e: React.TouchEvent) {
    const sw = stripSwipe.current;
    stripSwipe.current = null;
    if (!sw) return;
    const dx = (e.changedTouches[0]?.clientX ?? sw.x) - sw.x;
    if (Math.abs(dx) > 50) {
      onDayChange(addDays(day, dx < 0 ? 7 : -7));
    }
  }

  function onDayTap(d: Date) {
    if (stripSwipe.current?.moved) return;
    onDayChange(d);
  }

  // grid swipe = adjacent day
  function onGridTouchStart(e: React.TouchEvent) {
    gridSwipe.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
  }
  function onGridTouchEnd(e: React.TouchEvent) {
    const sw = gridSwipe.current;
    gridSwipe.current = null;
    if (!sw) return;
    const dx = e.changedTouches[0].clientX - sw.x;
    const dy = e.changedTouches[0].clientY - sw.y;
    if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.4) {
      onDayChange(addDays(day, dx < 0 ? 1 : -1));
    }
  }

  function onSlotTap(minOffset: number) {
    if (!gridStart) return;
    const start = addMinutes(gridStart, minOffset);
    if (plan.breakStart && plan.breakEnd && start >= plan.breakStart && start < plan.breakEnd) return;
    setSlotMenu(start);
  }

  const slotsCount = Math.floor(totalMin / SLOT_MIN);

  const menuAppt = menu ? state.appointments.find((a) => a.id === menu.appointmentId) : null;
  const menuClient = menuAppt ? state.clients.find((c) => c.id === menuAppt.clientId) : null;

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-journal">
      {/* Week strip */}
      <div
        ref={stripRef}
        className="shrink-0 bg-white border-b border-gray-200 px-2 py-2"
        onTouchStart={onStripTouchStart}
        onTouchMove={onStripTouchMove}
        onTouchEnd={onStripTouchEnd}
      >
        <div className="flex gap-1">
          {weekDays.map((d) => {
            const active = mskDateKey(d) === dayKey;
            const today = mskDateKey(d) === mskDateKey(now);
            return (
              <button
                key={+d}
                type="button"
                onClick={() => onDayTap(d)}
                className={cn(
                  'flex-1 rounded-xl py-1.5 text-center transition',
                  active ? 'bg-accent text-white' : 'text-gray-700',
                )}
              >
                <div className="text-[10px] uppercase opacity-80">{WEEKDAY_SHORT[mskDow(mskDateKey(d))]}</div>
                <div className={cn('text-base font-semibold', today && !active && 'text-accent')}>
                  {Number(mskDateKey(d).slice(8))}
                </div>
              </button>
            );
          })}
        </div>
        <div className="text-center text-[10px] text-gray-400 mt-1 capitalize">
          {format(day, 'LLLL yyyy', { locale: ru })}
        </div>
      </div>

      {/* Grid */}
      <div
        ref={gridRef}
        className="flex-1 overflow-y-auto no-scrollbar relative"
        onTouchStart={onGridTouchStart}
        onTouchEnd={onGridTouchEnd}
        onClick={() => setMenu(null)}
      >
        {!plan.working || !gridStart || !gridEnd ? (
          <div className="flex items-center justify-center h-full text-gray-400 text-sm px-6 text-center">
            нет в графике
          </div>
        ) : (
          <div className="relative mx-2 my-2" style={{ height: heightPx }}>
            {/* hour lines + slots */}
            {Array.from({ length: slotsCount }).map((_, i) => {
              const minOffset = i * SLOT_MIN;
              const top = (minOffset / 60) * PX_PER_HOUR;
              const isHour = minOffset % 60 === 0;
              const t = addMinutes(gridStart, minOffset);
              return (
                <div key={i} className="absolute left-0 right-0" style={{ top, height: (SLOT_MIN / 60) * PX_PER_HOUR }}>
                  {isHour && (
                    <div className="absolute left-0 top-0 w-10 -translate-y-1/2 text-[10px] text-gray-400 tabular-nums">
                      {format(t, 'HH:mm')}
                    </div>
                  )}
                  <button
                    type="button"
                    className={cn(
                      'absolute left-10 right-0 border-t',
                      isHour ? 'border-gray-300' : 'border-gray-100',
                    )}
                    style={{ top: 0, height: '100%', width: 'calc(100% - 2.5rem)' }}
                    onClick={(e) => {
                      e.stopPropagation();
                      onSlotTap(minOffset);
                    }}
                  />
                </div>
              );
            })}

            {/* break band */}
            {plan.breakStart && plan.breakEnd && (
              <div
                className="absolute left-10 right-0 bg-gray-300/50 pointer-events-none rounded"
                style={{
                  top: (minFromTop(plan.breakStart) / 60) * PX_PER_HOUR,
                  height: (differenceInMinutes(plan.breakEnd, plan.breakStart) / 60) * PX_PER_HOUR,
                }}
              >
                <span className="text-[10px] text-gray-500 px-2">перерыв</span>
              </div>
            )}

            {/* empty windows */}
            {dayWins.map((w) => {
              const s = parseApStart(w.start);
              return (
                <button
                  key={w.id}
                  type="button"
                  className="absolute left-10 right-1 rounded-lg bg-gray-400/40 border border-gray-400/50 text-left px-2 py-1 z-[5]"
                  style={{
                    top: (minFromTop(s) / 60) * PX_PER_HOUR,
                    height: Math.max(20, (w.durationMin / 60) * PX_PER_HOUR),
                  }}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (confirm('Удалить пустое окно?')) state.deleteWindow(w.id);
                  }}
                >
                  <span className="text-[11px] text-gray-700 font-medium">{w.label || 'Окно'}</span>
                </button>
              );
            })}

            {/* visits */}
            {dayAppts.map((a) => {
              const s = parseApStart(a.start);
              const client = state.clients.find((c) => c.id === a.clientId);
              const color = a.color || state.settings.visitColor || '#6b7280';
              return (
                <div
                  key={a.id}
                  className="absolute left-10 right-1 rounded-lg text-white px-2 py-1 z-10 overflow-hidden shadow-sm select-none"
                  style={{
                    top: (minFromTop(s) / 60) * PX_PER_HOUR,
                    height: Math.max(24, (a.durationMin / 60) * PX_PER_HOUR),
                    background: color,
                    touchAction: 'none',
                  }}
                  onPointerDown={(e) => onCardPointerDown(e, a.id)}
                  onPointerUp={() => onCardPointerUp(a.id)}
                  onPointerCancel={clearLP}
                  onPointerLeave={clearLP}
                  onContextMenu={(e) => e.preventDefault()}
                >
                  <div className="text-[11px] font-semibold leading-tight">
                    {format(s, 'HH:mm')} · {client?.name || 'Клиент'}
                  </div>
                  {a.durationMin >= 30 && (
                    <div className="text-[10px] opacity-90 truncate">
                      {a.serviceIds
                        .map((id) => state.services.find((sv) => sv.id === id)?.name)
                        .filter(Boolean)
                        .join(', ')}
                    </div>
                  )}
                </div>
              );
            })}

            {/* now line */}
            {dayKey === mskDateKey(now) && now >= gridStart && now <= gridEnd && (
              <div
                className="absolute left-8 right-0 z-20 pointer-events-none"
                style={{ top: (minFromTop(now) / 60) * PX_PER_HOUR }}
              >
                <div className="h-0.5 bg-red-500 relative">
                  <span className="absolute -left-1.5 -top-1.5 h-3.5 w-3.5 rounded-full bg-red-500" />
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {slotMenu && (
        <div className="fixed inset-0 z-[55] bg-black/40 flex items-end" onClick={() => setSlotMenu(null)}>
          <div className="w-full bg-white rounded-t-2xl p-4 space-y-2 safe-bottom" onClick={(e) => e.stopPropagation()}>
            <div className="text-sm text-gray-500 mb-1">{format(slotMenu, 'd MMMM HH:mm', { locale: ru })}</div>
            <button type="button" className="touch-btn w-full rounded-xl bg-accent text-white font-semibold" onClick={() => { onBooking({ kind: 'new', start: slotMenu }); setSlotMenu(null); }}>Записать клиента</button>
            <button type="button" className="touch-btn w-full rounded-xl border border-gray-200 font-medium" onClick={() => { onBooking({ kind: 'window', start: slotMenu }); setSlotMenu(null); }}>Пустое окно</button>
            <button type="button" className="touch-btn w-full rounded-xl text-gray-500" onClick={() => setSlotMenu(null)}>Отмена</button>
          </div>
        </div>
      )}

      {/* long-press menu */}
      {menu && menuAppt && menuClient && (
        <div
          className="fixed inset-0 z-[60]"
          onClick={() => setMenu(null)}
          onContextMenu={(e) => e.preventDefault()}
        >
          <div
            className="absolute bg-white rounded-xl shadow-xl border border-gray-100 py-1 w-44"
            style={{
              left: Math.min(menu.x, window.innerWidth - 180),
              top: Math.min(menu.y, window.innerHeight - 220),
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <a href={telHref(menuClient.phone)} className="block px-4 py-2.5 text-sm hover:bg-gray-50">
              Позвонить
            </a>
            <a
              href={smsHref(menuClient.phone, `Напоминание: запись ${format(new Date(menuAppt.start), 'd.MM HH:mm')}`)}
              className="block px-4 py-2.5 text-sm hover:bg-gray-50"
            >
              SMS
            </a>
            <button
              type="button"
              className="w-full text-left px-4 py-2.5 text-sm hover:bg-gray-50"
              onClick={() => {
                setMenu(null);
                onBooking({ kind: 'move', appointmentId: menuAppt.id, start: new Date(menuAppt.start) });
              }}
            >
              Перенести
            </button>
            <button
              type="button"
              className="w-full text-left px-4 py-2.5 text-sm hover:bg-gray-50"
              onClick={() => {
                setMenu(null);
                onBooking({ kind: 'edit', appointmentId: menuAppt.id });
              }}
            >
              Открыть
            </button>
            <button
              type="button"
              className="w-full text-left px-4 py-2.5 text-sm text-red-600 hover:bg-gray-50"
              onClick={() => {
                state.upsertAppointment({ ...menuAppt, status: 'cancelled' });
                setMenu(null);
              }}
            >
              Отменить
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
