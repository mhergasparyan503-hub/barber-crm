import { useState } from 'react';
import { Link } from '@tanstack/react-router';
import { ArrowLeft } from 'lucide-react';
import { useCrm } from '@/lib/store';
import { STAFF_ID } from '@/lib/seed';
import { WEEKDAY_FULL } from '@/lib/format';
import type { DaySchedule, ExceptionType } from '@/lib/types';
import { toast } from 'sonner';
import { cn } from '@/lib/cn';

export function SchedulePage() {
  const schedule = useCrm((s) => s.schedules.find((x) => x.staffId === STAFF_ID));
  const setWeekTemplate = useCrm((s) => s.setWeekTemplate);
  const applyExceptionRange = useCrm((s) => s.applyExceptionRange);
  const clearExceptionsRange = useCrm((s) => s.clearExceptionsRange);
  const week = schedule?.week || [];

  const [tab, setTab] = useState<'week' | 'period'>('week');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [exType, setExType] = useState<ExceptionType | 'template'>('off');
  const [customStart, setCustomStart] = useState('10:00');
  const [customEnd, setCustomEnd] = useState('21:00');

  function updateDay(day: number, patch: Partial<DaySchedule>) {
    const next = week.map((d) => (d.day === day ? { ...d, ...patch } : d));
    setWeekTemplate(STAFF_ID, next);
  }

  // Mon-Sun order for display (1..6,0)
  const order = [1, 2, 3, 4, 5, 6, 0];

  function applyPeriod() {
    if (!from || !to) {
      toast.error('Укажите период');
      return;
    }
    if (exType === 'template') {
      clearExceptionsRange(STAFF_ID, from, to);
      toast.success('По шаблону');
      return;
    }
    applyExceptionRange(STAFF_ID, from, to, {
      type: exType,
      ...(exType === 'custom' ? { start: customStart, end: customEnd } : {}),
    });
    toast.success('Исключения сохранены');
  }

  return (
    <div className="flex-1 overflow-y-auto bg-journal">
      <div className="bg-white border-b border-gray-100 px-3 py-2 flex items-center gap-2 sticky top-0 z-10">
        <Link to="/more" className="h-10 w-10 flex items-center justify-center">
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <div className="font-semibold">График</div>
      </div>

      <div className="flex gap-2 p-3">
        {(['week', 'period'] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={cn(
              'flex-1 touch-btn rounded-xl text-sm font-medium',
              tab === t ? 'bg-accent text-white' : 'bg-white border border-gray-200',
            )}
          >
            {t === 'week' ? 'Шаблон недели' : 'Период'}
          </button>
        ))}
      </div>

      {tab === 'week' && (
        <div className="px-3 pb-6 space-y-2">
          {order.map((dow) => {
            const d = week.find((x) => x.day === dow) || {
              day: dow,
              start: '10:00',
              end: '21:00',
              working: false,
            };
            return (
              <div key={dow} className="bg-white rounded-2xl p-3 shadow-sm border border-gray-100">
                <div className="flex items-center justify-between mb-2">
                  <span className="font-medium">{WEEKDAY_FULL[dow]}</span>
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={d.working}
                      onChange={(e) => updateDay(dow, { working: e.target.checked })}
                    />
                    Рабочий
                  </label>
                </div>
                {d.working && (
                  <div className="grid grid-cols-2 gap-2">
                    <label className="text-xs text-gray-500">
                      Начало
                      <input
                        type="time"
                        className="mt-1 w-full rounded-lg border border-gray-200 px-2 py-2"
                        value={d.start}
                        onChange={(e) => updateDay(dow, { start: e.target.value })}
                      />
                    </label>
                    <label className="text-xs text-gray-500">
                      Конец
                      <input
                        type="time"
                        className="mt-1 w-full rounded-lg border border-gray-200 px-2 py-2"
                        value={d.end}
                        onChange={(e) => updateDay(dow, { end: e.target.value })}
                      />
                    </label>
                    <label className="text-xs text-gray-500">
                      Перерыв с
                      <input
                        type="time"
                        className="mt-1 w-full rounded-lg border border-gray-200 px-2 py-2"
                        value={d.breakStart || ''}
                        onChange={(e) => updateDay(dow, { breakStart: e.target.value || undefined })}
                      />
                    </label>
                    <label className="text-xs text-gray-500">
                      Перерыв до
                      <input
                        type="time"
                        className="mt-1 w-full rounded-lg border border-gray-200 px-2 py-2"
                        value={d.breakEnd || ''}
                        onChange={(e) => updateDay(dow, { breakEnd: e.target.value || undefined })}
                      />
                    </label>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {tab === 'period' && (
        <div className="px-3 pb-6 space-y-3">
          <div className="bg-white rounded-2xl p-4 space-y-3 shadow-sm">
            <label className="block text-xs text-gray-500">
              С
              <input type="date" className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2.5" value={from} onChange={(e) => setFrom(e.target.value)} />
            </label>
            <label className="block text-xs text-gray-500">
              По
              <input type="date" className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2.5" value={to} onChange={(e) => setTo(e.target.value)} />
            </label>
            <div className="flex flex-wrap gap-2">
              {(
                [
                  ['off', 'Нет в графике'],
                  ['vacation', 'Отпуск'],
                  ['sick', 'Больничный'],
                  ['custom', 'Другие часы'],
                  ['template', 'По шаблону'],
                ] as const
              ).map(([k, label]) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setExType(k)}
                  className={cn(
                    'px-3 py-1.5 rounded-full text-sm border',
                    exType === k ? 'bg-accent text-white border-accent' : 'border-gray-200',
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
            {exType === 'custom' && (
              <div className="grid grid-cols-2 gap-2">
                <input type="time" value={customStart} onChange={(e) => setCustomStart(e.target.value)} className="rounded-xl border border-gray-200 px-3 py-2" />
                <input type="time" value={customEnd} onChange={(e) => setCustomEnd(e.target.value)} className="rounded-xl border border-gray-200 px-3 py-2" />
              </div>
            )}
            <button type="button" onClick={applyPeriod} className="touch-btn w-full rounded-xl bg-accent text-white font-semibold">
              Сохранить
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
