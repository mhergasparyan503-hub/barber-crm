import { useEffect, useState } from 'react';
import { Link } from '@tanstack/react-router';
import { ArrowLeft } from 'lucide-react';
import { useCrm } from '@/lib/store';
import { normalizePhone } from '@/lib/phone';
import { cn } from '@/lib/cn';
import { copyText } from '@/lib/copy';
import { saveSnapshot } from '@/lib/crm-snapshot';
import { toast } from 'sonner';

export function SettingsPage() {
  const settings = useCrm((s) => s.settings);
  const services = useCrm((s) => s.services);
  const replaceSettings = useCrm((s) => s.replaceSettings);
  const [tab, setTab] = useState<'salon' | 'booking' | 'telegram'>('salon');
  const [form, setForm] = useState(settings);
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);
  const [checking, setChecking] = useState(false);

  useEffect(() => setForm(settings), [settings]);

  useEffect(() => {
    const handler = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e);
    };
    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  async function save() {
    replaceSettings({
      ...form,
      phone: normalizePhone(form.phone) || form.phone,
    });
    await saveSnapshot(useCrm.getState().getSnapshot());
    toast.success('Сохранено');
  }

  function toggleOnlineSvc(id: string) {
    const set = new Set(form.onlineServiceIds);
    if (set.has(id)) set.delete(id);
    else set.add(id);
    setForm({ ...form, onlineServiceIds: [...set] });
  }

  async function checkBot() {
    if (!form.telegramToken.trim()) {
      toast.error('Вставьте токен');
      return;
    }
    setChecking(true);
    try {
      // Persist token first so webhook / send can use snapshot
      const nextBase = {
        ...form,
        telegramToken: form.telegramToken.trim(),
      };
      replaceSettings(nextBase);
      await saveSnapshot(useCrm.getState().getSnapshot());

      const r = await fetch('/api/telegram/check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: nextBase.telegramToken }),
      });
      const j = await r.json();
      if (!j.ok) {
        toast.error(j.error || 'Ошибка');
        return;
      }
      const next = {
        ...nextBase,
        telegramBotUsername: j.username || '',
        // NEVER reset telegramOffset here
      };
      setForm(next);
      replaceSettings(next);
      await saveSnapshot(useCrm.getState().getSnapshot());
      const mode = j.webhook?.mode;
      if (mode === 'webhook') {
        toast.success(`Бот @${j.username} ок. Webhook установлен — журнал открывать не нужно.`);
      } else if (mode === 'poll') {
        toast.success(`Бот @${j.username} ок. Режим poll (ALLOW_POLL).`);
      } else {
        toast.success(`Бот @${j.username} ок. Для webhook задайте PUBLIC_URL на сервере.`);
      }
    } catch (e: any) {
      toast.error(e?.message || 'Сеть');
    } finally {
      setChecking(false);
    }
  }

  const botUrl = form.telegramBotUsername ? `https://t.me/${form.telegramBotUsername}` : '';
  const ownerLink = form.telegramBotUsername
    ? `https://t.me/${form.telegramBotUsername}?start=owner`
    : '';

  return (
    <div className="flex-1 overflow-y-auto bg-journal">
      <div className="bg-white border-b border-gray-100 px-3 py-2 flex items-center gap-2 sticky top-0 z-10">
        <Link to="/more" className="h-10 w-10 flex items-center justify-center">
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <div className="font-semibold">Настройки</div>
      </div>

      <div className="flex gap-2 p-3">
        {(['salon', 'booking', 'telegram'] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={cn(
              'flex-1 touch-btn rounded-xl text-sm font-medium px-1',
              tab === t ? 'bg-accent text-white' : 'bg-white border border-gray-200',
            )}
          >
            {t === 'salon' ? 'Барбершоп' : t === 'booking' ? 'Онлайн' : 'Telegram'}
          </button>
        ))}
      </div>

      <div className="px-3 pb-8 space-y-3">
        {tab === 'salon' && (
          <div className="bg-white rounded-2xl p-4 space-y-3 shadow-sm">
            <Field label="Название" value={form.studioName} onChange={(v) => setForm({ ...form, studioName: v })} />
            <Field label="Подзаголовок" value={form.subtitle} onChange={(v) => setForm({ ...form, subtitle: v })} />
            <Field label="Телефон" value={form.phone} onChange={(v) => setForm({ ...form, phone: v })} />
            <Field label="Адрес" value={form.address} onChange={(v) => setForm({ ...form, address: v })} />
          </div>
        )}

        {tab === 'booking' && (
          <div className="bg-white rounded-2xl p-4 space-y-3 shadow-sm">
            <label className="flex items-center justify-between text-sm">
              <span>Онлайн-запись включена</span>
              <input
                type="checkbox"
                checked={form.onlineEnabled}
                onChange={(e) => setForm({ ...form, onlineEnabled: e.target.checked })}
              />
            </label>
            <label className="block text-xs text-gray-500">
              Lead (мин)
              <input
                type="number"
                className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2.5"
                value={form.leadMinutes}
                onChange={(e) => setForm({ ...form, leadMinutes: +e.target.value || 0 })}
              />
            </label>
            <label className="block text-xs text-gray-500">
              Горизонт (дни)
              <input
                type="number"
                className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2.5"
                value={form.horizonDays}
                onChange={(e) => setForm({ ...form, horizonDays: +e.target.value || 1 })}
              />
            </label>
            <label className="block text-xs text-gray-500">
              Шаг слота (мин)
              <input
                type="number"
                className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2.5"
                value={form.slotMinutes}
                onChange={(e) => setForm({ ...form, slotMinutes: +e.target.value || 15 })}
              />
            </label>
            <label className="block text-xs text-gray-500">
              Цвет визита
              <input
                type="color"
                className="mt-1 h-10 w-full rounded-xl border border-gray-200"
                value={form.visitColor}
                onChange={(e) => setForm({ ...form, visitColor: e.target.value })}
              />
            </label>
            <label className="block text-xs text-gray-500">
              Цвет онлайн
              <input
                type="color"
                className="mt-1 h-10 w-full rounded-xl border border-gray-200"
                value={form.onlineColor}
                onChange={(e) => setForm({ ...form, onlineColor: e.target.value })}
              />
            </label>
            <div>
              <div className="text-xs text-gray-500 mb-2">Услуги в онлайне</div>
              <div className="space-y-1">
                {services.filter((s) => s.active).map((s) => (
                  <label key={s.id} className="flex items-center gap-2 text-sm py-1">
                    <input
                      type="checkbox"
                      checked={form.onlineServiceIds.includes(s.id)}
                      onChange={() => toggleOnlineSvc(s.id)}
                    />
                    {s.name}
                  </label>
                ))}
              </div>
            </div>
          </div>
        )}

        {tab === 'telegram' && (
          <div className="bg-white rounded-2xl p-4 space-y-3 shadow-sm">
            <p className="text-xs text-gray-500">
              Токен от @BotFather. После «Проверить бота» в проде ставится webhook — открытый журнал не нужен.
              getUpdates не вызывается (не срывает webhook), кроме TELEGRAM_ALLOW_POLL=1.
            </p>
            <label className="block text-xs text-gray-500">
              Токен бота
              <input
                className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm font-mono text-gray-900"
                placeholder="123456:ABC…"
                value={form.telegramToken}
                onChange={(e) => setForm({ ...form, telegramToken: e.target.value })}
                autoComplete="off"
              />
            </label>
            <div className="flex flex-wrap gap-2 items-center">
              <button
                type="button"
                disabled={checking}
                onClick={checkBot}
                className="touch-btn flex-1 rounded-xl bg-accent text-white font-semibold"
              >
                {checking ? 'Проверяем…' : 'Проверить бота'}
              </button>
              {form.telegramBotUsername && (
                <span className="text-sm font-medium text-gray-800">@{form.telegramBotUsername}</span>
              )}
            </div>
            {ownerLink && (
              <div className="space-y-2 pt-1">
                <a
                  href={ownerLink}
                  target="_blank"
                  rel="noreferrer"
                  className="touch-btn flex items-center justify-center w-full rounded-xl border border-gray-200 font-medium text-sm"
                >
                  Подключить мой Telegram
                </a>
                <div className="flex gap-2">
                  <input
                    className="min-w-0 flex-1 rounded-xl border border-gray-200 px-3 py-2 text-xs"
                    readOnly
                    value={botUrl}
                  />
                  <button
                    type="button"
                    className="touch-btn rounded-xl border border-gray-200 px-3 text-sm shrink-0"
                    onClick={async () => {
                      const ok = await copyText(botUrl);
                      toast[ok ? 'success' : 'error'](ok ? 'Ссылка скопирована' : 'Не удалось скопировать');
                    }}
                  >
                    Копировать
                  </button>
                </div>
                {form.telegramOwnerChatId ? (
                  <div className="text-xs text-emerald-700">Мастер подключён (chat id сохранён)</div>
                ) : (
                  <div className="text-xs text-amber-700">
                    Откройте «Подключить мой Telegram» и нажмите Start в боте (?start=owner).
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        <button type="button" onClick={save} className="touch-btn w-full rounded-xl bg-accent text-white font-semibold">
          Сохранить
        </button>

        <div className="bg-white rounded-2xl p-4 shadow-sm text-sm text-gray-600 space-y-2">
          <div className="font-medium text-gray-900">Установка на телефон (PWA)</div>
          <p>Добавьте на домашний экран через меню браузера «На экран Домой» / Install.</p>
          {deferredPrompt && (
            <button
              type="button"
              className="touch-btn w-full rounded-xl border border-gray-200 font-medium"
              onClick={async () => {
                deferredPrompt.prompt();
                await deferredPrompt.userChoice;
                setDeferredPrompt(null);
              }}
            >
              Установить приложение
            </button>
          )}
          <p className="text-xs text-gray-400">
            Ссылка записи: {typeof window !== 'undefined' ? window.location.origin + '/book' : '/book'}
          </p>
        </div>
      </div>
    </div>
  );
}

function Field({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="block text-xs text-gray-500">
      {label}
      <input
        className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm text-gray-900"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  );
}
