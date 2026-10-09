import { describe, expect, it } from 'vitest';
import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { acquireRunLock, releaseRunLock } from './run-lock.js';
import { folder } from './helpers.js';

// The lock that lets only one test run build and test at a time (global-setup.ts), with each order of events.
const lockIn = () => join(folder(), 'run.lock');

describe('test-run lock', () => {
  it('a free lock is taken; the owner releases it; another pid cannot release it', async () => {
    const lock = lockIn();
    await acquireRunLock(lock, { pid: 101 });
    expect(readFileSync(lock, 'utf8')).toBe('101');
    expect(releaseRunLock(lock, 202)).toBe(false);
    expect(releaseRunLock(lock, 101)).toBe(true);
    expect(existsSync(lock)).toBe(false);
  });
  it('the lock appears with its process id in it (a link to a written file), and no temporary file is left, also by a run that waits', async () => {
    const lock = lockIn(), dir = dirname(lock);
    await acquireRunLock(lock, { pid: 101 });
    let seen = '';
    const waiting = acquireRunLock(lock, { pid: 202, alive: () => true, afterExists: () => { seen ||= readFileSync(lock, 'utf8'); } });
    await new Promise(done => setTimeout(done, 150));
    expect(readdirSync(dir).sort()).toEqual(['run.lock']);
    releaseRunLock(lock, 101); await waiting;
    expect([seen, readFileSync(lock, 'utf8'), readdirSync(dir)]).toEqual(['101', '202', ['run.lock']]);
  });
  it('a waiting run gets the lock after the owner releases it', async () => {
    const lock = lockIn(), waits: number[] = [];
    writeFileSync(lock, '101');
    const waiting = acquireRunLock(lock, { pid: 202, alive: () => true, onWait: owner => waits.push(owner) });
    await new Promise(done => setTimeout(done, 150));
    expect(releaseRunLock(lock, 101)).toBe(true);
    await waiting;
    expect([readFileSync(lock, 'utf8'), waits]).toEqual(['202', [101]]);
  });
  it('the owner releases the lock between the failed creation and the read: the waiting run tries again and gets it', async () => {
    const lock = lockIn();
    writeFileSync(lock, '101');
    let released = false;
    await acquireRunLock(lock, { pid: 202, alive: () => true, afterExists: () => { if (!released) { released = true; rmSync(lock); } } });
    expect([released, readFileSync(lock, 'utf8')]).toEqual([true, '202']);
  });
  it('a lock of a process that ended, or with no process id, stops the run and is not removed', async () => {
    const lock = lockIn();
    for (const text of ['101', '', 'x']) {
      writeFileSync(lock, text);
      await expect(acquireRunLock(lock, { pid: 202, alive: () => false })).rejects.toThrow(/remove it and start again/);
      expect(readFileSync(lock, 'utf8')).toBe(text);
    }
  });
  it('two runs that find the same ended owner both stop: neither removes the lock, so neither can build', async () => {
    const lock = lockIn();
    writeFileSync(lock, '101');
    const results = await Promise.allSettled([acquireRunLock(lock, { pid: 202, alive: () => false }), acquireRunLock(lock, { pid: 303, alive: () => false })]);
    expect([results.map(r => r.status), readFileSync(lock, 'utf8')]).toEqual([['rejected', 'rejected'], '101']);
  });
});
