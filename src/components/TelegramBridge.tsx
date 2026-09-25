import { useEffect, useRef } from "react";
import { useCrm } from "@/lib/store";
import { useRouterState } from "@tanstack/react-router";
import { loadSnapshot, scheduleFlush } from "@/lib/crm-snapshot";
import type { Appointment, Client } from "@/lib/types";

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
      // Always flush: schedules/exceptions must reach the server for the bot + /book
      // even when this browser has no telegramToken saved.
      scheduleFlush(() => useCrm.getState().getSnapshot());
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

        // Fresh device / cleared browser (empty journal and clients): adopt the server CRM
        // instead of pushing seed defaults over it.
        if (
          !local.clients.length &&
          !local.appointments.length &&
          !(local.deletedAppointmentIds || []).length &&
          !(local.deletedClientIds || []).length &&
          (remoteClients.length || remoteAppts.length || (remote.services || []).length)
        ) {
          useCrm.setState({
            clients: remoteClients,
            appointments: remoteAppts,
            services: remote.services?.length ? remote.services : local.services,
            staff: remote.staff?.length ? remote.staff : local.staff,
            windows: remote.windows || [],
            schedules: remote.schedules?.length ? remote.schedules : local.schedules,
            exceptions: remote.exceptions || [],
            exceptionsUpdatedAt: remote.exceptionsUpdatedAt,
            telegramChats: remote.telegramChats || [],
            deletedAppointmentIds: [],
            deletedClientIds: [],
            settings: {
              ...local.settings,
              ...remote.settings,
              telegramToken: local.settings.telegramToken || '',
              dataVersion: local.settings.dataVersion,
            },
          });
          return;
        }

        const newer = (r?: { updatedAt?: string }, l?: { updatedAt?: string }) =>
          !!r?.updatedAt && (!l?.updatedAt || r.updatedAt > l.updatedAt);
        const mergeSent = (
          chosen: Appointment['reminders'],
          other: Appointment['reminders'],
        ): Appointment['reminders'] =>
          chosen?.map((x) =>
            x.sent || !other?.some((o) => o.sent && o.kind === x.kind && o.at === x.at)
              ? x
              : { ...x, sent: true },
          );

        const localClientIds = new Set(local.clients.map((c) => c.id));
        const localApptIds = new Set(local.appointments.map((a) => a.id));
        const tombstones = new Set(local.deletedAppointmentIds || []);
        const clientTombs = new Set(local.deletedClientIds || []);
        const remoteApptIds = new Set(remoteAppts.map((a) => a.id));
        const remoteClientIds = new Set(remoteClients.map((c) => c.id));
        // Drop tombstones once the server no longer has the id (flush succeeded).
        const prunedTombstones = [...tombstones].filter((id) => remoteApptIds.has(id));
        const prunedClientTombs = [...clientTombs].filter((id) => remoteClientIds.has(id));
        const tombstonesChanged =
          prunedTombstones.length !== tombstones.size || prunedClientTombs.length !== clientTombs.size;

        const newClients = remoteClients.filter((c) => !localClientIds.has(c.id) && !clientTombs.has(c.id));
        const remoteClientMap = new Map(remoteClients.map((c) => [c.id, c]));
        // Never resurrect hard-deleted appointments from a stale server snapshot.
        const newAppts = remoteAppts.filter(
          (a) => !localApptIds.has(a.id) && !tombstones.has(a.id),
        );
        const remoteApptMap = new Map(remoteAppts.map((a) => [a.id, a]));

        const mergeAppt = (a: Appointment): Appointment => {
          const r = remoteApptMap.get(a.id);
          if (!r) return a;
          if (newer(r, a)) return { ...a, ...r, reminders: mergeSent(r.reminders, a.reminders) };
          if (a.updatedAt) {
            return {
              ...a,
              reminders: mergeSent(a.reminders, r.reminders),
              telegramChatId: a.telegramChatId || r.telegramChatId,
            };
          }
          // Legacy rows without timestamps: previous behaviour (cancel wins, remote time/reminders).
          const status =
            a.status === 'cancelled' || r.status === 'cancelled' ? ('cancelled' as const) : r.status;
          return {
            ...a,
            status,
            start: r.start,
            reminders: r.reminders ?? a.reminders,
            telegramChatId: r.telegramChatId || a.telegramChatId,
          };
        };
        const mergeClient = (c: Client): Client => {
          const u = remoteClientMap.get(c.id);
          if (!u) return c;
          if (newer(u, c)) return { ...c, ...u };
          return {
            ...c,
            telegramChatId: c.telegramChatId || u.telegramChatId,
            telegramUsername: c.telegramUsername || u.telegramUsername,
            reminderPrefs: c.reminderPrefs ?? u.reminderPrefs,
            name: c.name || u.name,
            phone: c.phone || u.phone,
          };
        };
        const mergedAppts = local.appointments.map(mergeAppt);
        const mergedClients = local.clients.map(mergeClient);
        const apptsChanged = mergedAppts.some((a, i) => a !== local.appointments[i] && JSON.stringify(a) !== JSON.stringify(local.appointments[i]));
        const clientsChanged = mergedClients.some((c, i) => c !== local.clients[i] && JSON.stringify(c) !== JSON.stringify(local.clients[i]));
        const exceptionsNewer =
          !!remote.exceptionsUpdatedAt &&
          (!local.exceptionsUpdatedAt || remote.exceptionsUpdatedAt > local.exceptionsUpdatedAt);
        const chatsChanged =
          JSON.stringify(remote.telegramChats || []) !== JSON.stringify(local.telegramChats || []);

        if (
          newClients.length ||
          newAppts.length ||
          apptsChanged ||
          clientsChanged ||
          exceptionsNewer ||
          (remote.telegramChats && chatsChanged) ||
          tombstonesChanged
        ) {
          useCrm.getState().mergeTelegramPatch({
            deletedAppointmentIds: prunedTombstones,
            deletedClientIds: prunedClientTombs,
            clients: [...mergedClients, ...newClients],
            appointments: [...mergedAppts, ...newAppts],
            telegramChats: remote.telegramChats || local.telegramChats || [],
            ...(exceptionsNewer
              ? { exceptions: remote.exceptions || [], exceptionsUpdatedAt: remote.exceptionsUpdatedAt }
              : {}),
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
        await r.json();
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

    // Pull first, then flush — a stale/new browser must not push over newer server data.
    void pull().finally(() => {
      if (!dead) flush();
    });
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
