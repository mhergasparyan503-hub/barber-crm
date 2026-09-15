import { useEffect, useRef } from 'react';
import { useCrm } from '@/lib/store';
import { useRouterState } from '@tanstack/react-router';
import { loadSnapshot, scheduleFlush } from '@/lib/crm-snapshot';

/**
 * Keeps server CRM snapshot in sync (for webhook) and pulls owner chat / offset.
 * Does not call getUpdates unless server allows poll (TELEGRAM_ALLOW_POLL=1).
 */
export function TelegramBridge() {
  const path = useRouterState({ select: (s) => s.location.pathname });
  const busy = useRef(false);

  useEffect(() => {
    if (path === '/book') return;
    let dead = false;

    const flush = () => {
      const snap = useCrm.getState().getSnapshot();
      if (snap.settings.telegramToken) scheduleFlush(() => useCrm.getState().getSnapshot());
    };

    const pull = async () => {
      if (dead || busy.current) return;
      busy.current = true;
      try {
        const remote = await loadSnapshot();
        if (!remote?.settings) return;
        const local = useCrm.getState().settings;
        const patch: Record<string, unknown> = {};
        if (
          remote.settings.telegramOwnerChatId &&
          remote.settings.telegramOwnerChatId !== local.telegramOwnerChatId
        ) {
          patch.telegramOwnerChatId = remote.settings.telegramOwnerChatId;
        }
        if (
          typeof remote.settings.telegramOffset === 'number' &&
          remote.settings.telegramOffset > (local.telegramOffset || 0)
        ) {
          patch.telegramOffset = remote.settings.telegramOffset;
        }
        if (
          remote.settings.telegramBotUsername &&
          remote.settings.telegramBotUsername !== local.telegramBotUsername
        ) {
          patch.telegramBotUsername = remote.settings.telegramBotUsername;
        }
        if (Object.keys(patch).length) {
          useCrm.getState().replaceSettings(patch as any);
        }
      } catch {
        /* */
      } finally {
        busy.current = false;
      }
    };

    const poll = async () => {
      if (dead) return;
      const snap = useCrm.getState().getSnapshot();
      if (!snap.settings.telegramToken) return;
      try {
        const r = await fetch('/api/telegram/poll', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(snap),
        });
        if (!r.ok) return;
        const j = await r.json();
        if (j.patch?.settings) {
          useCrm.getState().mergeTelegramPatch(j.patch);
        }
        if (typeof j.offset === 'number' && j.offset > (snap.settings.telegramOffset || 0)) {
          useCrm.getState().replaceSettings({ telegramOffset: j.offset });
        }
      } catch {
        /* */
      }
    };

    flush();
    void pull();
    const flushId = setInterval(flush, 8000);
    const pullId = setInterval(pull, 5000);
    const pollId = setInterval(poll, 4000);

    return () => {
      dead = true;
      clearInterval(flushId);
      clearInterval(pullId);
      clearInterval(pollId);
    };
  }, [path]);

  return null;
}
