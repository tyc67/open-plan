import { afterAll, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { folder, mcpClient, read, run, runAsync, V1_SAMPLE, type Run } from './helpers.js';

// Step C acceptance for MCP (roadmap C5b): concurrent writers from the CLI and MCP on one file, and the MCP part of
// the backup rules. The live update in `serve` is checked in a browser (tools/checks/mcp-serve.mjs).
const sha = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex');
type Mcp = Awaited<ReturnType<typeof mcpClient>>;
const open: Mcp[] = [];
afterAll(async () => { await Promise.all(open.map(m => m.close())); });
async function clients(dir: string, n: number) { const list = await Promise.all(Array.from({ length: n }, () => mcpClient(dir))); open.push(...list); return list; }
const backupsOf = (plan: string) => existsSync(`${plan}.backups`) ? readdirSync(`${plan}.backups`).sort() : [];

/**
 * Reads the plan file again and again while `work` runs. Every read must be complete JSON: a reader sees the old file
 * or the new one, never a part. Gives the revisions that were seen.
 */
async function sampled(plan: string, work: () => Promise<unknown>) {
  const seen = new Set<string>(), broken: string[] = [];
  let running = true, reads = 0;
  const reader = (async () => {
    while (running) {
      const bytes = await readFile(plan);
      reads++;
      try { JSON.parse(bytes.toString('utf8')); } catch { broken.push(bytes.toString('utf8').slice(0, 80)); }
      seen.add(sha(bytes));
    }
  })();
  try { await work(); } finally { running = false; await reader; }
  return { seen, broken, reads };
}

/** One outcome of a CLI or MCP apply: the code, and the revisions of a success. */
interface Outcome { via: 'cli' | 'mcp'; index: number; ok: boolean; code: string; revision?: string; previousRevision?: string; currentRevision?: string }
const fromCli = (index: number, r: Run): Outcome => ({ via: 'cli', index, ok: r.code === 0, code: r.json?.code ?? (r.code === 0 ? 'ok' : r.err.slice(0, 120)), revision: r.json?.revision, previousRevision: r.json?.previousRevision, currentRevision: r.json?.currentRevision });
const fromMcp = (index: number, result: any): Outcome => ({ via: 'mcp', index, ok: result.ok, code: result.code ?? 'ok', revision: result.revision, previousRevision: result.previousRevision, currentRevision: result.currentRevision });
const counts = (outcomes: Outcome[]) => Object.entries(Object.groupBy(outcomes, o => `${o.via} ${o.code}`)).map(([k, v]) => `${k} ×${v!.length}`).sort();

describe('C5b: 100 parallel apply calls from the CLI and MCP on one file', () => {
  it('with the same starting revision: exactly one succeeds, 99 get REVISION_CONFLICT; every read is complete JSON; one backup', async () => {
    const dir = folder(), plan = join(dir, 'plan.json');
    expect(run(dir, 'new', 'plan.json', '--sample').code).toBe(0);
    const before = readFileSync(plan), revision = sha(before);
    const mcp = await clients(dir, 5);
    for (let i = 0; i < 50; i++) writeFileSync(join(dir, `c${i}.json`), JSON.stringify({ expectedRevision: revision, commands: [{ op: 'set_plan_name', name: `cli-${i}` }] }));
    let outcomes: Outcome[] = [];
    const { seen, broken, reads } = await sampled(plan, async () => {
      outcomes = await Promise.all([
        ...Array.from({ length: 50 }, (_, i) => runAsync(dir, 'apply', 'plan.json', `c${i}.json`).then(r => fromCli(i, r))),
        ...Array.from({ length: 50 }, (_, i) => mcp[i % 5].call('apply_commands', { path: 'plan.json', expectedRevision: revision, commands: [{ op: 'set_plan_name', name: `mcp-${i}` }] }).then(r => fromMcp(i, r.result))),
      ]);
    });
    const winners = outcomes.filter(o => o.ok);
    expect(winners, counts(outcomes).join(', ')).toHaveLength(1);
    expect(outcomes.filter(o => !o.ok).every(o => o.code === 'REVISION_CONFLICT' && o.currentRevision === winners[0].revision), counts(outcomes).join(', ')).toBe(true);
    const winner = winners[0], text = read(plan);
    expect([sha(text), JSON.parse(text).name]).toEqual([winner.revision, `${winner.via}-${winner.index}`]);
    expect(backupsOf(plan)).toHaveLength(1);
    expect(readFileSync(join(`${plan}.backups`, backupsOf(plan)[0])).equals(before)).toBe(true);
    expect(broken, `${broken.length} of ${reads} reads were not complete JSON`).toEqual([]);
    expect([...seen].every(r => r === revision || r === winner.revision)).toBe(true);
    expect(readdirSync(dir).filter(f => f.endsWith('.tmp') || f.endsWith('.lock'))).toEqual([]);
    expect(run(dir, 'validate', 'plan.json').code).toBe(0);
    console.log(`same revision: ${counts(outcomes).join(', ')}; ${reads} reads during the run`);
  }, 120_000);

  it('each reads the revision and sends its change, again after each REVISION_CONFLICT: 100 successes in one sequence of 100 revisions, no lost update', async () => {
    const dir = folder(), plan = join(dir, 'plan.json');
    expect(run(dir, 'new', 'plan.json', '--sample').code).toBe(0);
    const initial = sha(readFileSync(plan)), sampleIds = JSON.parse(read(plan)).furniture.map((f: { id: string }) => f.id);
    const mcp = await clients(dir, 5);
    const add = (id: string) => [{ op: 'add_furniture', id, type: 'sofa', name: id, cx: 2000, cy: 1500, w: 800, d: 600 }];
    // Every attempt is kept: the conflicts and the one success of each caller.
    const outcomes: Outcome[] = [];
    const cliAttempt = async (i: number) => {
      const revision = (await runAsync(dir, 'info', 'plan.json')).json.revision;
      writeFileSync(join(dir, `c${i}.json`), JSON.stringify({ expectedRevision: revision, commands: add(`cli-${i}`) }));
      return fromCli(i, await runAsync(dir, 'apply', 'plan.json', `c${i}.json`));
    };
    const mcpAttempt = async (i: number) => {
      const client = mcp[i % 5], revision = (await client.call('read_plan', { path: 'plan.json' })).result.revision;
      return fromMcp(i, (await client.call('apply_commands', { path: 'plan.json', expectedRevision: revision, commands: add(`mcp-${i}`) })).result);
    };
    const caller = async (via: 'cli' | 'mcp', i: number) => {
      // The callers start 10 ms apart, CLI and MCP in turn, so they overlap but do not all read at the same moment.
      await new Promise(done => setTimeout(done, (2 * i + (via === 'mcp' ? 1 : 0)) * 10));
      for (let attempt = 0; attempt < 100; attempt++) {
        const outcome = await (via === 'cli' ? cliAttempt(i) : mcpAttempt(i));
        outcomes.push(outcome);
        if (outcome.code !== 'REVISION_CONFLICT') return;
      }
    };
    const { seen, broken, reads } = await sampled(plan, () => Promise.all([
      ...Array.from({ length: 50 }, (_, i) => caller('cli', i)), ...Array.from({ length: 50 }, (_, i) => caller('mcp', i)),
    ]));
    expect(outcomes.every(o => o.ok || o.code === 'REVISION_CONFLICT'), counts(outcomes).join(', ')).toBe(true);
    const successes = outcomes.filter(o => o.ok);
    expect(successes.length, counts(outcomes).join(', ')).toBe(100);
    // No two successes start from the same revision (that would be a lost update), and they link from the first
    // revision to the file's revision.
    const next = new Map(successes.map(s => [s.previousRevision!, s]));
    expect(next.size, 'two successes started from one revision').toBe(successes.length);
    const chain: Outcome[] = [];
    for (let at = initial; next.has(at); at = next.get(at)!.revision!) chain.push(next.get(at)!);
    expect(chain.length).toBe(successes.length);
    expect(chain.at(-1)!.revision).toBe(sha(readFileSync(plan)));
    const furniture = JSON.parse(read(plan)).furniture.map((f: { id: string }) => f.id).sort();
    expect(furniture).toEqual([...sampleIds, ...chain.map(s => `${s.via}-${s.index}`)].sort());
    // Each success left one backup with the plan before it; pruning keeps 20.
    expect(backupsOf(plan)).toHaveLength(Math.min(20, successes.length));
    const kept = backupsOf(plan).map(n => n.split('-')[1].replace('.json', ''));
    expect(kept).toEqual(chain.slice(-20).map(s => s.previousRevision));
    expect(broken, `${broken.length} of ${reads} reads were not complete JSON`).toEqual([]);
    expect([...seen].every(r => r === initial || successes.some(s => s.revision === r))).toBe(true);
    expect(readdirSync(dir).filter(f => f.endsWith('.tmp') || f.endsWith('.lock'))).toEqual([]);
    expect(run(dir, 'validate', 'plan.json').code).toBe(0);
    console.log(`with retries: ${counts(outcomes).join(', ')}; a sequence of ${chain.length} revisions; ${reads} reads during the run`);
  }, 180_000);
});

describe('C5b: backups of MCP writes', () => {
  it('each MCP or CLI write that replaces the plan leaves exactly one backup with the bytes before it, in one folder', async () => {
    const dir = folder(), plan = join(dir, 'plan.json');
    expect(run(dir, 'new', 'plan.json', '--sample').code).toBe(0);
    copyFileSync(V1_SAMPLE, join(dir, 'v1.json'));
    const [mcp] = await clients(dir, 1);
    const revision = () => sha(readFileSync(plan));
    const steps: [string, () => Promise<{ ok: boolean; backup?: string }>][] = [
      ['MCP apply_commands', async () => (await mcp.call('apply_commands', { path: 'plan.json', expectedRevision: revision(), commands: [{ op: 'set_plan_name', name: 'A' }] })).result],
      ['MCP write_plan', async () => (await mcp.call('write_plan', { path: 'plan.json', expectedRevision: revision(), plan: { ...JSON.parse(read(plan)), name: 'B' } })).result],
      ['CLI apply', async () => { writeFileSync(join(dir, 'c.json'), JSON.stringify({ expectedRevision: revision(), commands: [{ op: 'set_plan_name', name: 'C' }] })); return run(dir, 'apply', 'plan.json', 'c.json').json; }],
      ['MCP migrate_plan over the plan', async () => (await mcp.call('migrate_plan', { source: 'v1.json', destination: 'plan.json', expectedRevision: revision() })).result],
    ];
    for (const [name, step] of steps) {
      const before = readFileSync(plan), count = backupsOf(plan).length;
      const result = await step();
      expect(result.ok, name).toBe(true);
      expect(backupsOf(plan).length, name).toBe(count + 1);
      expect(readFileSync(join(`${plan}.backups`, result.backup!)).equals(before), name).toBe(true);
    }
  });
  it('no backup for a new file or for a write that changes nothing', async () => {
    const dir = folder(), plan = join(dir, 'plan.json');
    copyFileSync(V1_SAMPLE, join(dir, 'v1.json'));
    const [mcp] = await clients(dir, 1);
    expect((await mcp.call('create_plan', { path: 'plan.json', sample: true })).result).toMatchObject({ ok: true, backup: null });
    const revision = sha(readFileSync(plan));
    expect((await mcp.call('apply_commands', { path: 'plan.json', expectedRevision: revision, commands: [{ op: 'set_plan_name', name: JSON.parse(read(plan)).name }] })).result).toMatchObject({ ok: true, backup: null, revision });
    expect((await mcp.call('write_plan', { path: 'plan.json', expectedRevision: revision, plan: JSON.parse(read(plan)) })).result).toMatchObject({ ok: true, backup: null, revision });
    expect((await mcp.call('write_plan', { path: 'other.json', plan: JSON.parse(read(plan)) })).result).toMatchObject({ ok: true, backup: null });
    expect((await mcp.call('migrate_plan', { source: 'v1.json', destination: 'v2.json' })).result).toMatchObject({ ok: true, backup: null });
    for (const name of ['plan.json', 'other.json', 'v2.json']) expect(backupsOf(join(dir, name)), name).toEqual([]);
  });
  it('a failed backup refuses each MCP write, and nothing changes', async () => {
    const dir = folder(), plan = join(dir, 'plan.json');
    expect(run(dir, 'new', 'plan.json', '--sample').code).toBe(0);
    copyFileSync(V1_SAMPLE, join(dir, 'v1.json'));
    writeFileSync(`${plan}.backups`, 'not a folder');
    const [mcp] = await clients(dir, 1);
    const before = read(plan), revision = sha(before);
    for (const [tool, args] of [
      ['apply_commands', { path: 'plan.json', expectedRevision: revision, commands: [{ op: 'set_plan_name', name: 'X' }] }],
      ['write_plan', { path: 'plan.json', expectedRevision: revision, plan: { ...JSON.parse(before), name: 'X' } }],
      ['migrate_plan', { source: 'v1.json', destination: 'plan.json', expectedRevision: revision }],
    ] as const) {
      expect((await mcp.call(tool, args)).result, tool).toMatchObject({ ok: false, code: 'BACKUP_FAILED' });
      expect(read(plan), tool).toBe(before);
    }
  });
  it('pruning keeps the 20 newest backups after 22 MCP writes; `restore` brings back a plan from an MCP backup, and MCP reads it', async () => {
    const dir = folder(), plan = join(dir, 'plan.json');
    expect(run(dir, 'new', 'plan.json', '--sample').code).toBe(0);
    const [mcp] = await clients(dir, 1);
    const previous: string[] = [];
    for (let i = 0; i < 22; i++) {
      const revision = sha(readFileSync(plan));
      previous.push(revision);
      const tool = i % 2 ? 'write_plan' : 'apply_commands';
      const args = i % 2 ? { plan: { ...JSON.parse(read(plan)), name: `n${i}` } } : { commands: [{ op: 'set_plan_name', name: `n${i}` }] };
      expect((await mcp.call(tool, { path: 'plan.json', expectedRevision: revision, ...args })).result.ok, `${tool} ${i}`).toBe(true);
    }
    const kept = backupsOf(plan);
    expect(kept.map(n => n.split('-')[1].replace('.json', ''))).toEqual(previous.slice(2));
    const chosen = kept[5], chosenBytes = readFileSync(join(`${plan}.backups`, chosen));
    const restored = run(dir, 'restore', 'plan.json', chosen);
    expect(restored.code).toBe(0);
    expect(readFileSync(plan).equals(chosenBytes)).toBe(true);
    expect((await mcp.call('read_plan', { path: 'plan.json' })).result).toMatchObject({ ok: true, revision: sha(chosenBytes), plan: { name: JSON.parse(chosenBytes.toString('utf8')).name } });
  });
});
