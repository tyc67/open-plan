import { beforeAll, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { applyCommands, COMMAND_OPS } from 'open-plan-core';
import { GUIDE_COPIES } from '../scripts/guide-copies.mjs';
import { CLI, folder, mcpClient, run, runAsync, type Run } from './helpers.js';

// The agent guide (roadmap C4a). It is tested through the built CLI (`guide`, `apply`, `validate`), the interface that
// an installed agent uses; the command contracts are compared with the core command code.
const repo = new URL('../../../', import.meta.url).pathname;
const source = (path: string) => readFileSync(join(repo, path), 'utf8');
const guide = (...args: string[]) => run(repo, 'guide', ...args);
const text = guide().json.text as string;
const commandsDoc = source('docs/agent-guide/commands.md');
const cliDoc = source('docs/agent-guide/cli.md'), mcpDoc = source('docs/agent-guide/mcp.md');

/** The `#### \`op\`` sections of the command reference: op → section text. */
const sections = new Map<string, string>();
for (const part of commandsDoc.split(/^(?=#{3,4} )/m)) {
  const op = /^#### `(\w+)`/.exec(part)?.[1];
  if (op) sections.set(op, part);
}
/** The JSON code blocks of a text. */
const jsonBlocks = (markdown: string) => [...markdown.matchAll(/```json\n([\s\S]*?)```/g)].map(m => JSON.parse(m[1]));
interface Fields { required: Set<string>; optional: Set<string> }
const VARIANT_LINE: [RegExp, (m: RegExpExecArray) => string[]][] = [
  [/^- For a `([\w-]+)`(?: or a `([\w-]+)`)?:/, m => [m[1], m[2]].filter(Boolean)],
  [/^- \*\*By a factor:\*\*/, () => ['factor']],
  [/^- \*\*By a known distance:\*\*/, () => ['distance']],
];
/**
 * The fields that a section marks `(required` or `(optional`, for example "- `wallId`, `offset` (required)", for each
 * argument form: '' holds the fields of every form; a bullet "For a `window`:" or "**By a factor:**" belongs to one form.
 */
function documentedFields(section: string): Map<string, Fields> {
  const forms = new Map<string, Fields>();
  const form = (name: string) => forms.get(name) ?? forms.set(name, { required: new Set(), optional: new Set() }).get(name)!;
  form('');
  for (const line of section.replace(/```[\s\S]*?```/g, '').split('\n').filter(l => l.startsWith('- '))) {
    const variant = VARIANT_LINE.map(([re, names]) => { const m = re.exec(line); return m ? names(m) : null; }).find(Boolean) ?? [''];
    for (const match of line.matchAll(/((?:`\w+`(?:, | and )?)+) \((required|optional)/g)) {
      for (const name of match[1].matchAll(/`(\w+)`/g)) for (const v of variant) form(v)[match[2] as keyof Fields].add(name[1]);
    }
  }
  return forms;
}
/** The fields of one argument form: the common fields and the form's own. */
function formFields(forms: Map<string, Fields>, name: string): Fields {
  const common = forms.get('')!, own = forms.get(name) ?? { required: new Set<string>(), optional: new Set<string>() };
  return { required: new Set([...common.required, ...own.required]), optional: new Set([...common.optional, ...own.optional]) };
}
/** The plan of the format example, the start of every command example. */
const examplePlan = jsonBlocks(source('docs/plan-format.md'))[0];
// The forms of each command are selected as the reference says: `type` for openings, `factor` for scale_plan.

/** The fields that the core code accepts for a command, from its refusal of an unknown field. */
function acceptedFields(command: Record<string, unknown>): string[] {
  const result = applyCommands(examplePlan, [{ ...command, zzzUnknown: 1 }]);
  expect(result.ok).toBe(false);
  const error = !result.ok ? result.errors[0] : null;
  expect(error?.code, JSON.stringify(error)).toBe('command-field-unknown');
  return error!.params.allowed as string[];
}
/** The argument forms of each command, by the name that the reference uses, with the fields that select each one. */
const FORMS: Record<string, Record<string, Record<string, unknown>>> = {
  add_opening: { window: { type: 'window' }, door: { type: 'door' }, 'sliding-door': { type: 'sliding-door' }, hole: { type: 'hole' } },
  change_opening_type: { window: { type: 'window' }, door: { type: 'door' }, 'sliding-door': { type: 'sliding-door' }, hole: { type: 'hole' } },
  scale_plan: { factor: { factor: 1.1 }, distance: {} },
};
const formsOf = (op: string) => Object.entries(FORMS[op] ?? { '': {} });
/** A value of the right type for each field, so that only the field that a test leaves out can be missing. */
const VALUE: Record<string, unknown> = {
  id: 'new-id', newId: 'new-id', wallId: 'w1', otherId: 'w1', openingId: 'win1', roomId: 'r1', furnitureId: 'f1',
  type: 'n', a: [0, 100], b: [8000, 100], to: [9000, 100], at: [5400, 100], by: [0, 10], end: 'b', thickness: 200, name: 'Name',
  demolished: false, offset: 7000, width: 500, sill: 900, head: 2100, hinge: 'start', swing: 'left', entry: true, keep: 'start',
  mat: 'wood', poly: [[0, 200], [100, 200], [100, 300]], counted: true, cx: 1, cy: 1, w: 1, d: 1, rot: 0, color: '#fff',
  key: 'k', sw: '#fff', price: 1, ceilingHeight: 3000, pivot: [0, 0], distance: 8000,
  dimensions: [{ horizontal: true, at: -600, start: 0, segments: [8000] }],
};
const FIELD_CODES = ['command-field-unknown', 'missing-field', 'type-invalid', 'enum-invalid'];
/** A command with every documented field of one form. */
function fullCommand(op: string, selector: Record<string, unknown>, fields: Fields): Record<string, unknown> {
  return { op, ...Object.fromEntries([...fields.required, ...fields.optional].map(f => [f, VALUE[f]])), ...selector, ...(op === 'add_furniture' || op === 'update_furniture' ? { type: 'sofa' } : {}) };
}

describe('agent guide: the command reference', () => {
  it('has one section for each of the 26 commands, and no other', () => {
    expect(COMMAND_OPS).toHaveLength(26);
    expect([...sections.keys()].sort()).toEqual([...COMMAND_OPS].sort());
  });
  for (const op of COMMAND_OPS) it(`${op}: each argument form documents exactly the fields that the command accepts in that form`, () => {
    const forms = documentedFields(sections.get(op)!);
    expect([...forms.keys()].filter(k => k).sort(), 'the forms in the reference').toEqual(Object.keys(FORMS[op] ?? {}).sort());
    for (const [name, selector] of formsOf(op)) {
      const fields = formFields(forms, name);
      expect([...fields.required, ...fields.optional].sort(), `${op} ${name}`).toEqual(acceptedFields({ op, ...selector }).sort());
    }
  });
  for (const op of COMMAND_OPS) it(`${op}: in each form, every documented required field is required and every optional one is not`, () => {
    const forms = documentedFields(sections.get(op)!);
    for (const [name, selector] of formsOf(op)) {
      const fields = formFields(forms, name), full = fullCommand(op, selector, fields);
      const fieldErrors = (command: object) => { const r = applyCommands(examplePlan, [command]); return r.ok ? [] : r.errors.filter(e => FIELD_CODES.includes(e.code)); };
      // The command with every field passes the field checks, so a missing field below can only be the one left out.
      expect(fieldErrors(full), `${op} ${name}: ${JSON.stringify(full)}`).toEqual([]);
      for (const field of [...fields.required, ...fields.optional]) {
        if (Object.hasOwn(selector, field)) continue;                // leaving out `factor` selects the other form
        const { [field]: _left, ...rest } = full;
        const errors = fieldErrors(rest);
        if (fields.required.has(field)) expect(errors, `${op} ${name} without ${field}`).toEqual([expect.objectContaining({ code: 'missing-field', path: `commands[0].${field}` })]);
        else expect(errors, `${op} ${name} without ${field}`).toEqual([]);
      }
    }
  });
  it('the fields that select a form are documented as required, and leaving them out is refused as documented', () => {
    const fieldErrors = (command: object) => { const r = applyCommands(examplePlan, [command]); return r.ok ? [] : r.errors.filter(e => FIELD_CODES.includes(e.code)); };
    // Openings: `type` is required in every form; without it the command is refused with missing-field.
    for (const op of ['add_opening', 'change_opening_type']) {
      const forms = documentedFields(sections.get(op)!);
      expect(forms.get('')!.required.has('type'), `${op}: type documented as required`).toBe(true);
      for (const [name, selector] of formsOf(op)) {
        const { type: _type, ...rest } = fullCommand(op, selector, formFields(forms, name));
        expect(fieldErrors(rest), `${op} ${name} without type`).toEqual([expect.objectContaining({ code: 'missing-field', path: 'commands[0].type' })]);
      }
    }
    // scale_plan: `factor` is required in its form; without it, the command is read in the distance form, so a kept
    // `pivot` is refused with command-field-unknown, as the reference says.
    const forms = documentedFields(sections.get('scale_plan')!);
    expect(formFields(forms, 'factor').required.has('factor'), 'factor documented as required').toBe(true);
    expect(sections.get('scale_plan')).toContain('So a command with `pivot` but no `factor` is refused with `command-field-unknown` for `pivot`.');
    const { factor: _factor, ...rest } = fullCommand('scale_plan', FORMS.scale_plan.factor, formFields(forms, 'factor'));
    expect(fieldErrors(rest)).toEqual([expect.objectContaining({ code: 'command-field-unknown', path: 'commands[0].pivot' })]);
  });
  it('an opening in a demolished wall: the reference says which commands work on it, and they do', () => {
    expect(sections.get('toggle_demolition')).toContain('The openings in the wall stay');
    const start = applyCommands(examplePlan, [
      { op: 'add_wall', id: 'p', type: 'n', a: [0, 1000], b: [4000, 1000], thickness: 100 },
      { op: 'add_opening', id: 'pd', type: 'door', wallId: 'p', offset: 100, width: 900, hinge: 'start', swing: 'left' },
      { op: 'add_wall', id: 'q', type: 'n', a: [0, 2000], b: [4000, 2000], thickness: 100 },
      { op: 'toggle_demolition', wallId: 'p', demolished: true },
    ]);
    expect(start.ok && start.plan.openings.some(o => o.id === 'pd')).toBe(true);
    const plan = start.ok ? start.plan : null;
    const outcome = (command: object) => { const r = applyCommands(plan, [command]); return r.ok ? 'ok' : r.errors[0].code; };
    expect({
      update: outcome({ op: 'update_opening', openingId: 'pd', name: 'Old door' }),
      delete: outcome({ op: 'delete_opening', openingId: 'pd' }),
      moveToAnotherWall: outcome({ op: 'move_opening', openingId: 'pd', offset: 100, wallId: 'q' }),
      moveInItsWall: outcome({ op: 'move_opening', openingId: 'pd', offset: 200 }),
      resize: outcome({ op: 'resize_opening', openingId: 'pd', width: 800 }),
      changeType: outcome({ op: 'change_opening_type', openingId: 'pd', type: 'hole', head: 2100 }),
    }).toEqual({ update: 'ok', delete: 'ok', moveToAnotherWall: 'ok', moveInItsWall: 'wall-demolished', resize: 'wall-demolished', changeType: 'wall-demolished' });
  });
  it('scale_plan documents and shows both argument forms', () => {
    const forms = jsonBlocks(sections.get('scale_plan')!).flat().map(c => Object.keys(c).sort().join(','));
    expect(forms).toEqual(expect.arrayContaining(['factor,op,pivot', 'a,b,distance,op']));
  });
  it('names every refusal, note and warning code of the command code', () => {
    const dir = join(repo, 'packages/core/src/commands');
    const code = readdirSync(dir).map(f => readFileSync(join(dir, f), 'utf8')).join('\n');
    const codes = new Set([...code.matchAll(/refuse\([^,]+, '([\w-]+)'/g), ...code.matchAll(/code: (?:\w+ \? )?'([\w-]+)'(?: : '([\w-]+)')?/g)].flatMap(m => m.slice(1).filter(Boolean)));
    codes.add('command-op-unknown');
    expect(codes.size).toBeGreaterThan(40);
    expect([...codes].filter(c => !commandsDoc.includes(`\`${c}\``))).toEqual([]);
  });
});

describe('agent guide: the examples run through the built CLI with real revisions', () => {
  const results: { name: string; batch: unknown; apply: Run; validate: Run }[] = [];
  let refused: { output: unknown; apply: Run } | null = null;
  beforeAll(async () => {
    const refusedSection = cliDoc.slice(cliDoc.indexOf('### A refused batch'));
    const examples = [...sections].flatMap(([op, s]) => jsonBlocks(s).map((batch, i) => ({ name: `${op} example ${i + 1}`, batch })));
    const envelope = jsonBlocks(cliDoc.slice(cliDoc.indexOf('### Sending a batch')))[0];
    examples.push({ name: 'the batch envelope', batch: envelope.commands });
    const [refusedBatch, refusedOutput] = jsonBlocks(refusedSection);
    await Promise.all([...examples.map(async ({ name, batch }, i) => {
      const dir = folder();
      writeFileSync(join(dir, 'plan.json'), JSON.stringify(examplePlan, null, 2));
      const revision = (await runAsync(dir, 'info', 'plan.json')).json.revision;
      writeFileSync(join(dir, 'c.json'), JSON.stringify({ expectedRevision: revision, commands: batch }));
      const apply = await runAsync(dir, 'apply', 'plan.json', 'c.json');
      results[i] = { name, batch, apply, validate: await runAsync(dir, 'validate', 'plan.json') };
    }), (async () => {
      const dir = folder();
      writeFileSync(join(dir, 'plan.json'), JSON.stringify(examplePlan, null, 2));
      const revision = (await runAsync(dir, 'info', 'plan.json')).json.revision;
      writeFileSync(join(dir, 'c.json'), JSON.stringify({ expectedRevision: revision, commands: refusedBatch }));
      refused = { output: refusedOutput, apply: await runAsync(dir, 'apply', 'plan.json', 'c.json') };
    })()]);
  }, 120_000);
  it('every example of every command is accepted, writes a new revision, and leaves a valid plan', () => {
    expect(results.length).toBe([...sections.values()].reduce((n, s) => n + jsonBlocks(s).length, 0) + 1);
    for (const { name, apply, validate } of results) {
      expect(apply.code, `${name}: ${apply.out}${apply.err}`).toBe(0);
      expect(apply.json.revision, name).not.toBe(apply.json.previousRevision);
      expect(validate.code, `${name}: ${validate.out}`).toBe(0);
    }
  });
  it('set_dimensions: the reference documents exactly the fields of a chain, and each one is required', () => {
    // The fields of a chain are the nested bullets of the section; the tests above see only the top field.
    const documented = [...sections.get('set_dimensions')!.matchAll(/^ {4}- `(\w+)`:/gm)].map(m => m[1]);
    const chain: Record<string, unknown> = { horizontal: true, at: -600, start: 0, segments: [8000] };
    const error = (value: object) => { const r = applyCommands(examplePlan, [{ op: 'set_dimensions', dimensions: [value] }]); return r.ok ? null : r.errors[0]; };
    expect(error({ ...chain, zzzUnknown: 1 })).toMatchObject({ code: 'command-field-unknown', params: { allowed: documented } });
    expect(error(chain)).toBe(null);
    for (const field of documented) {
      const { [field]: _left, ...rest } = chain;
      expect(error(rest), field).toMatchObject({ code: 'missing-field', path: `commands[0].dimensions[0].${field}` });
    }
  });
  it('every command appears in an example, and scale_plan in both forms', () => {
    const ops = new Set(results.flatMap(r => (r.batch as { op: string }[]).map(c => c.op)));
    expect([...ops].sort()).toEqual([...COMMAND_OPS].sort());
  });
  it('the refused batch gives exactly the documented output and exit code 1', () => {
    expect(refused!.apply.code).toBe(1);
    expect(refused!.apply.json).toEqual(refused!.output);
  });
});

describe('agent guide: the MCP part, and the examples through the built MCP server with real revisions', () => {
  it('the command reference has no transport: no CLI command, no command file, no exit code', () => {
    for (const word of ['<cli>', 'commands.json', 'exit code', 'apply_commands']) expect(commandsDoc, word).not.toContain(word);
  });
  it('the MCP part names every tool of the server, and asks for no command file', async () => {
    const dir = folder(), mcp = await mcpClient(dir);
    try {
      const tools = (await mcp.client.listTools()).tools.map(t => t.name);
      const documented = [...mcpDoc.matchAll(/^\| `(\w+)`/gm)].map(m => m[1]);
      expect(documented.sort()).toEqual(tools.sort());
    } finally { await mcp.close(); }
    expect(mcpDoc).not.toContain('commands.json');
    expect(mcpDoc).not.toContain('<cli>');
  });
  it('the envelope, every example of every command, and the refused batch work as documented through apply_commands', async () => {
    const examples = [...sections].flatMap(([op, s]) => jsonBlocks(s).map((batch, i) => ({ name: `${op} example ${i + 1}`, batch })));
    const envelope = jsonBlocks(mcpDoc.slice(mcpDoc.indexOf('### Sending a batch')))[0];
    expect(Object.keys(envelope).sort()).toEqual(['commands', 'expectedRevision', 'path']);
    const [refusedBatch, refusedOutput] = jsonBlocks(mcpDoc.slice(mcpDoc.indexOf('### A refused batch')));
    const dir = folder(), mcp = await mcpClient(dir);
    try {
      const all = [...examples, { name: 'the MCP envelope', batch: envelope.commands }];
      for (const [i, { name, batch }] of all.entries()) {
        const path = `plan${i}.json`;
        writeFileSync(join(dir, path), JSON.stringify(examplePlan, null, 2));
        const { revision } = (await mcp.call('read_plan', { path })).result;
        const applied = await mcp.call('apply_commands', { ...envelope, path, expectedRevision: revision, commands: batch });
        expect(applied.result, name).toMatchObject({ ok: true, previousRevision: revision });
        expect(applied.result.revision, name).not.toBe(revision);
        expect((await mcp.call('validate_plan', { path })).result.ok, name).toBe(true);
      }
      writeFileSync(join(dir, 'refused.json'), JSON.stringify(examplePlan, null, 2));
      const { revision } = (await mcp.call('read_plan', { path: 'refused.json' })).result;
      const refused = await mcp.call('apply_commands', { path: 'refused.json', expectedRevision: revision, commands: refusedBatch });
      expect(refused.isError).toBe(true);
      expect(refused.result).toEqual(refusedOutput);
    } finally { await mcp.close(); }
  }, 120_000);
});

describe('agent guide: the forms', () => {
  it('`guide` prints the whole guide: the loop, the image steps, the format with its example, the CLI and the commands', () => {
    for (const part of ['## Work loop', '## From an image to a plan', '## Open Plan format (schemaVersion 2)', '## CLI commands', '## Commands', '#### `scale_plan`', '"schemaVersion": 2']) expect(text).toContain(part);
    expect(text).toContain(source('docs/agent-guide/image-to-plan.md').trim());
    expect(text).not.toContain('## MCP tools');
  });
  it('the CLI part has the MCP setup tested in C5c: claude -p with --mcp-config, codex exec with -c, the approval setting of codex exec, and the node form', () => {
    for (const part of ['### MCP setup', '"args":["mcp","--root","<folder>"]', '--mcp-config open-plan.mcp.json --allowedTools "mcp__open-plan"', '"command":"node","args":["<path>/cli.js","mcp","--root","<folder>"]', "mcp_servers.open-plan.args=[\"mcp\",\"--root\",\"<folder>\"]", 'default_tools_approval_mode="approve"']) expect(text).toContain(part);
  });
  it('the mcp form has the same image rules, format and commands, with the MCP part in place of the CLI part', () => {
    const mcp = guide('--form', 'mcp').json.text as string;
    for (const part of ['## Work loop', '## From an image to a plan', '## Open Plan format (schemaVersion 2)', '## MCP tools', '## Commands', '#### `scale_plan`', 'given by the tool `get_schema`']) expect(mcp).toContain(part);
    for (const shared of ['docs/agent-guide/image-to-plan.md', 'docs/agent-guide/commands.md']) expect(mcp).toContain(source(shared).trim());
    expect(mcp).not.toContain('<cli>');
    expect(mcp).not.toContain('## CLI commands');
    expect(guide('--form', 'mcp', '--cli', 'x')).toMatchObject({ code: 2, json: { code: 'USAGE' } });
  });
  it('every form is self-contained: no link to a repository file', () => {
    for (const form of ['text', 'agents-md', 'skill', 'llms', 'mcp']) {
      const out = guide('--form', form).json.text as string;
      expect(out.match(/\]\((?!https?:)[^)]*\)/g), form).toBeNull();
      expect(out, form).not.toContain('open-plan.schema.json');
    }
  });
  it('the committed copies are exactly what the built CLI prints (run guide:write after a change)', () => {
    for (const { form, path } of GUIDE_COPIES) expect(source(path), path).toBe(guide('--form', form).json.text);
  });
  it('the skill has the Claude Code front matter; the AGENTS.md section starts at level 2; llms.txt starts with the title and a summary', () => {
    expect(guide('--form', 'skill').json.text).toMatch(/^---\nname: open-plan\ndescription: .+\n---\n\n# Open Plan agent guide\n/);
    expect(guide('--form', 'agents-md').json.text).toMatch(/^<!-- .+ -->\n## Open Plan agent guide\n/);
    expect(guide('--form', 'llms').json.text).toMatch(/^# Open Plan\n\n> .+\n\n## Open Plan agent guide\n/);
  });
  it('--cli puts one command in place of every <cli>, and says so once', () => {
    const out = guide('--cli', 'node /opt/open-plan/cli.js').json.text as string;
    expect(out).not.toContain('<cli>');
    expect(out).toContain('In this guide, the Open Plan CLI command is `node /opt/open-plan/cli.js`.');
    expect(out).toContain('`node /opt/open-plan/cli.js validate plan.json`');
  });
  it('the text output is the guide; a wrong form or an option of another command is a usage error', () => {
    expect(guide().code).toBe(0);
    const plain = spawnSync(process.execPath, [CLI, 'guide'], { encoding: 'utf8' });
    expect([plain.status, plain.stdout]).toEqual([0, text]);
    expect(guide('--form', 'pdf')).toMatchObject({ code: 2, json: { code: 'USAGE' } });
    expect(run(repo, 'validate', 'x.json', '--form', 'skill')).toMatchObject({ code: 2, json: { code: 'USAGE' } });
  });
});
