import { existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { config } from '../config.js';
import { getDb } from '../db.js';

const dir = () => join(dirname(config.dbPath), 'backups');

/** Cria uma cópia consistente do banco (VACUUM INTO) e mantém só as últimas N. */
export function makeBackup() {
  mkdirSync(dir(), { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const file = join(dir(), `paany-${stamp}.db`);
  if (existsSync(file)) rmSync(file);
  getDb().exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);

  const files = readdirSync(dir()).filter((f) => f.startsWith('paany-') && f.endsWith('.db')).sort();
  for (const old of files.slice(0, Math.max(0, files.length - config.backupKeep))) rmSync(join(dir(), old));
  return file;
}

export function startBackupLoop() {
  setInterval(() => {
    try { makeBackup(); } catch (e) { console.error('[backup]', e.message); }
  }, 24 * 3600_000).unref?.();
  setTimeout(() => { try { makeBackup(); } catch (e) { console.error('[backup]', e.message); } }, 60_000);
}
