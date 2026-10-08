// The tools of the MCP server (roadmap C5). Each tool calls the same operation as the CLI (operations.ts), with the
// workspace boundary and the MCP input limits. The protocol part is in mcp.ts.
import { CliError } from './files.js';
import { guideText } from './guide.js';
import * as op from './operations.js';
import type { Workspace } from './workspace.js';

export const MAX_PLAN_BYTES = 5_242_880, MAX_COMMANDS = 1000, MAX_COMMAND_BYTES = 1_048_576;
export const RENDER_LIMITS = { side: 2000, pixels: 4_000_000 };

type Json = Record<string, unknown>;
/** A tool's result: the result object (`ok`, and `code` and `message` when not ok), and for render_preview a PNG. */
export interface ToolOutput { result: Json & { ok: boolean }; png?: Buffer }

/** Test hook: called after the paths are checked and before the operation uses them. */
export interface ToolHooks { afterCheck?: (tool: string, paths: string[]) => Promise<void> }

type Kind = 'string' | 'boolean' | 'integer' | 'revision' | 'crop' | 'plan' | 'commands';
interface Field { kind: Kind; required?: boolean; description: string }
interface Tool { name: string; title: string; description: string; readOnly: boolean; destructive?: boolean; fields: Record<string, Field>; run(args: Json): Promise<ToolOutput> }

const SCHEMA: Record<Kind, object> = {
  string: { type: 'string', minLength: 1 },
  boolean: { type: 'boolean' },
  integer: { type: 'integer' },
  revision: { type: 'string', pattern: '^[0-9a-f]{64}$' },
  crop: { type: 'array', items: { type: 'number' }, minItems: 4, maxItems: 4 },
  plan: { type: 'object' },
  commands: { type: 'array', items: { type: 'object' } },
};
const usage = (message: string) => new CliError('USAGE', message);

/** Checks the arguments against the tool's fields. Annotations and schemas are hints for the client; this enforces. */
function checkArgs(tool: Tool, args: Json) {
  // Own properties only: `in` would accept inherited names such as "constructor" or "__proto__".
  for (const key of Object.keys(args)) if (!Object.hasOwn(tool.fields, key)) throw usage(`${tool.name} has no argument "${key}". Arguments: ${Object.keys(tool.fields).join(', ') || 'none'}.`);
  for (const [key, field] of Object.entries(tool.fields)) {
    const value = args[key];
    if (value === undefined) { if (field.required) throw usage(`${tool.name} needs the argument "${key}".`); continue; }
    const ok = field.kind === 'string' ? typeof value === 'string' && value !== ''
      : field.kind === 'boolean' ? typeof value === 'boolean'
      : field.kind === 'integer' ? Number.isInteger(value)
      : field.kind === 'revision' ? typeof value === 'string'
      : field.kind === 'crop' ? Array.isArray(value) && value.length === 4 && value.every(n => typeof n === 'number')
      : field.kind === 'commands' ? Array.isArray(value)
      : true;
    if (!ok) throw usage(`The argument "${key}" of ${tool.name} must be ${field.kind === 'crop' ? 'a list of four numbers' : field.kind === 'commands' ? 'a list' : `a ${field.kind}`}.`);
  }
}

const jsonBytes = (value: unknown) => Buffer.byteLength(JSON.stringify(value) ?? '', 'utf8');
function limit(bytes: number, max: number, what: string) {
  if (bytes > max) throw new CliError('INPUT_TOO_LARGE', `${what} is ${bytes} bytes; the limit is ${max} bytes.`, { limit: max, size: bytes });
}

/** CLI command names in messages and notices, as the MCP tool names. */
const TOOL_NAMES: [RegExp, string][] = [[/`validate`/g, '`validate_plan`'], [/`info`/g, '`plan_info`'], [/`migrate`/g, '`migrate_plan`']];
const forMcp = (text: string) => TOOL_NAMES.reduce((t, [re, name]) => t.replace(re, name), text);

function output(result: Json & { ok: boolean }, replaceHint: string): ToolOutput {
  const copy: Json & { ok: boolean } = { ...result };
  if (typeof copy.message === 'string') copy.message = copy.code === 'DESTINATION_EXISTS' ? copy.message.replace(/Use --replace .*$/, replaceHint) : forMcp(copy.message);
  if (Array.isArray(copy.notices)) copy.notices = copy.notices.map(n => typeof n === 'string' ? forMcp(n) : n);
  return { result: copy };
}

export function createTools(ws: Workspace, hooks: ToolHooks = {}) {
  const opts: op.OpOptions = { maxBytes: MAX_PLAN_BYTES, boundary: ws.boundary };
  const checked = async (tool: string, ...paths: string[]) => { await hooks.afterCheck?.(tool, paths); };
  const fileOf = (args: Json) => args.path as string;
  const pathField: Field = { kind: 'string', required: true, description: 'The plan file, relative to the workspace (for example "plan.json").' };
  const tools: Tool[] = [
    {
      name: 'get_guide', title: 'Get the Open Plan guide', readOnly: true, fields: {},
      description: 'Gives the full Open Plan agent guide: the work loop, how to make a plan from a floor-plan image, the plan format, the tools and every command for apply_commands. Read it before you write a plan.',
      run: async () => ({ result: { ok: true, text: guideText('mcp'), notices: [] } }),
    },
    {
      name: 'get_schema', title: 'Get the plan schema', readOnly: true, fields: {},
      description: 'Gives the JSON Schema of an Open Plan file (schema version 2) and the short field description.',
      run: async () => ({ result: await op.schema() }),
    },
    {
      name: 'read_plan', title: 'Read a plan file', readOnly: true, fields: { path: pathField },
      description: 'Gives the JSON of a plan file as it is in the file (not changed), its schemaVersion, and its revision (the SHA-256 of the bytes that were read). Give the revision as expectedRevision when you change the file.',
      run: async args => { const path = await ws.resolve(fileOf(args), true); await checked('read_plan', path); return output(await op.readPlan(path, opts), ''); },
    },
    {
      name: 'plan_info', title: 'Plan information', readOnly: true, fields: { path: pathField },
      description: 'Gives the counts, the size, the rooms with their areas, the revision and the warnings of a plan file.',
      run: async args => { const path = await ws.resolve(fileOf(args), true); await checked('plan_info', path); return output(await op.info(path, opts), ''); },
    },
    {
      name: 'validate_plan', title: 'Validate a plan', readOnly: true,
      fields: { path: { ...pathField, required: false }, plan: { kind: 'plan', description: 'An inline plan (JSON object), in place of path.' } },
      description: 'Checks a plan file (path) or an inline plan (plan) with the strict rules: an issue that the editor only warns about is an error here. Give exactly one of path and plan. Each error has the path of the field and a code. A file also gives its revision.',
      run: async args => {
        if ((args.path === undefined) === (args.plan === undefined)) throw usage('validate_plan needs exactly one of "path" and "plan".');
        if (args.plan !== undefined) { limit(jsonBytes(args.plan), MAX_PLAN_BYTES, 'The inline plan'); return output(op.validateValue(args.plan), ''); }
        const path = await ws.resolve(fileOf(args), true); await checked('validate_plan', path);
        return output(await op.validate(path, opts), '');
      },
    },
    {
      name: 'render_preview', title: 'Draw the plan', readOnly: true,
      fields: {
        path: pathField,
        crop: { kind: 'crop', description: 'An area [x0, y0, x1, y1] in mm (the values can be negative). Default: the whole plan.' },
        width: { kind: 'integer', description: `The image width in px, 1 to ${RENDER_LIMITS.side} (default 1200). The height follows the area; the image is at most ${RENDER_LIMITS.side} px high and ${RENDER_LIMITS.pixels / 1e6} million px.` },
        grid: { kind: 'boolean', description: 'Add a 1 m grid.' },
        dimensions: { kind: 'boolean', description: 'Add the dimension chains.' },
        text: { kind: 'boolean', description: 'false leaves out all text (default true).' },
      },
      description: 'Draws the plan in 2D and gives a PNG image, to compare with the source image. A plan with errors that block drawing is refused; run validate_plan.',
      run: async args => {
        const path = await ws.resolve(fileOf(args), true); await checked('render_preview', path);
        const drawn = await op.renderPng(path, { crop: args.crop as op.RenderOptions['crop'], width: args.width as number | undefined, grid: args.grid as boolean | undefined, dimensions: args.dimensions as boolean | undefined, text: args.text as boolean | undefined, limits: RENDER_LIMITS }, opts);
        if (!drawn.ok) return output(drawn, '');
        const { png, ...result } = drawn;
        return { ...output(result, ''), png };
      },
    },
    {
      name: 'create_plan', title: 'Create a plan file', readOnly: false, destructive: false,
      fields: { path: pathField, sample: { kind: 'boolean', description: 'true: the sample apartment; default: an empty plan.' } },
      description: 'Writes a new plan file: an empty plan, or the sample apartment. It never replaces a file: an existing file is refused (DESTINATION_EXISTS). A new file has no backup.',
      run: async args => {
        const path = await ws.resolve(fileOf(args), false); await checked('create_plan', path);
        return output(await op.create(path, { sample: args.sample === true }, opts), 'To replace it, use `write_plan` with its expectedRevision.');
      },
    },
    {
      name: 'write_plan', title: 'Write a whole plan', readOnly: false, destructive: true,
      fields: {
        path: pathField,
        plan: { kind: 'plan', required: true, description: 'The whole plan (schema version 2).' },
        expectedRevision: { kind: 'revision', description: 'Required to replace an existing file: its revision from read_plan, plan_info or validate_plan. Leave it out for a new file.' },
      },
      description: 'Writes a whole plan, for example the first version from an image. The plan is checked with the strict rules first; a refusal writes nothing. A new file: give no expectedRevision (an existing file is refused). An existing file: expectedRevision is required, and the file is backed up before it is replaced. A plan that equals the current plan is not written.',
      run: async args => {
        limit(jsonBytes(args.plan), MAX_PLAN_BYTES, 'The plan');
        const path = await ws.resolve(fileOf(args), false); await checked('write_plan', path);
        return output(await op.writePlan(path, args.plan, { expectedRevision: args.expectedRevision as string | undefined }, opts), 'To replace it, give its expectedRevision.');
      },
    },
    {
      name: 'apply_commands', title: 'Change a plan with commands', readOnly: false, destructive: true,
      fields: {
        path: pathField,
        expectedRevision: { kind: 'revision', required: true, description: 'The revision of the plan that you read (read_plan, plan_info or validate_plan).' },
        commands: { kind: 'commands', required: true, description: `The commands, in order (see the "Commands" part of get_guide). At most ${MAX_COMMANDS} commands and ${MAX_COMMAND_BYTES} bytes.` },
      },
      description: 'Changes a plan file with a batch of commands, for example { "op": "move_wall", ... }. The batch is atomic: if one command is refused, nothing is written (COMMANDS_REFUSED, with the index of the command). If the file changed since expectedRevision, nothing is written (REVISION_CONFLICT). The file is backed up before it is replaced. Get the 25 commands and their fields from get_guide.',
      run: async args => {
        const commands = args.commands as unknown[];
        if (commands.length > MAX_COMMANDS) throw new CliError('INPUT_TOO_LARGE', `The batch has ${commands.length} commands; the limit is ${MAX_COMMANDS}.`, { limit: MAX_COMMANDS, size: commands.length });
        limit(jsonBytes(commands), MAX_COMMAND_BYTES, 'The commands');
        const path = await ws.resolve(fileOf(args), true); await checked('apply_commands', path);
        return output(await op.applyBatch(path, { expectedRevision: args.expectedRevision, commands }, opts), '');
      },
    },
    {
      name: 'migrate_plan', title: 'Convert a version 1 file', readOnly: false, destructive: true,
      fields: {
        source: { kind: 'string', required: true, description: 'The schema version 1 file, relative to the workspace.' },
        destination: { kind: 'string', required: true, description: 'The version 2 file to write, relative to the workspace. It can be the source.' },
        expectedRevision: { kind: 'revision', description: 'Required to replace an existing destination (also the source itself): its revision. Leave it out for a new file.' },
      },
      description: 'Converts a schema version 1 file to version 2, with a report of each change. A new destination: give no expectedRevision. An existing destination: its expectedRevision is required, and it is backed up before it is replaced.',
      run: async args => {
        const source = await ws.resolve(args.source as string, true), destination = await ws.resolve(args.destination as string, false);
        await checked('migrate_plan', source, destination);
        return output(await op.migrate(source, destination, { expectedRevision: args.expectedRevision as string | undefined }, opts), 'To replace it, give its expectedRevision.');
      },
    },
  ];

  const byName = new Map(tools.map(t => [t.name, t]));
  return {
    /** The tool list for `tools/list`. */
    list: tools.map(t => ({
      name: t.name, title: t.title, description: t.description,
      inputSchema: {
        type: 'object', additionalProperties: false,
        properties: Object.fromEntries(Object.entries(t.fields).map(([k, f]) => [k, { ...SCHEMA[f.kind], description: f.description }])),
        required: Object.entries(t.fields).filter(([, f]) => f.required).map(([k]) => k),
      },
      annotations: { title: t.title, readOnlyHint: t.readOnly, ...(t.readOnly ? {} : { destructiveHint: t.destructive ?? false, idempotentHint: false }), openWorldHint: false },
    })),
    has: (name: string) => byName.has(name),
    /** Runs a tool. A refusal or an operational failure is a result with `ok: false`, never a thrown error. */
    async call(name: string, args: Json): Promise<ToolOutput> {
      const tool = byName.get(name)!;
      try {
        checkArgs(tool, args);
        return await tool.run(args);
      } catch (error) {
        if (error instanceof CliError) return output({ ok: false, code: error.code, message: error.message, ...error.details, notices: [] }, 'To replace it, give its expectedRevision.');
        return { result: { ok: false, code: 'IO_ERROR', message: (error as Error)?.message ?? String(error), notices: [] } };
      }
    },
  };
}
