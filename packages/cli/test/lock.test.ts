import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { hostname } from 'node:os';
import { join } from 'node:path';
import { acquireLock, lockPath, releaseLock } from '../src/lock.js';
import { CliError } from '../src/files.js';
import { folder } from './helpers.js';

const planIn = (dir: string) => join(dir, 'plan.json');
const owner = (fields: object) => `${JSON.stringify({ token: 'other', hostname: hostname(), pid: process.pid, createdAt: new Date().toISOString(), ...fields })}\n`;
async function lockError(plan: string, timeoutMs = 200): Promise<CliError> {
  try { await acquireLock(plan, { timeoutMs }); } catch (error) { return error as CliError; }
  throw new Error('the lock was taken');
}
/** The pid of a process that has exited. */
function deadPid(): number {
  const child = spawnSync(process.execPath, ['-e', 'process.stdout.write(String(process.pid))'], { encoding: 'utf8' });
  return Number(child.stdout);
}

describe('plan lock (roadmap C2)', () => {
  it('a lock file has a token, the hostname, the pid and the time, and release removes it', async () => {
    const plan = planIn(folder()), lock = await acquireLock(plan);
    const content = JSON.parse(readFileSync(lockPath(plan), 'utf8'));
    expect(content).toEqual({ token: lock.owner.token, hostname: hostname(), pid: process.pid, createdAt: lock.owner.createdAt });
    expect(content.token).toMatch(/^[0-9a-f]{32}$/);
    expect(await releaseLock(lock)).toBeNull();
    expect(existsSync(lockPath(plan))).toBe(false);
  });
  it('a live owner on this computer: wait, then LOCK_TIMEOUT', async () => {
    const plan = planIn(folder()), held = await acquireLock(plan), started = Date.now();
    const error = await lockError(plan, 300);
    expect([error.code, Date.now() - started >= 300]).toEqual(['LOCK_TIMEOUT', true]);
    await releaseLock(held);
  });
  it('a waiting writer gets the lock when the owner releases it', async () => {
    const plan = planIn(folder()), held = await acquireLock(plan);
    setTimeout(() => { releaseLock(held); }, 150);
    const lock = await acquireLock(plan, { timeoutMs: 2000 });
    expect(lock.owner.token).not.toBe(held.owner.token);
    await releaseLock(lock);
  });
  it('an owner process that does not exist: LOCK_STALE, and the lock is not removed or changed', async () => {
    const plan = planIn(folder()), text = owner({ pid: deadPid() });
    writeFileSync(lockPath(plan), text);
    const error = await lockError(plan);
    expect(error.code).toBe('LOCK_STALE');
    expect(error.message).toContain('Stop every program that writes this plan');
    expect(readFileSync(lockPath(plan), 'utf8')).toBe(text);
  });
  it('an owner that cannot be checked: LOCK_UNCERTAIN, and the lock is not removed or changed', async () => {
    const cases = [owner({ hostname: 'another-computer' }), 'not json', owner({ pid: 'x' })];
    if (process.getuid?.() !== 0) cases.push(owner({ pid: 1 }));            // pid 1 belongs to root: EPERM, not ESRCH
    for (const text of cases) {
      const plan = planIn(folder());
      writeFileSync(lockPath(plan), text);
      expect((await lockError(plan)).code).toBe('LOCK_UNCERTAIN');
      expect(readFileSync(lockPath(plan), 'utf8')).toBe(text);
    }
  });
  it('release never removes a lock with another token, and reports it', async () => {
    const plan = planIn(folder()), lock = await acquireLock(plan), other = owner({ token: 'someone-else' });
    writeFileSync(lockPath(plan), other);
    expect(await releaseLock(lock)).toContain('belongs to another writer');
    expect(readFileSync(lockPath(plan), 'utf8')).toBe(other);
  });
  it('release reports a lock that is already gone', async () => {
    const plan = planIn(folder()), lock = await acquireLock(plan);
    expect(await releaseLock(lock)).toBeNull();
    expect(await releaseLock(lock)).toContain('already gone');
  });
});
