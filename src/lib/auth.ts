const LOCK_KEY = 'barber-lock-v1';
const SESSION_KEY = 'barber-session-v1';

export type LockData = { phone: string; pinHash: string; createdAt: string };

async function sha256(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export function getLock(): LockData | null {
  try {
    const raw = localStorage.getItem(LOCK_KEY);
    return raw ? (JSON.parse(raw) as LockData) : null;
  } catch {
    return null;
  }
}

export function hasLock(): boolean {
  return !!getLock();
}

export async function setupLock(phone: string, pin: string): Promise<void> {
  const pinHash = await sha256(pin + '|' + phone);
  const data: LockData = { phone, pinHash, createdAt: new Date().toISOString() };
  localStorage.setItem(LOCK_KEY, JSON.stringify(data));
  sessionStorage.setItem(SESSION_KEY, '1');
}

export async function verifyPin(phone: string, pin: string): Promise<boolean> {
  const lock = getLock();
  if (!lock) return false;
  const pinHash = await sha256(pin + '|' + phone);
  // also allow hash with stored phone (user may type same digits differently)
  const alt = await sha256(pin + '|' + lock.phone);
  if (pinHash === lock.pinHash || alt === lock.pinHash) {
    sessionStorage.setItem(SESSION_KEY, '1');
    return true;
  }
  return false;
}

export function isSessionOpen(): boolean {
  return sessionStorage.getItem(SESSION_KEY) === '1';
}

export function logout(): void {
  sessionStorage.removeItem(SESSION_KEY);
}

export function clearLock(): void {
  localStorage.removeItem(LOCK_KEY);
  sessionStorage.removeItem(SESSION_KEY);
}
