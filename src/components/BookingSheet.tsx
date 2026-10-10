import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { X, Phone, MessageSquare } from 'lucide-react';
import { addDays, format, startOfDay } from 'date-fns';
import { ru } from 'date-fns/locale';
import { toast } from 'sonner';
import { useCrm } from '@/lib/store';
import { STAFF_ID, uid } from '@/lib/seed';
import { phoneLast10, normalizePhone, telHref, smsHref } from '@/lib/phone';
import { hasConflict } from '@/lib/slots';
import { getDayPlan } from '@/lib/schedule';
import { formatVisitWhen } from '@/lib/format';
import { cn } from '@/lib/cn';
import type { Appointment } from '@/lib/types';
import { notifyOwnerNewVisit } from '@/lib/telegram-notify';
import { scheduleFlush, flushNow } from '@/lib/crm-snapshot';
import { rub, visitPrice, visitLines, findService, MAX_QTY_PER_SERVICE, MAX_QTY_TOTAL } from '@/lib/price';
import { visitComment } from '@/lib/note';
import { WheelPicker, buildRangeOptions, type WheelOption } from './WheelPicker';

const DURATION_STEP = 15; // match settings.slotMinutes / service steps
const DURATION_MIN = 15;
const DURATION_MAX = 240;
const DURATION_HOUR_MAX = Math.floor(DURATION_MAX / 60);
const MINUTE_STEP = 10; // start-time minute grid

const HOUR_OPTIONS = buildRangeOptions(0, 23, 1);
const MINUTE_OPTIONS = buildRangeOptions(0, 50, MINUTE_STEP);
const DUR_HOUR_OPTIONS = buildRangeOptions(0, DURATION_HOUR_MAX, 1);
const DUR_MINUTE_OPTIONS = buildRangeOptions(0, 45, DURATION_STEP);

type WheelPanel = null | 'duration' | 'datetime' | 'time';

function formatDurationRu(totalMin: number): string {
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h <= 0) return `${m} мин`;
  if (m === 0) return `${h} ч 00 мин`;
  return `${h} ч ${String(m).padStart(2, '0')} мин`;
}

function buildDateOptions(center: Date, pastDays = 7, futureDays = 90): WheelOption[] {
  const base = startOfDay(center);
  const out: WheelOption[] = [];
  for (let i = -pastDays; i <= futureDays; i++) {
    const d = addDays(base, i);
    const value = +startOfDay(d);
    const label = format(d, 'EEE d MMM', { locale: ru });
    out.push({ value, label });
  }
  return out;
}

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
  /** Quantity per service (only >1 is stored). */
  const [qty, setQty] = useState<Record<string, number>>({});
  const [startLocal, setStartLocal] = useState('');
  const [comment, setComment] = useState('');
  const [showComment, setShowComment] = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);
  const [winDur, setWinDur] = useState(30);
  const [durationMin, setDurationMin] = useState(30);
  const [error, setError] = useState('');
  /** Collapsed by default when editing/moving with services already chosen; expanded for new. */
  const [servicesOpen, setServicesOpen] = useState(true);
  /** Only one wheel expander open at a time; idle = compact summary rows. */
  const [wheelPanel, setWheelPanel] = useState<WheelPanel>(null);

  /** Services of an existing visit: unique ids + quantities (old rows may repeat an id). */
  function loadServices(a: Appointment) {
    const lines = visitLines(state.services, a.serviceIds, a.qty);
    const ids = lines.map((l) => l.id);
    const rest = (a.serviceIds || []).filter((r) => !findService(state.services, r) && !ids.includes(r));
    setServiceIds([...ids, ...rest]);
    setQty(Object.fromEntries(lines.filter((l) => l.qty > 1).map((l) => [l.id, l.qty])));
  }

  useEffect(() => {
    if (!mode) return;
    setError('');
    setConfirmDel(false);
    setWheelPanel(null);
    if (mode.kind === 'new') {
      setPhone('');
      setName('');
      setServiceIds([]);
      setQty({});
      setStartLocal(toLocalInput(sensibleStart(mode.start)));
      setComment('');
      setShowComment(false);
      setDurationMin(30);
      setServicesOpen(true);
    } else if (mode.kind === 'edit' && appt) {
      setPhone(client0?.phone || '');
      setName(client0?.name || '');
      loadServices(appt);
      setStartLocal(toLocalInput(new Date(appt.start)));
      setComment(visitComment(appt));
      setShowComment(!!visitComment(appt));
      setDurationMin(appt.durationMin || 30);
      setServicesOpen(!(appt.serviceIds.length > 0));
    } else if (mode.kind === 'move' && appt) {
      setPhone(client0?.phone || '');
      setName(client0?.name || '');
      loadServices(appt);
      setStartLocal(toLocalInput(mode.start));
      setComment(visitComment(appt));
      setShowComment(!!visitComment(appt));
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

  const servicesSum = useMemo(
    () => visitPrice(state.services, serviceIds, qty).durationMin,
    [serviceIds, qty, state.services],
  );

  const servicesSummary = useMemo(() => {
    const selected = serviceIds
      .map((id) => state.services.find((s) => s.id === id))
      .filter((s): s is NonNullable<typeof s> => !!s);
    if (!selected.length) return null;
    const first = selected[0];
    const extra = selected.length - 1;
    const q = qty[first.id] || 1;
    return {
      label: `${first.name}${q > 1 ? ` ×${q}` : ''} · ${first.durationMin * q}м`,
      extra,
      count: selected.length,
    };
  }, [serviceIds, qty, state.services]);

  const pricedSelection = useMemo(() => visitPrice(state.services, serviceIds, qty), [serviceIds, qty, state.services]);

  const duration = mode?.kind === 'window' ? winDur : durationMin;

  const dateOptions = useMemo(() => {
    const center = startLocal ? new Date(startLocal) : new Date();
    const safe = Number.isNaN(+center) ? new Date() : center;
    return buildDateOptions(safe);
  }, [startLocal ? startLocal.slice(0, 10) : '']);

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
    const svc = visitPrice(state.services, last.serviceIds, last.qty).label;
    return `Последний визит: ${formatVisitWhen(last.start).full}${svc ? ` · ${svc}` : ''}`;
  }, [phone, state.clients, state.appointments, state.services]);

  if (!open || !mode) return null;

  function togglePanel(panel: Exclude<WheelPanel, null>) {
    setWheelPanel((cur) => (cur === panel ? null : panel));
  }

  function applyServices(nextIds: string[], nextQty: Record<string, number>) {
    setServiceIds(nextIds);
    setQty(nextQty);
    setDurationMin(visitPrice(state.services, nextIds, nextQty).durationMin || 30);
  }

  function toggleSvc(id: string) {
    if (serviceIds.includes(id)) {
      const nq = { ...qty };
      delete nq[id];
      applyServices(serviceIds.filter((x) => x !== id), nq);
    } else {
      applyServices([...serviceIds, id], qty);
    }
  }

  function changeQty(id: string, delta: number) {
    const cur = qty[id] || 1;
    const next = Math.max(1, Math.min(MAX_QTY_PER_SERVICE, cur + delta));
    const totalOthers = serviceIds.reduce((sum, x) => sum + (x === id ? 0 : qty[x] || 1), 0);
    if (totalOthers + next > MAX_QTY_TOTAL) return;
    const nq = { ...qty };
    if (next > 1) nq[id] = next;
    else delete nq[id];
    applyServices(serviceIds, nq);
  }

  function setStartHour(hour: number) {
    setStartLocal((prev) => {
      const d = prev ? new Date(prev) : new Date();
      if (Number.isNaN(+d)) return prev;
      d.setHours(hour);
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

  function setStartDateValue(dayMs: number) {
    setStartLocal((prev) => {
      const d = prev ? new Date(prev) : new Date();
      if (Number.isNaN(+d)) return prev;
      const day = new Date(dayMs);
      d.setFullYear(day.getFullYear(), day.getMonth(), day.getDate());
      return toLocalInput(d);
    });
  }

  function clampDuration(total: number) {
    return Math.min(DURATION_MAX, Math.max(DURATION_MIN, Math.round(total / DURATION_STEP) * DURATION_STEP));
  }

  function setDurationHours(hours: number, currentTotal: number, setter: (n: number) => void) {
    let mins = currentTotal % 60;
    mins = Math.round(mins / DURATION_STEP) * DURATION_STEP;
    if (mins >= 60) mins = 60 - DURATION_STEP;
    let total = hours * 60 + mins;
    if (total < DURATION_MIN) total = DURATION_MIN;
    if (total > DURATION_MAX) total = DURATION_MAX;
    setter(clampDuration(total));
  }

  function setDurationMinutes(mins: number, currentTotal: number, setter: (n: number) => void) {
    const hours = Math.floor(currentTotal / 60);
    let total = hours * 60 + mins;
    if (total < DURATION_MIN) total = DURATION_MIN;
    if (total > DURATION_MAX) total = DURATION_MAX;
    setter(clampDuration(total));
  }

  const startParsed = startLocal ? new Date(startLocal) : null;
  const startValid = !!startParsed && !Number.isNaN(+startParsed);
  const startHour = startValid ? startParsed!.getHours() : 10;
  const startMinuteRaw = startValid ? startParsed!.getMinutes() : 0;
  const startMinute =
    Math.min(60 - MINUTE_STEP, Math.max(0, Math.round(startMinuteRaw / MINUTE_STEP) * MINUTE_STEP));
  const startDateValue = startValid ? +startOfDay(startParsed!) : +startOfDay(new Date());
  const endHint =
    startValid && duration
      ? formatVisitWhen(new Date(+startParsed! + duration * 60000).toISOString()).time
      : null;

  const durationClamped = clampDuration(durationMin);
  const winDurClamped = clampDuration(winDur);
  const durHours = Math.floor(durationClamped / 60);
  const durMins = durationClamped % 60;
  const winHours = Math.floor(winDurClamped / 60);
  const winMins = winDurClamped % 60;

  const datetimeSummary = startValid
    ? format(startParsed!, "d MMM, HH:mm", { locale: ru })
    : '—';

  function saveEmptyWindow(duration: number) {
    const start = new Date(startLocal);
    if (Number.isNaN(+start)) {
      setError('Некорректная дата');
      return;
    }
    const dur = clampDuration(duration || 30);
    const err = hasConflict(state.getSnapshot(), STAFF_ID, start, dur);
    if (err) {
      setError(err);
      return;
    }
    state.addWindow({
      staffId: STAFF_ID,
      start: start.toISOString(),
      durationMin: dur,
      label: 'Окно',
    });
    scheduleFlush(() => state.getSnapshot());
    toast.success('Пустое окно создано');
    onClose();
  }

  function save() {
    setError('');
    if (mode!.kind === 'window') {
      saveEmptyWindow(winDur);
      return;
    }

    const nPhone = normalizePhone(phone);
    const emptyClient = !name.trim() && phoneLast10(nPhone).length < 10;
    const emptyServices = !serviceIds.length;
    // Новая запись без клиента и услуг → свободное окно (как в YCLIENTS).
    if (mode!.kind === 'new' && emptyClient && emptyServices) {
      saveEmptyWindow(durationMin);
      return;
    }

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
      // Keep reminders / Telegram link / creation info of an existing visit (bot, online).
      ...(appt || {}),
      id: appt?.id || uid('apt'),
      clientId,
      staffId: STAFF_ID,
      serviceIds,
      qty: serviceIds.some((id) => (qty[id] || 1) > 1)
        ? Object.fromEntries(serviceIds.filter((id) => (qty[id] || 1) > 1).map((id) => [id, qty[id]]))
        : undefined,
      start: start.toISOString(),
      durationMin: duration,
      status: 'waiting',
      note: comment.trim() || (appt?.note && !visitComment(appt) ? appt.note : undefined),
      source: appt?.source || 'journal',
      color: appt?.color || state.settings.visitColor,
      createdAt: appt?.createdAt || new Date().toISOString(),
    };
    const isNew = !appt && mode!.kind !== 'move';
    state.upsertAppointment(base);
    scheduleFlush(() => state.getSnapshot());
    if (isNew) {
      const svcNames = pricedSelection.label;
      notifyOwnerNewVisit(state.getSnapshot(), {
        appointmentId: base.id,
        clientName: name.trim(),
        clientPhone: nPhone,
        serviceNames: svcNames || 'Услуга',
        totalPrice: pricedSelection.total,
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
              <CollapsibleWheel
                open={wheelPanel === 'datetime'}
                onToggle={() => togglePanel('datetime')}
                label="Дата и время"
                summary={datetimeSummary}
              >
                <DateTimeWheels
                  dateOptions={dateOptions}
                  dateValue={startDateValue}
                  hour={startHour}
                  minute={startMinute}
                  onDateChange={setStartDateValue}
                  onHourChange={setStartHour}
                  onMinuteChange={setStartMinute}
                  endHint={endHint}
                />
              </CollapsibleWheel>
              <CollapsibleWheel
                open={wheelPanel === 'duration'}
                onToggle={() => togglePanel('duration')}
                label="Длительность окна"
                summary={formatDurationRu(winDurClamped)}
              >
                <DurationWheels
                  hours={winHours}
                  minutes={winMins}
                  onHoursChange={(h) => setDurationHours(h, winDurClamped, setWinDur)}
                  onMinutesChange={(m) => setDurationMinutes(m, winDurClamped, setWinDur)}
                />
              </CollapsibleWheel>
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
                        {pricedSelection.total > 0 && (
                          <span className="text-gray-900 font-semibold"> · {rub(pricedSelection.total)}</span>
                        )}
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
                        {s.name} · {s.durationMin}м{rub(s.price) ? ` · ${rub(s.price)}` : ''}
                      </button>
                    ))}
                  </div>
                )}
                {pricedSelection.items.length > 0 && (
                  <div className="mt-2 rounded-xl bg-gray-50 border border-gray-100 px-3 py-2 text-sm" data-testid="price-summary">
                    {pricedSelection.items.map((x) => (
                      <div key={x.id} className="flex items-center justify-between gap-2 text-gray-700 py-0.5">
                        <span className="truncate flex-1 min-w-0">{x.name}</span>
                        <span className="flex items-center gap-1 shrink-0" data-testid={`qty-${x.id}`}>
                          <button
                            type="button"
                            aria-label="Меньше"
                            className="h-8 w-8 rounded-lg border border-gray-200 bg-white text-base leading-none disabled:opacity-30"
                            disabled={x.qty <= 1}
                            onClick={() => changeQty(x.id, -1)}
                          >
                            −
                          </button>
                          <span className="w-5 text-center font-semibold tabular-nums">{x.qty}</span>
                          <button
                            type="button"
                            aria-label="Больше"
                            className="h-8 w-8 rounded-lg border border-gray-200 bg-white text-base leading-none disabled:opacity-30"
                            disabled={x.qty >= MAX_QTY_PER_SERVICE}
                            onClick={() => changeQty(x.id, 1)}
                          >
                            +
                          </button>
                        </span>
                        <span className="tabular-nums whitespace-nowrap w-20 text-right">{x.price ? rub(x.sum) : ''}</span>
                      </div>
                    ))}
                    {pricedSelection.total > 0 && (
                      <div className="flex justify-between gap-3 mt-1 pt-1 border-t border-gray-200 font-semibold text-gray-900">
                        <span>Итого:</span>
                        <span className="tabular-nums whitespace-nowrap">{rub(pricedSelection.total)}</span>
                      </div>
                    )}
                  </div>
                )}
              </div>

              <CollapsibleWheel
                open={wheelPanel === 'duration'}
                onToggle={() => togglePanel('duration')}
                label="Длительность"
                summary={
                  servicesSum > 0 && servicesSum !== durationMin
                    ? `${formatDurationRu(durationClamped)} · услуги ${servicesSum} мин`
                    : formatDurationRu(durationClamped)
                }
              >
                <DurationWheels
                  hours={durHours}
                  minutes={durMins}
                  onHoursChange={(h) => setDurationHours(h, durationClamped, setDurationMin)}
                  onMinutesChange={(m) => setDurationMinutes(m, durationClamped, setDurationMin)}
                />
              </CollapsibleWheel>

              <CollapsibleWheel
                open={wheelPanel === 'datetime'}
                onToggle={() => togglePanel('datetime')}
                label="Дата и время"
                summary={
                  endHint ? `${datetimeSummary} · до ≈ ${endHint}` : datetimeSummary
                }
              >
                <DateTimeWheels
                  dateOptions={dateOptions}
                  dateValue={startDateValue}
                  hour={startHour}
                  minute={startMinute}
                  onDateChange={setStartDateValue}
                  onHourChange={setStartHour}
                  onMinuteChange={setStartMinute}
                  endHint={endHint}
                />
              </CollapsibleWheel>

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

          {mode.kind === 'new' && !name.trim() && !phone.trim() && !serviceIds.length && (
            <p className="text-xs text-gray-500 text-center">
              Без клиента и услуг сохранится как свободное окно
            </p>
          )}

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

function CollapsibleWheel({
  open,
  onToggle,
  label,
  summary,
  children,
}: {
  open: boolean;
  onToggle: () => void;
  label: string;
  summary: string;
  children: ReactNode;
}) {
  return (
    <div className="rounded-xl border border-gray-200 overflow-hidden">
      <button
        type="button"
        className="w-full flex items-center gap-2 min-h-11 px-3 py-2.5 text-left active:bg-gray-50"
        onClick={onToggle}
        aria-expanded={open}
      >
        <span className="flex-1 min-w-0">
          <span className="text-xs text-gray-500 block">{label}</span>
          <span className="text-sm font-medium text-gray-900 truncate block">{summary}</span>
        </span>
        <span className="text-gray-400 text-sm shrink-0" aria-hidden>
          {open ? '▾' : '▸'}
        </span>
      </button>
      {open && <div className="border-t border-gray-100 px-3 py-2">{children}</div>}
    </div>
  );
}

function DurationWheels({
  hours,
  minutes,
  onHoursChange,
  onMinutesChange,
}: {
  hours: number;
  minutes: number;
  onHoursChange: (h: number) => void;
  onMinutesChange: (m: number) => void;
}) {
  return (
    <div className="space-y-1">
      <div className="flex gap-3">
        <div className="flex-1 min-w-0">
          <div className="text-xs text-gray-500 text-center mb-1">Часы</div>
          <WheelPicker
            options={DUR_HOUR_OPTIONS}
            loop
            value={hours}
            onChange={onHoursChange}
            aria-label="Часы длительности"
          />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-xs text-gray-500 text-center mb-1">Минуты</div>
          <WheelPicker
            options={DUR_MINUTE_OPTIONS}
            loop
            value={minutes}
            onChange={onMinutesChange}
            aria-label="Минуты длительности"
          />
        </div>
      </div>
      <p className="text-[11px] text-gray-400 text-center">
        Листайте · минуты шаг {DURATION_STEP} · {formatDurationRu(hours * 60 + minutes)}
      </p>
    </div>
  );
}

function DateTimeWheels({
  dateOptions,
  dateValue,
  hour,
  minute,
  onDateChange,
  onHourChange,
  onMinuteChange,
  endHint,
}: {
  dateOptions: WheelOption[];
  dateValue: number;
  hour: number;
  minute: number;
  onDateChange: (dayMs: number) => void;
  onHourChange: (h: number) => void;
  onMinuteChange: (m: number) => void;
  endHint: string | null;
}) {
  const nearestDate =
    dateOptions.find((o) => o.value === dateValue)?.value ??
    dateOptions.reduce((best, o) =>
      Math.abs(o.value - dateValue) < Math.abs(best - dateValue) ? o.value : best,
    dateOptions[0]?.value ?? dateValue);

  return (
    <div className="space-y-1">
      <div className="flex gap-2">
        <div className="flex-[1.4] min-w-0">
          <div className="text-xs text-gray-500 text-center mb-1">Дата</div>
          <WheelPicker
            options={dateOptions}
            value={nearestDate}
            onChange={onDateChange}
            aria-label="Дата"
          />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-xs text-gray-500 text-center mb-1">Часы</div>
          <WheelPicker
            options={HOUR_OPTIONS}
            loop
            value={hour}
            onChange={onHourChange}
            aria-label="Часы"
          />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-xs text-gray-500 text-center mb-1">Мин</div>
          <WheelPicker
            options={MINUTE_OPTIONS}
            loop
            value={minute}
            onChange={onMinuteChange}
            aria-label="Минуты"
          />
        </div>
      </div>
      <p className="text-[11px] text-gray-400 text-center">
        Листайте · время шаг {MINUTE_STEP} мин
        {endHint ? ` · конец ≈ ${endHint}` : ''}
      </p>
    </div>
  );
}

/**
 * «+» passes the raw current time (e.g. 21:59) — not on the wheel grid.
 * Pick the next sensible start: next 10-min step within today's hours,
 * else the start of the next working day. Slot taps (already on grid) are kept.
 */
function sensibleStart(from: Date): Date {
  if (from.getMinutes() % MINUTE_STEP === 0 && from.getSeconds() === 0) return from;
  const st = useCrm.getState();
  const schedule = st.schedules.find((x) => x.staffId === STAFF_ID);
  const up = new Date(from);
  up.setSeconds(0, 0);
  up.setMinutes(Math.ceil((up.getMinutes() + 1) / MINUTE_STEP) * MINUTE_STEP);
  for (let i = 0; i < 31; i++) {
    const day = addDays(from, i);
    const plan = getDayPlan(schedule, st.exceptions, STAFF_ID, day);
    if (!plan.working || !plan.start || !plan.end) continue;
    const cand = i === 0 && up > plan.start ? up : plan.start;
    if (cand < plan.end) return cand;
  }
  return up;
}

function toLocalInput(d: Date) {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
