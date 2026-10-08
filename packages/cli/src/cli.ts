#!/usr/bin/env node
// Open Plan command line (roadmap C2). Output is text for people and agents, or JSON with --json.
// Exit codes: 0 success; 1 validation errors or a refused change; 2 usage error; 3 revision conflict; 4 lock error;
// 5 input or output error.
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import type { Issue } from 'open-plan-core';
import { CliError } from './files.js';
import * as op from './operations.js';
import { DEFAULT_PORT, startServer } from './serve.js';

const USAGE = `Usage: open-plan <command> [options]

  schema                                 Print the JSON Schema and the field description
  validate <plan.json>                   Check a plan (strict); exit code 1 on errors
  info <plan.json>                       Counts, size, rooms with areas, and the revision
  new <plan.json> [--sample] [--replace] Write an empty plan or the sample apartment
  migrate <old.json> <plan.json> [--replace]
                                         Convert a schema version 1 file to version 2
  apply <plan.json> <commands.json>      Apply { "expectedRevision": "...", "commands": [...] }
  render <plan.json> <out.png> [--crop x0,y0,x1,y1] [--width px] [--grid] [--dimensions] [--no-text]
                                         Draw the plan in 2D as a PNG, to compare with the source image
  serve <plan.json> [--port n] [--host address] [--no-open]
                                         Open the plan in the editor; edits are saved to the file, and file
                                         changes appear in the editor (stop with Ctrl+C)
  backups <plan.json>                    List the backups of a plan
  restore <plan.json> <backup-name>      Restore a backup (the current file is backed up first)

Options: --json (machine-readable output), --help

render: --crop is a plan area in mm (default: the whole plan); --width is the image width in px (default 1200).
The image is at most 8000 px on each side and 32 million px. --grid adds a 1 m grid; --dimensions adds the
dimension chains; --no-text leaves out all text.

serve: listens on 127.0.0.1 port ${DEFAULT_PORT} (or the next free one; an explicit --port must be free). The URL has a
secret token; do not share it. --host adds one more address, for example a LAN address (plain HTTP).`;

const EXIT: Record<string, number> = {
  VALIDATION_FAILED: 1, COMMANDS_REFUSED: 1, DESTINATION_EXISTS: 1, NOT_VERSION_1: 1, NOT_VERSION_2: 1, REVISION_REQUIRED: 1,
  COMMANDS_INVALID: 1, BACKUP_INVALID: 1, BACKUP_NOT_FOUND: 1, PLAN_HARD_LINKED: 1, NOT_A_FILE: 1, PLAN_PATH_CHANGED: 1,
  JSON_INVALID: 1, FILE_NOT_FOUND: 1, USAGE: 2, REVISION_CONFLICT: 3, LOCK_TIMEOUT: 4, LOCK_STALE: 4, LOCK_UNCERTAIN: 4,
  IO_ERROR: 5, BACKUP_FAILED: 5, PORT_IN_USE: 5, EDITOR_MISSING: 5,
};
const ARITY: Record<string, number> = { schema: 0, validate: 1, info: 1, new: 1, migrate: 2, apply: 2, render: 2, serve: 1, backups: 1, restore: 2 };
const RENDER_OPTIONS = ['crop', 'width', 'grid', 'dimensions', 'no-text'] as const, SERVE_OPTIONS = ['port', 'host', 'no-open'] as const;

const issueLine = (i: Issue & { commandIndex?: number }) =>
  `  - ${i.commandIndex !== undefined ? `[command ${i.commandIndex}] ` : ''}${i.path}: ${i.code}${Object.keys(i.params).length ? ` ${JSON.stringify(i.params)}` : ''}`;

/** Text output for people and agents that do not use --json. */
function printText(command: string, result: Record<string, any>) {
  const out: string[] = [];
  if (!result.ok) {
    out.push(`${result.code}: ${result.message}`);
    if (result.currentRevision) out.push(`Current revision: ${result.currentRevision}`);
    for (const e of result.errors ?? []) out.push(issueLine(e));
  } else if (command === 'schema') {
    out.push(result.description.trimEnd(), '', '## JSON Schema', '', JSON.stringify(result.schema, null, 2));
  } else if (command === 'backups') {
    out.push(result.backups.length ? 'Backups (oldest first):' : 'No backups.');
    for (const b of result.backups) out.push(`  ${b.name}  ${b.bytes} bytes${b.label === 'file' ? '' : `  (${b.label === 'browser' ? 'browser plan before loading the file version' : 'browser plan before a replacement'})`}`);
  } else {
    if (command === 'validate') out.push('Valid.');
    if (command === 'info') {
      const s = result.summary;
      out.push(`${result.name}: ${s.walls} walls, ${s.openings} openings, ${s.rooms} rooms, ${s.furniture} furniture; ${s.width.toFixed(2)} × ${s.depth.toFixed(2)} m`);
      for (const r of result.rooms) out.push(`  ${r.id}  ${r.name}  ${r.area.toFixed(2)} m²${r.counted ? '' : ' (not counted)'}`);
    }
    if (command === 'render') out.push(`Wrote ${result.output} (${result.width} × ${result.height} px).`);
    if (result.revision) out.push(`Revision: ${result.revision}`);
    if (result.backup) out.push(`Backup: ${result.backup}`);
    for (const n of result.notes ?? []) out.push(`  note [command ${n.commandIndex}] ${n.code} ${JSON.stringify(n.params)}`);
    if (result.warnings?.length) { out.push(`Warnings (${result.warnings.length}):`); for (const w of result.warnings) out.push(issueLine(w)); }
  }
  if (result.migrationReport?.length) { out.push(`Migration report (${result.migrationReport.length}):`); for (const n of result.migrationReport) out.push(`  - ${n.code}: ${n.message}`); }
  for (const n of result.notices ?? []) out.push(`Notice: ${n}`);
  (result.ok ? process.stdout : process.stderr).write(`${out.join('\n')}\n`);
}

async function main(argv: string[]): Promise<number> {
  let parsed;
  try {
    parsed = parseArgs({ args: argv, allowPositionals: true, options: { json: { type: 'boolean' }, sample: { type: 'boolean' }, replace: { type: 'boolean' }, help: { type: 'boolean', short: 'h' },
      crop: { type: 'string' }, width: { type: 'string' }, grid: { type: 'boolean' }, dimensions: { type: 'boolean' }, 'no-text': { type: 'boolean' },
      port: { type: 'string' }, host: { type: 'string' }, 'no-open': { type: 'boolean' } } });
  } catch (error) { process.stderr.write(`${(error as Error).message}\n\n${USAGE}\n`); return 2; }
  const { values, positionals: [command, ...args] } = parsed;
  if (values.help || !command) { process.stdout.write(`${USAGE}\n`); return command || values.help ? 0 : 2; }
  const fail = (code: string, message: string, details: Record<string, unknown> = {}) => {
    if (values.json) process.stdout.write(`${JSON.stringify({ ok: false, code, message, ...details, notices: [] })}\n`);
    else process.stderr.write(`${code}: ${message}\n`);
    return EXIT[code] ?? 5;
  };
  if (!(command in ARITY)) return fail('USAGE', `Unknown command "${command}".\n\n${USAGE}`);
  if (args.length !== ARITY[command]) return fail('USAGE', `${command} takes ${ARITY[command]} argument(s).\n\n${USAGE}`);
  if ((values.sample && command !== 'new') || (values.replace && !['new', 'migrate'].includes(command)) ||
    (command !== 'render' && RENDER_OPTIONS.some(o => values[o] !== undefined)) ||
    (command !== 'serve' && SERVE_OPTIONS.some(o => values[o] !== undefined))) return fail('USAGE', `Option not available for ${command}.`);
  const number = (text: string) => text.trim() === '' ? NaN : Number(text);
  try {
    if (command === 'serve') return await serve(args[0], values, fail);
    const result: Record<string, any> =
      command === 'schema' ? await op.schema()
      : command === 'validate' ? await op.validate(args[0])
      : command === 'info' ? await op.info(args[0])
      : command === 'new' ? await op.create(args[0], { sample: values.sample, replace: values.replace })
      : command === 'migrate' ? await op.migrate(args[0], args[1], { replace: values.replace })
      : command === 'apply' ? await op.apply(args[0], args[1])
      : command === 'render' ? await op.render(args[0], args[1], {
        crop: values.crop === undefined ? undefined : values.crop.split(',').map(number) as op.RenderOptions['crop'],
        width: values.width === undefined ? undefined : number(values.width),
        grid: values.grid, dimensions: values.dimensions, text: !values['no-text'],
      })
      : command === 'backups' ? await op.backups(args[0])
      : await op.restore(args[0], args[1]);
    if (values.json) process.stdout.write(`${JSON.stringify(result)}\n`);
    else printText(command, result);
    return result.ok ? 0 : EXIT[result.code] ?? 1;
  } catch (error) {
    if (error instanceof CliError) return fail(error.code, error.message, error.details);
    return fail('IO_ERROR', (error as Error)?.stack ?? String(error));
  }
}

/** Runs `serve` until Ctrl+C (or SIGTERM); writes in progress finish before the process ends. */
async function serve(file: string, values: { json?: boolean; port?: string; host?: string; 'no-open'?: boolean }, fail: (code: string, message: string) => number): Promise<number> {
  const port = values.port === undefined ? undefined : Number(values.port);
  if (port !== undefined && !(Number.isInteger(port) && port >= 1 && port <= 65535)) return fail('USAGE', '--port must be a whole number from 1 to 65535.');
  const server = await startServer({ file, port, host: values.host, editorDir: fileURLToPath(new URL('./editor/', import.meta.url)) });
  if (values.json) process.stdout.write(`${JSON.stringify({ ok: true, url: server.url, port: server.port, plan: server.plan })}\n`);
  else process.stdout.write(`Open Plan is serving ${server.plan}\n${server.url}\nThe link has a secret token; do not share it. Stop with Ctrl+C.\n`);
  if (values.host) process.stderr.write(`Warning: also listening on ${values.host}. The connection is plain HTTP; use it only on a network you trust.\n`);
  if (!values['no-open']) {
    const opener = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? null : 'xdg-open';
    if (opener) spawn(opener, [server.url], { detached: true, stdio: 'ignore' }).on('error', () => process.stderr.write('Could not open a browser; open the link above.\n')).unref();
  }
  await new Promise<void>(done => { process.once('SIGINT', done); process.once('SIGTERM', done); });
  await server.close();
  return 0;
}

process.exitCode = await main(process.argv.slice(2));
