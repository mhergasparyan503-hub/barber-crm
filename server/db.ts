import { PGlite } from '@electric-sql/pglite';
import path from 'path';
import fs from 'fs';

const dataDir = path.join(process.cwd(), 'data', 'pglite');
fs.mkdirSync(dataDir, { recursive: true });

let db: PGlite | null = null;

export async function getDb() {
  if (db) return db;
  db = new PGlite(dataDir);
  await db.exec(`
    CREATE TABLE IF NOT EXISTS crm_snapshot (
      id INT PRIMARY KEY,
      data JSONB NOT NULL
    );
    CREATE TABLE IF NOT EXISTS telegram_links (
      code TEXT PRIMARY KEY,
      chat_id TEXT NOT NULL,
      username TEXT
    );
  `);
  return db;
}

export async function loadCrmSnapshot() {
  const d = await getDb();
  const r = await d.query<{ data: unknown }>('SELECT data FROM crm_snapshot WHERE id = 1');
  return r.rows[0]?.data ?? null;
}

export async function saveCrmSnapshot(data: unknown) {
  const d = await getDb();
  await d.query(
    `INSERT INTO crm_snapshot (id, data) VALUES (1, $1)
     ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data`,
    [data],
  );
}

export async function upsertTelegramLink(code: string, chatId: string, username?: string) {
  const d = await getDb();
  await d.query(
    `INSERT INTO telegram_links (code, chat_id, username) VALUES ($1, $2, $3)
     ON CONFLICT (code) DO UPDATE SET chat_id = EXCLUDED.chat_id, username = EXCLUDED.username`,
    [code, chatId, username ?? null],
  );
}

export async function getTelegramLink(code: string) {
  const d = await getDb();
  const r = await d.query<{ chat_id: string; username: string | null }>(
    'SELECT chat_id, username FROM telegram_links WHERE code = $1',
    [code],
  );
  return r.rows[0] ?? null;
}
