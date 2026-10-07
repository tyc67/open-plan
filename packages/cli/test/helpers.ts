import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const CLI = new URL('../dist/cli.js', import.meta.url).pathname;
export const V1_SAMPLE = new URL('../../core/test/fixtures/sample-v1.json', import.meta.url).pathname;

/** A new empty folder (its canonical path). */
export const folder = () => realpathSync.native(mkdtempSync(join(tmpdir(), 'open-plan-cli-')));

export interface Run { code: number; out: string; err: string; json: any }
/** Runs the built CLI with --json and parses the output. */
export function run(cwd: string, ...args: string[]): Run {
  const r = spawnSync(process.execPath, [CLI, ...args, '--json'], { cwd, encoding: 'utf8' });
  let json: any = null;
  try { json = JSON.parse(r.stdout); } catch { /* not JSON */ }
  return { code: r.status ?? -1, out: r.stdout, err: r.stderr, json };
}
/** The same, as a promise, so many can run at once. */
export function runAsync(cwd: string, ...args: string[]): Promise<Run> {
  return new Promise(done => {
    const child = spawn(process.execPath, [CLI, ...args, '--json'], { cwd });
    let out = '', err = '';
    child.stdout.on('data', d => { out += d; }); child.stderr.on('data', d => { err += d; });
    child.on('close', code => { let json: any = null; try { json = JSON.parse(out); } catch { /* not JSON */ } done({ code: code ?? -1, out, err, json }); });
  });
}
export const read = (path: string) => readFileSync(path, 'utf8');
