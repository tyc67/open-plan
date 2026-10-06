import { migrateGeometry } from './geometryMigration.js';
import { validateDocument } from './document.js';
import { localizeDocument } from './locale.js';
const KEY = 'open-plan:document:v1';
const RECOVERY_KEY = 'open-plan:document:v1:recovery';
export function loadDocument() {
  const raw = localStorage.getItem(KEY);
  if (!raw) return null;
  const doc = JSON.parse(raw);
  if (!validateDocument(doc)) throw new Error('格式不支援或資料已損壞');
  return migrateGeometry(localizeDocument(doc));
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
