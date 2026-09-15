import { createServer } from 'http';
import { createServer as createViteServer } from 'vite';
import { Hono } from 'hono';
import { getMe, setWebhook, deleteWebhook, sendMessage } from './telegram-api';
import { loadCrmSnapshot, saveCrmSnapshot } from './db';
import { pollAndHandle, handleUpdate } from './telegram-inbox';

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
  await setWebhook(token, url);
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
    await saveCrmSnapshot(body.data);
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

    return c.json({
      ok: true,
      username: me.result?.username,
      id: me.result?.id,
      first_name: me.result?.first_name,
      webhook: ensured,
    });
  });

  app.post('/api/telegram/poll', async (c) => {
    const crm = await c.req.json();
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
    const update = await c.req.json();
    const snap = (await loadCrmSnapshot()) as any;
    if (!snap?.settings?.telegramToken) return c.json({ ok: true });
    const seenOffset = snap.settings.telegramOffset || 0;
    if (update.update_id && update.update_id < seenOffset) return c.json({ ok: true });
    try {
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
        snap.settings.telegramOffset = Math.max(seenOffset, (update.update_id || 0) + 1);
        await saveCrmSnapshot(snap);
      } catch {
        /* */
      }
    }
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
            void ensureWebhook(token, base);
          }, 30000);
        } else if (ensured.mode === 'poll') {
          console.log('Telegram poll mode (TELEGRAM_ALLOW_POLL=1)');
        } else {
          console.log('Telegram: no PUBLIC_URL — webhook not set (local/dev)');
        }
      } catch (e) {
        console.error('webhook ensure', e);
      }
    })();
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
