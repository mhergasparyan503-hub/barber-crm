/**
 * Owner authentication (single account, email + password).
 *  - data/auth.json: { user, sessions (sha256 of token), codes, webhookSecret }
 *  - Passwords: scrypt (node:crypto) with per-user salt.
 *  - One-time codes (registration / password reset) go to the master Telegram chat.
 */
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

const dataDir = path.join(process.cwd(), 'data');
const authPath = path.join(dataDir, 'auth.json');

export const SESSION_COOKIE = 'bcrm_sess';
export const SESSION_DAYS = 90;
const CODE_TTL_MS = 15 * 60 * 1000;

type Code = { hash: string; exp: number; tries: number };
type AuthData = {
  user: { email: string; hash: string; createdAt: string; updatedAt?: string } | null;
  sessions: Record<string, { createdAt: number; exp: number }>;
  codes: { register?: Code; reset?: Code };
  webhookSecret?: string;
};

let cache: AuthData | null = null;

function load(): AuthData {
  if (cache) return cache;
  try {
    const raw = JSON.parse(fs.readFileSync(authPath, 'utf8'));
    cache = { user: raw.user || null, sessions: raw.sessions || {}, codes: raw.codes || {}, webhookSecret: raw.webhookSecret };
  } catch {
    cache = { user: null, sessions: {}, codes: {} };
  }
  return cache;
}

function save() {
  const d = load();
  const now = Date.now();
  for (const [k, s] of Object.entries(d.sessions)) if (s.exp < now) delete d.sessions[k];
  fs.mkdirSync(dataDir, { recursive: true });
  const tmp = authPath + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(d), { mode: 0o600 });
  fs.renameSync(tmp, authPath);
}

const sha = (s: string) => crypto.createHash('sha256').update(s).digest('hex');

function hashPassword(pw: string): string {
  const salt = crypto.randomBytes(16);
  const key = crypto.scryptSync(pw, salt, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt$${salt.toString('base64')}$${key.toString('base64')}`;
}

function verifyPassword(pw: string, stored: string): boolean {
  const [alg, saltB, keyB] = String(stored || '').split('$');
  if (alg !== 'scrypt' || !saltB || !keyB) return false;
  const key = Buffer.from(keyB, 'base64');
  const got = crypto.scryptSync(pw, Buffer.from(saltB, 'base64'), key.length, { N: 16384, r: 8, p: 1 });
  return crypto.timingSafeEqual(key, got);
}

export const normEmail = (e: unknown) => String(e || '').trim().toLowerCase();
export const emailOk = (e: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) && e.length <= 120;
export const passwordOk = (p: unknown) => typeof p === 'string' && p.trim().length >= 6 && p.length <= 200;
/** New passwords are stored without stray spaces at the ends (phone keyboards add them). */
export const cleanPassword = (p: unknown) => String(p || '').trim();

export function hasAccount(): boolean {
  return !!load().user;
}
export function accountEmail(): string {
  return load().user?.email || '';
}

export function webhookSecret(): string {
  const d = load();
  if (!d.webhookSecret) {
    d.webhookSecret = crypto.randomBytes(24).toString('hex');
    save();
  }
  return d.webhookSecret;
}

// ---- sessions
export function createSession(): string {
  const token = crypto.randomBytes(32).toString('base64url');
  const now = Date.now();
  load().sessions[sha(token)] = { createdAt: now, exp: now + SESSION_DAYS * 864e5 };
  save();
  return token;
}
export function sessionValid(token: string | undefined | null): boolean {
  if (!token || !load().user) return false;
  const s = load().sessions[sha(token)];
  return !!s && s.exp > Date.now();
}
export function destroySession(token: string | undefined | null) {
  if (!token) return;
  delete load().sessions[sha(token)];
  save();
}
export function destroyOtherSessions(keepToken?: string) {
  const keep = keepToken ? sha(keepToken) : '';
  const d = load();
  for (const k of Object.keys(d.sessions)) if (k !== keep) delete d.sessions[k];
  save();
}

export function readCookie(header: string | undefined | null, name = SESSION_COOKIE): string | null {
  for (const part of String(header || '').split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return null;
}
export function sessionCookie(token: string, secure: boolean): string {
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}${secure ? '; Secure' : ''}`;
}
export function clearCookie(secure: boolean): string {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure ? '; Secure' : ''}`;
}

// ---- one-time codes
export function issueCode(kind: 'register' | 'reset'): string {
  const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
  load().codes[kind] = { hash: sha(code), exp: Date.now() + CODE_TTL_MS, tries: 0 };
  save();
  return code;
}
/** Checks and consumes the code (max 5 tries per code). */
export function checkCode(kind: 'register' | 'reset', code: unknown): 'ok' | 'bad' | 'expired' {
  const d = load();
  const c = d.codes[kind];
  if (!c || c.exp < Date.now() || c.tries >= 5) return 'expired';
  if (sha(String(code || '').trim()) !== c.hash) {
    c.tries++;
    save();
    return c.tries >= 5 ? 'expired' : 'bad';
  }
  delete d.codes[kind];
  save();
  return 'ok';
}

// ---- account
export function register(email: string, password: string): boolean {
  const d = load();
  if (d.user) return false;
  d.user = { email, hash: hashPassword(password), createdAt: new Date().toISOString() };
  d.sessions = {};
  delete d.codes.register;
  save();
  return true;
}
/**
 * Tolerant check for phone keyboards: exact first, then without stray spaces at the ends,
 * then with the first letter's case flipped (auto-capitalization). Rate limits still apply.
 */
function passwordVariants(pw: string): string[] {
  const out = [pw];
  const t = pw.trim();
  if (t !== pw) out.push(t);
  for (const v of [pw, t]) {
    if (!v) continue;
    const f = v[0];
    const flipped = f === f.toUpperCase() ? f.toLowerCase() : f.toUpperCase();
    if (flipped !== f) out.push(flipped + v.slice(1));
  }
  return [...new Set(out)];
}
function verifyAny(pw: string, stored: string): boolean {
  let ok = false;
  for (const v of passwordVariants(pw)) if (verifyPassword(v, stored)) ok = true;
  return ok;
}
export function checkLogin(email: string, password: string): boolean {
  const u = load().user;
  if (!u) return false;
  const passOk = verifyAny(password, u.hash); // always run (timing)
  return passOk && normEmail(email) === u.email;
}
export function checkPassword(password: string): boolean {
  const u = load().user;
  return !!u && verifyAny(password, u.hash);
}
export function setPassword(password: string) {
  const u = load().user;
  if (!u) return;
  u.hash = hashPassword(password);
  u.updatedAt = new Date().toISOString();
  save();
}
export function setEmail(email: string) {
  const u = load().user;
  if (!u) return;
  u.email = email;
  u.updatedAt = new Date().toISOString();
  save();
}

// ---- in-memory rate limiting
const buckets = new Map<string, number[]>();
/** Returns true if the key has >= limit hits within windowMs. */
export function limited(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  const arr = (buckets.get(key) || []).filter((t) => now - t < windowMs);
  buckets.set(key, arr);
  return arr.length >= limit;
}
export function hit(key: string, windowMs: number): number {
  const now = Date.now();
  const arr = (buckets.get(key) || []).filter((t) => now - t < windowMs);
  arr.push(now);
  buckets.set(key, arr);
  return arr.length;
}
/** Minutes until the oldest hit in the window expires (for «подождите N минут»). */
export function waitMinutes(key: string, windowMs: number): number {
  const arr = buckets.get(key) || [];
  if (!arr.length) return 0;
  return Math.max(1, Math.ceil((arr[0] + windowMs - Date.now()) / 60000));
}
export function clearHits(key: string) {
  buckets.delete(key);
}
