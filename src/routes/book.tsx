import { useEffect, useMemo, useState } from 'react';
import { format, parseISO } from 'date-fns';
import { ru } from 'date-fns/locale';
import { useCrm } from '@/lib/store';
import { STAFF_ID, uid } from '@/lib/seed';
import { availableDays, freeSlots } from '@/lib/slots';
import { normalizePhone, phoneLast10 } from '@/lib/phone';
import { cn } from '@/lib/cn';
import { notifyOwnerNewVisit } from '@/lib/telegram-notify';
import { loadSnapshot, scheduleFlush } from '@/lib/crm-snapshot';
import {
  REMINDER_PRESETS,
  buildReminders,
  mskWallISO,
} from '@/lib/msk';

type Step = 'service' | 'day' | 'slot' | 'form' | 'remind' | 'done';

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
  const [selectedReminders, setSelectedReminders] = useState<string[]>([]);
  const [customText, setCustomText] = useState('');
  const [showCustom, setShowCustom] = useState(false);

  const [bootstrapping, setBootstrapping] = useState(true);

  // Always prefer server CRM snapshot on /book so stale localStorage cannot
  // hide services (e.g. only 3 leftover onlineServiceIds).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const remote = await loadSnapshot();
        if (cancelled || !remote) return;
        const cur = useCrm.getState();
        useCrm.setState({
          services: remote.services?.length ? remote.services : cur.services,
          staff: remote.staff?.length ? remote.staff : cur.staff,
          appointments: remote.appointments || [],
          windows: remote.windows || [],
          schedules: remote.schedules?.length ? remote.schedules : cur.schedules,
          exceptions: remote.exceptions || [],
          settings: {
            ...cur.settings,
            ...(remote.settings || {}),
            // keep any local-only secrets out of the public page if empty remote
            telegramToken: cur.settings.telegramToken || remote.settings?.telegramToken || '',
          },
        });
      } catch {
        /* ignore — fall back to local/seed */
      } finally {
        if (!cancelled) setBootstrapping(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const onlineServices = state.services.filter((s) => {
    if (s.active === false) return false;
    const ids = settings.onlineServiceIds || [];
    if (ids.length) return ids.includes(s.id);
    return s.online !== false;
  });
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

  const botUsername = (settings.telegramBotUsername || '').replace(/^@/, '');
  const botUrl = botUsername ? `https://t.me/${botUsername}` : '';

  if (bootstrapping) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-6 text-center bg-white">
        <p className="text-gray-500">Загрузка услуг…</p>
      </div>
    );
  }

  if (!settings.onlineEnabled) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-6 text-center bg-white">
        <h1 className="text-xl font-bold mb-2">{settings.studioName}</h1>
        <p className="text-gray-500 mb-4">Запись по ссылке закрыта</p>
        {settings.phone && <a className="text-accent font-medium" href={`tel:${normalizePhone(settings.phone)}`}>{settings.phone}</a>}
      </div>
    );
  }

  function parseCustomMins(text: string): number | null {
    const t = text.trim().toLowerCase().replace(',', '.');
    if (!t) return null;
    const before = t.match(/^(?:за\s+)?(\d+)\s*(мин|минут|м|час|часа|часов|ч)?$/);
    if (before) {
      const n = Number(before[1]);
      if (!Number.isFinite(n) || n <= 0) return null;
      const unit = before[2] || 'мин';
      if (unit.startsWith('ч')) return n * 60;
      return n;
    }
    return null;
  }

  function goToRemind() {
    setError('');
    const nPhone = normalizePhone(phone);
    if (!name.trim() || phoneLast10(nPhone).length < 10) {
      setError('Укажите имя и телефон');
      return;
    }
    setStep('remind');
  }

  function toggleReminder(id: string) {
    setSelectedReminders((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  }

  function submit(skipReminders: boolean) {
    setError('');
    const nPhone = normalizePhone(phone);
    if (!name.trim() || phoneLast10(nPhone).length < 10) {
      setError('Укажите имя и телефон');
      return;
    }
    if (!service || !day || !slot) return;

    const customMins = !skipReminders && showCustom ? parseCustomMins(customText) : null;
    if (!skipReminders && showCustom && customText.trim() && customMins == null) {
      setError('Своё напоминание: например «45» или «за 1 ч»');
      return;
    }

    let clientId = state.clients.find((c) => phoneLast10(c.phone) === phoneLast10(nPhone))?.id;
    if (!clientId) clientId = state.addClient({ name: name.trim(), phone: nPhone });
    else state.updateClient(clientId, { name: name.trim(), phone: nPhone });

    const startISO = mskWallISO(day, slot);
    const reminders = skipReminders
      ? []
      : buildReminders(startISO, selectedReminders, customMins);

    // Remember prefs like the Telegram bot
    if (!skipReminders) {
      const minsPrefs = REMINDER_PRESETS.filter(
        (p) => selectedReminders.includes(p.id) && p.mins != null,
      ).map((p) => p.mins!);
      if (customMins) minsPrefs.push(customMins);
      const patch: { reminderPrefs?: number[]; reminderMorning?: boolean } = {};
      if (minsPrefs.length) {
        const existing = state.clients.find((c) => c.id === clientId)?.reminderPrefs || [];
        patch.reminderPrefs = [...new Set([...existing, ...minsPrefs])];
      }
      if (selectedReminders.includes('morning')) {
        patch.reminderMorning = true;
      }
      if (Object.keys(patch).length) state.updateClient(clientId, patch);
    }

    const aptId = uid('apt');
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
      reminders,
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
            <button
              type="button"
              onClick={goToRemind}
              className="touch-btn w-full rounded-xl bg-accent text-white font-semibold"
            >
              Далее
            </button>
          </div>
        )}

        {step === 'remind' && (
          <div className="space-y-3">
            <button type="button" className="text-sm text-accent" onClick={() => setStep('form')}>
              ← Контакты
            </button>
            <h2 className="font-semibold">Когда напомнить?</h2>
            <p className="text-sm text-gray-500">
              Можно выбрать несколько. Время — по Москве (МСК). Напоминания приходят в Telegram-боте;
              там же можно перенести или отменить запись.
            </p>
            {botUrl ? (
              <a
                href={botUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center justify-center w-full touch-btn rounded-xl bg-[#229ED9] text-white font-semibold text-sm"
              >
                Открыть бота{botUsername ? ` @{botUsername}` : ''}
              </a>
            ) : (
              <p className="text-xs text-gray-400">
                Ссылка на бота появится, когда мастер подключит Telegram в настройках.
              </p>
            )}
            <div className="flex flex-wrap gap-2">
              {REMINDER_PRESETS.map((p) => {
                const on = selectedReminders.includes(p.id);
                return (
                  <button
                    key={p.id}
                    type="button"
                    className={cn(
                      'px-3.5 py-2.5 rounded-xl border text-sm font-medium transition-colors',
                      on
                        ? 'border-accent bg-accent/10 text-accent'
                        : 'border-gray-200 text-gray-800',
                    )}
                    onClick={() => toggleReminder(p.id)}
                  >
                    {p.label}
                  </button>
                );
              })}
              <button
                type="button"
                className={cn(
                  'px-3.5 py-2.5 rounded-xl border text-sm font-medium',
                  showCustom ? 'border-accent bg-accent/10 text-accent' : 'border-gray-200',
                )}
                onClick={() => setShowCustom((v) => !v)}
              >
                Своё…
              </button>
            </div>
            {showCustom && (
              <input
                className="w-full rounded-xl border border-gray-200 px-3 py-3 text-sm"
                placeholder="Например: 45 или за 1 ч"
                value={customText}
                onChange={(e) => setCustomText(e.target.value)}
              />
            )}
            {error && <p className="text-sm text-red-600">{error}</p>}
            <button
              type="button"
              onClick={() => submit(false)}
              disabled={!selectedReminders.length && !(showCustom && customText.trim())}
              className="touch-btn w-full rounded-xl bg-accent text-white font-semibold disabled:opacity-40"
            >
              Записаться
              {(selectedReminders.length > 0 || (showCustom && customText.trim())) &&
                ` · ${selectedReminders.length + (showCustom && customText.trim() ? 1 : 0)} нап.`}
            </button>
            <button
              type="button"
              onClick={() => submit(true)}
              className="touch-btn w-full rounded-xl border border-gray-200 text-gray-700 font-medium"
            >
              Без напоминания
            </button>
          </div>
        )}

        {step === 'done' && (
          <div className="text-center py-8 px-1">
            <img
              src="/book-success.jpg"
              alt=""
              className="mx-auto mb-4 w-40 max-w-[55%] h-auto rounded-2xl object-contain"
            />
            <div className="text-4xl mb-3">✓</div>
            <h2 className="text-xl font-bold mb-2">Вы записаны</h2>
            <p className="text-gray-600 capitalize mb-6">
              {service?.name}
              <br />
              {day && format(parseISO(day), 'EEEE, d MMMM', { locale: ru })} в {slot}
            </p>
            <div className="rounded-2xl border border-gray-100 bg-gray-50 p-4 text-left space-y-3">
              <p className="text-sm text-gray-700">
                Напоминания и управление записью — в Telegram-боте.
              </p>
              {botUrl ? (
                <a
                  href={botUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center justify-center w-full touch-btn rounded-xl bg-[#229ED9] text-white font-semibold"
                >
                  Открыть бота{botUsername ? ` @{botUsername}` : ''}
                </a>
              ) : null}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
