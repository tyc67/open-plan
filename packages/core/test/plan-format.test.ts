import { describe, expect, it } from 'vitest';
import { Ajv2020 } from 'ajv/dist/2020.js';
import schema from '../../../docs/open-plan.schema.json' with { type: 'json' };
import formatDoc from '../../../docs/plan-format.md?raw';
import { validatePlan } from '../src/index.js';

// The published format description (docs/plan-format.md) must show a plan that imports with no issues.
describe('docs/plan-format.md', () => {
  const block = /```json\n([\s\S]*?)\n```/.exec(formatDoc);
  it('has one JSON example', () => expect(block).not.toBeNull());
  const example = JSON.parse(block![1]);
  it('the example passes the schema', () => expect(new Ajv2020({ strict: true }).compile(schema)(example)).toBe(true));
  it('the example imports with no errors or warnings', () => expect(validatePlan(example, 'import')).toMatchObject({ ok: true, errors: [], warnings: [] }));
});
