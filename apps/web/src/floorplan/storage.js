import { checkDocumentV1, localizeLegacyNames, migrateV1Document, validatePlan } from 'open-plan-core';
import { issueMessage } from './issueMessages.js';
const KEY = 'open-plan:document:v1';
const RECOVERY_KEY = 'open-plan:document:v1:recovery';
// The last saved plan in schema v1, kept when it is migrated to v2 at load. It is never overwritten by v2 saves.
const BEFORE_V2_KEY = 'open-plan:document:v1:before-v2';
// The open plan from just before the last replacement (new plan, sample, later import). "Restore" reads it and keeps it,
// so it stays available until the next replacement. It is separate from RECOVERY_KEY, which is only for unreadable saves.
const REPLACED_KEY = 'open-plan:document:v1:replaced';
/** A saved plan that cannot be opened. `issues` are the validator errors; the message gives the first one and the count. */
export class PlanLoadError extends Error {
  constructor(issues) {
    super(issueMessage(issues[0]) + (issues.length > 1 ? `（共 ${issues.length} 個問題）` : ''));
    this.name = 'PlanLoadError'; this.issues = issues;
  }
}
// Saved plans use the "saved" policy (roadmap B2): tolerable issues are warnings, so a plan that loaded before a save
// also loads after it. Errors that block rendering throw, and the editor follows the H2 path (recovery copy, no autosave).
function checkSaved(plan) {
  const result = validatePlan(plan, 'saved');
  if (!result.ok) throw new PlanLoadError(result.errors);
  return result;
}
/** The saved plan as { plan, warnings }, or null if nothing is saved. Throws PlanLoadError if it cannot be opened. */
export function loadDocument() {
  const raw = localStorage.getItem(KEY);
  if (!raw) return null;
  let doc;
  try { doc = JSON.parse(raw); } catch { throw new PlanLoadError([{ path: '$', code: 'json-invalid', params: {} }]); }
  if (doc?.schemaVersion === 1) {
    const v1 = checkDocumentV1(doc);
    if (!v1.ok) throw new PlanLoadError(v1.errors);
    // Keep the v1 data first; if it cannot be kept, do not migrate, so the next save cannot replace the only copy.
    localStorage.setItem(BEFORE_V2_KEY, raw);
    const migrated = migrateV1Document(doc);
    if (!migrated.ok) throw new PlanLoadError(migrated.errors);
    const plan = migrated.plan;
    // A v1 plan can pass the v1 check and still give a v2 plan that v2 rejects (for example a wall thicker than 1000 mm).
    // Reject it now, so autosave never writes a plan that the next load cannot read.
    const { plan: checked, warnings } = checkSaved(plan);
    return { plan: checked, warnings };
  }
  const { plan, warnings } = checkSaved(doc);
  return { plan: localizeLegacyNames(plan), warnings };
}
export function saveDocument(doc) { localStorage.setItem(KEY, JSON.stringify(doc)); }
// Copies an unreadable plan aside before a later save can overwrite it.
export function preserveUnreadableDocument() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw === null) return false;
    localStorage.setItem(RECOVERY_KEY, raw);
    return true;
  } catch { return false; }
}
export function savedDocumentText() {
  try { return localStorage.getItem(KEY); } catch { return null; }
}
// Moves the saved plan to the recovery copy, so the next load starts a new plan. Returns false if it could not be kept.
export function setAsideSavedDocument() {
  if (!preserveUnreadableDocument()) return false;
  try { localStorage.removeItem(KEY); return true; } catch { return false; }
}
// Throws if the backup cannot be written (for example, storage is full): the caller must then not replace the plan.
export function backupBeforeReplace(doc) { localStorage.setItem(REPLACED_KEY, JSON.stringify(doc)); }
// The plan from before the last replacement as { plan, warnings }, or null if there is none or it cannot be opened.
export function replacedDocument() {
  try {
    const doc = JSON.parse(localStorage.getItem(REPLACED_KEY));
    if (!doc) return null;
    const result = validatePlan(doc, 'saved');
    return result.ok ? { plan: localizeLegacyNames(result.plan), warnings: result.warnings } : null;
  } catch { return null; }
}
