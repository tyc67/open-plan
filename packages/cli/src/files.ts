import { createHash, randomBytes } from 'node:crypto';
import { constants, realpath as realpathCallback } from 'node:fs';
import { promisify } from 'node:util';
import { link, lstat, mkdir, open, readdir, readFile, rename, rm, stat, unlink } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';

/** An operational failure (not a validation result). `code` is stable; the CLI maps it to an exit code. */
export class CliError extends Error {
  constructor(readonly code: string, message: string, readonly details: Record<string, unknown> = {}) { super(message); this.name = 'CliError'; }
}

// The native realpath also gives the stored letter case on a case-insensitive file system.
const realpathNative = promisify(realpathCallback.native);

const io = (error: unknown, action: string, path: string): CliError => {
  const code = (error as NodeJS.ErrnoException)?.code ?? 'UNKNOWN';
  return new CliError('IO_ERROR', `Cannot ${action} ${path} (${code}).`, { path, errno: code });
};

/** The revision of a plan: the full SHA-256 of the file bytes, in hex. */
export const revisionOf = (bytes: Buffer): string => createHash('sha256').update(bytes).digest('hex');

/** The text that the CLI writes for a plan. Not byte-identical to the web export, which has no final newline. */
export const planText = (plan: unknown): string => `${JSON.stringify(plan, null, 2)}\n`;

/**
 * The canonical path of a plan, so two names of one file use one lock and one backup folder. An existing file is
 * resolved with realpath (symlinks, letter case); a new file uses the canonical parent folder and its name.
 */
export async function canonicalPath(path: string, mustExist: boolean): Promise<string> {
  try { return await realpathNative(path); } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw io(error, 'resolve', path);
    if (mustExist) throw new CliError('FILE_NOT_FOUND', `${path} does not exist.`, { path });
  }
  let parent: string;
  try { parent = await realpathNative(dirname(path)); } catch (error) { throw io(error, 'resolve the folder of', path); }
  return join(parent, basename(path));
}

/** Refuses a plan file with more than one hard link: its other names would get other locks. Returns false if it does not exist. */
export async function checkSingleLink(path: string): Promise<boolean> {
  let info;
  try { info = await lstat(path); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false; throw io(error, 'read', path); }
  if (!info.isFile()) throw new CliError('NOT_A_FILE', `${path} is not a regular file.`, { path });
  if (info.nlink > 1) throw new CliError('PLAN_HARD_LINKED', `${path} has ${info.nlink} hard links. Each name would get its own lock, so the file is refused. Copy it to a file with one name.`, { path, links: info.nlink });
  return true;
}

export async function readBytes(path: string): Promise<Buffer> {
  try { return await readFile(path); } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new CliError('FILE_NOT_FOUND', `${path} does not exist.`, { path });
    throw io(error, 'read', path);
  }
}

/** Parses JSON, or throws a CliError with the code that the validator uses for the same problem. */
export function parseJson(bytes: Buffer, path: string): unknown {
  try { return JSON.parse(bytes.toString('utf8')); } catch (error) {
    throw new CliError('JSON_INVALID', `${path} is not valid JSON: ${(error as Error).message}`, { path });
  }
}

/** Writes a new file with `flag` ('wx': must not exist) and syncs it to disk before it is closed. */
async function writeSynced(path: string, data: string | Buffer, flag: string) {
  const handle = await open(path, flag, 0o644);
  try { await handle.writeFile(data); await handle.sync(); } finally { await handle.close(); }
}

/** Syncs a folder, so a rename or a new file in it is on disk. Some systems cannot sync a folder; that is ignored. */
async function syncFolder(folder: string) {
  try { const handle = await open(folder, constants.O_RDONLY); try { await handle.sync(); } finally { await handle.close(); } } catch { /* not supported */ }
}

/**
 * Replaces `path` atomically: a temporary file in the same folder, synced, then renamed over the target. A reader sees
 * the old file or the new one, never a part of the new one. The caller must hold the lock.
 */
export async function replaceFile(path: string, data: string | Buffer): Promise<void> {
  const temp = join(dirname(path), `.${basename(path)}.${randomBytes(6).toString('hex')}.tmp`);
  try {
    await writeSynced(temp, data, 'wx');
    await rename(temp, path);
  } catch (error) {
    await rm(temp, { force: true }).catch(() => {});
    throw io(error, 'write', path);
  }
  await syncFolder(dirname(path));
}

// ---- Backups: <plan>.backups/<time>-<revision>.json ----

export const backupFolder = (plan: string) => `${plan}.backups`;
export const BACKUPS_KEPT = 20;
const BACKUP_NAME = /^(\d{8}T\d{9}Z)-([0-9a-f]{64})(?:-(\d+))?\.json$/;

export interface BackupInfo { name: string; time: string; revision: string; bytes: number }

const stamp = (date: Date) => date.toISOString().replace(/[-:.]/g, '');

/**
 * Writes the current bytes of a plan to its backup folder and syncs them, before the plan is replaced. If this fails,
 * the caller must not replace the plan. Returns the backup name.
 */
export async function writeBackup(plan: string, bytes: Buffer): Promise<string> {
  const folder = backupFolder(plan), base = `${stamp(new Date())}-${revisionOf(bytes)}`;
  try { await mkdir(folder, { recursive: true }); } catch (error) { throw new CliError('BACKUP_FAILED', `Cannot make the backup folder ${folder} (${(error as NodeJS.ErrnoException).code}). Nothing was changed.`, { folder }); }
  for (let n = 1; n < 100; n++) {
    const name = n === 1 ? `${base}.json` : `${base}-${n}.json`;
    try {
      await writeSynced(join(folder, name), bytes, 'wx');
      await syncFolder(folder);
      return name;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') continue;
      await rm(join(folder, name), { force: true }).catch(() => {});
      throw new CliError('BACKUP_FAILED', `Cannot write a backup in ${folder} (${(error as NodeJS.ErrnoException).code}). Nothing was changed.`, { folder });
    }
  }
  throw new CliError('BACKUP_FAILED', `Cannot find a free backup name in ${folder}. Nothing was changed.`, { folder });
}

/** The backups of a plan, oldest first. */
export async function listBackups(plan: string): Promise<BackupInfo[]> {
  let names: string[];
  try { names = await readdir(backupFolder(plan)); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw io(error, 'read', backupFolder(plan)); }
  const out: BackupInfo[] = [];
  for (const name of names.sort()) {
    const match = BACKUP_NAME.exec(name);
    if (!match) continue;
    const { size } = await stat(join(backupFolder(plan), name));
    out.push({ name, time: match[1], revision: match[2], bytes: size });
  }
  return out;
}

/** The path of a listed backup. Only a plain name from the listing is accepted, never a path. */
export async function backupPath(plan: string, name: string): Promise<string> {
  if (!BACKUP_NAME.test(name) || name !== basename(name)) throw new CliError('BACKUP_NOT_FOUND', `${name} is not a backup name. Use a name from \`backups\`.`, { name });
  if (!(await listBackups(plan)).some(b => b.name === name)) throw new CliError('BACKUP_NOT_FOUND', `There is no backup ${name}.`, { name });
  return join(backupFolder(plan), name);
}

/** Deletes the oldest backups so that `BACKUPS_KEPT` remain. Returns a warning instead of throwing: the write already succeeded. */
export async function pruneBackups(plan: string): Promise<string | null> {
  try {
    const backups = await listBackups(plan);
    for (const old of backups.slice(0, Math.max(0, backups.length - BACKUPS_KEPT))) await unlink(join(backupFolder(plan), old.name));
    return null;
  } catch (error) {
    return `The plan was written, but old backups could not be removed (${(error as NodeJS.ErrnoException).code ?? (error as Error).message}). Remove old files in ${backupFolder(plan)} by hand.`;
  }
}

/**
 * Prepares exclusive creation of `path` with complete content: the content is written and synced to a temporary file
 * once, and each `link()` tries to link it to `path` (false if `path` exists). Retries then cost one link each, not a
 * write and a sync. `discard()` removes the temporary file; call it in all cases.
 */
export async function prepareExclusive(path: string, data: string): Promise<{ link(): Promise<boolean>; discard(): Promise<void> }> {
  const temp = `${path}.${randomBytes(6).toString('hex')}.tmp`;
  await writeSynced(temp, data, 'wx');
  return {
    link: async () => {
      try { await link(temp, path); return true; } catch (error) { if ((error as NodeJS.ErrnoException).code === 'EEXIST') return false; throw error; }
    },
    discard: () => unlink(temp).catch(() => {}),
  };
}
