import { useMemo, useState } from 'react';
import { format, parseISO, startOfDay } from 'date-fns';
import { ru } from 'date-fns/locale';
import { useCrm } from '@/lib/store';
import { STAFF_ID, uid } from '@/lib/seed';
import { availableDays, freeSlots } from '@/lib/slots';
import { normalizePhone, phoneLast10 } from '@/lib/phone';
import { cn } from '@/lib/cn';
import { notifyOwnerNewVisit } from '@/lib/telegram-notify';
import { scheduleFlush } from '@/lib/crm-snapshot';

type Step = 'service' | 'day' | 'slot' | 'form' | 'done';

export function BookPage() {
  const state = useCrm();
  const settings = state.settings;
  const [step, setStep] = useState<Step>('service');
  const [serviceId, setServiceId] = useState('');
  const [day, setDay] = useState('');
  const [slot, setSlot] = useState('');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [error, setError] = useState('');

  const onlineServices = state.services.filter(
    (s) => s.active && s.online && settings.onlineServiceIds.includes(s.id),
  );
  const service = onlineServices.find((s) => s.id === serviceId);
  const snap = state.getSnapshot();

  const days = useMemo(() => {
    if (!service) return [];
    return availableDays(snap, STAFF_ID, service.durationMin);
  }, [serviceId, state.appointments, state.windows, state.exceptions, state.schedules, settings.horizonDays]);

  const slots = useMemo(() => {
    if (!service || !day) return [];
    return freeSlots({ state: snap, staffId: STAFF_ID, day: parseISO(day), durationMin: service.durationMin });
  }, [serviceId, day, state.appointments, state.windows]);

  if (!settings.onlineEnabled) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-6 text-center bg-white">
        <h1 className="text-xl font-bold mb-2">{settings.studioName}</h1>
        <p className="text-gray-500 mb-4">Запись по ссылке закрыта</p>
        {settings.phone && <a className="text-accent font-medium" href={`tel:${normalizePhone(settings.phone)}`}>{settings.phone}</a>}
      </div>
    );
  }

  function submit() {
    setError('');
    const nPhone = normalizePhone(phone);
    if (!name.trim() || phoneLast10(nPhone).length < 10) {
      setError('Укажите имя и телефон');
      return;
    }
    if (!service || !day || !slot) return;
    let clientId = state.clients.find((c) => phoneLast10(c.phone) === phoneLast10(nPhone))?.id;
    if (!clientId) clientId = state.addClient({ name: name.trim(), phone: nPhone });
    else state.updateClient(clientId, { name: name.trim(), phone: nPhone });

    const start = parseISO(`${day}T${slot}:00`);
    const aptId = uid('apt');
    const startISO = start.toISOString();
    state.upsertAppointment({
      id: aptId,
      clientId,
      staffId: STAFF_ID,
      serviceIds: [service.id],
      start: startISO,
      durationMin: service.durationMin,
      status: 'waiting',
      note: 'Онлайн-запись',
      source: 'online',
      color: settings.onlineColor,
      createdAt: new Date().toISOString(),
    });
    scheduleFlush(() => state.getSnapshot());
    notifyOwnerNewVisit(state.getSnapshot(), {
      appointmentId: aptId,
      clientName: name.trim(),
      clientPhone: nPhone,
      serviceNames: service.name,
      startISO,
      durationMin: service.durationMin,
      source: 'online',
    });
    setStep('done');
  }

  return (
    <div className="flex-1 overflow-y-auto bg-white safe-top safe-bottom">
      <div className="px-4 pt-6 pb-4 border-b border-gray-100">
        <h1 className="text-xl font-bold">{settings.studioName}</h1>
        <p className="text-sm text-gray-500">{settings.subtitle}</p>
      </div>

      <div className="p-4">
        {step === 'service' && (
          <div className="space-y-2">
            <h2 className="font-semibold mb-3">Выберите услугу</h2>
            {onlineServices.map((s) => (
              <button
                key={s.id}
                type="button"
                className="w-full text-left rounded-2xl border border-gray-200 p-4 hover:border-accent"
                onClick={() => {
                  setServiceId(s.id);
                  setStep('day');
                }}
              >
                <div className="font-medium">{s.name}</div>
                <div className="text-sm text-gray-500">
                  {s.durationMin} мин · {s.price.toLocaleString('ru-RU')} ₽
                </div>
              </button>
            ))}
          </div>
        )}

        {step === 'day' && (
          <div>
            <button type="button" className="text-sm text-accent mb-3" onClick={() => setStep('service')}>
              ← Услуга
            </button>
            <h2 className="font-semibold mb-3">День</h2>
            <div className="grid grid-cols-2 gap-2">
              {days.map((d) => (
                <button
                  key={d}
                  type="button"
                  className="rounded-xl border border-gray-200 p-3 text-sm capitalize"
                  onClick={() => {
                    setDay(d);
                    setStep('slot');
                  }}
                >
                  {format(parseISO(d), 'EEEE, d MMM', { locale: ru })}
                </button>
              ))}
              {!days.length && <p className="text-gray-400 text-sm col-span-2">Нет свободных дней</p>}
            </div>
          </div>
        )}

        {step === 'slot' && (
          <div>
            <button type="button" className="text-sm text-accent mb-3" onClick={() => setStep('day')}>
              ← День
            </button>
            <h2 className="font-semibold mb-3">Время</h2>
            <div className="flex flex-wrap gap-2">
              {slots.map((t) => (
                <button
                  key={t}
                  type="button"
                  className="px-4 py-2.5 rounded-xl border border-gray-200 text-sm font-medium"
                  onClick={() => {
                    setSlot(t);
                    setStep('form');
                  }}
                >
                  {t}
                </button>
              ))}
              {!slots.length && <p className="text-gray-400 text-sm">Нет слотов</p>}
            </div>
          </div>
        )}

        {step === 'form' && (
          <div className="space-y-3">
            <button type="button" className="text-sm text-accent" onClick={() => setStep('slot')}>
              ← Время
            </button>
            <p className="text-sm text-gray-600 capitalize">
              {service?.name} · {day && format(parseISO(day), 'd MMMM', { locale: ru })} в {slot}
            </p>
            <input
              className="w-full rounded-xl border border-gray-200 px-3 py-3"
              placeholder="Имя"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <input
              className="w-full rounded-xl border border-gray-200 px-3 py-3"
              placeholder="Телефон"
              inputMode="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
            />
            {error && <p className="text-sm text-red-600">{error}</p>}
            <button type="button" onClick={submit} className="touch-btn w-full rounded-xl bg-accent text-white font-semibold">
              Записаться
            </button>
          </div>
        )}

        {step === 'done' && (
          <div className="text-center py-10">
            <div className="text-4xl mb-3">✓</div>
            <h2 className="text-xl font-bold mb-2">Вы записаны</h2>
            <p className="text-gray-600 capitalize">
              {service?.name}
              <br />
              {day && format(parseISO(day), "EEEE, d MMMM", { locale: ru })} в {slot}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
