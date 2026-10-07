import { migrateV1, summarizePlan, validatePlan } from 'open-plan-core';
import { validateDocumentV1 } from './document.js';
import { migrateGeometry } from './geometryMigration.js';
import { localizeDocument } from './locale.js';

/**
 * A v1 plan (an old save or an old export) as v2, with the A1 rules: the v1 checks, the old local fixes, then the
 * migration. Returns { ok, plan, report } or { ok: false, errors }. The result still needs validatePlan.
 */
export function migrateV1Document(doc) {
  const v1 = validateDocumentV1(doc);
  if (!v1.ok) return { ok: false, errors: v1.errors };
  try {
    const { plan, report } = migrateV1(migrateGeometry(localizeDocument(doc)));
    return { ok: true, plan, report };
  } catch (error) {
    return { ok: false, errors: [{ path: error.path || '$', code: 'v1-unreadable', params: { reason: error.code || error.message } }] };
  }
}

/**
 * Reads a plan file for import (roadmap B3), with the import policy: tolerable issues are errors.
 * Returns { ok: true, plan, summary, report } (report: v1 migration notes, empty for v2) or { ok: false, errors, report }.
 * A v2 plan is not changed apart from the default heights, so an exported plan imports again with no change.
 */
export function readImportFile(text) {
  let input;
  try { input = JSON.parse(text); } catch { return { ok: false, errors: [{ path: '$', code: 'json-invalid', params: {} }], report: [] }; }
  let report = [];
  if (input?.schemaVersion === 1) {
    const migrated = migrateV1Document(input);
    if (!migrated.ok) return { ok: false, errors: migrated.errors, report };
    input = migrated.plan; report = migrated.report;
  }
  const result = validatePlan(input, 'import');
  if (!result.ok) return { ok: false, errors: result.errors, report };
  return { ok: true, plan: result.plan, summary: summarizePlan(result.plan), report };
}
