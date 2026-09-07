import { useMemo, useState } from 'react';
import {
  addDays,
  addMinutes,
  format,
  setHours,
  setMinutes,
  startOfDay,
  differenceInMinutes,
} from 'date-fns';
import { ru } from 'date-fns/locale';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useCrm } from '@/lib/store';
import { getDayPlan, offBands } from '@/lib/schedule';
import { BookingDialog } from './booking-dialog';
import { ScheduleEditor } from './schedule-editor';
import type { Appointment } from '@/lib/types';

const HOUR_H = 52;
const START_H = 8;
const END_H = 22;
const TOTAL_H = END_H - START_H;

export function Journal() {
  const [day, setDay] = useState(() => startOfDay(new Date()));
  const allStaff = useCrm((s) => s.staff);
  const staff = useMemo(() => allStaff.filter((x) => x.active), [allStaff]);
  const clients = useCrm((s) => s.clients);
  const services = useCrm((s) => s.services);
  const appointments = useCrm((s) => s.appointments);
  const windows = useCrm((s) => s.windows);
  const schedules = useCrm((s) => s.schedules);
  const exceptions = useCrm((s) => s.exceptions);
  const settings = useCrm((s) => s.settings);
  const moveAppointment = useCrm((s) => s.moveAppointment);

  const [menu, setMenu] = useState<{ x: number; y: number; slot: Date; staffId: string } | null>(null);
  const [dialog, setDialog] = useState<{
    open: boolean;
    mode: 'create' | 'edit' | 'window';
    initial?: Partial<Appointment> & { slotStart?: string; staffId?: string };
  }>({ open: false, mode: 'create' });
  const [schedOpen, setSchedOpen] = useState<{ staffId: string; date?: string } | null>(null);
  const [movingId, setMovingId] = useState<string | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);

  const dayKey = format(day, 'yyyy-MM-dd');

  const columns = useMemo(() => {
    return staff.map((st) => {
      const schedule = schedules.find((s) => s.staffId === st.id);
      const plan = getDayPlan(schedule, exceptions, st.id, day);
      const bands = offBands(plan, START_H, END_H);
      const appts = appointments.filter(
        (a) =>
          a.staffId === st.id &&
          a.status !== 'cancelled' &&
          format(new Date(a.start), 'yyyy-MM-dd') === dayKey,
      );
      const wins = windows.filter(
        (w) => w.staffId === st.id && format(new Date(w.start), 'yyyy-MM-dd') === dayKey,
      );
      return { st, plan, bands, appts, wins };
    });
  }, [staff, schedules, exceptions, day, appointments, windows, dayKey]);

  const hours = Array.from({ length: TOTAL_H + 1 }, (_, i) => START_H + i);

  const yToTime = (y: number) => {
    const mins = Math.round((y / HOUR_H) * 60 / 15) * 15;
    return addMinutes(setMinutes(setHours(day, START_H), 0), mins);
  };

  const openCreate = (slot: Date, staffId: string, mode: 'create' | 'window') => {
    setMenu(null);
    setDialog({
      open: true,
      mode,
      initial: { slotStart: slot.toISOString(), staffId, start: slot.toISOString() },
    });
  };

  return (
    <div className="flex h-full flex-col bg-[#f0f2f5]">
      <div className="flex flex-wrap items-center gap-2 border-b border-black/5 bg-white px-3 py-2">
        <button type="button" className="touch-btn rounded-md border px-2" onClick={() => setDay((d) => addDays(d, -1))}>
          <ChevronLeft size={18} />
        </button>
        <button type="button" className="touch-btn rounded-md border px-3 text-sm" onClick={() => setDay(startOfDay(new Date()))}>
          Сегодня
        </button>
        <button type="button" className="touch-btn rounded-md border px-2" onClick={() => setDay((d) => addDays(d, 1))}>
          <ChevronRight size={18} />
        </button>
        <div className="text-sm font-semibold capitalize">
          {format(day, 'EEEE, d MMMM yyyy', { locale: ru })}
        </div>
        <input
          type="date"
          className="ml-auto rounded-md border px-2 py-1 text-sm"
          value={dayKey}
          onChange={(e) => setDay(startOfDay(new Date(e.target.value + 'T12:00:00')))}
        />
        {movingId && (
          <span className="rounded-md bg-amber-100 px-2 py-1 text-xs text-amber-800">
            Выберите новый слот для переноса
          </span>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        <div className="inline-flex min-w-full">
          <div className="sticky left-0 z-10 w-14 shrink-0 bg-[#f0f2f5]">
            <div className="h-10 border-b" />
            {hours.slice(0, -1).map((h) => (
              <div key={h} className="relative border-b border-black/5 text-[11px] text-slate-500" style={{ height: HOUR_H }}>
                <span className="absolute -top-2 right-2">{String(h).padStart(2, '0')}:00</span>
              </div>
            ))}
          </div>

          {columns.map(({ st, bands, appts, wins }) => (
            <div key={st.id} className="relative min-w-[220px] flex-1 border-l border-black/5 bg-white">
              <button
                type="button"
                className="sticky top-0 z-20 flex h-10 w-full items-center justify-center border-b bg-white text-sm font-semibold hover:bg-orange-50"
                onClick={() => setSchedOpen({ staffId: st.id, date: dayKey })}
              >
                {st.name}
              </button>
              <div
                className="relative"
                style={{ height: TOTAL_H * HOUR_H }}
                onClick={(e) => {
                  const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect();
                  const y = e.clientY - rect.top;
                  const slot = yToTime(y);
                  if (movingId) {
                    moveAppointment(movingId, slot.toISOString(), st.id);
                    setMovingId(null);
                    return;
                  }
                  setMenu({ x: e.clientX, y: e.clientY, slot, staffId: st.id });
                }}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  const id = e.dataTransfer.getData('text/apt') || dragId;
                  if (!id) return;
                  const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect();
                  const slot = yToTime(e.clientY - rect.top);
                  moveAppointment(id, slot.toISOString(), st.id);
                  setDragId(null);
                }}
              >
                {Array.from({ length: TOTAL_H * 4 }).map((_, i) => (
                  <div
                    key={i}
                    className="absolute left-0 right-0 border-b border-slate-100"
                    style={{ top: (i * HOUR_H) / 4, height: HOUR_H / 4 }}
                  />
                ))}

                {bands.map((b, i) => (
                  <button
                    key={i}
                    type="button"
                    className="absolute left-0 right-0 bg-slate-200/70"
                    style={{
                      top: (b.startMin / 60) * HOUR_H,
                      height: ((b.endMin - b.startMin) / 60) * HOUR_H,
                    }}
                    onClick={(e) => {
                      e.stopPropagation();
                      setSchedOpen({ staffId: st.id, date: dayKey });
                    }}
                    title="Нерабочее время — открыть график"
                  />
                ))}

                {wins.map((w) => {
                  const start = new Date(w.start);
                  const top =
                    ((start.getHours() * 60 + start.getMinutes() - START_H * 60) / 60) * HOUR_H;
                  const h = (w.durationMin / 60) * HOUR_H;
                  return (
                    <div
                      key={w.id}
                      className="absolute left-1 right-1 overflow-hidden rounded border border-dashed border-slate-400 bg-slate-100 px-2 py-1 text-xs text-slate-600"
                      style={{ top, height: Math.max(h, 18) }}
                      onClick={(e) => e.stopPropagation()}
                    >
                      {w.label || 'Окно'}
                    </div>
                  );
                })}

                {appts.map((a) => {
                  const start = new Date(a.start);
                  const top =
                    ((start.getHours() * 60 + start.getMinutes() - START_H * 60) / 60) * HOUR_H;
                  const h = (a.durationMin / 60) * HOUR_H;
                  const client = clients.find((c) => c.id === a.clientId);
                  const svc = services.find((s) => a.serviceIds.includes(s.id));
                  const color =
                    a.source === 'online' ? settings.onlineColor : a.color || settings.visitColor;
                  return (
                    <div
                      key={a.id}
                      draggable
                      onDragStart={(e) => {
                        e.dataTransfer.setData('text/apt', a.id);
                        setDragId(a.id);
                      }}
                      className="absolute left-1 right-1 cursor-pointer overflow-hidden rounded px-2 py-1 text-xs text-white shadow-sm"
                      style={{ top, height: Math.max(h, 22), background: color || '#6b7280' }}
                      onClick={(e) => {
                        e.stopPropagation();
                        setDialog({ open: true, mode: 'edit', initial: a });
                      }}
                    >
                      <div className="font-semibold">{client?.name || 'Клиент'}</div>
                      <div className="opacity-90">{svc?.name}</div>
                      <div className="opacity-80">
                        {format(start, 'HH:mm')}–{format(addMinutes(start, a.durationMin), 'HH:mm')}
                        {client?.phone ? ` · ${client.phone}` : ''}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>

      {menu && (
        <div
          className="fixed z-50 min-w-[180px] rounded-lg border bg-white py-1 shadow-xl"
          style={{ left: menu.x, top: menu.y }}
          onMouseLeave={() => setMenu(null)}
        >
          <button
            type="button"
            className="block w-full px-3 py-2 text-left text-sm hover:bg-slate-50"
            onClick={() => openCreate(menu.slot, menu.staffId, 'create')}
          >
            Записать клиента
          </button>
          <button
            type="button"
            className="block w-full px-3 py-2 text-left text-sm hover:bg-slate-50"
            onClick={() => openCreate(menu.slot, menu.staffId, 'window')}
          >
            Пустое окно
          </button>
        </div>
      )}

      <BookingDialog
        open={dialog.open}
        onOpenChange={(v) => setDialog((d) => ({ ...d, open: v }))}
        mode={dialog.mode}
        initial={dialog.initial}
        onRequestMove={(id) => {
          setDialog((d) => ({ ...d, open: false }));
          setMovingId(id);
        }}
      />

      {schedOpen && (
        <ScheduleEditor
          open={!!schedOpen}
          onOpenChange={(v) => !v && setSchedOpen(null)}
          staffId={schedOpen.staffId}
          focusDate={schedOpen.date}
        />
      )}
    </div>
  );
}
