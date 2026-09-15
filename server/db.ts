import fs from 'fs';
import path from 'path';

const dataDir = path.join(process.cwd(), 'data');
const snapPath = path.join(dataDir, 'crm-snapshot.json');

fs.mkdirSync(dataDir, { recursive: true });

export async function loadCrmSnapshot(): Promise<unknown | null> {
  try {
    if (!fs.existsSync(snapPath)) return null;
    const raw = fs.readFileSync(snapPath, 'utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export async function saveCrmSnapshot(data: unknown): Promise<void> {
  fs.mkdirSync(dataDir, { recursive: true });
  const tmp = snapPath + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data));
  fs.renameSync(tmp, snapPath);
}
