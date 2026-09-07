import { useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { useCrm } from '@/lib/store';
import type { DaySchedule, ExceptionType } from '@/lib/types';
import { toast } from 'sonner';

const DAY_NAMES = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];

type Props = {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  staffId: string;
  focusDate?: string;
};

export function ScheduleEditor({ open, onOpenChange, staffId, focusDate }: Props) {
  const schedule = useCrm((s) => s.schedules.find((x) => x.staffId === staffId));
  const setWeekTemplate = useCrm((s) => s.setWeekTemplate);
  const applyExceptionRange = useCrm((s) => s.applyExceptionRange);
  const clearExceptionsRange = useCrm((s) => s.clearExceptionsRange);
  const staff = useCrm((s) => s.staff.find((x) => x.id === staffId));

  const [tab, setTab] = useState<'day' | 'period' | 'template'>('day');
  const [from, setFrom] = useState(focusDate || new Date().toISOString().slice(0, 10));
  const [to, setTo] = useState(focusDate || new Date().toISOString().slice(0, 10));
  const [type, setType] = useState<ExceptionType | 'work'>('off');
  const [start, setStart] = useState('10:00');
  const [end, setEnd] = useState('21:00');
  const [week, setWeek] = useState<DaySchedule[]>(
    () => schedule?.week.map((d) => ({ ...d })) || [],
  );

  const saveDayOrPeriod = () => {
    const a = tab === 'day' ? from : from;
    const b = tab === 'day' ? from : to;
    if (type === 'work') {
      clearExceptionsRange(staffId, a, b);
      // optionally set custom hours
      if (start && end) {
        applyExceptionRange(staffId, a, b, { type: 'custom', start, end });
      }
    } else {
      applyExceptionRange(staffId, a, b, {
        type,
        start: type === 'custom' ? start : undefined,
        end: type === 'custom' ? end : undefined,
      });
    }
    toast.success('График сохранён');
    onOpenChange(false);
  };

  const restoreTemplate = () => {
    const a = tab === 'day' ? from : from;
    const b = tab === 'day' ? from : to;
    clearExceptionsRange(staffId, a, b);
    toast.success('Возвращено к шаблону');
    onOpenChange(false);
  };

  const saveTemplate = () => {
    setWeekTemplate(staffId, week);
    toast.success('Шаблон недели сохранён');
    onOpenChange(false);
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/40" />
        <Dialog.Content className="fixed inset-x-0 bottom-0 z-50 max-h-[92vh] overflow-auto rounded-t-2xl bg-white p-4 shadow-xl md:inset-auto md:left-1/2 md:top-1/2 md:w-[520px] md:-translate-x-1/2 md:-translate-y-1/2 md:rounded-2xl">
          <Dialog.Title className="mb-3 text-lg font-semibold">
            График · {staff?.name || 'Мастер'}
          </Dialog.Title>
          <div className="mb-3 flex gap-1">
            {([
              ['day', 'День'],
              ['period', 'Период'],
              ['template', 'Шаблон недели'],
            ] as const).map(([k, l]) => (
              <button
                key={k}
                type="button"
                className={`touch-btn flex-1 rounded-md px-2 text-sm ${tab === k ? 'bg-[#ff7900] text-white' : 'bg-slate-100'}`}
                onClick={() => setTab(k)}
              >
                {l}
              </button>
            ))}
          </div>

          {tab !== 'template' && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-xs text-slate-500">{tab === 'day' ? 'Дата' : 'С'}</label>
                  <input type="date" className="w-full rounded-md border px-3 py-2 text-sm" value={from} onChange={(e) => setFrom(e.target.value)} />
                </div>
                {tab === 'period' && (
                  <div>
                    <label className="text-xs text-slate-500">По</label>
                    <input type="date" className="w-full rounded-md border px-3 py-2 text-sm" value={to} onChange={(e) => setTo(e.target.value)} />
                  </div>
                )}
              </div>
              <div>
                <label className="text-xs text-slate-500">Тип</label>
                <select className="w-full rounded-md border px-3 py-2 text-sm" value={type} onChange={(e) => setType(e.target.value as any)}>
                  <option value="work">Рабочий</option>
                  <option value="off">Нет в графике</option>
                  <option value="vacation">Отпуск</option>
                  <option value="sick">Больничный</option>
                  <option value="custom">Другие часы</option>
                </select>
              </div>
              {(type === 'work' || type === 'custom') && (
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-xs text-slate-500">Начало</label>
                    <input type="time" className="w-full rounded-md border px-3 py-2 text-sm" value={start} onChange={(e) => setStart(e.target.value)} />
                  </div>
                  <div>
                    <label className="text-xs text-slate-500">Конец</label>
                    <input type="time" className="w-full rounded-md border px-3 py-2 text-sm" value={end} onChange={(e) => setEnd(e.target.value)} />
                  </div>
                </div>
              )}
              <div className="flex flex-wrap gap-2">
                <button type="button" className="touch-btn flex-1 rounded-md bg-[#ff7900] font-semibold text-white" onClick={saveDayOrPeriod}>
                  Сохранить
                </button>
                <button type="button" className="touch-btn rounded-md border px-3" onClick={restoreTemplate}>
                  По шаблону
                </button>
              </div>
            </div>
          )}

          {tab === 'template' && (
            <div className="space-y-2">
              {week
                .slice()
                .sort((a, b) => ((a.day + 6) % 7) - ((b.day + 6) % 7))
                .map((d) => (
                  <div key={d.day} className="flex flex-wrap items-center gap-2 rounded-md border p-2 text-sm">
                    <span className="w-8 font-medium uppercase">{DAY_NAMES[d.day]}</span>
                    <label className="flex items-center gap-1">
                      <input
                        type="checkbox"
                        checked={d.working}
                        onChange={(e) =>
                          setWeek((w) =>
                            w.map((x) => (x.day === d.day ? { ...x, working: e.target.checked } : x)),
                          )
                        }
                      />
                      раб.
                    </label>
                    <input
                      type="time"
                      className="rounded border px-2 py-1"
                      value={d.start}
                      onChange={(e) =>
                        setWeek((w) => w.map((x) => (x.day === d.day ? { ...x, start: e.target.value } : x)))
                      }
                    />
                    <span>—</span>
                    <input
                      type="time"
                      className="rounded border px-2 py-1"
                      value={d.end}
                      onChange={(e) =>
                        setWeek((w) => w.map((x) => (x.day === d.day ? { ...x, end: e.target.value } : x)))
                      }
                    />
                  </div>
                ))}
              <button type="button" className="touch-btn w-full rounded-md bg-[#ff7900] font-semibold text-white" onClick={saveTemplate}>
                Сохранить шаблон
              </button>
            </div>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
