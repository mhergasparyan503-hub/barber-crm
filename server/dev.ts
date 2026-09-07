import { createServer } from 'http';
import { createServer as createViteServer } from 'vite';
import { Hono } from 'hono';
import { getMe, deleteWebhook, sendMessage } from './telegram-api';
import { loadCrmSnapshot, saveCrmSnapshot } from './db';
import { pollAndHandle } from './telegram-inbox';

const PORT = Number(process.env.PORT || 8080);
const HOST = '0.0.0.0';

async function main() {
  const app = new Hono();

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
    const me = await getMe(token);
    if (!me.ok) return c.json({ ok: false, error: me.description }, 400);
    await deleteWebhook(token);
    return c.json({
      ok: true,
      username: me.result?.username,
      id: me.result?.id,
      first_name: me.result?.first_name,
    });
  });

  app.post('/api/telegram/poll', async (c) => {
    const crm = await c.req.json();
    const result = await pollAndHandle(crm);
    try {
      const snap = (await loadCrmSnapshot()) as any;
      if (snap?.settings) {
        snap.settings.telegramOffset = result.offset;
        await saveCrmSnapshot(snap);
      }
    } catch {
      /* */
    }
    return c.json(result);
  });

  app.post('/api/telegram/send', async (c) => {
    const { token, chatId, text, reply_markup } = await c.req.json();
    const r = await sendMessage(token, chatId, text, reply_markup);
    return c.json(r);
  });

  app.post('/api/telegram', async (c) => {
    const update = await c.req.json();
    const snap = (await loadCrmSnapshot()) as any;
    if (!snap?.settings?.telegramToken) return c.json({ ok: true });
    const seenOffset = snap.settings.telegramOffset || 0;
    if (update.update_id && update.update_id < seenOffset) return c.json({ ok: true });
    snap.settings.telegramOffset = Math.max(seenOffset, (update.update_id || 0) + 1);
    await saveCrmSnapshot(snap);
    return c.json({ ok: true });
  });

  app.get('/api/health', (c) => c.json({ ok: true }));

  const server = createServer();

  const vite = await createViteServer({
    server: { middlewareMode: true, hmr: false, watch: null },
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
    console.log(`Barber CRM preview http://${HOST}:${PORT}`);
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
