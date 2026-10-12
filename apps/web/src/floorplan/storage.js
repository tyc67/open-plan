import { checkDocumentV1, localizeLegacyNames, migrateV1Document, validatePlan } from 'open-plan-core';
import { issueMessage } from './issueMessages.js';
const KEY = 'open-plan:document:v1';
export const PLAN_KEY = KEY;
const RECOVERY_KEY = 'open-plan:document:v1:recovery';
// The last saved plan in schema v1, kept when it is migrated to v2 at load. It is never overwritten by v2 saves.
const BEFORE_V2_KEY = 'open-plan:document:v1:before-v2';
// The open plan from just before the last replacement (new plan, sample, later import). "Restore" reads it and keeps it,
// so it stays available until the next replacement. It is separate from RECOVERY_KEY, which is only for unreadable saves.
const REPLACED_KEY = 'open-plan:document:v1:replaced';
// The session snapshot (roadmap C3): the saved plan from before the first write of this page load that changes it.
// Undo is lost on reload; this copy is not. It is taken at the first change, not at load, because autosave also runs at
// load: a reload after a mistake must not replace the good copy with the mistake.
const SESSION_KEY = 'open-plan:document:v1:session';
let sessionKept = false;
// The plan as the editor opened it (after migration and normalization). The saved bytes can differ from it (omitted
// default heights, other formatting, v1), so only a plan that differs from this one is a change. A v1 plan is still
// saved as v2 at load (roadmap B2; the v1 bytes are in BEFORE_V2_KEY), but that write takes no session copy.
let openedText = null, migrated = false;
// The text of the saved plan that this tab read or wrote last (null: nothing saved). If the stored text is another one,
// another tab changed the plan (old finding L6): a save is then refused, and the user decides in the editor.
// Limit: localStorage has no lock, so two tabs that write at almost the same moment can both pass this check; the tab
// that wrote first then gets a `storage` event and shows the conflict, but its text is no longer in storage.
let knownText = null;
// The same saved plan as the editor has it (JSON of the opened or written plan). The stored bytes can differ from it,
// so a save of this plan writes nothing: a plan that was loaded from another tab is not written back to that tab.
let knownPlan = null;
/** A save was refused because another tab changed the saved plan after this tab read or wrote it. */
export class PlanChangedElsewhere extends Error {
  constructor() { super('另一個分頁已變更已儲存的平面圖'); this.name = 'PlanChangedElsewhere'; }
}
/** True if the saved plan is not the one that this tab read or wrote last. */
export function changedElsewhere() {
  try { return localStorage.getItem(KEY) !== knownText; } catch { return false; }
}
const opened = (result, v1 = false) => { openedText = JSON.stringify(result.plan); migrated = v1; knownPlan = v1 ? null : openedText; return result; };
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
  knownText = raw; knownPlan = null;
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
    return opened({ plan: checked, warnings }, true);
  }
  const { plan, warnings } = checkSaved(doc);
  return opened({ plan: localizeLegacyNames(plan), warnings });
}
/**
 * Saves the plan. Until the plan differs from the one opened, nothing is written, so the saved bytes stay as they were.
 * The first write of a page load keeps the saved plan first; if that fails, it throws and nothing is written.
 * If another tab changed the saved plan, it throws PlanChangedElsewhere and nothing is written.
 */
export function saveDocument(doc) {
  const text = JSON.stringify(doc), saved = localStorage.getItem(KEY);
  if (saved !== knownText) throw new PlanChangedElsewhere();
  if (sessionKept && text === knownPlan) return;
  if (!sessionKept) {
    if (saved === text) return;
    if (text === openedText) { if (migrated) { localStorage.setItem(KEY, text); knownText = knownPlan = text; } return; }
    try {
      // With nothing saved, an older snapshot would be from another plan, so it goes.
      if (saved === null) localStorage.removeItem(SESSION_KEY); else localStorage.setItem(SESSION_KEY, saved);
    } catch (error) { throw new Error(`無法先備份已儲存的平面圖（${error.message}）`); }
    sessionKept = true;
  }
  localStorage.setItem(KEY, text);
  knownText = knownPlan = text;
}
/**
 * Resolves a change from another tab with "keep this tab's plan": the plan of the other tab is read again now and kept
 * first, then this tab's plan is written. A plan that can be opened goes to the replaced copy (還原上一個平面圖 brings it
 * back); other data goes to the recovery copy. If the copy cannot be written, it throws and nothing is written.
 * Returns 'replaced', 'recovery', or null if the other tab removed the saved plan.
 */
export function keepOverElsewhere(doc) {
  const other = localStorage.getItem(KEY), text = JSON.stringify(doc);
  let kept = null;
  if (other !== null && other !== text) {
    let usable = false;
    try { usable = validatePlan(JSON.parse(other), 'saved').ok; } catch { /* not JSON */ }
    kept = usable ? 'replaced' : 'recovery';
    try { localStorage.setItem(usable ? REPLACED_KEY : RECOVERY_KEY, other); }
    catch (error) { throw new Error(`無法先備份另一個分頁的版本（${error.message}）`); }
  }
  localStorage.setItem(KEY, text);
  knownText = knownPlan = text;
  // The stored plan is now this one, not the plan that this tab opened: a later save of the opened plan (an undo back
  // to it) is a change and must be written.
  openedText = text; migrated = false;
  return kept;
}
/**
 * Resolves a change from another tab with "load the other plan": reads the saved plan again now, as a page load does.
 * Returns { plan, warnings }, or null if the other tab removed the saved plan; throws PlanLoadError if it cannot be
 * opened. In the last 2 cases this tab does not take the stored state as known, so its saves stay refused.
 */
export function loadFromElsewhere() {
  const before = [knownText, knownPlan, openedText, migrated];
  const back = () => { [knownText, knownPlan, openedText, migrated] = before; };
  try {
    const loaded = loadDocument();
    if (!loaded) back();
    return loaded;
  } catch (error) { back(); throw error; }
}
/** The session snapshot as { plan, warnings }, or null if there is none or it cannot be opened. */
export function sessionDocument() { return readPlan(SESSION_KEY); }
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
export function replacedDocument() { return readPlan(REPLACED_KEY); }
function readPlan(key) {
  try {
    const doc = JSON.parse(localStorage.getItem(key));
    if (!doc) return null;
    const result = validatePlan(doc, 'saved');
    return result.ok ? { plan: localizeLegacyNames(result.plan), warnings: result.warnings } : null;
  } catch { return null; }
}
