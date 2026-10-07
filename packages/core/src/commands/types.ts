import type { Point, WallType } from '../types.js';
import type { Issue } from '../validate.js';

// ---- Commands (roadmap C1). Lengths in mm; x goes right and y goes down. ----

/** Door fields. `hinge` start: at `offset`; end: at `offset + width`. `swing`: side of the wall seen along a → b. */
interface DoorFields { hinge: 'start' | 'end'; swing: 'left' | 'right'; head: number; entry?: boolean }

export type OpeningTypeFields =
  | { type: 'window'; sill: number; head: number }
  | ({ type: 'door' } & DoorFields)
  | { type: 'sliding-door'; head: number }
  | { type: 'hole'; head: number };

export type WallCommand =
  /** A new wall. A missing `id` is generated. */
  | { op: 'add_wall'; id?: string; type: WallType; a: Point; b: Point; thickness: number; name?: string; demolished?: boolean }
  /** Only `type`, `thickness` and `name`. Other fields are refused with the command to use. */
  | { op: 'update_wall'; wallId: string; type?: WallType; thickness?: number; name?: string }
  /** Also deletes the openings in the wall. */
  | { op: 'delete_wall'; wallId: string }
  /** Moves the whole wall by `by` = [dx, dy]. Openings move with it. */
  | { op: 'move_wall'; wallId: string; by: Point }
  /** Moves one end along the wall line. Openings keep their position in the plan. */
  | { op: 'move_wall_end'; wallId: string; end: 'a' | 'b'; to: Point }
  /** Splits at a point on the centre line. The `a` piece keeps the id; the `b` piece gets `newId` (generated if missing). */
  | { op: 'split_wall'; wallId: string; at: Point; newId?: string }
  /** Joins `otherId` into `wallId`: same line, type, thickness and demolition state, ends touching or overlapping. */
  | { op: 'join_walls'; wallId: string; otherId: string }
  /** Swaps `a` and `b`. Every opening and door stays in the same place. */
  | { op: 'reverse_wall'; wallId: string }
  /** Sets `demolished`, or switches it when it is left out. Only `n` and `low` walls can be demolished. */
  | { op: 'toggle_demolition'; wallId: string; demolished?: boolean };

export type OpeningCommand =
  /** A new opening. Heights left out get the A2 defaults. A missing `id` is generated. */
  | ({ op: 'add_opening'; id?: string; wallId: string; offset: number; width: number; name?: string } & (
      | { type: 'window'; sill?: number; head?: number }
      | ({ type: 'door' } & Omit<DoorFields, 'head'> & { head?: number })
      | { type: 'sliding-door' | 'hole'; head?: number }))
  /** Only `name`, `entry`, `sill`, `head`, `hinge` and `swing`, as the type allows. Other fields are refused with the command to use. */
  | { op: 'update_opening'; openingId: string; name?: string; entry?: boolean; sill?: number; head?: number; hinge?: 'start' | 'end'; swing?: 'left' | 'right' }
  | { op: 'delete_opening'; openingId: string }
  /** A new `offset`, optionally in another wall. */
  | { op: 'move_opening'; openingId: string; offset: number; wallId?: string }
  /** A new `width`. `keep` is the edge that stays in place: `start` (default) or `end`. */
  | { op: 'resize_opening'; openingId: string; width: number; keep?: 'start' | 'end' }
  /** A new type with all its fields. Fields that the new type does not use are removed. */
  | ({ op: 'change_opening_type'; openingId: string } & OpeningTypeFields);

export type PlanCommand =
  | { op: 'set_plan_name'; name: string }
  /** Creates or replaces one material by its key. */
  | { op: 'set_material'; key: string; name: string; sw: string; price?: number };

export type Command = WallCommand | OpeningCommand | PlanCommand;
export type CommandOp = Command['op'];

// ---- Results ----

/**
 * An error or warning of a batch. `commandIndex` (zero-based) names the command that caused it. A refused command has
 * a path inside the command (`commands[2].offset`); an issue from validation has a path in the plan.
 */
export interface CommandIssue extends Issue { commandIndex?: number }

/**
 * Structured information about a change, for example `id-generated` ({ list, id }) or `openings-deleted`
 * ({ wallId, openingIds }). Agents use the generated ids in later requests.
 */
export interface CommandNote { commandIndex: number; code: string; params: Record<string, unknown> }

export type BatchResult<P> =
  | { ok: true; plan: P; warnings: CommandIssue[]; notes: CommandNote[] }
  | { ok: false; errors: CommandIssue[] };
