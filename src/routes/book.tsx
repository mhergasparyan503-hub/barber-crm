import { useEffect, useMemo, useRef, useState } from 'react';
import { format } from 'date-fns';
import { ru } from 'date-fns/locale';
import { useCrm } from '@/lib/store';
import { STAFF_ID } from '@/lib/seed';
import { availableDays, freeSlots } from '@/lib/slots';
import { normalizePhone, phoneLast10 } from '@/lib/phone';
import type { CrmState } from '@/lib/types';
import { REMINDER_PRESETS, mskDayNoon } from '@/lib/msk';
import '@/styles/book.css';

/** Public booking data (no client list, no secrets) — never written into the local CRM store. */
async function loadPublic(): Promise<CrmState | null> {
  try {
    const r = await fetch('/api/public/booking', { cache: 'no-store' });
    if (!r.ok) return null;
    const j = await r.json();
    return j.data ?? null;
  } catch {
    return null;
  }
}

type Step = 'service' | 'time' | 'form' | 'done';

const rub = (n: number) => `${Math.round(n || 0).toLocaleString('ru-RU')} ₽`;
const dur = (m: number) => (m % 60 === 0 ? `${m / 60} ч` : m > 60 ? `${Math.floor(m / 60)} ч ${m % 60} мин` : `${m} мин`);

/* ---------- icons ---------- */
const Svg = ({ children, className }: { children: React.ReactNode; className?: string }) => (
  <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
    {children}
  </svg>
);
const IcCheck = () => (
  <Svg>
    <path d="m5 12 5 5 9-10" />
  </Svg>
);
const IcBack = () => (
  <Svg>
    <path d="M15 5l-7 7 7 7" />
  </Svg>
);
const IcPin = () => (
  <Svg>
    <path d="M12 21s7-6.5 7-12a7 7 0 0 0-14 0c0 5.5 7 12 7 12z" />
    <circle cx="12" cy="9" r="2.5" />
  </Svg>
);
const IcPhone = () => (
  <Svg>
    <path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2" />
  </Svg>
);
const IcTg = () => (
  <svg viewBox="0 0 24 24" className="bk-tgic" aria-hidden="true">
    <path d="M21 4 2.5 11.2c-.8.3-.8 1.4 0 1.7l4.6 1.6 1.8 5.6c.2.7 1.1.9 1.6.4l2.6-2.5 4.8 3.5c.6.4 1.4.1 1.6-.6L22.9 5.2C23.1 4.4 21.8 3.7 21 4zM9.5 14.2l8.8-7.4-7 8.6-.3 3z" />
  </svg>
);
function ServiceIcon({ name }: { name: string }) {
  const n = name.toLowerCase();
  if (n.includes('дет') || n.includes('сын'))
    return (
      <Svg>
        <circle cx="9" cy="7" r="3" />
        <circle cx="17" cy="10" r="2" />
        <path d="M3 21c0-4 3-7 6-7s6 3 6 7M14 21c0-3 1.5-5 3-5s3 2 3 5" />
      </Svg>
    );
  if (n.includes('тонир'))
    return (
      <Svg>
        <path d="M12 3s6 7 6 11a6 6 0 0 1-12 0c0-4 6-11 6-11z" />
      </Svg>
    );
  if (n.includes('брит'))
    return (
      <Svg>
        <rect x="4" y="3.5" width="16" height="5" rx="1.2" />
        <path d="M7 6h10M12 8.5V21M10.5 13h3M10.5 16h3" />
      </Svg>
    );
  if (n.includes('бород') && !n.includes('стрижка+') && !n.includes('стрижка +'))
    return (
      <Svg>
        <path d="M5 8c0 7 3 12 7 12s7-5 7-12" />
        <path d="M8 13c1.5 1 6.5 1 8 0M9 17h6" />
      </Svg>
    );
  return (
    <Svg>
      <circle cx="6" cy="6" r="3" />
      <circle cx="6" cy="18" r="3" />
      <path d="M20 4 8.1 15.9M14.5 14.5 20 20M8.1 8.1 12 12" />
    </Svg>
  );
}

function Steps({ cur }: { cur: 1 | 2 | 3 }) {
  const names = ['Услуга', 'Дата и время', 'Контакты'];
  return (
    <div className="bk-steps" aria-label={`Шаг ${cur} из 3`}>
      {names.map((n, i) => {
        const k = i + 1;
        const st = k < cur ? 'done' : k === cur ? 'cur' : '';
        return (
          <div key={n} className="bk-steps-item">
            <div className={`bk-st ${st}`}>
              <span className="bk-st-num">{k < cur ? <IcCheck /> : k}</span>
              <span className="bk-st-nm">{n}</span>
            </div>
            {k < 3 && <div className={`bk-st-ln ${k < cur ? 'done' : ''}`} />}
          </div>
        );
      })}
    </div>
  );
}

export function BookPage() {
  const [pub, setPub] = useState<CrmState | null>(null);
  const state = pub || useCrm.getState().getSnapshot();
  const settings = state.settings;
  const [submitting, setSubmitting] = useState(false);
  const [step, setStep] = useState<Step>('service');
  const [serviceId, setServiceId] = useState('');
  const [day, setDay] = useState('');
  const [slot, setSlot] = useState('');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [comment, setComment] = useState('');
  const [error, setError] = useState('');
  const [selectedReminders, setSelectedReminders] = useState<string[]>([]);
  const [customText, setCustomText] = useState('');
  const [showCustom, setShowCustom] = useState(false);
  const [bookedId, setBookedId] = useState('');
  const [bootstrapping, setBootstrapping] = useState(true);
  const rootRef = useRef<HTMLDivElement>(null);
  const servicesRef = useRef<HTMLDivElement>(null);

  // Always use the server's public booking data on /book (visitor phones have no CRM data).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const remote = await loadPublic();
      if (!cancelled && remote) setPub(remote);
      if (!cancelled) setBootstrapping(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // /book-only page look (dark body, serif font) — removed when leaving, CRM styles untouched.
  useEffect(() => {
    document.body.classList.add('bk-body');
    document.documentElement.classList.add('bk-html');
    const meta = document.querySelector('meta[name="theme-color"]');
    const prevTheme = meta?.getAttribute('content');
    meta?.setAttribute('content', '#110f0d');
    let link = document.getElementById('bk-font') as HTMLLinkElement | null;
    if (!link) {
      link = document.createElement('link');
      link.id = 'bk-font';
      link.rel = 'stylesheet';
      link.href = 'https://fonts.googleapis.com/css2?family=Playfair+Display:wght@500;600&display=swap';
      document.head.appendChild(link);
    }
    return () => {
      document.body.classList.remove('bk-body');
      document.documentElement.classList.remove('bk-html');
      if (meta && prevTheme) meta.setAttribute('content', prevTheme);
    };
  }, []);

  // New step → top of the page.
  useEffect(() => {
    if (step !== 'service') rootRef.current?.scrollTo({ top: 0 });
  }, [step]);

  const onlineServices = state.services.filter((s) => {
    if (s.active === false) return false;
    const ids = settings.onlineServiceIds || [];
    if (ids.length) return ids.includes(s.id);
    return s.online !== false;
  });
  const service = onlineServices.find((s) => s.id === serviceId);
  const staffId = state.staff?.find((s) => s.active !== false)?.id || STAFF_ID;

  const days = useMemo(() => {
    if (!service) return [];
    return availableDays(state, staffId, service.durationMin);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [service, pub, staffId]);

  const slots = useMemo(() => {
    if (!service || !day) return [];
    return freeSlots({ state, staffId, day, durationMin: service.durationMin });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [service, day, pub, staffId]);

  // Pick the first free day automatically when entering step 2.
  useEffect(() => {
    if (step === 'time' && service && days.length && (!day || !days.includes(day))) setDay(days[0]);
  }, [step, service, days, day]);

  const botUsername = (settings.telegramBotUsername || '').replace(/^@/, '');
  const botUrl = botUsername ? `https://t.me/${botUsername}` : '';
  // Deep link opens the bot with this visit → links the client (reminders, reschedule, cancel).
  const botVisitUrl = botUrl && bookedId ? `${botUrl}?start=v_${bookedId}` : botUrl;
  const brand = (settings.studioName || 'Барбершоп').toUpperCase();
  const minPrice = onlineServices.length ? Math.min(...onlineServices.map((s) => s.price || 0)) : 0;
  const dayLabel = (d: string, f: string) => (d ? format(mskDayNoon(d), f, { locale: ru }) : '');

  if (bootstrapping) {
    return (
      <div className="bk-root bk-center">
        <p className="bk-muted">Загрузка услуг…</p>
      </div>
    );
  }

  if (!settings.onlineEnabled) {
    return (
      <div className="bk-root bk-center">
        <div className="bk-logo">{brand}</div>
        <p className="bk-muted" style={{ margin: '16px 0' }}>
          Запись по ссылке закрыта
        </p>
        {settings.phone && (
          <a className="bk-link" href={`tel:${normalizePhone(settings.phone)}`}>
            {settings.phone}
          </a>
        )}
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

  function toggleReminder(id: string) {
    setSelectedReminders((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  async function submit() {
    if (submitting) return;
    setError('');
    const nPhone = normalizePhone(phone);
    if (!name.trim() || phoneLast10(nPhone).length < 10) {
      setError('Укажите имя и телефон');
      return;
    }
    if (!service || !day || !slot) return;

    const customMins = showCustom ? parseCustomMins(customText) : null;
    if (showCustom && customText.trim() && customMins == null) {
      setError('Своё напоминание: например «45» или «за 1 ч»');
      return;
    }

    setSubmitting(true);
    try {
      const r = await fetch('/api/public/book', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          serviceId: service.id,
          day,
          time: slot,
          name: name.trim(),
          phone: nPhone,
          comment: comment.trim() || undefined,
          reminders: selectedReminders,
          customMins: customMins ?? undefined,
        }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.ok) {
        if (j.code === 'busy') {
          const fresh = await loadPublic();
          if (fresh) setPub(fresh);
          setSlot('');
          setStep('time');
        }
        setError(j.error || 'Не удалось записаться. Попробуйте ещё раз.');
        return;
      }
      setBookedId(String(j.id || ''));
      setStep('done');
    } catch {
      setError('Нет связи. Проверьте интернет и попробуйте ещё раз.');
    } finally {
      setSubmitting(false);
    }
  }

  const topbar = (onBack?: () => void) => (
    <div className="bk-topbar">
      {onBack ? (
        <button type="button" className="bk-iconbtn" onClick={onBack} aria-label="Назад">
          <IcBack />
        </button>
      ) : (
        <span className="bk-iconbtn ghost" />
      )}
      <span className="bk-logo">{brand}</span>
      <span className="bk-iconbtn ghost" />
    </div>
  );

  const summary = (
    <div className="bk-summary">
      <div className="bk-row">
        <span>Услуга</span>
        <b>{service?.name}</b>
      </div>
      <div className="bk-row">
        <span>Дата</span>
        <b className="bk-cap">{dayLabel(day, 'EEEEEE, d MMMM')}</b>
      </div>
      <div className="bk-row">
        <span>Время</span>
        <b>
          {slot}
          {service ? ` · ${dur(service.durationMin)}` : ''}
        </b>
      </div>
      {settings.address && (
        <div className="bk-row">
          <span>Адрес</span>
          <b>{settings.address}</b>
        </div>
      )}
      <div className="bk-row tot">
        <span>Итого</span>
        <b>{rub(service?.price || 0)}</b>
      </div>
    </div>
  );

  return (
    <div className="bk-root" ref={rootRef}>
      <div className="bk-col">
        {step === 'service' && (
          <>
            <section className="bk-hero">
              <div className="bk-nav">
                <span className="bk-logo">{brand}</span>
                <button
                  type="button"
                  className="bk-navbtn"
                  onClick={() => servicesRef.current?.scrollIntoView({ behavior: 'smooth' })}
                >
                  Записаться
                </button>
              </div>
              <div className="bk-photo" aria-hidden="true">
                <div className="bk-photo-in">
                  <picture>
                    <source srcSet="/book-master.webp" type="image/webp" />
                    <img src="/book-master.jpg" alt="" width={414} height={470} />
                  </picture>
                  <i className="bk-fade-l" />
                </div>
                <i className="bk-fade-r" />
                <i className="bk-fade-t" />
                <i className="bk-fade-b" />
              </div>
              <div className="bk-hero-txt">
                <div className="bk-kicker">Мужские стрижки и уход за бородой</div>
                <h1 className="bk-h1">
                  Твой стиль.
                  <br />
                  Моя работа.
                </h1>
                <p className="bk-sub">Стрижка, которая подходит именно тебе.</p>
                <button
                  type="button"
                  className="bk-btn big"
                  onClick={() => servicesRef.current?.scrollIntoView({ behavior: 'smooth' })}
                >
                  Записаться <span aria-hidden="true">→</span>
                </button>
                {(settings.address || settings.phone) && (
                  <div className="bk-meta">
                    {settings.address && (
                      <span>
                        <IcPin /> {settings.address}
                      </span>
                    )}
                    {settings.phone && (
                      <a href={`tel:${normalizePhone(settings.phone)}`}>
                        <IcPhone /> {settings.phone}
                      </a>
                    )}
                  </div>
                )}
                <div className="bk-feats">
                  <div>
                    <b>{onlineServices.length}</b>
                    <span>услуг</span>
                  </div>
                  <div>
                    <b>от {rub(minPrice)}</b>
                    <span>цены</span>
                  </div>
                  <div>
                    <b>1 мин</b>
                    <span>запись онлайн</span>
                  </div>
                </div>
              </div>
            </section>

            <section className="bk-pad bk-sec" ref={servicesRef}>
              <Steps cur={1} />
              <h2 className="bk-h2">Выберите услугу</h2>
              <div className="bk-grid">
                {onlineServices.map((s) => {
                  const sel = s.id === serviceId;
                  return (
                    <button
                      key={s.id}
                      type="button"
                      className={`bk-card ${sel ? 'sel' : ''}`}
                      aria-pressed={sel}
                      onClick={() => {
                        setServiceId(s.id);
                        setError('');
                        if (s.id !== serviceId) {
                          setDay('');
                          setSlot('');
                        }
                      }}
                    >
                      <span className="bk-card-ic">
                        <ServiceIcon name={s.name} />
                      </span>
                      <span className="bk-radio">{sel && <IcCheck />}</span>
                      <span className="bk-card-nm">{s.name}</span>
                      <span className="bk-card-pr">
                        {rub(s.price)}
                        <span className="bk-card-du">{dur(s.durationMin)}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
              {!onlineServices.length && <p className="bk-muted">Нет услуг для онлайн-записи</p>}
            </section>
            {service && (
              <div className="bk-sticky">
                <div className="bk-sticky-in">
                  <div className="bk-sum">
                    <b>{service.name}</b>
                    <span>
                      {dur(service.durationMin)} · {rub(service.price)}
                    </span>
                  </div>
                  <button type="button" className="bk-btn" onClick={() => setStep('time')}>
                    Далее →
                  </button>
                </div>
              </div>
            )}
          </>
        )}

        {step === 'time' && service && (
          <>
            <div className="bk-pad">
              {topbar(() => setStep('service'))}
              <Steps cur={2} />
              <div className="bk-chosen">
                <span>
                  {service.name} · {dur(service.durationMin)} · {rub(service.price)}
                </span>
                <button type="button" className="bk-link" onClick={() => setStep('service')}>
                  Изменить
                </button>
              </div>
              <h2 className="bk-h2">Выберите день</h2>
              {!days.length ? (
                <p className="bk-muted">Нет свободных дней</p>
              ) : (
                <>
                  <div className="bk-month bk-cap">{dayLabel(day || days[0], 'LLLL yyyy')}</div>
                  <div className="bk-days no-scrollbar">
                    {days.map((d) => (
                      <button
                        key={d}
                        type="button"
                        className={`bk-day ${d === day ? 'sel' : ''}`}
                        aria-pressed={d === day}
                        onClick={() => {
                          setDay(d);
                          setSlot('');
                          setError('');
                        }}
                      >
                        <span className="bk-day-w bk-cap">{dayLabel(d, 'EEEEEE')}</span>
                        <span className="bk-day-n">{dayLabel(d, 'd')}</span>
                        <span className="bk-day-m">{dayLabel(d, 'MMM').replace('.', '')}</span>
                      </button>
                    ))}
                  </div>
                  <h2 className="bk-h2 bk-h2b">Свободное время</h2>
                  <div className="bk-hint bk-cap">{dayLabel(day, 'EEEE, d MMMM')}</div>
                  {error && <p className="bk-err">{error}</p>}
                  <div className="bk-times">
                    {slots.map((t) => (
                      <button
                        key={t}
                        type="button"
                        className={`bk-tm ${t === slot ? 'sel' : ''}`}
                        aria-pressed={t === slot}
                        onClick={() => {
                          setSlot(t);
                          setError('');
                        }}
                      >
                        {t}
                      </button>
                    ))}
                  </div>
                  {!slots.length && <p className="bk-muted">На этот день свободного времени нет</p>}
                </>
              )}
            </div>
            {slot && (
              <div className="bk-sticky">
                <div className="bk-sticky-in">
                  <div className="bk-sum">
                    <b className="bk-cap">{dayLabel(day, 'EEEEEE, d MMMM')}</b>
                    <span>в {slot}</span>
                  </div>
                  <button type="button" className="bk-btn" onClick={() => setStep('form')}>
                    Далее →
                  </button>
                </div>
              </div>
            )}
          </>
        )}

        {step === 'form' && service && (
          <div className="bk-pad bk-bottom">
            {topbar(() => setStep('time'))}
            <Steps cur={3} />
            <h2 className="bk-h2">Ваши контакты</h2>
            {summary}
            <label className="bk-lbl" htmlFor="bk-name">
              Имя
            </label>
            <input
              id="bk-name"
              className="bk-inp"
              placeholder="Как к вам обращаться"
              autoComplete="name"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                setError('');
              }}
            />
            <label className="bk-lbl" htmlFor="bk-phone">
              Телефон
            </label>
            <input
              id="bk-phone"
              className="bk-inp"
              placeholder="+7 (___) ___-__-__"
              inputMode="tel"
              autoComplete="tel"
              value={phone}
              onChange={(e) => {
                setPhone(e.target.value);
                setError('');
              }}
            />

            <label className="bk-lbl" htmlFor="bk-comment">
              Комментарий (необязательно)
            </label>
            <div className="bk-ta-wrap">
              <textarea
                id="bk-comment"
                className="bk-inp bk-ta"
                placeholder="Пожелания к стрижке, вопрос мастеру…"
                maxLength={300}
                rows={3}
                value={comment}
                onChange={(e) => setComment(e.target.value.slice(0, 300))}
              />
              {comment.length > 200 && <span className="bk-ta-cnt">{comment.length}/300</span>}
            </div>

            <div className="bk-remind">
              <div className="bk-remind-t">🔔 Напомним за 2 часа до визита</div>
              <div className="bk-remind-s">
                Напоминания приходят в Telegram-боте — там же можно перенести или отменить запись. Время —
                по Москве. Можно добавить ещё:
              </div>
              <div className="bk-chips">
                {REMINDER_PRESETS.filter((p) => p.id !== '120').map((p) => {
                  const on = selectedReminders.includes(p.id);
                  return (
                    <button
                      key={p.id}
                      type="button"
                      className={`bk-chip ${on ? 'sel' : ''}`}
                      aria-pressed={on}
                      onClick={() => toggleReminder(p.id)}
                    >
                      {p.label}
                    </button>
                  );
                })}
                <button
                  type="button"
                  className={`bk-chip ${showCustom ? 'sel' : ''}`}
                  aria-pressed={showCustom}
                  onClick={() => setShowCustom((v) => !v)}
                >
                  Своё…
                </button>
              </div>
              {showCustom && (
                <input
                  className="bk-inp sm"
                  placeholder="Например: 45 или за 1 ч"
                  value={customText}
                  onChange={(e) => setCustomText(e.target.value)}
                />
              )}
            </div>

            {error && <p className="bk-err">{error}</p>}
            <button type="button" onClick={() => void submit()} disabled={submitting} className="bk-btn big full">
              {submitting ? 'Записываем…' : 'Записаться'}
            </button>
            <p className="bk-consent">
              Нажимая «Записаться», вы соглашаетесь на обработку персональных данных для записи и напоминаний.
            </p>
          </div>
        )}

        {step === 'done' && (
          <div className="bk-pad bk-bottom">
            {topbar()}
            <div className="bk-fin">
              <div className="bk-ok">
                <IcCheck />
              </div>
              <h1 className="bk-h1 bk-dh">Вы записаны</h1>
              <p className="bk-sub bk-c">Ждём вас! Детали записи:</p>
              <div className="bk-summary">
                <div className="bk-row">
                  <span>Услуга</span>
                  <b>{service?.name}</b>
                </div>
                <div className="bk-row">
                  <span>Когда</span>
                  <b className="bk-cap">
                    {dayLabel(day, 'EEEEEE, d MMMM')}, {slot}
                  </b>
                </div>
                {settings.address && (
                  <div className="bk-row">
                    <span>Адрес</span>
                    <b>{settings.address}</b>
                  </div>
                )}
                <div className="bk-row tot">
                  <span>Итого</span>
                  <b>{rub(service?.price || 0)}</b>
                </div>
              </div>
              <div className="bk-tgbox">
                <div className="bk-remind-t">Напомним за 2 часа до визита</div>
                <div className="bk-remind-s">
                  Откройте бота — туда придёт напоминание, там же можно перенести или отменить запись.
                </div>
                {botVisitUrl ? (
                  <>
                    <a href={botVisitUrl} target="_blank" rel="noopener noreferrer" className="bk-btn tg">
                      <IcTg /> Открыть бота в Telegram
                    </a>
                    <div className="bk-tgh">@{botUsername}</div>
                  </>
                ) : (
                  <p className="bk-tgh">Ссылка на бота появится, когда мастер подключит Telegram.</p>
                )}
              </div>
              <button
                type="button"
                className="bk-btn ghost"
                onClick={() => {
                  setStep('service');
                  setServiceId('');
                  setDay('');
                  setSlot('');
                  setSelectedReminders([]);
                  setComment('');
                  setCustomText('');
                  setShowCustom(false);
                  setBookedId('');
                  void loadPublic().then((f) => f && setPub(f));
                  rootRef.current?.scrollTo({ top: 0 });
                }}
              >
                На главную
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
