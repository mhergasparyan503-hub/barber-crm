import { createServer } from 'http';
import { createServer as createViteServer } from 'vite';
import { Hono } from 'hono';
import { getMe, setWebhook, deleteWebhook, sendMessage } from './telegram-api';
import { loadCrmSnapshot, saveCrmSnapshot } from './db';
import {
  pollAndHandle,
  handleUpdate,
  processDueReminders,
  computeSlots,
  notifyOwner,
  findClientsByPhone,
  staffIdOf,
} from './telegram-inbox';
import { claimUpdateId } from './tg-dedup';
import { withCrmLock, mergeIncoming, stampChanges, publicView } from './crm-merge';
import { buildReminders, mskWallISO } from '../src/lib/msk';
import { normalizePhone, phoneLast10 } from '../src/lib/phone';
import fs from 'fs';
import * as auth from './auth';
import path from 'path';

const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x));

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
    const r = await setWebhook(token, url, auth.webhookSecret());
    if (r && r.ok === false) console.error('setWebhook error', r.error_code, r.description);
  } catch (e) {
    console.error('setWebhook failed (will retry)', e);
    return { mode: 'webhook' as const, url, error: true as const };
  }
  return { mode: 'webhook' as const, url };
}

async function main() {
  const app = new Hono();

  app.get('/api/health', (c) => c.json({ ok: true }));

  // ---------- Auth ----------
  const PUBLIC_API = (p: string, method: string) =>
    p === '/api/health' ||
    (p === '/api/telegram' && method === 'POST') ||
    p.startsWith('/api/public/') ||
    p.startsWith('/api/auth/');
  const isSecure = (c: any) =>
    c.req.header('x-forwarded-proto') === 'https' || process.env.NODE_ENV === 'production';
  const clientIp = (c: any) =>
    c.req.header('x-real-ip') || (c.req.header('x-forwarded-for') || '').split(',')[0].trim() || 'local';
  const sessToken = (c: any) => auth.readCookie(c.req.header('cookie'));

  app.use('/api/*', async (c, next) => {
    if (PUBLIC_API(c.req.path, c.req.method)) return next();
    if (!auth.sessionValid(sessToken(c))) {
      return c.json({ ok: false, error: 'unauthorized' }, 401);
    }
    return next();
  });

  async function tellMaster(text: string): Promise<boolean> {
    const snap = (await loadCrmSnapshot()) as any;
    const token = snap?.settings?.telegramToken;
    const chat = snap?.settings?.telegramOwnerChatId;
    if (!token || !chat) return false;
    const r = await sendMessage(token, chat, text).catch(() => null);
    return !!r?.ok;
  }

  const MIN15 = 15 * 60 * 1000;
  const loginBlocked = (c: any, email: string) =>
    auth.limited('ip:' + clientIp(c), 5, MIN15) || auth.limited('em:' + email, 5, MIN15);
  const loginFailed = async (c: any, email: string) => {
    const n = Math.max(auth.hit('ip:' + clientIp(c), MIN15), auth.hit('em:' + email, MIN15));
    if (n === 5) {
      void tellMaster(
        `⚠️ CRM: 5 неудачных попыток входа подряд (IP ${clientIp(c)}). Вход временно заблокирован на 15 минут.\nЕсли это не вы — ничего не делайте, пароль не раскрыт.`,
      );
    }
  };
  const loggedIn = (c: any) => {
    const t = auth.createSession();
    c.header('Set-Cookie', auth.sessionCookie(t, isSecure(c)));
    return t;
  };

  app.get('/api/auth/status', async (c) => {
    const snap = (await loadCrmSnapshot()) as any;
    const authed = auth.sessionValid(sessToken(c));
    return c.json({
      hasAccount: auth.hasAccount(),
      authed,
      email: authed ? auth.accountEmail() : undefined,
      masterTelegram: !!(snap?.settings?.telegramToken && snap?.settings?.telegramOwnerChatId),
    });
  });

  app.post('/api/auth/code', async (c) => {
    const b = (await c.req.json().catch(() => ({}))) as any;
    const purpose = b?.purpose === 'reset' ? 'reset' : 'register';
    if (purpose === 'register' && auth.hasAccount()) {
      return c.json({ ok: false, error: 'Аккаунт уже создан. Войдите.' }, 409);
    }
    if (purpose === 'reset' && !auth.hasAccount()) {
      return c.json({ ok: false, error: 'Аккаунт ещё не создан.' }, 400);
    }
    if (auth.limited('code:' + purpose, 1, 60_000) || auth.limited('codeh:' + purpose, 6, 60 * 60_000)) {
      return c.json({ ok: false, error: 'Код уже отправлен. Повторить можно через минуту.' }, 429);
    }
    auth.hit('code:' + purpose, 60_000);
    auth.hit('codeh:' + purpose, 60 * 60_000);
    const code = auth.issueCode(purpose);
    const text =
      purpose === 'register'
        ? `Код для регистрации в CRM: ${code}\nДействует 15 минут. Никому его не сообщайте.`
        : `Код для сброса пароля CRM: ${code}\nДействует 15 минут. Если вы не запрашивали сброс — просто проигнорируйте.`;
    const sent = await tellMaster(text);
    if (sent) return c.json({ ok: true, via: 'telegram' });
    if (purpose === 'register') {
      // No master Telegram yet: code only in the server log (admin access).
      console.log(`[auth] setup code (no master Telegram connected): ${code}`);
      return c.json({ ok: true, via: 'log' });
    }
    return c.json({ ok: false, error: 'Telegram мастера не подключён — код отправить некуда.' }, 400);
  });

  app.post('/api/auth/register', async (c) => {
    if (auth.hasAccount()) return c.json({ ok: false, error: 'Регистрация закрыта: аккаунт уже создан.' }, 409);
    const b = (await c.req.json().catch(() => ({}))) as any;
    const email = auth.normEmail(b?.email);
    if (!auth.emailOk(email)) return c.json({ ok: false, error: 'Неверный email' }, 400);
    if (!auth.passwordOk(b?.password)) return c.json({ ok: false, error: 'Пароль — минимум 8 символов' }, 400);
    const r = auth.checkCode('register', b?.code);
    if (r !== 'ok') {
      return c.json({ ok: false, error: r === 'bad' ? 'Неверный код' : 'Код устарел — запросите новый' }, 400);
    }
    if (!auth.register(email, b.password)) return c.json({ ok: false, error: 'Регистрация закрыта' }, 409);
    loggedIn(c);
    void tellMaster(`✅ CRM: создан аккаунт владельца (${email}). Регистрация закрыта.`);
    return c.json({ ok: true, email });
  });

  app.post('/api/auth/login', async (c) => {
    const b = (await c.req.json().catch(() => ({}))) as any;
    const email = auth.normEmail(b?.email);
    if (loginBlocked(c, email)) {
      return c.json({ ok: false, error: 'Слишком много попыток. Подождите 15 минут.' }, 429);
    }
    if (!auth.hasAccount()) return c.json({ ok: false, error: 'Аккаунт ещё не создан' }, 400);
    if (!auth.checkLogin(email, String(b?.password || ''))) {
      await loginFailed(c, email);
      return c.json({ ok: false, error: 'Неверный email или пароль' }, 401);
    }
    auth.clearHits('ip:' + clientIp(c));
    auth.clearHits('em:' + email);
    loggedIn(c);
    return c.json({ ok: true, email: auth.accountEmail() });
  });

  app.post('/api/auth/logout', (c) => {
    auth.destroySession(sessToken(c));
    c.header('Set-Cookie', auth.clearCookie(isSecure(c)));
    return c.json({ ok: true });
  });

  app.post('/api/auth/reset', async (c) => {
    if (!auth.hasAccount()) return c.json({ ok: false, error: 'Аккаунт ещё не создан' }, 400);
    const b = (await c.req.json().catch(() => ({}))) as any;
    if (!auth.passwordOk(b?.password)) return c.json({ ok: false, error: 'Пароль — минимум 8 символов' }, 400);
    const r = auth.checkCode('reset', b?.code);
    if (r !== 'ok') {
      return c.json({ ok: false, error: r === 'bad' ? 'Неверный код' : 'Код устарел — запросите новый' }, 400);
    }
    auth.setPassword(b.password);
    auth.destroyOtherSessions();
    loggedIn(c);
    void tellMaster('🔐 CRM: пароль сброшен по коду. Все другие входы завершены.');
    return c.json({ ok: true, email: auth.accountEmail() });
  });

  app.post('/api/auth/change-password', async (c) => {
    if (!auth.sessionValid(sessToken(c))) return c.json({ ok: false, error: 'unauthorized' }, 401);
    const b = (await c.req.json().catch(() => ({}))) as any;
    const key = 'chg:' + clientIp(c);
    if (auth.limited(key, 5, MIN15)) return c.json({ ok: false, error: 'Слишком много попыток. Подождите 15 минут.' }, 429);
    if (!auth.checkPassword(String(b?.current || ''))) {
      auth.hit(key, MIN15);
      return c.json({ ok: false, error: 'Текущий пароль неверный' }, 400);
    }
    if (!auth.passwordOk(b?.password)) return c.json({ ok: false, error: 'Новый пароль — минимум 8 символов' }, 400);
    auth.setPassword(b.password);
    auth.destroyOtherSessions(sessToken(c) || undefined);
    void tellMaster('🔐 CRM: пароль изменён. Другие входы завершены.');
    return c.json({ ok: true });
  });

  app.post('/api/auth/change-email', async (c) => {
    if (!auth.sessionValid(sessToken(c))) return c.json({ ok: false, error: 'unauthorized' }, 401);
    const b = (await c.req.json().catch(() => ({}))) as any;
    const key = 'chg:' + clientIp(c);
    if (auth.limited(key, 5, MIN15)) return c.json({ ok: false, error: 'Слишком много попыток. Подождите 15 минут.' }, 429);
    if (!auth.checkPassword(String(b?.current || ''))) {
      auth.hit(key, MIN15);
      return c.json({ ok: false, error: 'Текущий пароль неверный' }, 400);
    }
    const email = auth.normEmail(b?.email);
    if (!auth.emailOk(email)) return c.json({ ok: false, error: 'Неверный email' }, 400);
    auth.setEmail(email);
    void tellMaster(`✉️ CRM: email для входа изменён на ${email}.`);
    return c.json({ ok: true, email });
  });

  app.get('/api/crm/snapshot', async (c) => {
    const data = (await loadCrmSnapshot()) as any;
    if (data?.settings) {
      // Never expose the bot token or bot drafts over HTTP.
      const { telegramToken: _t, _draft: _d, ...settings } = data.settings;
      void _t;
      void _d;
      return c.json({ data: { ...data, settings: { ...settings, telegramToken: '' } } });
    }
    return c.json({ data });
  });

  app.post('/api/crm/snapshot', async (c) => {
    const body = await c.req.json().catch(() => null);
    const incoming = body?.data;
    if (!incoming || typeof incoming !== 'object' || !incoming.settings) {
      return c.json({ ok: false, error: 'bad snapshot' }, 400);
    }
    await withCrmLock(async () => {
      const prev = (await loadCrmSnapshot()) as any;
      // Merge instead of overwrite: keeps bot/online bookings the browser hasn't pulled yet,
      // bot drafts, sent-reminder flags, bot schedule edits; only tombstoned deletes remove.
      await saveCrmSnapshot(prev ? mergeIncoming(prev, incoming) : incoming);
    });
    return c.json({ ok: true });
  });

  // Public data for /book — no client names/phones, no token.
  app.get('/api/public/booking', async (c) => {
    const snap = await loadCrmSnapshot();
    return c.json({ data: publicView(snap) });
  });

  // Public online booking — validated and saved on the server (no full-snapshot flush from a visitor's phone).
  app.post('/api/public/book', async (c) => {
    const b = (await c.req.json().catch(() => null)) as any;
    const name = String(b?.name || '').trim().slice(0, 80);
    const phone = normalizePhone(String(b?.phone || ''));
    const day = String(b?.day || '');
    const time = String(b?.time || '');
    if (!name || phoneLast10(phone).length < 10) return c.json({ ok: false, error: 'Укажите имя и телефон' }, 400);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !/^\d{2}:\d{2}$/.test(time)) {
      return c.json({ ok: false, error: 'Неверная дата или время' }, 400);
    }
    const result = await withCrmLock(async () => {
      const snap = (await loadCrmSnapshot()) as any;
      if (!snap?.settings) return { ok: false, error: 'CRM не настроена' };
      if (!snap.settings.onlineEnabled) return { ok: false, error: 'Запись по ссылке закрыта' };
      const svc = (snap.services || []).find((s: any) => s.id === b?.serviceId && s.active !== false);
      if (!svc) return { ok: false, error: 'Услуга не найдена', code: 'service' };
      const sid = staffIdOf(snap);
      if (!computeSlots(snap, sid, day, svc.durationMin).includes(time)) {
        return { ok: false, error: 'Это время уже заняли. Выберите другое.', code: 'busy' };
      }
      const prev = clone(snap);
      let client = findClientsByPhone(snap, phone).find((x: any) => phoneLast10(x.phone || '') === phoneLast10(phone));
      if (!client) {
        client = { id: 'cli_' + Math.random().toString(36).slice(2, 10), name, phone, createdAt: new Date().toISOString() };
        snap.clients = [...(snap.clients || []), client];
      } else {
        client.name = name;
        client.phone = phone;
      }
      const reminderIds: string[] = Array.isArray(b?.reminders) ? b.reminders.map(String).slice(0, 10) : [];
      const customMins = Number(b?.customMins) > 0 ? Math.min(Number(b.customMins), 60 * 24 * 7) : null;
      const startISO = mskWallISO(day, time);
      const reminders = buildReminders(startISO, reminderIds, customMins);
      const mins = reminders.filter((r) => r.kind !== 'morning').map((r) => Number(String(r.kind).replace(/\D/g, ''))).filter((n) => n > 0);
      if (mins.length) client.reminderPrefs = [...new Set([...(client.reminderPrefs || []), ...mins])];
      if (reminderIds.includes('morning')) client.reminderMorning = true;
      const ap = {
        id: 'apt_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4),
        clientId: client.id,
        staffId: sid,
        serviceIds: [svc.id],
        start: startISO,
        durationMin: svc.durationMin,
        status: 'waiting',
        note: 'Онлайн-запись',
        source: 'online',
        color: snap.settings.onlineColor,
        telegramChatId: client.telegramChatId || undefined,
        reminders,
        createdAt: new Date().toISOString(),
      };
      snap.appointments = [...(snap.appointments || []), ap];
      stampChanges(prev, snap);
      await saveCrmSnapshot(snap);
      const token = snap.settings.telegramToken;
      if (token) {
        void notifyOwner(token, snap, ap, client, svc, 'Новая онлайн-запись').catch((e) =>
          console.error('notify owner (online)', e),
        );
      }
      return { ok: true, id: ap.id };
    });
    return c.json(result, result.ok ? 200 : 409);
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
      await withCrmLock(async () => {
        const snap = (await loadCrmSnapshot()) as any;
        if (snap?.settings) {
          snap.settings.telegramToken = token.trim();
          snap.settings.telegramBotUsername = me.result?.username || snap.settings.telegramBotUsername || '';
          await saveCrmSnapshot(snap);
        }
      });
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

  // Allow a new master Telegram account to connect via ?start=owner (clears the saved owner chat).
  app.post('/api/telegram/owner/reset', async (c) => {
    await withCrmLock(async () => {
      const snap = (await loadCrmSnapshot()) as any;
      if (snap?.settings) {
        snap.settings.telegramOwnerChatId = '';
        await saveCrmSnapshot(snap);
      }
    });
    return c.json({ ok: true });
  });

  app.post('/api/telegram/send', async (c) => {
    const body = await c.req.json();
    const { chatId, text, reply_markup } = body;
    let token = body.token;
    if (!token) {
      const snap = (await loadCrmSnapshot()) as any;
      token = snap?.settings?.telegramToken;
    }
    if (!token || !chatId || !text) {
      return c.json({ ok: false, error: 'token, chatId, text required' }, 400);
    }
    const r = await sendMessage(token, chatId, text, reply_markup);
    return c.json(r);
  });

  app.post('/api/telegram', async (c) => {
    // Only Telegram knows the secret_token we set in setWebhook.
    if (c.req.header('x-telegram-bot-api-secret-token') !== auth.webhookSecret()) {
      return c.json({ ok: false }, 401);
    }
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
    void withCrmLock(async () => {
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
        stampChanges(snap, next);
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
    });

    return c.json({ ok: true });
  });

  const server = createServer();

  // Production: serve the prebuilt bundle from dist/ (fast on phones, no Vite dep-optimizer
  // at runtime). Fallback to Vite middleware when dist/ is missing (local dev).
  const distDir = path.join(process.cwd(), 'dist');
  const useDist =
    process.env.NODE_ENV === 'production' &&
    process.env.SERVE_VITE !== '1' &&
    fs.existsSync(path.join(distDir, 'index.html'));
  const vite = useDist
    ? null
    : await createViteServer({
        server: { middlewareMode: true, hmr: { server }, allowedHosts: true },
        appType: 'spa',
      });
  const MIME: Record<string, string> = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json',
    '.webmanifest': 'application/manifest+json',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.ico': 'image/x-icon',
    '.webp': 'image/webp',
    '.txt': 'text/plain; charset=utf-8',
    '.woff2': 'font/woff2',
  };
  const serveDist = (reqUrl: string, res: import('http').ServerResponse) => {
    const pathname = decodeURIComponent((reqUrl || '/').split('?')[0]);
    let file = path.normalize(path.join(distDir, pathname));
    if (!file.startsWith(distDir)) file = path.join(distDir, 'index.html');
    if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      // Missing hashed asset (old tab after deploy) → real 404, not HTML-as-JS.
      if (pathname.startsWith('/assets/')) {
        res.statusCode = 404;
        res.end('Not found');
        return;
      }
      file = path.join(distDir, 'index.html');
    }
    const ext = path.extname(file).toLowerCase();
    res.statusCode = 200;
    res.setHeader('Content-Type', MIME[ext] || 'application/octet-stream');
    res.setHeader(
      'Cache-Control',
      file.includes(`${path.sep}assets${path.sep}`) ? 'public, max-age=31536000, immutable' : 'no-cache',
    );
    fs.createReadStream(file).pipe(res);
  };
  console.log(useDist ? 'Serving prebuilt dist/' : 'Serving via Vite middleware');

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
      if (!vite) {
        serveDist(req.url || '/', res);
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
        await withCrmLock(async () => {
        const snap = (await loadCrmSnapshot()) as any;
        if (!snap?.settings?.telegramToken) return;
        const prevSnap = clone(snap);
        const before = JSON.stringify(
          (snap.appointments || []).map((a: any) => (a.reminders || []).map((r: any) => !!r.sent)),
        );
        const { sent, crm } = await processDueReminders(snap);
        const after = JSON.stringify(
          (crm.appointments || []).map((a: any) => (a.reminders || []).map((r: any) => !!r.sent)),
        );
        if (sent > 0 || before !== after) {
          stampChanges(prevSnap, crm);
          await saveCrmSnapshot(crm);
          if (sent > 0) console.log('reminders sent', sent);
        }
        });
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
