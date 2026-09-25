import { useMemo, useState } from 'react';
import { format } from 'date-fns';
import { ru } from 'date-fns/locale';
import { toast } from 'sonner';
import { useCrm } from '@/lib/store';
import { STAFF_ID } from '@/lib/seed';
import { getDayPlan, parseHm } from '@/lib/schedule';
import { mskDateKey, mskDayNoon, mskParts, parseApStart } from '@/lib/msk';
import { flushNow } from '@/lib/crm-snapshot';
import { WheelPicker, buildRangeOptions } from './WheelPicker';

const HOURS = buildRangeOptions(0, 23, 1);
const MINS = buildRangeOptions(0, 45, 15);
const hm = (h: number, m: number) => `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
const toHM = (s: string) => {
  const [h, m] = s.split(':').map(Number);
  return { h: h || 0, m: Math.round((m || 0) / 15) * 15 % 60 };
};

export function recordsWord(n: number) {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return 'запись';
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return 'записи';
  return 'записей';
}

/** Bottom sheet for one date: day off / custom hours / back to the weekly template. */
export function DayMenuSheet({
  dayKey,
  onClose,
  onOpenJournal,
}: {
  dayKey: string;
  onClose: () => void;
  /** Calendar tab: first item «Открыть журнал». */
  onOpenJournal?: () => void;
}) {
  const state = useCrm();
  const schedule = state.schedules.find((s) => s.staffId === STAFF_ID);
  const ex = state.exceptions.find((e) => e.staffId === STAFF_ID && e.date === dayKey);
  const plan = getDayPlan(schedule, state.exceptions, STAFF_ID, dayKey);
  const past = dayKey < mskDateKey(new Date());

  const dayAppts = useMemo(
    () =>
      state.appointments.filter(
        (a) => a.status !== 'cancelled' && a.staffId === STAFF_ID && mskDateKey(parseApStart(a.start)) === dayKey,
      ),
    [state.appointments, dayKey],
  );

  const tplDay = schedule?.week.find((w) => w.day === mskDayNoon(dayKey).getUTCDay());
  const initStart = plan.working && plan.start ? mskParts(plan.start).time : tplDay?.start || '10:00';
  const initEnd = plan.working && plan.end ? mskParts(plan.end).time : tplDay?.end || '21:00';

  const [view, setView] = useState<'menu' | 'hours' | 'confirmOff'>('menu');
  const [sH, setSH] = useState(toHM(initStart).h);
  const [sM, setSM] = useState(toHM(initStart).m);
  const [eH, setEH] = useState(toHM(initEnd).h);
  const [eM, setEM] = useState(toHM(initEnd).m);
  const [confirmHours, setConfirmHours] = useState(false);

  const title = format(mskDayNoon(dayKey), 'EEEE, d MMMM', { locale: ru });
  const status = !plan.working
    ? ex
      ? 'Выходной (изменено для этой даты)'
      : 'Выходной по графику'
    : `${initStart}–${initEnd}${ex ? ' (изменено для этой даты)' : ''}`;

  const sync = () => void flushNow(() => useCrm.getState().getSnapshot());

  function makeOff() {
    state.applyExceptionRange(STAFF_ID, dayKey, dayKey, { type: 'off' });
    sync();
    toast.success('День сделан выходным');
    onClose();
  }

  const start = hm(sH, sM);
  const end = hm(eH, eM);
  const outside = dayAppts.filter((a) => {
    const s = parseApStart(a.start).getTime();
    const e = s + (a.durationMin || 0) * 60000;
    return s < parseHm(start, dayKey).getTime() || e > parseHm(end, dayKey).getTime();
  }).length;

  function saveHours() {
    if (start >= end) {
      toast.error('Конец работы должен быть позже начала');
      return;
    }
    if (outside > 0 && !confirmHours) {
      setConfirmHours(true);
      return;
    }
    // Keep the weekly break only if it still fits inside the new hours.
    const br =
      tplDay?.breakStart && tplDay?.breakEnd && tplDay.breakStart >= start && tplDay.breakEnd <= end
        ? { breakStart: tplDay.breakStart, breakEnd: tplDay.breakEnd }
        : {};
    state.applyExceptionRange(STAFF_ID, dayKey, dayKey, { type: 'custom', start, end, ...br });
    sync();
    toast.success(`Время работы ${start}–${end}`);
    onClose();
  }

  function revert() {
    state.clearExceptionsRange(STAFF_ID, dayKey, dayKey);
    sync();
    toast.success('Обычный график');
    onClose();
  }

  const warn = (n: number) => `На этот день ${n} ${recordsWord(n)}. Они останутся, но новых записей не будет.`;

  return (
    <div className="fixed inset-0 z-[70] bg-black/40 flex items-end justify-center" onClick={onClose}>
      <div
        className="w-full max-w-[430px] bg-white rounded-t-2xl p-4 space-y-2 safe-bottom"
        onClick={(e) => e.stopPropagation()}
        onContextMenu={(e) => e.preventDefault()}
      >
        <div className="mb-1">
          <div className="font-semibold text-gray-900 first-letter:uppercase">{title}</div>
          <div className="text-sm text-gray-500">
            {status}
            {dayAppts.length > 0 && ` · ${dayAppts.length} ${recordsWord(dayAppts.length)}`}
          </div>
        </div>

        {onOpenJournal && view === 'menu' && (
          <button
            type="button"
            className="touch-btn w-full rounded-xl bg-accent text-white font-semibold"
            onClick={() => {
              onClose();
              onOpenJournal();
            }}
          >
            📖 Открыть журнал
          </button>
        )}

        {past && <p className="text-sm text-gray-500">Прошедший день — график менять не нужно.</p>}

        {!past && view === 'menu' && (
          <>
            {plan.working ? (
              <>
                <button
                  type="button"
                  className="touch-btn w-full rounded-xl border border-red-200 text-red-600 font-semibold"
                  onClick={() => (dayAppts.length ? setView('confirmOff') : makeOff())}
                >
                  Сделать выходным
                </button>
                <button
                  type="button"
                  className="touch-btn w-full rounded-xl border border-gray-200 font-medium"
                  onClick={() => setView('hours')}
                >
                  Изменить время работы
                </button>
              </>
            ) : (
              <button
                type="button"
                className="touch-btn w-full rounded-xl border border-emerald-300 text-emerald-700 font-semibold"
                onClick={() => setView('hours')}
              >
                Сделать рабочим
              </button>
            )}
            {ex && (
              <button
                type="button"
                className="touch-btn w-full rounded-xl border border-gray-200 font-medium"
                onClick={revert}
              >
                Вернуть обычный график
              </button>
            )}
          </>
        )}

        {!past && view === 'confirmOff' && (
          <>
            <p className="text-sm text-amber-700 bg-amber-50 rounded-xl p-3">{warn(dayAppts.length)}</p>
            <button type="button" className="touch-btn w-full rounded-xl bg-red-600 text-white font-semibold" onClick={makeOff}>
              Всё равно сделать выходным
            </button>
          </>
        )}

        {!past && view === 'hours' && (
          <>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <div className="text-xs text-gray-500 text-center mb-1">Начало</div>
                <div className="flex gap-1">
                  <WheelPicker options={HOURS} value={sH} onChange={(v) => { setSH(v); setConfirmHours(false); }} aria-label="Начало, часы" className="flex-1" />
                  <WheelPicker options={MINS} value={sM} onChange={(v) => { setSM(v); setConfirmHours(false); }} aria-label="Начало, минуты" className="flex-1" />
                </div>
              </div>
              <div>
                <div className="text-xs text-gray-500 text-center mb-1">Конец</div>
                <div className="flex gap-1">
                  <WheelPicker options={HOURS} value={eH} onChange={(v) => { setEH(v); setConfirmHours(false); }} aria-label="Конец, часы" className="flex-1" />
                  <WheelPicker options={MINS} value={eM} onChange={(v) => { setEM(v); setConfirmHours(false); }} aria-label="Конец, минуты" className="flex-1" />
                </div>
              </div>
            </div>
            <p className="text-center text-sm font-medium">
              {start}–{end}
            </p>
            {confirmHours && outside > 0 && (
              <p className="text-sm text-amber-700 bg-amber-50 rounded-xl p-3">
                {outside} {recordsWord(outside)} вне нового времени. Они останутся, но новых записей вне {start}–{end} не будет.
              </p>
            )}
            <button type="button" className="touch-btn w-full rounded-xl bg-accent text-white font-semibold" onClick={saveHours}>
              {confirmHours && outside > 0 ? 'Всё равно сохранить' : `Сохранить ${start}–${end}`}
            </button>
          </>
        )}

        <button type="button" className="touch-btn w-full rounded-xl text-gray-500" onClick={view === 'menu' ? onClose : () => setView('menu')}>
          {view === 'menu' ? 'Отмена' : 'Назад'}
        </button>
      </div>
    </div>
  );
}
