import type { PlanV2 } from '../types.js';
import { validatePlan, type Issue } from '../validate.js';
import { OPENING_COMMANDS } from './openings.js';
import { PLAN_COMMANDS } from './plan.js';
import { ROOM_FURNITURE_COMMANDS } from './rooms-furniture.js';
import { SCALE_COMMANDS } from './scale.js';
import { Refusal, type Step } from './support.js';
import type { BatchResult, Command, CommandIssue, CommandNote, CommandOp } from './types.js';
import { WALL_COMMANDS } from './walls.js';

const COMMANDS: Record<CommandOp, (plan: PlanV2, command: never) => Step> = { ...WALL_COMMANDS, ...OPENING_COMMANDS, ...ROOM_FURNITURE_COMMANDS, ...PLAN_COMMANDS, ...SCALE_COMMANDS };
/** Every command name, for tools that list them. */
export const COMMAND_OPS = Object.keys(COMMANDS) as CommandOp[];

const LIST = /^(walls|openings|rooms|furniture|measurements)\[(\d+)\](.*)$/;
/**
 * A key that finds the same issue in two versions of a plan: the list index in the path is replaced by the item id,
 * because a deletion or insertion before an item changes its index.
 */
function issueKey(plan: PlanV2, { path, code }: Issue): string {
  const match = LIST.exec(path);
  if (!match) return `${code} ${path}`;
  const item = (plan[match[1] as 'walls'] as { id?: unknown }[] | undefined)?.[Number(match[2])];
  return `${code} ${match[1]}#${typeof item?.id === 'string' ? item.id : match[2]}${match[3]}`;
}

/**
 * Applies a list of commands as one unit (roadmap C1). The input plan is never changed.
 *
 * - The input is validated first (saved policy). If it has errors that block rendering, nothing runs and those errors
 *   are returned with no command index.
 * - A command that refuses its change stops the batch: the result is that one error, with the zero-based
 *   `commandIndex` and a path inside the command (`commands[2].offset`).
 * - The result is validated with the **saved** policy: an existing tolerable issue does not block an unrelated edit.
 *   An error names the first command after which it exists.
 * - On success: the normalized plan, its current warnings (a warning that the input already had has no command
 *   index; a new one names the first command after which it exists), command warnings, and the notes.
 * - On failure, no plan is returned.
 */
export function applyCommands(input: unknown, commands: unknown): BatchResult<PlanV2> {
  if (!Array.isArray(commands)) return { ok: false, errors: [{ path: 'commands', code: 'type-invalid', params: { expected: 'list' } }] };
  const start = validatePlan(input, 'saved');
  if (!start.ok) return { ok: false, errors: start.errors };

  const states: PlanV2[] = [start.plan!], notes: CommandNote[] = [], commandWarnings: CommandIssue[] = [];
  for (const [index, command] of commands.entries()) {
    const at = `commands[${index}]`;
    if (!command || typeof command !== 'object' || Array.isArray(command)) return { ok: false, errors: [{ commandIndex: index, path: at, code: 'type-invalid', params: { expected: 'object' } }] };
    const op = (command as { op?: unknown }).op;
    if (typeof op !== 'string' || !Object.hasOwn(COMMANDS, op)) return { ok: false, errors: [{ commandIndex: index, path: `${at}.op`, code: 'command-op-unknown', params: { op, allowed: COMMAND_OPS } }] };
    let step: Step;
    try {
      step = COMMANDS[op as CommandOp](states[index], command as never);
    } catch (error) {
      if (!(error instanceof Refusal)) throw error;
      return { ok: false, errors: [{ commandIndex: index, path: error.field ? `${at}.${error.field}` : at, code: error.code, params: { op, ...error.params } }] };
    }
    states.push(step.plan);
    for (const note of step.notes ?? []) notes.push({ commandIndex: index, ...note });
    for (const warning of step.warnings ?? []) commandWarnings.push({ commandIndex: index, ...warning });
  }

  // Validation results of the states after each command, made only when an issue must be attributed.
  const checked = new Map<number, Set<string>>();
  const keysAfter = (k: number) => {
    if (!checked.has(k)) { const r = validatePlan(states[k], 'saved'); checked.set(k, new Set([...r.errors, ...r.warnings].map(i => issueKey(states[k], i)))); }
    return checked.get(k)!;
  };
  const final = validatePlan(states.at(-1), 'saved'), last = states.length - 1, finalPlan = states[last];
  const firstCommand = (issue: Issue) => {
    const key = issueKey(finalPlan, issue);
    for (let k = 1; k <= last; k++) if (keysAfter(k).has(key)) return k - 1;
    return last - 1;
  };
  if (!final.ok) return { ok: false, errors: final.errors.map(e => ({ ...e, commandIndex: firstCommand(e) })) };

  const before = new Set(start.warnings.map(w => issueKey(states[0], w)));
  const warnings: CommandIssue[] = final.warnings.map(w => before.has(issueKey(finalPlan, w)) ? w : { ...w, commandIndex: firstCommand(w) });
  return { ok: true, plan: final.plan!, warnings: [...warnings, ...commandWarnings], notes };
}

/** Applies one command; the same rules as a batch of one. */
export const applyCommand = (input: unknown, command: Command): BatchResult<PlanV2> => applyCommands(input, [command]);
