import fs from 'fs';
import path from 'path';

/**
 * Persistent + in-memory dedup for Telegram update_id.
 * First claimUpdateId() wins; concurrent/retry deliveries return false.
 */
const dataDir = path.join(process.cwd(), 'data');
const seenPath = path.join(dataDir, 'tg-seen-ids.json');
const MAX_IDS = 2000;

const memory = new Set<number>();
let loaded = false;
let maxSeen = 0;

function ensureLoaded() {
  if (loaded) return;
  loaded = true;
  try {
    if (!fs.existsSync(seenPath)) return;
    const raw = JSON.parse(fs.readFileSync(seenPath, 'utf8')) as {
      ids?: number[];
      max?: number;
    };
    for (const id of raw.ids || []) {
      if (typeof id === 'number') {
        memory.add(id);
        if (id > maxSeen) maxSeen = id;
      }
    }
    if (typeof raw.max === 'number' && raw.max > maxSeen) maxSeen = raw.max;
  } catch (e) {
    console.error('tg-dedup load', e);
  }
}

function persist() {
  try {
    fs.mkdirSync(dataDir, { recursive: true });
    const ids = [...memory].sort((a, b) => a - b);
    const trimmed = ids.length > MAX_IDS ? ids.slice(ids.length - MAX_IDS) : ids;
    if (trimmed.length !== ids.length) {
      memory.clear();
      for (const id of trimmed) memory.add(id);
    }
    const tmp = seenPath + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify({ ids: trimmed, max: maxSeen }));
    fs.renameSync(tmp, seenPath);
  } catch (e) {
    console.error('tg-dedup persist', e);
  }
}

/** true = process this update; false = duplicate / already claimed. */
export function claimUpdateId(updateId: number | null | undefined, offsetHint = 0): boolean {
  ensureLoaded();
  if (updateId == null || !Number.isFinite(Number(updateId))) return true;
  const id = Number(updateId);
  if (offsetHint > 0 && id < offsetHint) return false;
  if (memory.has(id)) return false;
  memory.add(id);
  if (id > maxSeen) maxSeen = id;
  persist();
  return true;
}

export function hasSeenUpdateId(updateId: number | null | undefined): boolean {
  ensureLoaded();
  if (updateId == null) return false;
  return memory.has(Number(updateId));
}
