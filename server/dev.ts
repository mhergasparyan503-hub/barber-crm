import { createServer } from 'http';
import { createServer as createViteServer } from 'vite';
import { Hono } from 'hono';
import { getMe, setWebhook, deleteWebhook, sendMessage } from './telegram-api';
import { loadCrmSnapshot, saveCrmSnapshot } from './db';
import { pollAndHandle, handleUpdate, processDueReminders } from './telegram-inbox';
import { claimUpdateId } from './tg-dedup';

const PORT = Number(process.env.PORT || 8080);
const HOST = process.env.HOST || '0.0.0.0';

function publicBase(reqHost?: string | null): string | null {
  if (process.env.PUBLIC_URL) return process.env.PUBLIC_URL.replace(/\/$/, '');
  if (!reqHost) return null;
  const host = reqHost.split(',')[0].trim();
  if (!host || host.startsWith('localhost') || host.startsWith('127.')) return null;
  const proto = process.env.PUBLIC_PROTO || 'https';
  return `${proto}://${host}`;
}

async function ensureWebhook(token: string, base: string | null) {
  if (process.env.TELEGRAM_ALLOW_POLL === '1') {
    await deleteWebhook(token);
    return { mode: 'poll' as const };
  }
  if (!base) return { mode: 'none' as const };
  const url = `${base}/api/telegram`;
  try {
    await setWebhook(token, url);
  } catch (e) {
    console.error('setWebhook failed (will retry)', e);
    return { mode: 'webhook' as const, url, error: true as const };
  }
  return { mode: 'webhook' as const, url };
}

async function main() {
  const app = new Hono();

  app.get('/api/health', (c) => c.json({ ok: true }));

  app.get('/api/crm/snapshot', async (c) => {
    const data = await loadCrmSnapshot();
    return c.json({ data });
  });

  app.post('/api/crm/snapshot', async (c) => {
    const body = await c.req.json();
    const incoming = body.data;
    // Never let a stale browser localStorage flush rewind telegramOffset
    // (that makes getUpdates skip /start updates the server already advanced past).
    try {
      const prev = (await loadCrmSnapshot()) as any;
      if (prev?.settings && incoming?.settings) {
        const prevOff = Number(prev.settings.telegramOffset || 0);
        // Browser flushes must NEVER advance (or re-poison) telegramOffset —
        // only webhook/poll handlers may move it forward.
        incoming.settings.telegramOffset = prevOff;
        // Prefer non-empty server token if client sends empty (don't wipe)
        if (!incoming.settings.telegramToken && prev.settings.telegramToken) {
          incoming.settings.telegramToken = prev.settings.telegramToken;
        }
        if (!incoming.settings.telegramOwnerChatId && prev.settings.telegramOwnerChatId) {
          incoming.settings.telegramOwnerChatId = prev.settings.telegramOwnerChatId;
        }
      }
    } catch {
      /* */
    }
    await saveCrmSnapshot(incoming);
    return c.json({ ok: true });
  });

  app.post('/api/telegram/check', async (c) => {
    const { token } = await c.req.json();
    if (!token || typeof token !== 'string') {
      return c.json({ ok: false, error: 'token required' }, 400);
    }
    const me = await getMe(token.trim());
    if (!me.ok) return c.json({ ok: false, error: me.description || 'getMe failed' }, 400);

    const host = c.req.header('x-forwarded-host') || c.req.header('host');
    const base = publicBase(host);
    const ensured = await ensureWebhook(token.trim(), base);

    // Persist token + username into snapshot settings if present
    try {
      const snap = (await loadCrmSnapshot()) as any;
      if (snap?.settings) {
        snap.settings.telegramToken = token.trim();
        snap.settings.telegramBotUsername = me.result?.username || snap.settings.telegramBotUsername || '';
        await saveCrmSnapshot(snap);
      }
    } catch {
      /* */
    }

    // When TELEGRAM_ALLOW_POLL=1, ensureWebhook already called deleteWebhook so
    // getUpdates (server poll loop + TelegramBridge) can receive updates.
    // Production must NOT set ALLOW_POLL — it uses setWebhook instead.
    const note =
      ensured.mode === 'poll'
        ? 'TELEGRAM_ALLOW_POLL=1: webhook deleted; server getUpdates poll is active. Prod bot is quiet until webhook is restored on deploy.'
        : ensured.mode === 'webhook'
          ? 'Webhook installed for production delivery.'
          : 'No PUBLIC_URL and poll disabled — Telegram updates will not be received.';

    return c.json({
      ok: true,
      username: me.result?.username,
      id: me.result?.id,
      first_name: me.result?.first_name,
      webhook: ensured,
      note,
      allowPoll: process.env.TELEGRAM_ALLOW_POLL === '1',
    });
  });

  app.post('/api/telegram/poll', async (c) => {
    const crm = await c.req.json();
    // Server-side loop already long-polls when ALLOW_POLL=1 — avoid dual getUpdates (409).
    if (process.env.TELEGRAM_ALLOW_POLL === '1') {
      const snap = (await loadCrmSnapshot()) as any;
      return c.json({
        offset: snap?.settings?.telegramOffset || crm?.settings?.telegramOffset || 0,
        patch: {},
        replies: 0,
        serverOwnsPoll: true,
      });
    }
    const result = await pollAndHandle(crm);
    if (result.replies > 0 || (result.patch && Object.keys(result.patch).length > 0)) {
      try {
        const snap = (await loadCrmSnapshot()) as any;
        if (snap?.settings) {
          await saveCrmSnapshot({
            ...snap,
            ...result.patch,
            settings: {
              ...snap.settings,
              ...((result.patch as any).settings || {}),
              telegramOffset: result.offset,
            },
          });
        }
      } catch {
        /* */
      }
    }
    return c.json(result);
  });

  app.post('/api/telegram/send', async (c) => {
    const { token, chatId, text, reply_markup } = await c.req.json();
    if (!token || !chatId || !text) {
      return c.json({ ok: false, error: 'token, chatId, text required' }, 400);
    }
    const r = await sendMessage(token, chatId, text, reply_markup);
    return c.json(r);
  });

  app.post('/api/telegram', async (c) => {
    let update: any;
    try {
      update = await c.req.json();
    } catch {
      return c.json({ ok: true });
    }

    const uid = update?.update_id;
    // Claim BEFORE loadCrmSnapshot / handleUpdate so concurrent retries cannot race.
    if (uid != null && !claimUpdateId(uid, 0)) {
      console.log('tg webhook dedup skip', uid);
      return c.json({ ok: true, dedup: true });
    }

    // Ack Telegram immediately — avoids retry duplicates while sendMessage runs.
    void (async () => {
      try {
        const snap = (await loadCrmSnapshot()) as any;
        if (!snap?.settings?.telegramToken) return;
        let seenOffset = Number(snap.settings.telegramOffset || 0);
        // Heal only when telegramOffset itself looks poisoned (smoke wrote ~1.9e9).
        // Never rewind a healthy offset because of a bogus low update_id (e.g. curl test).
        if (uid != null && uid < seenOffset) {
          const offsetPoisoned = seenOffset > 1_000_000_000;
          const uidPlausible = Number(uid) > 1_000_000;
          if (offsetPoisoned && uidPlausible) {
            console.warn('tg webhook offset heal', seenOffset, '→', Number(uid));
            seenOffset = Number(uid);
            snap.settings.telegramOffset = seenOffset;
          } else {
            console.log('tg webhook offset skip', uid, 'offset', seenOffset);
            return;
          }
        }
        const kind = update?.message
          ? 'message'
          : update?.callback_query
            ? 'callback'
            : 'other';
        const preview = (
          update?.message?.text ||
          update?.callback_query?.data ||
          ''
        ).slice(0, 80);
        console.log('tg webhook', uid, kind, JSON.stringify(preview));
        const result = await handleUpdate(snap as any, update);
        const next = {
          ...snap,
          ...(result.patch || {}),
          settings: {
            ...(snap.settings || {}),
            ...((result.patch as any)?.settings || {}),
            telegramOffset: result.offset,
          },
        };
        await saveCrmSnapshot(next);
      } catch (e) {
        console.error('tg webhook', e);
        try {
          const snap = (await loadCrmSnapshot()) as any;
          if (snap?.settings && uid != null) {
            snap.settings.telegramOffset = Math.max(
              Number(snap.settings.telegramOffset || 0),
              Number(uid) + 1,
            );
            await saveCrmSnapshot(snap);
          }
        } catch {
          /* */
        }
      }
    })();

    return c.json({ ok: true });
  });

  const server = createServer();

  const vite = await createViteServer({
    server: { middlewareMode: true, hmr: { server }, allowedHosts: true },
    appType: 'spa',
  });

  server.on('request', async (req, res) => {
    try {
      if (req.url?.startsWith('/api/')) {
        const url = `http://${req.headers.host}${req.url}`;
        const headers = new Headers();
        for (const [k, v] of Object.entries(req.headers)) {
          if (v) headers.set(k, Array.isArray(v) ? v.join(',') : v);
        }
        const chunks: Buffer[] = [];
        for await (const chunk of req) chunks.push(chunk as Buffer);
        const body = Buffer.concat(chunks);
        const request = new Request(url, {
          method: req.method,
          headers,
          body: req.method !== 'GET' && req.method !== 'HEAD' ? body : undefined,
        });
        const response = await app.fetch(request);
        res.statusCode = response.status;
        response.headers.forEach((v, k) => res.setHeader(k, v));
        const ab = await response.arrayBuffer();
        res.end(Buffer.from(ab));
        return;
      }
      vite.middlewares(req, res, () => {
        res.statusCode = 404;
        res.end('Not found');
      });
    } catch (e: any) {
      console.error(e);
      res.statusCode = 500;
      res.end(e?.message || 'error');
    }
  });

  server.listen(PORT, HOST, () => {
    console.log(`Barber CRM mobile http://${HOST}:${PORT}`);
    void (async () => {
      try {
        const snap = (await loadCrmSnapshot()) as any;
        const token = snap?.settings?.telegramToken;
        if (!token) return;
        const base = publicBase(process.env.PUBLIC_HOST || null) || (process.env.PUBLIC_URL ? process.env.PUBLIC_URL.replace(/\/$/, '') : null);
        const ensured = await ensureWebhook(token, base);
        if (ensured.mode === 'webhook') {
          console.log('Telegram webhook ensured', ensured.url);
          setInterval(() => {
            void ensureWebhook(token, base).catch((e) => console.error('webhook re-ensure', e));
          }, 30000);
        } else if (ensured.mode === 'poll') {
          console.log('Telegram poll mode (TELEGRAM_ALLOW_POLL=1) — webhook deleted; server-side getUpdates loop starting');
        } else {
          console.log('Telegram: no PUBLIC_URL — webhook not set (local/dev)');
        }
      } catch (e) {
        console.error('webhook ensure', e);
      }
    })();

    // Local preview: long-poll getUpdates even if the CRM UI / TelegramBridge is closed.
    // Requires TELEGRAM_ALLOW_POLL=1 (which also deleteWebhook's so getUpdates works).
    if (process.env.TELEGRAM_ALLOW_POLL === '1') {
      let pollBusy = false;
      const tickPoll = async () => {
        if (pollBusy) return;
        pollBusy = true;
        try {
          const snap = (await loadCrmSnapshot()) as any;
          if (!snap?.settings?.telegramToken) return;
          const result = await pollAndHandle(snap);
          if (result.replies > 0 || (result.patch && Object.keys(result.patch).length > 0)) {
            await saveCrmSnapshot({
              ...snap,
              ...result.patch,
              settings: {
                ...snap.settings,
                ...((result.patch as any).settings || {}),
                telegramOffset: result.offset,
              },
            });
            if (result.replies > 0) console.log('tg poll handled', result.replies, 'offset', result.offset);
          } else if (typeof result.offset === 'number' && result.offset !== (snap.settings.telegramOffset || 0)) {
            snap.settings.telegramOffset = result.offset;
            await saveCrmSnapshot(snap);
          }
        } catch (e) {
          console.error('tg poll tick', e);
        } finally {
          pollBusy = false;
        }
      };
      setInterval(() => {
        void tickPoll();
      }, 3000);
      void tickPoll();
    }

    // Deliver due reminders even when admin UI is closed (webhook mode).
    let reminderBusy = false;
    const tickReminders = async () => {
      if (reminderBusy) return;
      reminderBusy = true;
      try {
        const snap = (await loadCrmSnapshot()) as any;
        if (!snap?.settings?.telegramToken) return;
        const before = JSON.stringify(
          (snap.appointments || []).map((a: any) => (a.reminders || []).map((r: any) => !!r.sent)),
        );
        const { sent, crm } = await processDueReminders(snap);
        const after = JSON.stringify(
          (crm.appointments || []).map((a: any) => (a.reminders || []).map((r: any) => !!r.sent)),
        );
        if (sent > 0 || before !== after) {
          await saveCrmSnapshot(crm);
          if (sent > 0) console.log('reminders sent', sent);
        }
      } catch (e) {
        console.error('reminder tick', e);
      } finally {
        reminderBusy = false;
      }
    };
    setInterval(() => {
      void tickReminders();
    }, 15000);
    void tickReminders();
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
