import { migrateV1Document, summarizePlan, validatePlan } from 'open-plan-core';

/**
 * Reads a plan file for import (roadmap B3), with the import policy: tolerable issues are errors.
 * Returns { ok: true, plan, summary, report, warnings } (report: v1 migration notes, empty for v2; warnings: the issues
 * that are a warning also for an import) or { ok: false, errors, report }.
 * A v2 plan is not changed apart from the default heights, so an exported plan imports again with no change.
 */
export function readImportFile(text) {
  let input;
  try { input = JSON.parse(text); } catch { return { ok: false, errors: [{ path: '$', code: 'json-invalid', params: {} }], report: [] }; }
  let report = [];
  if (input?.schemaVersion === 1) {
    const migrated = migrateV1Document(input);
    if (!migrated.ok) return { ok: false, errors: migrated.errors, report: migrated.report };
    input = migrated.plan; report = migrated.report;
  }
  const result = validatePlan(input, 'import');
  if (!result.ok) return { ok: false, errors: result.errors, report };
  return { ok: true, plan: result.plan, summary: summarizePlan(result.plan), report, warnings: result.warnings };
}
