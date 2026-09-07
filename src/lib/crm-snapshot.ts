import type { CrmState } from './types';

export async function loadSnapshot(): Promise<CrmState | null> {
  try {
    const r = await fetch('/api/crm/snapshot');
    if (!r.ok) return null;
    const j = await r.json();
    return j.data ?? null;
  } catch {
    return null;
  }
}

export async function saveSnapshot(data: CrmState): Promise<void> {
  try {
    await fetch('/api/crm/snapshot', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data }),
    });
  } catch {
    /* ignore */
  }
}

let flushTimer: ReturnType<typeof setTimeout> | null = null;
export function scheduleFlush(getData: () => CrmState) {
  if (flushTimer) clearTimeout(flushTimer);
  flushTimer = setTimeout(() => {
    void saveSnapshot(getData());
  }, 250);
}
