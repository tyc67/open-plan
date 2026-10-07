import { randomBytes } from 'node:crypto';
import { readFile, unlink } from 'node:fs/promises';
import { hostname } from 'node:os';
import { CliError, prepareExclusive } from './files.js';

/** What a lock file holds. The token identifies the one writer that may remove it. */
export interface LockOwner { token: string; hostname: string; pid: number; createdAt: string }

export interface LockOptions { timeoutMs?: number; retryMs?: number }
export interface HeldLock { path: string; owner: LockOwner }

export const lockPath = (plan: string) => `${plan}.lock`;
const sleep = (ms: number) => new Promise(done => setTimeout(done, ms));

const RECOVERY = 'Stop every program that writes this plan (the CLI, the MCP server, `serve`), then remove the lock file by hand.';

/** Whether the owner process is alive: true, false (confirmed not to exist), or null (cannot be known). */
function processState(owner: LockOwner): boolean | null {
  if (owner.hostname !== hostname()) return null;
  try { process.kill(owner.pid, 0); return true; } catch (error) {
    // ESRCH is the only proof that the process does not exist. EPERM means it exists but belongs to another user.
    return (error as NodeJS.ErrnoException).code === 'ESRCH' ? false : null;
  }
}

function parseOwner(text: string): LockOwner | null {
  try {
    const value = JSON.parse(text);
    return typeof value?.token === 'string' && typeof value.hostname === 'string' && Number.isInteger(value.pid) && typeof value.createdAt === 'string' ? value : null;
  } catch { return null; }
}

/** True if the lock file still holds this token. */
async function sameLock(path: string, token: string): Promise<boolean> {
  try { return parseOwner(await readFile(path, 'utf8'))?.token === token; } catch { return false; }
}

/**
 * Takes the lock of a plan (roadmap C2). The lock file is created exclusively with its complete content. While a live
 * process on this computer holds it, this waits up to `timeoutMs` (then `LOCK_TIMEOUT`). A lock whose owner process is
 * confirmed not to exist gives `LOCK_STALE`; a lock whose owner cannot be checked gives `LOCK_UNCERTAIN`. Neither is
 * removed or renamed: there is no safe automatic recovery, so a person must stop all writers and remove it.
 * The guarantee holds on local file systems; exclusive creation is not reliable on some network file systems.
 */
export async function acquireLock(plan: string, { timeoutMs = 10_000, retryMs = 25 }: LockOptions = {}): Promise<HeldLock> {
  const path = lockPath(plan), started = Date.now();
  const owner: LockOwner = { token: randomBytes(16).toString('hex'), hostname: hostname(), pid: process.pid, createdAt: new Date().toISOString() };
  const ioError = (error: unknown, action: string) => new CliError('IO_ERROR', `Cannot ${action} the lock ${path} (${(error as NodeJS.ErrnoException).code}).`, { lock: path });
  let exclusive;
  try { exclusive = await prepareExclusive(path, `${JSON.stringify(owner)}\n`); } catch (error) { throw ioError(error, 'create'); }
  try {
    for (;;) {
      try { if (await exclusive.link()) return { path, owner }; } catch (error) { throw ioError(error, 'create'); }
      let text: string;
      try { text = await readFile(path, 'utf8'); } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;   // released between the two calls
        throw ioError(error, 'read');
      }
      const current = parseOwner(text), alive = current ? processState(current) : null;
      // The owner may have released the lock and exited after the read above. A dead process cannot release a lock
      // later, so the lock is stale only if the same token is still there after the death was seen.
      if (alive === false && !(await sameLock(path, current!.token))) continue;
      if (alive === false) throw new CliError('LOCK_STALE', `The plan is locked by process ${current!.pid}, which no longer runs. ${RECOVERY} Lock: ${path}`, { lock: path, owner: current });
      if (alive === null) throw new CliError('LOCK_UNCERTAIN', `The plan is locked${current ? ` by process ${current.pid} on ${current.hostname}` : ' by an unreadable lock file'}, and the owner cannot be checked. ${RECOVERY} Lock: ${path}`, { lock: path, owner: current });
      if (Date.now() - started >= timeoutMs) throw new CliError('LOCK_TIMEOUT', `The plan is still locked by process ${current!.pid} after ${timeoutMs / 1000} s. Try again later. Lock: ${path}`, { lock: path, owner: current });
      await sleep(retryMs);
    }
  } finally { await exclusive.discard(); }
}

/**
 * Removes the lock only if it still holds our token. A lock with another token, or no lock, is left as it is and a
 * warning is returned: removing it could break another writer.
 */
export async function releaseLock(lock: HeldLock): Promise<string | null> {
  let text: string;
  try { text = await readFile(lock.path, 'utf8'); } catch { return `The lock ${lock.path} was already gone when this command finished.`; }
  if (parseOwner(text)?.token !== lock.owner.token) return `The lock ${lock.path} now belongs to another writer; it was not removed.`;
  try { await unlink(lock.path); return null; } catch (error) { return `Cannot remove the lock ${lock.path} (${(error as NodeJS.ErrnoException).code}). ${RECOVERY}`; }
}

/** Runs `work` while holding the plan lock. A release problem is added to the result's notices. */
export async function withLock<T extends { notices: string[] }>(plan: string, work: () => Promise<T>, options?: LockOptions): Promise<T> {
  const lock = await acquireLock(plan, options);
  let result: T;
  try { result = await work(); } catch (error) { await releaseLock(lock); throw error; }
  const warning = await releaseLock(lock);
  if (warning) result.notices.push(warning);
  return result;
}
