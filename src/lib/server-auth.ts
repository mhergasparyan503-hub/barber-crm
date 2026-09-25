/** Server session (email + password). Cookie is httpOnly — JS only sees status. */
export type AuthStatus = { hasAccount: boolean; authed: boolean; email?: string; masterTelegram: boolean };

export const UNAUTHORIZED_EVENT = 'crm-unauthorized';

export function signalUnauthorized() {
  window.dispatchEvent(new Event(UNAUTHORIZED_EVENT));
}

export async function authStatus(): Promise<AuthStatus | null> {
  try {
    const r = await fetch('/api/auth/status', { cache: 'no-store' });
    if (!r.ok) return null;
    return (await r.json()) as AuthStatus;
  } catch {
    return null;
  }
}

export async function authPost(
  path: string,
  body: Record<string, unknown> = {},
): Promise<{ ok: boolean; error?: string; [k: string]: unknown }> {
  try {
    const r = await fetch(`/api/auth/${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const j = await r.json().catch(() => ({}));
    if (r.status === 401 && !['login', 'register', 'code', 'reset-code', 'reset'].includes(path)) {
      window.dispatchEvent(new Event(UNAUTHORIZED_EVENT));
      return { ...j, ok: false, error: 'Сессия истекла, войдите снова' };
    }
    if (!r.ok || !j.ok) return { ...j, ok: false, error: j.error || `Ошибка ${r.status}` };
    return j;
  } catch {
    return { ok: false, error: 'Нет связи с сервером' };
  }
}
