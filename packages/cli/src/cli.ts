#!/usr/bin/env node
// Open Plan command line (roadmap C2). Output is text for people and agents, or JSON with --json.
// Exit codes: 0 success; 1 validation errors or a refused change; 2 usage error; 3 revision conflict; 4 lock error;
// 5 input or output error.
import { parseArgs } from 'node:util';
import type { Issue } from 'open-plan-core';
import { CliError } from './files.js';
import * as op from './operations.js';

const USAGE = `Usage: open-plan <command> [options]

  schema                                 Print the JSON Schema and the field description
  validate <plan.json>                   Check a plan (strict); exit code 1 on errors
  info <plan.json>                       Counts, size, rooms with areas, and the revision
  new <plan.json> [--sample] [--replace] Write an empty plan or the sample apartment
  migrate <old.json> <plan.json> [--replace]
                                         Convert a schema version 1 file to version 2
  apply <plan.json> <commands.json>      Apply { "expectedRevision": "...", "commands": [...] }
  backups <plan.json>                    List the backups of a plan
  restore <plan.json> <backup-name>      Restore a backup (the current file is backed up first)

Options: --json (machine-readable output), --help`;

const EXIT: Record<string, number> = {
  VALIDATION_FAILED: 1, COMMANDS_REFUSED: 1, DESTINATION_EXISTS: 1, NOT_VERSION_1: 1, NOT_VERSION_2: 1, REVISION_REQUIRED: 1,
  COMMANDS_INVALID: 1, BACKUP_INVALID: 1, BACKUP_NOT_FOUND: 1, PLAN_HARD_LINKED: 1, NOT_A_FILE: 1, PLAN_PATH_CHANGED: 1,
  JSON_INVALID: 1, FILE_NOT_FOUND: 1, USAGE: 2, REVISION_CONFLICT: 3, LOCK_TIMEOUT: 4, LOCK_STALE: 4, LOCK_UNCERTAIN: 4,
  IO_ERROR: 5, BACKUP_FAILED: 5,
};
const ARITY: Record<string, number> = { schema: 0, validate: 1, info: 1, new: 1, migrate: 2, apply: 2, backups: 1, restore: 2 };

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
    for (const b of result.backups) out.push(`  ${b.name}  ${b.bytes} bytes`);
  } else {
    if (command === 'validate') out.push('Valid.');
    if (command === 'info') {
      const s = result.summary;
      out.push(`${result.name}: ${s.walls} walls, ${s.openings} openings, ${s.rooms} rooms, ${s.furniture} furniture; ${s.width.toFixed(2)} × ${s.depth.toFixed(2)} m`);
      for (const r of result.rooms) out.push(`  ${r.id}  ${r.name}  ${r.area.toFixed(2)} m²${r.counted ? '' : ' (not counted)'}`);
    }
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
    parsed = parseArgs({ args: argv, allowPositionals: true, options: { json: { type: 'boolean' }, sample: { type: 'boolean' }, replace: { type: 'boolean' }, help: { type: 'boolean', short: 'h' } } });
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
  if ((values.sample && command !== 'new') || (values.replace && !['new', 'migrate'].includes(command))) return fail('USAGE', `Option not available for ${command}.`);
  try {
    const result: Record<string, any> =
      command === 'schema' ? await op.schema()
      : command === 'validate' ? await op.validate(args[0])
      : command === 'info' ? await op.info(args[0])
      : command === 'new' ? await op.create(args[0], { sample: values.sample, replace: values.replace })
      : command === 'migrate' ? await op.migrate(args[0], args[1], { replace: values.replace })
      : command === 'apply' ? await op.apply(args[0], args[1])
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

process.exitCode = await main(process.argv.slice(2));
