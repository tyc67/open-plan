import { migrateGeometry } from './geometryMigration.js';
import { migrateV1 } from 'open-plan-core';
import { validateDocument, validateDocumentV1 } from './document.js';
import { localizeDocument } from './locale.js';
const KEY = 'open-plan:document:v1';
const RECOVERY_KEY = 'open-plan:document:v1:recovery';
// The last saved plan in schema v1, kept when it is migrated to v2 at load. It is never overwritten by v2 saves.
const BEFORE_V2_KEY = 'open-plan:document:v1:before-v2';
export function loadDocument() {
  const raw = localStorage.getItem(KEY);
  if (!raw) return null;
  const doc = JSON.parse(raw);
  if (doc?.schemaVersion === 1) {
    if (!validateDocumentV1(doc)) throw new Error('格式不支援或資料已損壞');
    // Keep the v1 data first; if it cannot be kept, do not migrate, so the next save cannot replace the only copy.
    localStorage.setItem(BEFORE_V2_KEY, raw);
    let plan;
    try { plan = migrateV1(migrateGeometry(localizeDocument(doc))).plan; }
    catch { throw new Error('格式不支援或資料已損壞'); }
    // A v1 plan can pass the v1 check and still give a v2 plan that v2 rejects (for example a wall thicker than 1000 mm).
    // Reject it now, so autosave never writes a plan that the next load cannot read.
    if (!validateDocument(plan)) throw new Error('格式不支援或資料已損壞');
    return plan;
  }
  if (!validateDocument(doc)) throw new Error('格式不支援或資料已損壞');
  return localizeDocument(doc);
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
