import { useState } from 'react';
import { Link } from '@tanstack/react-router';
import { ArrowLeft } from 'lucide-react';
import { useCrm } from '@/lib/store';
import { STAFF_ID } from '@/lib/seed';
import { WEEKDAY_FULL } from '@/lib/format';
import type { DaySchedule, ExceptionType } from '@/lib/types';
import { toast } from 'sonner';
import { flushNow } from '@/lib/crm-snapshot';
import { format } from 'date-fns';
import { ru } from 'date-fns/locale';
import { addYmd, eachYmd, mskDateKey, mskDayNoon, mskParts, parseApStart } from '@/lib/msk';
import { recordsWord } from '@/components/DayMenuSheet';

const daysWord = (n: number) => {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return 'день';
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return 'дня';
  return 'дней';
};
const EX_LABEL: Record<string, string> = { off: 'выходной', vacation: 'отпуск', sick: 'больничный' };

function rangeLabel(from: string, to: string) {
  const f = mskDayNoon(from);
  const t = mskDayNoon(to);
  if (from === to) return format(f, 'd MMMM', { locale: ru });
  if (from.slice(0, 7) === to.slice(0, 7)) return `С ${format(f, 'd')} по ${format(t, 'd MMMM', { locale: ru })}`;
  return `С ${format(f, 'd MMMM', { locale: ru })} по ${format(t, 'd MMMM', { locale: ru })}`;
}
import { cn } from '@/lib/cn';

export function SchedulePage() {
  const schedule = useCrm((s) => s.schedules.find((x) => x.staffId === STAFF_ID));
  const setWeekTemplate = useCrm((s) => s.setWeekTemplate);
  const applyExceptionRange = useCrm((s) => s.applyExceptionRange);
  const clearExceptionsRange = useCrm((s) => s.clearExceptionsRange);
  const week = schedule?.week || [];

  const [tab, setTab] = useState<'week' | 'period'>('period');
  const today = mskDateKey(new Date());
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(addYmd(today, 2));
  const [exType, setExType] = useState<ExceptionType>('vacation');
  const [more, setMore] = useState(false);
  const [pending, setPending] = useState<null | { type: ExceptionType }>(null);
  const appointments = useCrm((s) => s.appointments);
  const clients = useCrm((s) => s.clients);
  const exceptions = useCrm((s) => s.exceptions);
  const [customStart, setCustomStart] = useState('10:00');
  const [customEnd, setCustomEnd] = useState('21:00');

  function flushSchedule() {
    // Immediately — the bot and /book read the server copy.
    void flushNow(() => useCrm.getState().getSnapshot());
  }

  function updateDay(day: number, patch: Partial<DaySchedule>) {
    // Upsert missing weekday rows (map alone would silently no-op).
    const base = week.length
      ? week
      : [0, 1, 2, 3, 4, 5, 6].map((d) => ({
          day: d,
          start: '10:00',
          end: '21:00',
          working: d >= 1 && d <= 6,
        }));
    const has = base.some((d) => d.day === day);
    const next = has
      ? base.map((d) => (d.day === day ? { ...d, ...patch } : d))
      : [...base, { day, start: '10:00', end: '21:00', working: false, ...patch }];
    setWeekTemplate(STAFF_ID, next);
    flushSchedule();
  }

  // Mon-Sun order for display (1..6,0)
  const order = [1, 2, 3, 4, 5, 6, 0];

  function validRange(): boolean {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
      toast.error('Укажите даты «с» и «по»');
      return false;
    }
    if (to < from) {
      toast.error('Дата «по» раньше даты «с»');
      return false;
    }
    if (from < today) {
      toast.error('Нельзя менять прошедшие дни');
      return false;
    }
    if (eachYmd(from, to).length > 90) {
      toast.error('Не больше 90 дней за раз');
      return false;
    }
    return true;
  }

  const rangeDays = /^\d{4}-\d{2}-\d{2}$/.test(from) && /^\d{4}-\d{2}-\d{2}$/.test(to) && to >= from ? eachYmd(from, to).length : 0;
  const rangeAppts = appointments
    .filter((a) => {
      if (a.status === 'cancelled' || a.staffId !== STAFF_ID) return false;
      const k = mskDateKey(parseApStart(a.start));
      return k >= from && k <= to;
    })
    .sort((a, b) => parseApStart(a.start).getTime() - parseApStart(b.start).getTime());

  function askApply(type: ExceptionType) {
    if (!validRange()) return;
    setPending({ type });
  }

  function confirmApply() {
    if (!pending) return;
    applyExceptionRange(STAFF_ID, from, to, {
      type: pending.type,
      ...(pending.type === 'custom' ? { start: customStart, end: customEnd } : {}),
    });
    flushSchedule();
    toast.success(pending.type === 'custom' ? 'Часы сохранены' : 'Выходные сохранены');
    setPending(null);
  }

  function restoreRange() {
    if (!validRange()) return;
    clearExceptionsRange(STAFF_ID, from, to);
    flushSchedule();
    toast.success('Обычный график вернули');
  }

  function restoreDay(date: string) {
    clearExceptionsRange(STAFF_ID, date, date);
    flushSchedule();
    toast.success('День снова рабочий по графику');
  }

  const upcomingOff = exceptions
    .filter((e) => e.staffId === STAFF_ID && e.date >= today && e.type !== 'custom')
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(0, 60);

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
            {t === 'week' ? 'Шаблон недели' : 'Выходные / период'}
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
            <div className="font-semibold">Выходные на период</div>
            <div className="grid grid-cols-2 gap-2">
              <label className="block text-xs text-gray-500">
                С
                <input type="date" min={today} className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm" value={from} onChange={(e) => { setFrom(e.target.value); setPending(null); }} />
              </label>
              <label className="block text-xs text-gray-500">
                По
                <input type="date" min={from || today} className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm" value={to} onChange={(e) => { setTo(e.target.value); setPending(null); }} />
              </label>
            </div>

            {pending ? (
              <div className="space-y-2">
                <div className="rounded-xl bg-amber-50 p-3 text-sm text-amber-800 space-y-1">
                  <div className="font-medium">
                    {rangeLabel(from, to)} — {rangeDays} {daysWord(rangeDays)}
                    {pending.type !== 'off' && ` · ${pending.type === 'custom' ? `часы ${customStart}–${customEnd}` : EX_LABEL[pending.type]}`}.
                  </div>
                  {rangeAppts.length ? (
                    <>
                      <div>
                        В эти дни {rangeAppts.length} {recordsWord(rangeAppts.length)}: они останутся
                        {pending.type === 'custom' ? '' : ', но новых записей не будет'}.
                      </div>
                      <ul className="text-xs text-amber-900 space-y-0.5 max-h-40 overflow-y-auto">
                        {rangeAppts.map((a) => {
                          const p = mskParts(parseApStart(a.start));
                          const c = clients.find((x) => x.id === a.clientId);
                          return (
                            <li key={a.id}>
                              {format(mskDayNoon(p.date), 'd MMM', { locale: ru })} {p.time} — {c?.name || 'Клиент'}
                            </li>
                          );
                        })}
                      </ul>
                    </>
                  ) : (
                    <div>Записей в эти дни нет.</div>
                  )}
                </div>
                <button type="button" onClick={confirmApply} className="touch-btn w-full rounded-xl bg-red-600 text-white font-semibold">
                  Подтвердить
                </button>
                <button type="button" onClick={() => setPending(null)} className="touch-btn w-full rounded-xl border border-gray-200 font-medium">
                  Отмена
                </button>
              </div>
            ) : (
              <>
                <button type="button" onClick={() => askApply('off')} className="touch-btn w-full rounded-xl bg-accent text-white font-semibold">
                  Сделать выходными
                </button>
                <button type="button" onClick={restoreRange} className="touch-btn w-full rounded-xl border border-gray-200 font-medium">
                  Вернуть обычный график
                </button>
                <button type="button" onClick={() => setMore((v) => !v)} className="w-full text-sm text-accent">
                  {more ? 'Скрыть другие варианты' : 'Другие варианты: отпуск, больничный, другие часы'}
                </button>
                {more && (
                  <div className="space-y-2 border-t border-gray-100 pt-3">
                    <div className="flex flex-wrap gap-2">
                      {(
                        [
                          ['vacation', 'Отпуск'],
                          ['sick', 'Больничный'],
                          ['custom', 'Другие часы'],
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
                    <button
                      type="button"
                      onClick={() => {
                        if (exType === 'custom' && customStart >= customEnd) {
                          toast.error('Конец работы должен быть позже начала');
                          return;
                        }
                        askApply(exType);
                      }}
                      className="touch-btn w-full rounded-xl border border-accent text-accent font-semibold"
                    >
                      Применить к периоду
                    </button>
                  </div>
                )}
              </>
            )}
          </div>

          <div className="bg-white rounded-2xl p-4 shadow-sm">
            <div className="font-semibold mb-2">Ближайшие выходные</div>
            {upcomingOff.length ? (
              <ul className="divide-y divide-gray-100">
                {upcomingOff.map((e) => (
                  <li key={e.id} className="flex items-center justify-between py-2 text-sm">
                    <span className="first-letter:uppercase">
                      {format(mskDayNoon(e.date), 'EEEE, d MMMM', { locale: ru })}
                      <span className="text-gray-400"> · {EX_LABEL[e.type] || e.type}</span>
                    </span>
                    <button
                      type="button"
                      aria-label="Вернуть рабочий день"
                      className="h-8 w-8 flex items-center justify-center rounded-full text-gray-400 hover:bg-gray-100"
                      onClick={() => restoreDay(e.date)}
                    >
                      ✕
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-gray-400">Нет отдельных выходных. Дни по шаблону недели не показаны.</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
