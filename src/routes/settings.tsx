import { useState } from 'react';
import { useCrm } from '@/lib/store';
import { toast } from 'sonner';
import { copyText } from '@/lib/copy';
import { saveSnapshot } from '@/lib/crm-snapshot';

export function SettingsPage() {
  const settings = useCrm((s) => s.settings);
  const services = useCrm((s) => s.services);
  const replaceSettings = useCrm((s) => s.replaceSettings);
  const getSnapshot = useCrm((s) => s.getSnapshot);
  const [local, setLocal] = useState(settings);
  const [checking, setChecking] = useState(false);

  const patch = (p: Partial<typeof local>) => setLocal((s) => ({ ...s, ...p }));

  const save = async () => {
    replaceSettings(local);
    await saveSnapshot(useCrm.getState().getSnapshot());
    toast.success('Сохранено');
  };

  const checkBot = async () => {
    if (!local.telegramToken.trim()) return toast.error('Вставьте токен');
    setChecking(true);
    try {
      const r = await fetch('/api/telegram/check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: local.telegramToken.trim() }),
      });
      const j = await r.json();
      if (!j.ok) {
        toast.error(j.error || 'Ошибка');
        return;
      }
      const next = {
        ...local,
        telegramToken: local.telegramToken.trim(),
        telegramBotUsername: j.username || '',
        // NEVER reset telegramOffset here
      };
      setLocal(next);
      replaceSettings(next);
      await saveSnapshot(useCrm.getState().getSnapshot());
      toast.success(`Бот @${j.username} ок. Webhook снят для long poll.`);
    } catch (e: any) {
      toast.error(e?.message || 'Сеть');
    } finally {
      setChecking(false);
    }
  };

  const bookUrl = typeof window !== 'undefined' ? `${window.location.origin}/book` : '/book';
  const botUrl = local.telegramBotUsername ? `https://t.me/${local.telegramBotUsername}` : '';
  const ownerLink = local.telegramBotUsername
    ? `https://t.me/${local.telegramBotUsername}?start=owner`
    : '';

  return (
    <div className="mx-auto max-w-2xl space-y-4 p-4">
      <h1 className="text-xl font-semibold">Настройки</h1>

      <section className="space-y-2 rounded-xl border bg-white p-4">
        <h2 className="font-semibold">Барбершоп</h2>
        <input className="w-full rounded-md border px-3 py-2 text-sm" value={local.studioName} onChange={(e) => patch({ studioName: e.target.value })} placeholder="Название" />
        <input className="w-full rounded-md border px-3 py-2 text-sm" value={local.subtitle} onChange={(e) => patch({ subtitle: e.target.value })} placeholder="Подзаголовок" />
        <input className="w-full rounded-md border px-3 py-2 text-sm" value={local.phone} onChange={(e) => patch({ phone: e.target.value })} placeholder="Телефон" />
        <input className="w-full rounded-md border px-3 py-2 text-sm" value={local.address} onChange={(e) => patch({ address: e.target.value })} placeholder="Адрес" />
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={local.soloMode} onChange={(e) => patch({ soloMode: e.target.checked })} />
          Соло-режим (без выбора мастера в онлайн)
        </label>
      </section>

      <section className="space-y-2 rounded-xl border bg-white p-4">
        <h2 className="font-semibold">Онлайн-запись</h2>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={local.onlineEnabled} onChange={(e) => patch({ onlineEnabled: e.target.checked })} />
          Включена
        </label>
        <div className="grid grid-cols-3 gap-2">
          <label className="text-xs">Lead (мин)
            <input type="number" className="mt-1 w-full rounded-md border px-2 py-1" value={local.leadMinutes} onChange={(e) => patch({ leadMinutes: Number(e.target.value) })} />
          </label>
          <label className="text-xs">Горизонт (дн)
            <input type="number" className="mt-1 w-full rounded-md border px-2 py-1" value={local.horizonDays} onChange={(e) => patch({ horizonDays: Number(e.target.value) })} />
          </label>
          <label className="text-xs">Шаг слота
            <input type="number" className="mt-1 w-full rounded-md border px-2 py-1" value={local.slotMinutes} onChange={(e) => patch({ slotMinutes: Number(e.target.value) })} />
          </label>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <label className="text-xs">Цвет визита
            <input type="color" className="mt-1 h-10 w-full" value={local.visitColor} onChange={(e) => patch({ visitColor: e.target.value })} />
          </label>
          <label className="text-xs">Цвет онлайн
            <input type="color" className="mt-1 h-10 w-full" value={local.onlineColor} onChange={(e) => patch({ onlineColor: e.target.value })} />
          </label>
        </div>
        <div className="text-xs text-slate-500">Услуги в онлайне</div>
        <div className="flex flex-wrap gap-2">
          {services.map((s) => {
            const on = (local.onlineServiceIds || []).includes(s.id);
            return (
              <button
                key={s.id}
                type="button"
                className={`rounded-full px-3 py-1 text-xs ${on ? 'bg-[#ff7900] text-white' : 'bg-slate-100'}`}
                onClick={() =>
                  patch({
                    onlineServiceIds: on
                      ? local.onlineServiceIds.filter((id) => id !== s.id)
                      : [...(local.onlineServiceIds || []), s.id],
                  })
                }
              >
                {s.name}
              </button>
            );
          })}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <input className="min-w-0 flex-1 rounded-md border px-2 py-1 text-xs" readOnly value={bookUrl} />
          <button type="button" className="touch-btn rounded-md border px-3 text-sm" onClick={async () => toast[await copyText(bookUrl) ? 'success' : 'error']('Скопировано')}>Копировать</button>
        </div>
      </section>

      <section className="space-y-2 rounded-xl border bg-white p-4">
        <h2 className="font-semibold">Telegram</h2>
        <p className="text-xs text-slate-500">
          Пока открыт журнал, сервер делает getUpdates. Без открытой вкладки бот молчит (нужен публичный webhook). Offset при проверке бота не сбрасывается.
        </p>
        <input
          className="w-full rounded-md border px-3 py-2 font-mono text-sm"
          placeholder="Токен от @BotFather"
          value={local.telegramToken}
          onChange={(e) => patch({ telegramToken: e.target.value })}
        />
        <div className="flex flex-wrap gap-2">
          <button type="button" className="touch-btn rounded-md bg-[#ff7900] px-3 font-semibold text-white" disabled={checking} onClick={checkBot}>
            {checking ? 'Проверяем…' : 'Проверить бота'}
          </button>
          {local.telegramBotUsername && <span className="self-center text-sm">@{local.telegramBotUsername}</span>}
        </div>
        {ownerLink && (
          <div className="space-y-1">
            <a href={ownerLink} target="_blank" rel="noreferrer" className="touch-btn inline-flex rounded-md border px-3 text-sm">
              Подключить мой Telegram
            </a>
            <div className="flex gap-2">
              <input className="min-w-0 flex-1 rounded-md border px-2 py-1 text-xs" readOnly value={botUrl} />
              <button type="button" className="touch-btn rounded-md border px-3 text-sm" onClick={async () => toast[await copyText(botUrl) ? 'success' : 'error']('Ссылка бота')}>Копировать</button>
            </div>
            {local.telegramOwnerChatId && (
              <div className="text-xs text-emerald-700">Owner chat: {local.telegramOwnerChatId}</div>
            )}
          </div>
        )}
      </section>

      <section className="space-y-2 rounded-xl border bg-white p-4">
        <h2 className="font-semibold">Шаблоны сообщений</h2>
        <label className="block text-xs">После записи
          <textarea className="mt-1 w-full rounded-md border px-3 py-2 text-sm" rows={5} value={local.messageTemplates.booked} onChange={(e) => patch({ messageTemplates: { ...local.messageTemplates, booked: e.target.value } })} />
        </label>
        <label className="block text-xs">Напоминание
          <textarea className="mt-1 w-full rounded-md border px-3 py-2 text-sm" rows={5} value={local.messageTemplates.reminder} onChange={(e) => patch({ messageTemplates: { ...local.messageTemplates, reminder: e.target.value } })} />
        </label>
        <div className="flex gap-4 text-sm">
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={local.studioReminders.dayBefore} onChange={(e) => patch({ studioReminders: { ...local.studioReminders, dayBefore: e.target.checked } })} />
            За сутки
          </label>
          <label className="flex items-center gap-2">
            За N часов
            <input type="number" className="w-16 rounded border px-2 py-1" value={local.studioReminders.hoursBefore} onChange={(e) => patch({ studioReminders: { ...local.studioReminders, hoursBefore: Number(e.target.value) } })} />
          </label>
        </div>
      </section>

      <button type="button" className="touch-btn w-full rounded-md bg-[#ff7900] py-3 font-semibold text-white" onClick={save}>
        Сохранить изменения
      </button>
    </div>
  );
}
