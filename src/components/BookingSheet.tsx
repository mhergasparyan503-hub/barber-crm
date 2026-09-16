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
import { scheduleFlush } from '@/lib/crm-snapshot';

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
  const [showDt, setShowDt] = useState(false);
  const [showComment, setShowComment] = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);
  const [winDur, setWinDur] = useState(30);
  const [error, setError] = useState('');

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
      setShowDt(false);
      setShowComment(false);
    } else if (mode.kind === 'edit' && appt) {
      setPhone(client0?.phone || '');
      setName(client0?.name || '');
      setServiceIds([...appt.serviceIds]);
      setStartLocal(toLocalInput(new Date(appt.start)));
      setComment(appt.note || '');
      setShowDt(false);
      setShowComment(!!appt.note);
    } else if (mode.kind === 'move' && appt) {
      setPhone(client0?.phone || '');
      setName(client0?.name || '');
      setServiceIds([...appt.serviceIds]);
      setStartLocal(toLocalInput(mode.start));
      setComment(appt.note || '');
      setShowDt(true);
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

  const duration = useMemo(() => {
    if (mode?.kind === 'window') return winDur;
    return serviceIds.reduce((sum, id) => {
      const s = state.services.find((x) => x.id === id);
      return sum + (s?.durationMin || 0);
    }, 0) || 30;
  }, [serviceIds, state.services, mode, winDur]);

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
    setServiceIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

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
    toast.success('Запись удалена');
    onClose();
  }

  function cancelVisit() {
    if (!appt) return;
    state.upsertAppointment({ ...appt, status: 'cancelled' });
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
                Начало
                <input
                  type="datetime-local"
                  className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm"
                  value={startLocal}
                  onChange={(e) => setStartLocal(e.target.value)}
                />
              </label>
              <div className="flex gap-2 flex-wrap">
                {[15, 30, 45, 60, 90].map((d) => (
                  <button
                    key={d}
                    type="button"
                    onClick={() => setWinDur(d)}
                    className={cn(
                      'px-3 py-2 rounded-full text-sm border',
                      winDur === d ? 'bg-accent text-white border-accent' : 'border-gray-200',
                    )}
                  >
                    {d} мин
                  </button>
                ))}
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
                <div className="text-xs text-gray-500 mb-1.5">Услуги</div>
                <div className="flex flex-wrap gap-2">
                  {activeServices.map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => toggleSvc(s.id)}
                      className={cn(
                        'px-3 py-1.5 rounded-full text-sm border',
                        serviceIds.includes(s.id)
                          ? 'bg-accent text-white border-accent'
                          : 'border-gray-200 bg-white',
                      )}
                    >
                      {s.name} · {s.durationMin}м
                    </button>
                  ))}
                </div>
                <p className="text-xs text-gray-400 mt-1">Длительность: {duration} мин</p>
              </div>

              <button
                type="button"
                className="w-full text-left rounded-xl border border-gray-200 px-3 py-2.5 text-sm"
                onClick={() => setShowDt((v) => !v)}
              >
                <span className="text-xs text-gray-500 block">Дата и время</span>
                {startLocal ? formatVisitWhen(new Date(startLocal).toISOString()).full : '—'}
              </button>
              {showDt && (
                <input
                  type="datetime-local"
                  className="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm"
                  value={startLocal}
                  onChange={(e) => setStartLocal(e.target.value)}
                />
              )}

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

function toLocalInput(d: Date) {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
