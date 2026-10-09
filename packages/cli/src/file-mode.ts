import { validatePlan, type Issue, type PlanV2 } from 'open-plan-core';
import { backupPath, planText, pruneBackups, readBytes, replaceFile, revisionOf, writeBackup, type BackupLabel } from './files.js';
import type { LockOptions } from './lock.js';
import { lockedPlan, type Result } from './operations.js';

/**
 * The operations of live file mode (roadmap C3), apart from HTTP, so the server and the tests use the same code. They use
 * the C2 lock, revision check, atomic write and file format. Browser plans are validated with the saved policy.
 */

/** The plan file as the browser sees it. `valid: false` (an error that blocks rendering, a v1 file, not JSON) keeps the browser on its last valid plan. */
export interface FileState { revision: string; valid: boolean; plan?: PlanV2; warnings: Issue[]; errors: Issue[] }

export function stateOf(bytes: Buffer): FileState {
  const revision = revisionOf(bytes);
  let input: unknown;
  try { input = JSON.parse(bytes.toString('utf8')); } catch { return { revision, valid: false, warnings: [], errors: [{ path: '$', code: 'json-invalid', params: {} }] }; }
  const result = validatePlan(input, 'saved');
  return result.ok ? { revision, valid: true, plan: result.plan, warnings: result.warnings, errors: [] } : { revision, valid: false, warnings: result.warnings, errors: result.errors };
}

const conflict = (state: FileState) => ({
  ok: false as const, code: 'REVISION_CONFLICT', message: 'The file changed since the revision that was sent.', currentRevision: state.revision, state, notices: [] as string[],
});

/** Validates a plan from the browser with the saved policy, and gives its file text. */
function browserPlan(plan: unknown): { ok: true; text: string } | { ok: false; code: string; message: string; errors: Issue[]; notices: string[] } {
  const checked = validatePlan(plan, 'saved');
  if (!checked.ok) return { ok: false, code: 'VALIDATION_FAILED', message: `The plan has ${checked.errors.length} error(s) that block rendering; it was not written.`, errors: checked.errors, notices: [] };
  return { ok: true, text: planText(checked.plan) };
}

/**
 * Writes a browser plan to the file if the file still has `expectedRevision`. With `backupFirst` (the first write of a
 * browser session), the current file bytes are backed up first, and a failed backup refuses the write. A plan that is
 * the same as the file's normalized plan is not written: the bytes and the revision stay (`changed: false`).
 * `beforeWrite` gets the new revision under the lock, just before the file is replaced.
 */
export async function writeBrowserPlan(file: string, { expectedRevision, plan, backupFirst, beforeWrite }: { expectedRevision: string; plan: unknown; backupFirst: boolean; beforeWrite?: (revision: string) => void }, lock?: LockOptions)
  : Promise<Result<{ revision: string; previousRevision: string; changed: boolean; backup: string | null }>> {
  const checked = browserPlan(plan);
  if (!checked.ok) return checked;
  return lockedPlan(file, true, async path => {
    const bytes = await readBytes(path), current = stateOf(bytes);
    if (current.revision !== expectedRevision) return conflict(current);
    if (current.valid && planText(current.plan) === checked.text) return { ok: true, revision: current.revision, previousRevision: current.revision, changed: false, backup: null, notices: [] };
    const backup = backupFirst ? await writeBackup(path, bytes) : null;
    beforeWrite?.(revisionOf(Buffer.from(checked.text)));
    await replaceFile(path, checked.text);
    const notices: string[] = [], warning = backup ? await pruneBackups(path) : null;
    if (warning) notices.push(warning);
    return { ok: true, revision: revisionOf(Buffer.from(checked.text)), previousRevision: current.revision, changed: true, backup, notices };
  }, lock);
}

/** Keeps a browser plan in the backup folder with a label, for example before a replacement. A failure throws BACKUP_FAILED. */
export async function backupBrowserPlan(file: string, plan: unknown, label: Exclude<BackupLabel, 'file'>, lock?: LockOptions): Promise<Result<{ backup: string }>> {
  const checked = browserPlan(plan);
  if (!checked.ok) return checked;
  return lockedPlan(file, true, async path => {
    const backup = await writeBackup(path, Buffer.from(checked.text), label), warning = await pruneBackups(path);
    return { ok: true, backup, notices: warning ? [warning] : [] };
  }, lock);
}

/**
 * 載入檔案版本 as one guarded step: under the lock, the file must still have `seenRevision` (the one in the conflict
 * message), and the browser plan is backed up (`-browser`) before the file version is returned. If the revision changed
 * or the backup fails, nothing is kept and the browser keeps its plan.
 */
export async function loadFileVersion(file: string, { seenRevision, plan }: { seenRevision: string; plan: unknown }, lock?: LockOptions): Promise<Result<{ state: FileState; backup: string }>> {
  const checked = browserPlan(plan);
  if (!checked.ok) return checked;
  return lockedPlan(file, true, async path => {
    const current = stateOf(await readBytes(path));
    if (current.revision !== seenRevision) return conflict(current);
    if (!current.valid) return { ok: false, code: 'FILE_INVALID', message: 'The file has errors that block rendering, so it cannot be loaded.', state: current, notices: [] };
    const backup = await writeBackup(path, Buffer.from(checked.text), 'browser'), warning = await pruneBackups(path);
    return { ok: true, state: current, backup, notices: warning ? [warning] : [] };
  }, lock);
}

/** A backup as a plan the browser can open (for 復原上一個平面圖). A backup that is not a readable v2 plan is refused. */
export async function readBackup(path: string, name: string): Promise<Result<{ name: string; state: FileState }>> {
  const state = stateOf(await readBytes(await backupPath(path, name)));
  if (!state.valid) return { ok: false, code: 'BACKUP_INVALID', message: `${name} is not a plan that can be opened.`, errors: state.errors, notices: [] };
  return { ok: true, name, state, notices: [] };
}
