import { Resvg } from '@resvg/resvg-js';
import {
  applyCommands, createEmptyPlan, createSamplePlan, migrateV1Document, planImageSize, renderPlanSvg, roomArea, summarizePlan, validatePlan,
  type CommandIssue, type CommandNote, type Issue, type MigrationNote, type PlanV2, type Rect,
} from 'open-plan-core';
import schemaText from '../../../docs/open-plan.schema.json?raw';
import formatText from '../../../docs/plan-format.md?raw';
import {
  backupPath, canonicalPath, checkSingleLink, CliError, createFile, listBackups, parseJson, planText, pruneBackups, readBytes,
  replaceFile, revisionOf, writeBackup, type BackupInfo,
} from './files.js';
import { withLock, type LockOptions } from './lock.js';

/**
 * Results of the CLI operations (roadmap C2). `ok: false` with a `code` is an expected outcome (validation errors, a
 * refused change, a revision conflict); operational failures are thrown as CliError. `notices` are operational warnings
 * (a backup pruning failure, a lock problem at release), apart from the plan's validation `warnings`.
 */
export type Result<T> = ({ ok: true } & T | { ok: false; code: string; message: string; errors?: (Issue | CommandIssue)[]; [key: string]: unknown }) & { notices: string[] };

/** The JSON Schema and the short field description. Both are inside the built CLI, not read from the repository. */
export async function schema(): Promise<Result<{ schema: unknown; description: string }>> {
  return { ok: true, schema: JSON.parse(schemaText), description: formatText, notices: [] };
}

/**
 * Options of the operations for a transport other than the CLI (the MCP server, roadmap C5). The CLI passes none.
 * `maxBytes` bounds every file read. `boundary` is called with each canonical plan path that is used: under the lock
 * for a write, and after the read for a read; it throws to refuse the path (the MCP workspace boundary).
 */
export interface OpOptions extends LockOptions {
  maxBytes?: number;
  boundary?: (path: string) => Promise<void>;
}

/**
 * Reads a plan file. With a boundary, `path` is a checked canonical path: if it resolves to another file after the
 * read, a folder in it was replaced during the read, and the bytes are not used.
 */
async function readPlanBytes(path: string, opts: OpOptions): Promise<Buffer> {
  const bytes = await readBytes(path, opts.maxBytes);
  if (opts.boundary) {
    if ((await canonicalPath(path, true)) !== path) throw new CliError('PLAN_PATH_CHANGED', `${path} now resolves to another file. Nothing was used; try again.`, { path });
    await opts.boundary(path);
  }
  return bytes;
}

interface Examined { schemaVersion: unknown; plan?: PlanV2; errors: Issue[]; warnings: Issue[]; report: MigrationNote[] }
interface Loaded extends Examined { revision: string }

/** Reads a plan file of any version and validates it with a policy. A v1 file is migrated in memory first. */
async function load(path: string, source: 'import' | 'saved', opts: OpOptions): Promise<Loaded> {
  const bytes = await readPlanBytes(path, opts), revision = revisionOf(bytes);
  let input: unknown;
  try { input = parseJson(bytes, path); } catch { return { revision, schemaVersion: null, errors: [{ path: '$', code: 'json-invalid', params: {} }], warnings: [], report: [] }; }
  return { revision, ...examine(input, source) };
}

/** Validates a parsed plan of any version with a policy. */
function examine(input: unknown, source: 'import' | 'saved'): Examined {
  const schemaVersion = (input as { schemaVersion?: unknown })?.schemaVersion ?? null;
  let report: MigrationNote[] = [];
  if (schemaVersion === 1) {
    const migrated = migrateV1Document(input);
    if (!migrated.ok) return { schemaVersion, errors: migrated.errors, warnings: [], report: migrated.report };
    input = migrated.plan; report = migrated.report;
  }
  const result = validatePlan(input, source);
  return { schemaVersion, plan: result.plan, errors: result.errors, warnings: result.warnings, report };
}

/** Validates a plan file with the strict (import) policy: tolerable issues are errors. */
export async function validate(file: string, opts: OpOptions = {}): Promise<Result<{ revision: string; schemaVersion: unknown; warnings: Issue[]; migrationReport: MigrationNote[] }>> {
  const loaded = await load(file, 'import', opts);
  const hint = loaded.schemaVersion === 1 ? ' The file is schema version 1; `migrate` converts it.' : '';
  if (loaded.errors.length) return { ok: false, code: 'VALIDATION_FAILED', message: `${loaded.errors.length} error(s).${hint}`, errors: loaded.errors, revision: loaded.revision, schemaVersion: loaded.schemaVersion, migrationReport: loaded.report, notices: [] };
  return { ok: true, revision: loaded.revision, schemaVersion: loaded.schemaVersion, warnings: loaded.warnings, migrationReport: loaded.report, notices: hint ? [hint.trim()] : [] };
}

/** Validates an inline plan (not a file) with the same strict policy as `validate`. It has no revision. */
export function validateValue(input: unknown): Result<{ schemaVersion: unknown; warnings: Issue[]; migrationReport: MigrationNote[] }> {
  const checked = examine(input, 'import');
  const hint = checked.schemaVersion === 1 ? ' The plan is schema version 1; migration converts it.' : '';
  if (checked.errors.length) return { ok: false, code: 'VALIDATION_FAILED', message: `${checked.errors.length} error(s).${hint}`, errors: checked.errors, schemaVersion: checked.schemaVersion, migrationReport: checked.report, notices: [] };
  return { ok: true, schemaVersion: checked.schemaVersion, warnings: checked.warnings, migrationReport: checked.report, notices: hint ? [hint.trim()] : [] };
}

/** The file's JSON as it is in the file (not normalized), with the revision of the same bytes. */
export async function readPlan(file: string, opts: OpOptions = {}): Promise<Result<{ revision: string; schemaVersion: unknown; plan: unknown }>> {
  const bytes = await readPlanBytes(file, opts), revision = revisionOf(bytes);
  let plan: unknown;
  try { plan = parseJson(bytes, file); } catch (error) { return { ok: false, code: 'JSON_INVALID', message: (error as Error).message, revision, notices: [] }; }
  return { ok: true, revision, schemaVersion: (plan as { schemaVersion?: unknown })?.schemaVersion ?? null, plan, notices: [] };
}

/** Counts, size, rooms with areas, and the revision. A plan with tolerable issues still gives its information. */
export async function info(file: string, opts: OpOptions = {}): Promise<Result<{ revision: string; name: string; summary: ReturnType<typeof summarizePlan>; rooms: { id: string; name: string; area: number; counted: boolean }[]; warnings: Issue[] }>> {
  const loaded = await load(file, 'saved', opts);
  if (!loaded.plan) return { ok: false, code: 'VALIDATION_FAILED', message: `${loaded.errors.length} error(s); run \`validate\`.`, errors: loaded.errors, revision: loaded.revision, notices: [] };
  const plan = loaded.plan;
  return {
    ok: true, revision: loaded.revision, name: plan.name, summary: summarizePlan(plan), warnings: loaded.warnings, notices: [],
    rooms: plan.rooms.map(r => ({ id: r.id, name: r.name, area: Math.round(roomArea(r.poly) * 100) / 100, counted: r.counted !== false })),
  };
}

export interface RenderOptions {
  /** A plan area [x0, y0, x1, y1] in mm; default: the whole plan with its margin. */
  crop?: Rect;
  /** The image width in px; the height follows the crop. Each side is at most 8000 px, and the image at most 32 million px. */
  width?: number;
  grid?: boolean;
  dimensions?: boolean;
  /** `false`: no text, so the image does not depend on fonts (and no system fonts are loaded). */
  text?: boolean;
  /** Font files to use instead of the system fonts, and their family name (for tests with a fixed font). */
  fonts?: { files: string[]; family: string };
  /** The size limits: px on each side, and px in all. Default: the CLI's limits. */
  limits?: { side: number; pixels: number };
}

const CLI_LIMITS = { side: 8000, pixels: 32_000_000 };

/**
 * Draws a plan as a 2D PNG (roadmap C2b), so an agent can compare it with the source image. A plan with tolerable
 * issues is drawn, with them as warnings; an error that blocks rendering refuses. Returns the PNG bytes.
 */
export async function renderPng(file: string, options: RenderOptions = {}, opts: OpOptions = {}): Promise<Result<{ revision: string; png: Buffer; width: number; height: number; warnings: Issue[]; migrationReport: MigrationNote[] }>> {
  const { crop, width = 1200, limits = CLI_LIMITS } = options;
  if (!Number.isInteger(width) || width < 1 || width > limits.side) throw new CliError('USAGE', `The width must be a whole number of pixels from 1 to ${limits.side}.`);
  if (crop && !(crop.length === 4 && crop.every(Number.isFinite) && crop[0] < crop[2] && crop[1] < crop[3])) throw new CliError('USAGE', 'The crop must be x0,y0,x1,y1 in mm with x0 < x1 and y0 < y1.');
  const loaded = await load(file, 'saved', opts);
  if (!loaded.plan) return { ok: false, code: 'VALIDATION_FAILED', message: `${loaded.errors.length} error(s) block rendering; run \`validate\`.`, errors: loaded.errors, revision: loaded.revision, notices: [] };
  // The height follows the crop, so a narrow crop can ask for a very tall image: check the derived size before drawing.
  const size = planImageSize(loaded.plan, { crop, width });
  if (!(size.height <= limits.side && size.width * size.height <= limits.pixels)) {
    throw new CliError('USAGE', `The image would be ${size.width} × ${size.height} px; the limit is ${limits.side} px on each side and ${limits.pixels / 1e6} million px. Use a smaller width or a wider crop.`, { width: size.width, height: size.height });
  }
  const svg = renderPlanSvg(loaded.plan, { crop, width, grid: options.grid, dimensions: options.dimensions, text: options.text });
  const font = options.fonts
    ? { loadSystemFonts: false, fontFiles: options.fonts.files, defaultFontFamily: options.fonts.family, sansSerifFamily: options.fonts.family }
    : { loadSystemFonts: options.text !== false };
  const image = new Resvg(svg, { font }).render();
  const notices = loaded.schemaVersion === 1 ? ['The file is schema version 1; it was drawn through the migration. `migrate` converts it.'] : [];
  return { ok: true, revision: loaded.revision, png: image.asPng(), width: image.width, height: image.height, warnings: loaded.warnings, migrationReport: loaded.report, notices };
}

/** `render`: draws the plan and replaces `out` with the PNG atomically. */
export async function render(file: string, out: string, options: RenderOptions = {}): Promise<Result<{ revision: string; output: string; width: number; height: number; warnings: Issue[]; migrationReport: MigrationNote[] }>> {
  const [plan, output] = [await canonicalPath(file, true), await canonicalPath(out, false)];
  if (plan === output) throw new CliError('USAGE', 'The output file is the plan file. Give another name for the PNG.');
  const drawn = await renderPng(file, options);
  if (!drawn.ok) return drawn;
  const { png, ...result } = drawn;
  await replaceFile(output, png);
  return { ...result, output };
}

/**
 * Resolves the plan path, takes its lock, and checks under the lock that the path still names the same single-link
 * file, and that the boundary (if any) accepts it.
 */
export async function lockedPlan<T extends { notices: string[] }>(file: string, mustExist: boolean, work: (plan: string, exists: boolean) => Promise<T>, opts: OpOptions = {}): Promise<T> {
  const plan = await canonicalPath(file, mustExist);
  // Also before the lock: the lock file is created next to the plan, so it must not be made outside the boundary.
  await opts.boundary?.(plan);
  return withLock(plan, async () => {
    if ((await canonicalPath(file, mustExist)) !== plan) throw new CliError('PLAN_PATH_CHANGED', `${file} now resolves to another file. Nothing was changed; run the command again.`, { file });
    await opts.boundary?.(plan);
    const exists = await checkSingleLink(plan);
    if (mustExist && !exists) throw new CliError('FILE_NOT_FOUND', `${file} does not exist.`, { path: file });
    return work(plan, exists);
  }, opts);
}

/** Backs up the current bytes (if any), replaces the plan, then prunes old backups. */
async function replacePlan(plan: string, current: Buffer | null, text: string | Buffer, notices: string[]) {
  const backup = current ? await writeBackup(plan, current) : null;
  await replaceFile(plan, text);
  const warning = backup ? await pruneBackups(plan) : null;
  if (warning) notices.push(warning);
  return { backup, revision: revisionOf(Buffer.isBuffer(text) ? text : Buffer.from(text)) };
}

const exists = (file: string) => ({ ok: false as const, code: 'DESTINATION_EXISTS', message: `${file} already exists. Use --replace to replace it; a backup is made first.`, notices: [] as string[] });

/** Creates a plan file that does not exist, exclusively: a file that another program made in the meantime is kept. */
async function createPlan(plan: string, file: string, text: string) {
  if (!(await createFile(plan, text))) return exists(file);
  return { ok: true as const, backup: null, revision: revisionOf(Buffer.from(text)) };
}

/** Writes an empty plan or the sample. An existing file is refused unless `replace`; then it is backed up first. */
export async function create(file: string, { sample = false, replace = false } = {}, opts: OpOptions = {}): Promise<Result<{ revision: string; backup: string | null }>> {
  return lockedPlan(file, false, async (plan, present) => {
    const text = planText(sample ? createSamplePlan() : createEmptyPlan());
    if (!present) return { ...await createPlan(plan, file, text), notices: [] };
    if (!replace) return exists(file);
    const notices: string[] = [];
    const written = await replacePlan(plan, await readPlanBytes(plan, opts), text, notices);
    return { ok: true, ...written, notices };
  }, opts);
}

type Converted = { ok: true; plan: PlanV2; report: MigrationNote[] } | { ok: false; code: string; message: string; errors?: Issue[]; migrationReport?: MigrationNote[]; notices: string[] };

/** Converts v1 bytes to a v2 plan with the A1 rules and validates the result strictly. */
function convertV1(bytes: Buffer, source: string): Converted {
  const input = parseJson(bytes, source), version = (input as { schemaVersion?: unknown })?.schemaVersion;
  if (version !== 1) return { ok: false, code: 'NOT_VERSION_1', message: `${source} is schema version ${JSON.stringify(version ?? null)}, not 1. Only version 1 files are migrated.`, notices: [] };
  const migrated = migrateV1Document(input);
  if (!migrated.ok) return { ok: false, code: 'VALIDATION_FAILED', message: `${source} cannot be migrated.`, errors: migrated.errors, migrationReport: migrated.report, notices: [] };
  const checked = validatePlan(migrated.plan, 'import');
  if (!checked.ok) return { ok: false, code: 'VALIDATION_FAILED', message: `The migrated plan has ${checked.errors.length} error(s); nothing was written.`, errors: checked.errors, migrationReport: migrated.report, notices: [] };
  return { ok: true, plan: checked.plan!, report: migrated.report };
}

const HEX64 = /^[0-9a-f]{64}$/;
const revisionRequired = (what: string) => ({ ok: false as const, code: 'REVISION_REQUIRED', message: `expectedRevision is required ${what}: the revision from \`info\` or \`validate\` (64 hex characters).`, notices: [] as string[] });
const conflict = (currentRevision: string | null) => ({
  ok: false as const, code: 'REVISION_CONFLICT', currentRevision, notices: [] as string[],
  message: currentRevision === null ? 'The file of expectedRevision no longer exists. Nothing was created; read the folder again.' : 'The plan changed since expectedRevision. Read it again, then send the change with the new revision.',
});

/**
 * Converts a v1 file to v2 and writes it with the same rules as `create`. When the source and the destination are one
 * file (also through a symlink), the source is read under the plan lock, so a change by another writer is not lost.
 * `expectedRevision` (MCP) replaces `replace`: an existing destination is replaced only if its revision matches, and a
 * missing destination is then a conflict, not a creation.
 */
export async function migrate(source: string, destination: string, { replace = false, expectedRevision }: { replace?: boolean; expectedRevision?: string } = {}, opts: OpOptions = {}): Promise<Result<{ revision: string; backup: string | null; migrationReport: MigrationNote[] }>> {
  if (expectedRevision !== undefined && !HEX64.test(expectedRevision)) return revisionRequired('to replace the destination');
  const inPlace = (await canonicalPath(source, true)) === (await canonicalPath(destination, false));
  const separate = inPlace ? null : convertV1(await readPlanBytes(source, opts), source);
  if (separate && !separate.ok) return separate;
  return lockedPlan(destination, inPlace, async (plan, present) => {
    const current = present ? await readPlanBytes(plan, opts) : null;
    if (expectedRevision !== undefined && (current === null || revisionOf(current) !== expectedRevision)) return conflict(current && revisionOf(current));
    const converted = separate ?? convertV1(current!, source);
    if (!converted.ok) return converted;
    if (!current) return { ...await createPlan(plan, destination, planText(converted.plan)), migrationReport: converted.report, notices: [] };
    if (!replace && expectedRevision === undefined) return exists(destination);
    const notices: string[] = [];
    const written = await replacePlan(plan, current, planText(converted.plan), notices);
    return { ok: true, ...written, migrationReport: converted.report, notices };
  }, opts);
}

type Applied = Result<{ revision: string; previousRevision: string; backup: string | null; warnings: CommandIssue[]; notes: CommandNote[] }>;

/** `apply`: the batch from a commands file `{ expectedRevision, commands }`. */
export async function apply(file: string, commandsFile: string, opts: OpOptions = {}): Promise<Applied> {
  const request = parseJson(await readBytes(commandsFile), commandsFile);
  if (!request || typeof request !== 'object' || Array.isArray(request)) return { ok: false, code: 'COMMANDS_INVALID', message: `${commandsFile} must be an object { "expectedRevision": "...", "commands": [...] }.`, notices: [] };
  return applyBatch(file, request, opts);
}

/**
 * Applies a command batch (roadmap C1) to a plan file. Under the plan lock: the revision is compared with the file
 * bytes, the batch runs with the saved policy, the current bytes are backed up, and the plan is replaced. Any refusal
 * changes nothing.
 */
export async function applyBatch(file: string, request: { expectedRevision?: unknown; commands?: unknown }, opts: OpOptions = {}): Promise<Applied> {
  if (typeof request.expectedRevision !== 'string' || !HEX64.test(request.expectedRevision)) return { ok: false, code: 'REVISION_REQUIRED', message: 'expectedRevision is required: the revision from `info` or `validate` (64 hex characters).', notices: [] };
  if (!Array.isArray(request.commands)) return { ok: false, code: 'COMMANDS_INVALID', message: '`commands` must be a list.', notices: [] };
  const expected = request.expectedRevision, commands = request.commands;
  return lockedPlan(file, true, async plan => {
    const bytes = await readPlanBytes(plan, opts), revision = revisionOf(bytes);
    if (revision !== expected) return { ok: false, code: 'REVISION_CONFLICT', message: 'The plan changed since expectedRevision. Read it again, then send the commands with the new revision.', currentRevision: revision, notices: [] };
    const input = parseJson(bytes, plan);
    if ((input as { schemaVersion?: unknown })?.schemaVersion === 1) return { ok: false, code: 'NOT_VERSION_2', message: 'The plan is schema version 1. Run `migrate` first.', notices: [] };
    const result = applyCommands(input, commands);
    if (!result.ok) return { ok: false, code: 'COMMANDS_REFUSED', message: 'The commands were refused; the plan was not changed.', errors: result.errors, notices: [] };
    // Compare plans, not bytes: a file in another format (minified, a web export) that the commands do not change keeps its bytes and revision.
    const text = planText(result.plan), notices: string[] = [];
    if (text === planText(validatePlan(input, 'saved').plan)) return { ok: true, revision, previousRevision: revision, backup: null, warnings: result.warnings, notes: result.notes, notices: ['The commands did not change the plan; the file was not written.'] };
    const written = await replacePlan(plan, bytes, text, notices);
    return { ok: true, ...written, previousRevision: revision, warnings: result.warnings, notes: result.notes, notices };
  }, opts);
}

/**
 * Writes a whole plan (MCP `write_plan`). The plan is validated with the strict policy first. A missing file is created
 * exclusively, and only without `expectedRevision`; an existing file is replaced only with its exact revision, after a
 * backup. A plan that equals the current plan (both normalized) is not written, so the bytes and revision stay.
 */
export async function writePlan(file: string, input: unknown, { expectedRevision }: { expectedRevision?: string } = {}, opts: OpOptions = {}): Promise<Result<{ revision: string; previousRevision: string | null; backup: string | null; warnings: Issue[] }>> {
  if (expectedRevision !== undefined && !HEX64.test(expectedRevision)) return revisionRequired('to replace a plan');
  if ((input as { schemaVersion?: unknown })?.schemaVersion === 1) return { ok: false, code: 'NOT_VERSION_2', message: 'The plan is schema version 1. Write it as a file and migrate it, or convert it to version 2.', notices: [] };
  const checked = validatePlan(input, 'import');
  if (!checked.ok) return { ok: false, code: 'VALIDATION_FAILED', message: `${checked.errors.length} error(s); nothing was written.`, errors: checked.errors, notices: [] };
  const text = planText(checked.plan);
  return lockedPlan(file, false, async (plan, present) => {
    if (!present) {
      if (expectedRevision !== undefined) return conflict(null);
      return { ...await createPlan(plan, file, text), previousRevision: null, warnings: checked.warnings, notices: [] };
    }
    // A caller with no revision meant to create the file (for example a second creator at the same time).
    if (expectedRevision === undefined) return { ...exists(file), message: `${file} already exists. To replace it, give its expectedRevision; a backup is made first.` };
    const bytes = await readPlanBytes(plan, opts), revision = revisionOf(bytes);
    if (revision !== expectedRevision) return conflict(revision);
    let same = false;
    try { same = text === planText(validatePlan(JSON.parse(bytes.toString('utf8')), 'saved').plan); } catch { /* not JSON: replaced */ }
    if (same) return { ok: true, revision, previousRevision: revision, backup: null, warnings: checked.warnings, notices: ['The plan equals the current plan; the file was not written.'] };
    const notices: string[] = [];
    const written = await replacePlan(plan, bytes, text, notices);
    return { ok: true, ...written, previousRevision: revision, warnings: checked.warnings, notices };
  }, opts);
}

export async function backups(file: string): Promise<Result<{ backups: BackupInfo[] }>> {
  return { ok: true, backups: await listBackups(await canonicalPath(file, false)), notices: [] };
}

/**
 * Restores a backup through the lock, after a backup of the current file. The backup bytes are written unchanged, so the
 * revision is the backup's revision. A backup that is not a readable plan is refused.
 */
export async function restore(file: string, name: string, lock?: OpOptions): Promise<Result<{ revision: string; backup: string | null }>> {
  return lockedPlan(file, false, async (plan, present) => {
    const saved = await readBytes(await backupPath(plan, name));
    let readable = false;
    try {
      const input = JSON.parse(saved.toString('utf8'));
      // A v1 backup must pass the complete migration, as `load` reads it, not only the preliminary document check.
      const migrated = input?.schemaVersion === 1 ? migrateV1Document(input) : null;
      readable = migrated ? migrated.ok && validatePlan(migrated.plan, 'saved').ok : validatePlan(input, 'saved').ok;
    } catch { /* not JSON */ }
    if (!readable) return { ok: false, code: 'BACKUP_INVALID', message: `${name} is not a readable plan; nothing was changed.`, notices: [] };
    const notices: string[] = [];
    const written = await replacePlan(plan, present ? await readBytes(plan) : null, saved, notices);
    return { ok: true, ...written, notices };
  }, lock);
}
