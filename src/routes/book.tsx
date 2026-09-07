import { useMemo, useState } from 'react';
import { addDays, format, startOfDay } from 'date-fns';
import { ru } from 'date-fns/locale';
import { useCrm } from '@/lib/store';
import { freeSlots } from '@/lib/slots';
import { uid, STAFF_ID } from '@/lib/seed';
import { toast } from 'sonner';
import type { CrmState } from '@/lib/types';

export function BookPage() {
  const settings = useCrm((s) => s.settings);
  const servicesAll = useCrm((s) => s.services);
  const staff = useCrm((s) => s.staff);
  const appointments = useCrm((s) => s.appointments);
  const windows = useCrm((s) => s.windows);
  const schedules = useCrm((s) => s.schedules);
  const exceptions = useCrm((s) => s.exceptions);
  const clients = useCrm((s) => s.clients);
  const telegramChats = useCrm((s) => s.telegramChats);
  const addClient = useCrm((s) => s.addClient);
  const upsertAppointment = useCrm((s) => s.upsertAppointment);

  const services = servicesAll.filter(
    (x) => x.active && x.online && (settings.onlineServiceIds || []).includes(x.id),
  );
  const staffId = staff.find((x) => x.active)?.id || STAFF_ID;

  const state: CrmState = useMemo(
    () => ({
      clients,
      services: servicesAll,
      staff,
      appointments,
      windows,
      schedules,
      exceptions,
      telegramChats,
      settings,
    }),
    [clients, servicesAll, staff, appointments, windows, schedules, exceptions, telegramChats, settings],
  );

  const [step, setStep] = useState(0);
  const [serviceId, setServiceId] = useState('');
  const [day, setDay] = useState('');
  const [time, setTime] = useState('');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [done, setDone] = useState(false);

  const svc = services.find((s) => s.id === serviceId);

  const days = useMemo(() => {
    if (!svc) return [];
    const out: string[] = [];
    const from = startOfDay(new Date());
    for (let i = 0; i < settings.horizonDays; i++) {
      const d = addDays(from, i);
      const key = format(d, 'yyyy-MM-dd');
      if (freeSlots({ state, staffId, day: d, durationMin: svc.durationMin }).length) out.push(key);
    }
    return out;
  }, [svc, settings.horizonDays, state, staffId]);

  const times = useMemo(() => {
    if (!svc || !day) return [];
    return freeSlots({
      state,
      staffId,
      day: new Date(day + 'T12:00:00'),
      durationMin: svc.durationMin,
    });
  }, [svc, day, state, staffId]);

  if (!settings.onlineEnabled) {
    return (
      <div className="mx-auto flex min-h-screen max-w-md flex-col justify-center p-6 text-center">
        <h1 className="mb-2 text-2xl font-semibold">{settings.studioName}</h1>
        <p className="text-slate-600">Запись по ссылке закрыта</p>
        {settings.phone && (
          <a className="mt-4 text-[#ff7900]" href={`tel:${settings.phone}`}>
            {settings.phone}
          </a>
        )}
      </div>
    );
  }

  if (done) {
    return (
      <div className="mx-auto flex min-h-screen max-w-md flex-col justify-center p-6 text-center">
        <h1 className="mb-2 text-2xl font-semibold">Готово!</h1>
        <p className="text-slate-600">
          {svc?.name}
          <br />
          {day} в {time}
        </p>
      </div>
    );
  }

  const submit = async () => {
    if (!name.trim() || !phone.trim()) return toast.error('Имя и телефон');
    const clientId = addClient({ name: name.trim(), phone: phone.trim() });
    const start = new Date(`${day}T${time}:00`).toISOString();
    const ap = {
      id: uid('apt'),
      clientId,
      staffId,
      serviceIds: [serviceId],
      start,
      durationMin: svc!.durationMin,
      status: 'waiting' as const,
      note: 'Онлайн-запись',
      source: 'online' as const,
      color: settings.onlineColor,
      createdAt: new Date().toISOString(),
    };
    upsertAppointment(ap);
    if (settings.telegramToken && settings.telegramOwnerChatId) {
      void fetch('/api/telegram/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token: settings.telegramToken,
          chatId: settings.telegramOwnerChatId,
          text: `Новая запись\n\n${name}\n${phone}\n${svc?.name}\n${day} в ${time}\n${svc?.durationMin} мин`,
          reply_markup: {
            inline_keyboard: [
              [
                { text: 'Отменить', callback_data: `ow:cl:${ap.id.slice(-10)}` },
                { text: 'Перенести', callback_data: `ow:mv:${ap.id.slice(-10)}` },
              ],
              [{ text: 'Написать клиенту', callback_data: `ow:msg:${ap.id.slice(-10)}` }],
            ],
          },
        }),
      });
    }
    setDone(true);
  };

  return (
    <div className="mx-auto min-h-screen max-w-md bg-white p-4">
      <h1 className="text-2xl font-semibold">{settings.studioName}</h1>
      <p className="mb-4 text-slate-500">{settings.subtitle}</p>

      {step === 0 && (
        <div className="space-y-2">
          <h2 className="font-medium">Услуга</h2>
          {services.map((s) => (
            <button
              key={s.id}
              type="button"
              className="touch-btn flex w-full items-center justify-between rounded-xl border px-4 text-left hover:border-[#ff7900]"
              onClick={() => {
                setServiceId(s.id);
                setStep(1);
              }}
            >
              <span>{s.name}</span>
              <span className="text-sm text-slate-500">
                {s.durationMin} мин · {s.price} ₽
              </span>
            </button>
          ))}
        </div>
      )}

      {step === 1 && (
        <div>
          <button type="button" className="mb-2 text-sm text-[#ff7900]" onClick={() => setStep(0)}>
            ← Назад
          </button>
          <h2 className="mb-2 font-medium">День</h2>
          <div className="grid grid-cols-3 gap-2">
            {days.map((d) => (
              <button
                key={d}
                type="button"
                className="touch-btn rounded-lg border px-2 text-sm hover:border-[#ff7900]"
                onClick={() => {
                  setDay(d);
                  setStep(2);
                }}
              >
                {format(new Date(d + 'T12:00:00'), 'd MMM', { locale: ru })}
              </button>
            ))}
            {!days.length && <p className="col-span-3 text-sm text-slate-500">Нет свободных дней</p>}
          </div>
        </div>
      )}

      {step === 2 && (
        <div>
          <button type="button" className="mb-2 text-sm text-[#ff7900]" onClick={() => setStep(1)}>
            ← Назад
          </button>
          <h2 className="mb-2 font-medium">Время</h2>
          <div className="grid grid-cols-4 gap-2">
            {times.map((t) => (
              <button
                key={t}
                type="button"
                className="touch-btn rounded-lg border text-sm hover:border-[#ff7900]"
                onClick={() => {
                  setTime(t);
                  setStep(3);
                }}
              >
                {t}
              </button>
            ))}
          </div>
        </div>
      )}

      {step === 3 && (
        <div className="space-y-3">
          <button type="button" className="text-sm text-[#ff7900]" onClick={() => setStep(2)}>
            ← Назад
          </button>
          <h2 className="font-medium">Ваши данные</h2>
          <p className="text-sm text-slate-500">
            {svc?.name} · {day} {time}
          </p>
          <input
            className="w-full rounded-md border px-3 py-2"
            placeholder="Имя"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <input
            className="w-full rounded-md border px-3 py-2"
            placeholder="Телефон"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
          />
          <button
            type="button"
            className="touch-btn w-full rounded-md bg-[#ff7900] font-semibold text-white"
            onClick={submit}
          >
            Записаться
          </button>
        </div>
      )}
    </div>
  );
}
