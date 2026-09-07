import { useEffect, useRef } from 'react';
import { useCrm } from '@/lib/store';
import { useRouterState } from '@tanstack/react-router';

/** Polls getUpdates while journal (admin) is open. */
export function TelegramBridge() {
  const path = useRouterState({ select: (s) => s.location.pathname });
  const busy = useRef(false);

  useEffect(() => {
    if (path === '/book') return;
    let dead = false;

    const tick = async () => {
      if (dead || busy.current) return;
      const snap = useCrm.getState().getSnapshot();
      if (!snap.settings.telegramToken) return;
      busy.current = true;
      try {
        const r = await fetch('/api/telegram/poll', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(snap),
        });
        if (r.ok) {
          const j = await r.json();
          if (j.patch) {
            useCrm.getState().mergeTelegramPatch(j.patch);
          }
          if (typeof j.offset === 'number') {
            useCrm.getState().replaceSettings({ telegramOffset: j.offset });
          }
        }
      } catch {
        /* */
      } finally {
        busy.current = false;
      }
    };

    const id = setInterval(tick, 2500);
    void tick();

    // reminders scan
    const rem = setInterval(() => {
      const s = useCrm.getState();
      const now = Date.now();
      for (const a of s.appointments) {
        if (a.status === 'cancelled') continue;
        for (const r of a.reminders || []) {
          if (r.sent) continue;
          if (new Date(r.at).getTime() <= now) {
            r.sent = true;
            const client = s.clients.find((c) => c.id === a.clientId);
            const token = s.settings.telegramToken;
            const chat = a.telegramChatId || client?.telegramChatId;
            if (token && chat) {
              const svc = s.services.find((x) => a.serviceIds.includes(x.id));
              const text = (s.settings.messageTemplates.reminder || '')
                .replaceAll('{name}', client?.name || '')
                .replaceAll('{studio}', s.settings.studioName)
                .replaceAll('{service}', svc?.name || '')
                .replaceAll('{weekday}', '')
                .replaceAll('{date}', a.start.slice(0, 10))
                .replaceAll('{time}', a.start.slice(11, 16))
                .replaceAll('{when}', 'Скоро');
              void fetch('/api/telegram/send', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  token,
                  chatId: chat,
                  text,
                  reply_markup: {
                    inline_keyboard: [
                      [
                        { text: 'Подтверждаю', callback_data: `ok:v_${a.id.slice(0, 24)}` },
                        { text: 'Не смогу', callback_data: `no:v_${a.id.slice(0, 24)}` },
                      ],
                    ],
                  },
                }),
              });
            }
            s.upsertAppointment({ ...a });
          }
        }
      }
    }, 15000);

    return () => {
      dead = true;
      clearInterval(id);
      clearInterval(rem);
    };
  }, [path]);

  return null;
}
