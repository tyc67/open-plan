import { describe, expect, it } from 'vitest';
import { mkdirSync, readdirSync, readFileSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { acquireLock, releaseLock } from '../src/lock.js';
import { createTools } from '../src/mcp-tools.js';
import { Workspace } from '../src/workspace.js';
import { folder, run } from './helpers.js';

// The workspace boundary when a path changes between the check and the I/O (roadmap C5). The tools run in this
// process, with the test hook that runs after the paths are checked; the stdio tests are in mcp.test.ts.
const sha = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex');
const examplePlan = JSON.parse(/```json\n([\s\S]*?)```/.exec(readFileSync(new URL('../../../docs/plan-format.md', import.meta.url), 'utf8'))![1]);

/** A workspace with plan files inside, a folder outside with a plan, and tools whose hook runs `change` once. */
async function setup(change: (dir: string, outside: string) => void) {
  const dir = folder(), outside = folder();
  for (const name of ['a.json', 'sub/plan.json']) {
    mkdirSync(join(dir, 'sub'), { recursive: true });
    expect(run(dir, 'new', name, '--sample').code).toBe(0);
  }
  expect(run(outside, 'new', 'plan.json', '--sample').code).toBe(0);
  writeFileSync(join(outside, 'plan.json'), readFileSync(join(outside, 'plan.json'), 'utf8').replace('"name": "', '"name": "Outside '));
  symlinkSync(join(dir, 'a.json'), join(dir, 'link.json'));
  let done = false;
  const tools = createTools(await Workspace.open(dir), { afterCheck: async () => { if (!done) { done = true; change(dir, outside); } } });
  const outsideBefore = readFileSync(join(outside, 'plan.json'), 'utf8');
  const outsideUnchanged = () => {
    expect(readFileSync(join(outside, 'plan.json'), 'utf8')).toBe(outsideBefore);
    expect(readdirSync(outside)).toEqual(['plan.json']);
  };
  return { dir, outside, tools, outsideUnchanged };
}
const retargetLink = (dir: string, outside: string) => { rmSync(join(dir, 'link.json')); symlinkSync(join(outside, 'plan.json'), join(dir, 'link.json')); };
const swapFolder = (dir: string, outside: string) => { renameSync(join(dir, 'sub'), join(dir, 'sub-old')); symlinkSync(outside, join(dir, 'sub')); };

describe('MCP boundary: a path that changes between the check and the I/O', () => {
  it('a read through a symlink retargeted out after the check reads the checked file, not the new target', async () => {
    const { dir, tools, outsideUnchanged } = await setup(retargetLink);
    const { result } = await tools.call('read_plan', { path: 'link.json' });
    expect(result).toMatchObject({ ok: true, revision: sha(readFileSync(join(dir, 'a.json'))) });
    expect(JSON.stringify(result)).not.toContain('Outside');
    outsideUnchanged();
  });
  it('a write through a symlink retargeted out after the check writes the checked file only', async () => {
    const { dir, tools, outsideUnchanged } = await setup(retargetLink);
    const revision = sha(readFileSync(join(dir, 'a.json')));
    const { result } = await tools.call('apply_commands', { path: 'link.json', expectedRevision: revision, commands: [{ op: 'set_plan_name', name: 'Changed' }] });
    expect(result).toMatchObject({ ok: true, previousRevision: revision });
    expect(JSON.parse(readFileSync(join(dir, 'a.json'), 'utf8')).name).toBe('Changed');
    outsideUnchanged();
  });
  it('a read whose folder is replaced by a link out after the check is refused, and gives nothing of the outside file', async () => {
    for (const tool of ['read_plan', 'plan_info', 'validate_plan', 'render_preview']) {
      const { tools, outsideUnchanged } = await setup(swapFolder);
      const { result } = await tools.call(tool, { path: 'sub/plan.json' });
      expect(result, tool).toMatchObject({ ok: false, code: 'PLAN_PATH_CHANGED' });
      expect(JSON.stringify(result), tool).not.toContain('Outside');
      if (tool === 'read_plan') expect(result).not.toHaveProperty('revision');
      outsideUnchanged();
    }
  });
  it('a write whose folder is replaced by a link out after the check is refused before the lock: no lock, backup or plan outside', async () => {
    for (const [tool, args] of [
      ['apply_commands', { commands: [{ op: 'set_plan_name', name: 'X' }] }],
      ['write_plan', { plan: examplePlan }],
      ['create_plan', { path: 'sub/new.json' }],
    ] as const) {
      const { dir, outside, tools, outsideUnchanged } = await setup(swapFolder);
      const revision = sha(readFileSync(join(dir, 'sub/plan.json')));
      // A lock held on the outside plan: a tool that took the lock there would wait for it (and make its lock file
      // there); the refusal must come at once.
      const held = await acquireLock(join(outside, 'plan.json'));
      const started = Date.now();
      const { result } = await tools.call(tool, { path: 'sub/plan.json', ...(tool === 'create_plan' ? {} : { expectedRevision: revision }), ...args } as Record<string, unknown>);
      expect(result, tool).toMatchObject({ ok: false, code: 'PATH_OUTSIDE_WORKSPACE' });
      expect(Date.now() - started, `${tool}: refused before the lock`).toBeLessThan(2000);
      expect(await releaseLock(held)).toBeNull();
      outsideUnchanged();
    }
  });
  it('a backup folder replaced by a link out while the write waits for the lock: refused under the lock, nothing written', async () => {
    for (const tool of ['apply_commands', 'write_plan'] as const) {
      const { dir, outside, tools, outsideUnchanged } = await setup(() => {});
      const plan = join(dir, 'a.json'), before = readFileSync(plan, 'utf8'), revision = sha(before);
      mkdirSync(`${plan}.backups`);
      const held = await acquireLock(plan);
      const call = tools.call(tool, { path: 'a.json', expectedRevision: revision, ...(tool === 'apply_commands' ? { commands: [{ op: 'set_plan_name', name: 'X' }] } : { plan: examplePlan }) });
      // The writer has passed the check before the lock when it prepares its own lock file: wait for that file.
      const waiting = () => readdirSync(dir).some(f => f.startsWith('a.json.lock.') && f.endsWith('.tmp'));
      for (let i = 0; i < 400 && !waiting(); i++) await new Promise(done => setTimeout(done, 5));
      expect(waiting(), `${tool}: the writer waits for the lock`).toBe(true);
      rmSync(`${plan}.backups`, { recursive: true });
      symlinkSync(outside, `${plan}.backups`);
      expect(await releaseLock(held)).toBeNull();
      const { result } = await call;
      expect(result, tool).toMatchObject({ ok: false, code: 'PATH_OUTSIDE_WORKSPACE' });
      expect(readFileSync(plan, 'utf8'), tool).toBe(before);
      outsideUnchanged();
    }
  });
});
