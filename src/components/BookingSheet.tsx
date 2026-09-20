import { useEffect, useMemo, useState } from 'react';
import { X, Phone, MessageSquare } from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { toast } from 'sonner';
import { useCrm } from '@/lib/store';
import { STAFF_ID, uid } from '@/lib/seed';
import { phoneLast10, normalizePhone, formatPhoneDisplay, telHref, smsHref } from '@/lib/phone';
import { hasConflict } from '@/lib/slots';
import { formatVisitWhen } from '@/lib/format';
import { cn } from '@/lib/cn';
import type { Appointment } from '@/lib/types';
import { notifyOwnerNewVisit } from '@/lib/telegram-notify';
import { scheduleFlush, flushNow } from '@/lib/crm-snapshot';
import { WheelPicker, buildRangeOptions } from './WheelPicker';

const DURATION_STEP = 15; // match settings.slotMinutes default
const DURATION_MIN = 15;
const DURATION_MAX = 240;
const MINUTE_STEP = 10;

const HOUR_OPTIONS = buildRangeOptions(0, 23, 1);
const MINUTE_OPTIONS = buildRangeOptions(0, 50, MINUTE_STEP);
const DURATION_OPTIONS = buildRangeOptions(DURATION_MIN, DURATION_MAX, DURATION_STEP, ' мин');

export type BookingMode =
  | { kind: 'new'; start: Date }
  | { kind: 'edit'; appointmentId: string }
  | { kind: 'move'; appointmentId: string; start: Date }
  | { kind: 'window'; start: Date }
  | null;

export function BookingSheet({
  mode,
  onClose,
}: {
  mode: BookingMode;
  onClose: () => void;
}) {
  const open = !!mode;
  const state = useCrm();
  const appt =
    mode && (mode.kind === 'edit' || mode.kind === 'move')
      ? state.appointments.find((a) => a.id === mode.appointmentId)
      : undefined;
  const client0 = appt ? state.clients.find((c) => c.id === appt.clientId) : undefined;

  const [phone, setPhone] = useState('');
  const [name, setName] = useState('');
  const [serviceIds, setServiceIds] = useState<string[]>([]);
  const [startLocal, setStartLocal] = useState('');
  const [comment, setComment] = useState('');
  const [showComment, setShowComment] = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);
  const [winDur, setWinDur] = useState(30);
  const [durationMin, setDurationMin] = useState(30);
  const [error, setError] = useState('');
  /** Collapsed by default when editing/moving with services already chosen; expanded for new. */
  const [servicesOpen, setServicesOpen] = useState(true);

  useEffect(() => {
    if (!mode) return;
    setError('');
    setConfirmDel(false);
    if (mode.kind === 'new') {
      setPhone('');
      setName('');
      setServiceIds([]);
      setStartLocal(toLocalInput(mode.start));
      setComment('');
      setShowComment(false);
      setDurationMin(30);
      setServicesOpen(true);
    } else if (mode.kind === 'edit' && appt) {
      setPhone(client0?.phone || '');
      setName(client0?.name || '');
      setServiceIds([...appt.serviceIds]);
      setStartLocal(toLocalInput(new Date(appt.start)));
      setComment(appt.note || '');
      setShowComment(!!appt.note);
      setDurationMin(appt.durationMin || 30);
      setServicesOpen(!(appt.serviceIds.length > 0));
    } else if (mode.kind === 'move' && appt) {
      setPhone(client0?.phone || '');
      setName(client0?.name || '');
      setServiceIds([...appt.serviceIds]);
      setStartLocal(toLocalInput(mode.start));
      setComment(appt.note || '');
      setDurationMin(appt.durationMin || 30);
      setServicesOpen(!(appt.serviceIds.length > 0));
    } else if (mode.kind === 'window') {
      setStartLocal(toLocalInput(mode.start));
      setWinDur(30);
    }
  }, [mode?.kind, mode && 'appointmentId' in mode ? mode.appointmentId : '', mode && 'start' in mode ? mode.start?.toISOString() : '']);

  // phone search → autofill name
  useEffect(() => {
    if (!mode || mode.kind === 'window') return;
    const last10 = phoneLast10(phone);
    if (last10.length < 10) return;
    const found = state.clients.find((c) => phoneLast10(c.phone) === last10);
    if (found && found.name !== name) setName(found.name);
  }, [phone]);

  const servicesSum = useMemo(() => {
    return (
      serviceIds.reduce((sum, id) => {
        const s = state.services.find((x) => x.id === id);
        return sum + (s?.durationMin || 0);
      }, 0) || 0
    );
  }, [serviceIds, state.services]);

  const servicesSummary = useMemo(() => {
    const selected = serviceIds
      .map((id) => state.services.find((s) => s.id === id))
      .filter((s): s is NonNullable<typeof s> => !!s);
    if (!selected.length) return null;
    const first = selected[0];
    const extra = selected.length - 1;
    return {
      label: `${first.name} · ${first.durationMin}м`,
      extra,
      count: selected.length,
    };
  }, [serviceIds, state.services]);

  const duration = mode?.kind === 'window' ? winDur : durationMin;

  const lastVisitHint = useMemo(() => {
    const last10 = phoneLast10(phone);
    if (last10.length < 10) return null;
    const cli = state.clients.find((c) => phoneLast10(c.phone) === last10);
    if (!cli) return null;
    const hist = state.appointments
      .filter((a) => a.clientId === cli.id && a.status !== 'cancelled')
      .sort((a, b) => +new Date(b.start) - +new Date(a.start));
    if (!hist.length) return 'Новый клиент';
    const last = hist[0];
    const svc = last.serviceIds.map((id) => state.services.find((s) => s.id === id)?.name).filter(Boolean).join(', ');
    return `Последний визит: ${formatVisitWhen(last.start).full}${svc ? ` · ${svc}` : ''}`;
  }, [phone, state.clients, state.appointments, state.services]);

  if (!open || !mode) return null;

  function toggleSvc(id: string) {
    setServiceIds((prev) => {
      const next = prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id];
      const sum = next.reduce((acc, sid) => {
        const s = state.services.find((x) => x.id === sid);
        return acc + (s?.durationMin || 0);
      }, 0);
      setDurationMin(sum || 30);
      return next;
    });
  }

  function setStartHour(hour: number) {
    setStartLocal((prev) => {
      const d = prev ? new Date(prev) : new Date();
      if (Number.isNaN(+d)) return prev;
      d.setHours(hour);
      // keep minutes on 10-min grid for the wheel
      let m = d.getMinutes();
      m = Math.round(m / MINUTE_STEP) * MINUTE_STEP;
      if (m >= 60) m = 60 - MINUTE_STEP;
      d.setMinutes(m, 0, 0);
      return toLocalInput(d);
    });
  }

  function setStartMinute(minute: number) {
    setStartLocal((prev) => {
      const d = prev ? new Date(prev) : new Date();
      if (Number.isNaN(+d)) return prev;
      d.setMinutes(minute, 0, 0);
      return toLocalInput(d);
    });
  }

  const startParsed = startLocal ? new Date(startLocal) : null;
  const startValid = !!startParsed && !Number.isNaN(+startParsed);
  const startHour = startValid ? startParsed!.getHours() : 10;
  const startMinuteRaw = startValid ? startParsed!.getMinutes() : 0;
  const startMinute =
    Math.min(60 - MINUTE_STEP, Math.max(0, Math.round(startMinuteRaw / MINUTE_STEP) * MINUTE_STEP));
  const endHint =
    startValid && duration
      ? formatVisitWhen(new Date(+startParsed! + duration * 60000).toISOString()).time
      : null;

  const durationWheelValue = Math.min(
    DURATION_MAX,
    Math.max(DURATION_MIN, Math.round(durationMin / DURATION_STEP) * DURATION_STEP),
  );
  const winDurWheelValue = Math.min(
    DURATION_MAX,
    Math.max(DURATION_MIN, Math.round(winDur / DURATION_STEP) * DURATION_STEP),
  );

  function save() {
    setError('');
    if (mode!.kind === 'window') {
      const start = new Date(startLocal);
      const err = hasConflict(state.getSnapshot(), STAFF_ID, start, winDur);
      if (err) {
        setError(err);
        return;
      }
      state.addWindow({ staffId: STAFF_ID, start: start.toISOString(), durationMin: winDur, label: 'Окно' });
      toast.success('Пустое окно создано');
      onClose();
      return;
    }

    const nPhone = normalizePhone(phone);
    if (!name.trim()) {
      setError('Укажите имя');
      return;
    }
    if (phoneLast10(nPhone).length < 10) {
      setError('Укажите телефон');
      return;
    }
    if (!serviceIds.length) {
      setError('Выберите услугу');
      return;
    }
    const start = new Date(startLocal);
    if (Number.isNaN(+start)) {
      setError('Некорректная дата');
      return;
    }
    const ignoreId = appt?.id;
    const err = hasConflict(state.getSnapshot(), STAFF_ID, start, duration, ignoreId);
    if (err) {
      setError(err);
      return;
    }

    let clientId = state.clients.find((c) => phoneLast10(c.phone) === phoneLast10(nPhone))?.id;
    if (!clientId) {
      clientId = state.addClient({ name: name.trim(), phone: nPhone });
    } else {
      state.updateClient(clientId, { name: name.trim(), phone: nPhone });
    }

    const base: Appointment = {
      id: appt?.id || uid('apt'),
      clientId,
      staffId: STAFF_ID,
      serviceIds,
      start: start.toISOString(),
      durationMin: duration,
      status: 'waiting',
      note: comment || undefined,
      source: appt?.source || 'journal',
      color: state.settings.visitColor,
      createdAt: appt?.createdAt || new Date().toISOString(),
    };
    const isNew = !appt && mode!.kind !== 'move';
    state.upsertAppointment(base);
    scheduleFlush(() => state.getSnapshot());
    if (isNew) {
      const svcNames = serviceIds
        .map((id) => state.services.find((s) => s.id === id)?.name)
        .filter(Boolean)
        .join(', ');
      notifyOwnerNewVisit(state.getSnapshot(), {
        appointmentId: base.id,
        clientName: name.trim(),
        clientPhone: nPhone,
        serviceNames: svcNames || 'Услуга',
        startISO: base.start,
        durationMin: base.durationMin,
        source: 'journal',
      });
    }
    toast.success(mode!.kind === 'move' ? 'Перенесено' : appt ? 'Сохранено' : 'Запись создана');
    onClose();
  }

  function doDelete() {
    if (!appt) return;
    if (!confirmDel) {
      setConfirmDel(true);
      return;
    }
    state.deleteAppointment(appt.id);
    void flushNow(() => state.getSnapshot());
    toast.success('Запись удалена');
    onClose();
  }

  function cancelVisit() {
    if (!appt) return;
    state.upsertAppointment({ ...appt, status: 'cancelled' });
    void flushNow(() => state.getSnapshot());
    toast.success('Отменено');
    onClose();
  }

  const activeServices = state.services.filter((s) => s.active);

  return (
    <div className="absolute inset-0 z-50 flex flex-col justify-end bg-black/40" onClick={onClose}>
      <div
        className="bg-white rounded-t-2xl max-h-[92%] overflow-y-auto safe-bottom shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 bg-white border-b border-gray-100 px-4 py-3 flex items-center gap-2 z-10">
          <h2 className="flex-1 font-semibold text-gray-900">
            {mode.kind === 'window'
              ? 'Пустое окно'
              : mode.kind === 'move'
                ? 'Перенос'
                : appt
                  ? 'Запись'
                  : 'Новая запись'}
          </h2>
          <button type="button" className="h-9 w-9 flex items-center justify-center rounded-full hover:bg-gray-100" onClick={onClose}>
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="p-4 space-y-3">
          {mode.kind === 'window' ? (
            <>
              <label className="block text-xs text-gray-500">
                Дата
                <input
                  type="date"
                  className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm"
                  value={startLocal.slice(0, 10)}
                  onChange={(e) => {
                    const datePart = e.target.value;
                    const timePart = startLocal.includes('T') ? startLocal.slice(11, 16) : '10:00';
                    setStartLocal(`${datePart}T${timePart}`);
                  }}
                />
              </label>
              <TimeWheels
                hour={startHour}
                minute={startMinute}
                onHourChange={setStartHour}
                onMinuteChange={setStartMinute}
                endHint={endHint}
              />
              <div className="rounded-xl border border-gray-200 px-3 py-2">
                <div className="text-xs text-gray-500 mb-1 text-center">Длительность окна</div>
                <WheelPicker
                  options={DURATION_OPTIONS}
                  value={winDurWheelValue}
                  onChange={setWinDur}
                  aria-label="Длительность окна"
                />
                <p className="text-[11px] text-gray-400 text-center mt-1">Листайте · шаг {DURATION_STEP} мин</p>
              </div>
            </>
          ) : (
            <>
              <label className="block text-xs text-gray-500">
                Телефон
                <input
                  className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2.5 text-base"
                  inputMode="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="+7…"
                />
              </label>
              <label className="block text-xs text-gray-500">
                Имя
                <input
                  className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2.5 text-base"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Имя клиента"
                />
              </label>
              {lastVisitHint && <p className="text-xs text-gray-500 bg-gray-50 rounded-lg px-3 py-2">{lastVisitHint}</p>}

              <div>
                <button
                  type="button"
                  className="w-full flex items-center gap-2 min-h-11 py-1 text-left"
                  onClick={() => setServicesOpen((v) => !v)}
                  aria-expanded={servicesOpen}
                >
                  <span className="text-xs text-gray-500 flex-1">
                    Услуги{' '}
                    <span className="text-gray-400" aria-hidden>
                      {servicesOpen ? '▾' : '▸'}
                    </span>
                    {!servicesOpen && serviceIds.length > 0 && (
                      <span className="ml-1 text-gray-400">({serviceIds.length})</span>
                    )}
                  </span>
                  <span className="text-xs font-medium text-accent">
                    {servicesOpen ? 'Свернуть' : serviceIds.length ? 'Изменить' : 'Выбрать'}
                  </span>
                </button>
                {!servicesOpen ? (
                  <button
                    type="button"
                    className="w-full text-left rounded-xl border border-gray-200 bg-gray-50 px-3 py-2.5 text-sm text-gray-800 active:bg-gray-100"
                    onClick={() => setServicesOpen(true)}
                  >
                    {!servicesSummary ? (
                      <span className="text-gray-400">Не выбрано — нажмите, чтобы выбрать</span>
                    ) : (
                      <span>
                        {servicesSummary.label}
                        {servicesSummary.extra > 0 ? (
                          <span className="text-gray-500"> · ещё {servicesSummary.extra}</span>
                        ) : null}
                      </span>
                    )}
                  </button>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {activeServices.map((s) => (
                      <button
                        key={s.id}
                        type="button"
                        onClick={() => toggleSvc(s.id)}
                        className={cn(
                          'px-3 py-1.5 rounded-full text-sm border min-h-9',
                          serviceIds.includes(s.id)
                            ? 'bg-accent text-white border-accent'
                            : 'border-gray-200 bg-white',
                        )}
                      >
                        {s.name} · {s.durationMin}м
                      </button>
                    ))}
                  </div>
                )}
                <div className="mt-3 rounded-xl border border-gray-200 px-3 py-2">
                  <div className="text-xs text-gray-500 text-center mb-1">
                    Длительность
                    {servicesSum > 0 && servicesSum !== durationMin && (
                      <span className="ml-1 text-gray-400 font-normal">(услуги {servicesSum} мин)</span>
                    )}
                  </div>
                  <WheelPicker
                    options={DURATION_OPTIONS}
                    value={durationWheelValue}
                    onChange={setDurationMin}
                    aria-label="Длительность"
                  />
                  <p className="text-[11px] text-gray-400 text-center mt-1">
                    Листайте · шаг {DURATION_STEP} мин · сейчас {durationMin} мин
                  </p>
                </div>
              </div>

              <div className="rounded-xl border border-gray-200 px-3 py-2.5 text-sm">
                <span className="text-xs text-gray-500 block">Дата и время</span>
                {startLocal ? formatVisitWhen(new Date(startLocal).toISOString()).full : '—'}
                {endHint && (
                  <span className="block text-xs text-gray-400 mt-0.5">Окончание ≈ {endHint}</span>
                )}
              </div>
              <div className="space-y-2">
                <label className="block text-xs text-gray-500">
                  Дата
                  <input
                    type="date"
                    className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm"
                    value={startLocal.slice(0, 10)}
                    onChange={(e) => {
                      const datePart = e.target.value;
                      const timePart = startLocal.includes('T') ? startLocal.slice(11, 16) : '10:00';
                      setStartLocal(`${datePart}T${timePart}`);
                    }}
                  />
                </label>
                <TimeWheels
                  hour={startHour}
                  minute={startMinute}
                  onHourChange={setStartHour}
                  onMinuteChange={setStartMinute}
                  endHint={endHint}
                />
              </div>

              <button
                type="button"
                className="w-full text-left rounded-xl border border-gray-200 px-3 py-2.5 text-sm text-gray-600"
                onClick={() => setShowComment((v) => !v)}
              >
                Комментарий {comment ? '✓' : ''}
              </button>
              {showComment && (
                <textarea
                  className="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm min-h-[72px]"
                  placeholder="Форма, длина, борода, пожелания"
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                />
              )}

              {phoneLast10(phone).length >= 10 && (
                <div className="flex gap-2">
                  <a
                    href={telHref(phone)}
                    className="flex-1 touch-btn rounded-xl border border-gray-200 flex items-center justify-center gap-2 text-sm font-medium"
                  >
                    <Phone className="h-4 w-4" /> Звонок
                  </a>
                  <a
                    href={smsHref(phone, `Напоминание о записи в ${state.settings.studioName}`)}
                    className="flex-1 touch-btn rounded-xl border border-gray-200 flex items-center justify-center gap-2 text-sm font-medium"
                  >
                    <MessageSquare className="h-4 w-4" /> SMS
                  </a>
                </div>
              )}
            </>
          )}

          {error && <p className="text-sm text-red-600">{error}</p>}

          <button
            type="button"
            onClick={save}
            className="touch-btn w-full rounded-xl bg-accent text-white font-semibold"
          >
            Сохранить
          </button>

          {appt && mode.kind === 'edit' && (
            <div className="flex gap-2">
              <button type="button" onClick={cancelVisit} className="flex-1 touch-btn rounded-xl border border-gray-200 text-sm">
                Отменить визит
              </button>
              <button
                type="button"
                onClick={doDelete}
                className={cn(
                  'flex-1 touch-btn rounded-xl text-sm font-medium',
                  confirmDel ? 'bg-red-600 text-white' : 'border border-red-200 text-red-600',
                )}
              >
                {confirmDel ? 'Точно удалить?' : 'Удалить'}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function TimeWheels({
  hour,
  minute,
  onHourChange,
  onMinuteChange,
  endHint,
}: {
  hour: number;
  minute: number;
  onHourChange: (h: number) => void;
  onMinuteChange: (m: number) => void;
  endHint: string | null;
}) {
  return (
    <div className="rounded-xl border border-gray-200 p-3 space-y-1">
      <div className="flex gap-3">
        <div className="flex-1 min-w-0">
          <div className="text-xs text-gray-500 text-center mb-1">Часы</div>
          <WheelPicker
            options={HOUR_OPTIONS}
            value={hour}
            onChange={onHourChange}
            aria-label="Часы"
          />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-xs text-gray-500 text-center mb-1">Минуты</div>
          <WheelPicker
            options={MINUTE_OPTIONS}
            value={minute}
            onChange={onMinuteChange}
            aria-label="Минуты"
          />
        </div>
      </div>
      <p className="text-[11px] text-gray-400 text-center">
        Листайте · минуты шаг {MINUTE_STEP}
        {endHint ? ` · конец ≈ ${endHint}` : ''}
      </p>
    </div>
  );
}

function toLocalInput(d: Date) {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
