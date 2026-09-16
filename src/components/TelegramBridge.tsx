import { useEffect, useRef } from "react";
import { useCrm } from "@/lib/store";
import { useRouterState } from "@tanstack/react-router";
import { loadSnapshot, scheduleFlush } from "@/lib/crm-snapshot";

/**
 * Keeps server CRM snapshot in sync (for webhook) and pulls owner chat / offset /
 * telegram-created clients & appointments. Does not call getUpdates unless
 * server allows poll (TELEGRAM_ALLOW_POLL=1).
 */
export function TelegramBridge() {
  const path = useRouterState({ select: (s) => s.location.pathname });
  const busy = useRef(false);

  useEffect(() => {
    if (path === "/book") return;
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
        const local = useCrm.getState();
        const patchSettings: Record<string, unknown> = {};
        if (
          remote.settings.telegramOwnerChatId &&
          remote.settings.telegramOwnerChatId !== local.settings.telegramOwnerChatId
        ) {
          patchSettings.telegramOwnerChatId = remote.settings.telegramOwnerChatId;
        }
        if (
          typeof remote.settings.telegramOffset === "number" &&
          remote.settings.telegramOffset > (local.settings.telegramOffset || 0)
        ) {
          patchSettings.telegramOffset = remote.settings.telegramOffset;
        }
        if (
          remote.settings.telegramBotUsername &&
          remote.settings.telegramBotUsername !== local.settings.telegramBotUsername
        ) {
          patchSettings.telegramBotUsername = remote.settings.telegramBotUsername;
        }
        if (Object.keys(patchSettings).length) {
          useCrm.getState().replaceSettings(patchSettings as any);
        }

        const remoteClients = remote.clients || [];
        const remoteAppts = remote.appointments || [];
        const localClientIds = new Set(local.clients.map((c) => c.id));
        const localApptIds = new Set(local.appointments.map((a) => a.id));
        const newClients = remoteClients.filter((c) => !localClientIds.has(c.id));
        const linkedUpdates = remoteClients.filter((rc) => {
          const lc = local.clients.find((c) => c.id === rc.id);
          return lc && rc.telegramChatId && rc.telegramChatId !== lc.telegramChatId;
        });
        const newAppts = remoteAppts.filter((a) => !localApptIds.has(a.id));
        const remoteApptMap = new Map(remoteAppts.map((a) => [a.id, a]));
        const statusMoved = local.appointments.filter((a) => {
          const r = remoteApptMap.get(a.id);
          return (
            r &&
            (r.status !== a.status ||
              r.start !== a.start ||
              JSON.stringify(r.reminders || []) !== JSON.stringify(a.reminders || []))
          );
        });

        if (newClients.length || linkedUpdates.length || newAppts.length || statusMoved.length || remote.telegramChats) {
          useCrm.getState().mergeTelegramPatch({
            clients: [
              ...local.clients.map((c) => {
                const u =
                  linkedUpdates.find((x) => x.id === c.id) || remoteClients.find((x) => x.id === c.id);
                if (!u) return c;
                return {
                  ...c,
                  telegramChatId: u.telegramChatId || c.telegramChatId,
                  telegramUsername: u.telegramUsername || c.telegramUsername,
                  reminderPrefs: u.reminderPrefs || c.reminderPrefs,
                  name: c.name || u.name,
                  phone: c.phone || u.phone,
                };
              }),
              ...newClients,
            ],
            appointments: [
              ...local.appointments.map((a) => {
                const r = remoteApptMap.get(a.id);
                if (!r) return a;
                return {
                  ...a,
                  status: r.status,
                  start: r.start,
                  reminders: r.reminders ?? a.reminders,
                  telegramChatId: r.telegramChatId || a.telegramChatId,
                };
              }),
              ...newAppts,
            ],
            telegramChats: remote.telegramChats || local.telegramChats || [],
          });
        }
      } catch {
        /* */
      } finally {
        busy.current = false;
      }
    };

    // When TELEGRAM_ALLOW_POLL=1 the server owns getUpdates; client must NOT
    // also call /api/telegram/poll or Telegram returns 409 Conflict and drops updates.
    let serverOwnsPoll = false;
    const refreshMode = async () => {
      try {
        const r = await fetch("/api/telegram/check", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token: useCrm.getState().settings.telegramToken || "" }),
        });
        if (!r.ok) return;
        const j = await r.json();
        // Production webhook: never client-poll (getUpdates fights webhook).
        // Preview ALLOW_POLL: server loop owns getUpdates — also skip client poll.
        serverOwnsPoll = true;
      } catch {
        /* */
      }
    };

    const poll = async () => {
      if (dead || serverOwnsPoll) return;
      const snap = useCrm.getState().getSnapshot();
      if (!snap.settings.telegramToken) return;
      try {
        const r = await fetch("/api/telegram/poll", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(snap),
        });
        if (!r.ok) return;
        const j = await r.json();
        if (j.patch?.settings || j.patch?.clients || j.patch?.appointments) {
          useCrm.getState().mergeTelegramPatch(j.patch);
        }
        if (typeof j.offset === "number" && j.offset > (snap.settings.telegramOffset || 0)) {
          useCrm.getState().replaceSettings({ telegramOffset: j.offset });
        }
      } catch {
        /* */
      }
    };

    flush();
    void pull();
    void (async () => {
      const tok = useCrm.getState().settings.telegramToken;
      if (tok) await refreshMode();
    })();
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
