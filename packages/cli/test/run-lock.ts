import { linkSync, readFileSync, rmSync, writeFileSync } from 'node:fs';

// One test run at a time (see global-setup.ts). The lock file holds the process id of the run that owns it. It is never
// removed by another run: a lock whose process has ended, or that holds no process id, stops the run with a message
// that says how to remove it. So two waiting runs cannot both remove it and then both build.

export interface RunLockOptions {
  pid?: number;
  waitMs?: number;
  /** Whether a process is running (tests replace it). */
  alive?: (pid: number) => boolean;
  /** Called once when the run starts to wait. */
  onWait?: (owner: number) => void;
  /** For tests only: runs after the lock file was found to exist, before it is read. */
  afterExists?: () => void;
}

const running = (pid: number) => { try { process.kill(pid, 0); return true; } catch (error) { return (error as NodeJS.ErrnoException).code === 'EPERM'; } };
const sleep = (ms: number) => new Promise(done => setTimeout(done, ms));

export async function acquireRunLock(path: string, { pid = process.pid, waitMs = 15 * 60 * 1000, alive = running, onWait, afterExists }: RunLockOptions = {}): Promise<void> {
  const started = Date.now();
  let told = false;
  for (;;) {
    // The lock appears with its process id already in it (a link to a written file), so a waiting run never reads
    // an empty lock (with `writeFileSync(..., { flag: 'wx' })`, the file exists before the id is written).
    const own = `${path}.${pid}.tmp`;
    writeFileSync(own, String(pid));
    try { linkSync(own, path); return; } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    } finally { rmSync(own, { force: true }); }
    afterExists?.();
    let text: string;
    // The owner can remove the lock between the failed creation and this read: then try to create it again.
    try { text = readFileSync(path, 'utf8').trim(); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue; throw error; }
    const owner = Number(text);
    if (!/^\d+$/.test(text) || !alive(owner)) {
      throw new Error(`The test-run lock ${path} is left from a run that ended (${text ? `process ${text}` : 'no process id'}). If no other test run is going on, remove it and start again.`);
    }
    if (Date.now() - started > waitMs) throw new Error(`Another test run (process ${owner}) still holds ${path}.`);
    if (!told) { onWait?.(owner); told = true; }
    await sleep(100);
  }
}

/** Removes the lock if this process owns it. No other run removes a lock, so a lock with this pid is still ours. */
export function releaseRunLock(path: string, pid = process.pid): boolean {
  try { if (readFileSync(path, 'utf8').trim() !== String(pid)) return false; } catch { return false; }
  rmSync(path, { force: true });
  return true;
}
