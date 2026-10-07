/** Plan coordinates are millimetres; x goes right and y goes down (screen and image direction). */
export type Point = [number, number];
/** Axis-aligned rectangle [x0, y0, x1, y1] with x0 < x1 and y0 < y1. */
export type Rect = [number, number, number, number];

/** `e` exterior, `b` bearing, `n` partition, `low` low wall. Only `n` and `low` can be demolished. */
export type WallType = 'e' | 'b' | 'n' | 'low';

/** A room. `poly` is the outline on the inside face of its walls. Rooms are not linked to walls in this phase. */
export interface Room {
  id: string;
  name: string;
  /** A key of `materials`. */
  mat: string;
  poly: Point[];
  /** Label position. */
  at?: Point;
  /** `false`: not in the floor area. */
  counted?: boolean;
}

/** A floor material. `sw` is the swatch colour. The sample also has a `price` per m². */
export interface Material { name: string; sw: string; price?: number }

/** A furniture item: centre `cx`, `cy`, size `w` × `d` (real size, never scaled), rotation `rot` in degrees. */
export interface Furniture { id: string; type: string; name: string; cx: number; cy: number; w: number; d: number; rot: number; color?: string }

export interface Measurement { id: string; a: { x: number; y: number }; b: { x: number; y: number } }

/** A chain of dimension segments along x (`horizontal`) or y, drawn at `at` and starting at `start`. */
export interface DimensionChain { horizontal: boolean; at: number; start: number; segments: number[] }

export interface CostEstimate {
  furniturePrices?: Record<string, number | null>;
  materialPrices?: Record<string, number | null>;
  wastePercent?: number;
}

/** Fields that v1 and v2 share and the migration copies unchanged. Unknown extra fields are allowed and kept. */
export interface PlanCommon {
  id: string;
  name: string;
  units: 'mm';
  locale?: string;
  rooms: Room[];
  materials: Record<string, Material>;
  furniture: Furniture[];
  measurements?: Measurement[];
  dimensions?: DimensionChain[];
  costEstimate?: CostEstimate;
}

// ---- Schema v1: walls and openings as rects. Walls stop at each opening. ----

export interface WallV1 { id: string; type: string; rect: Rect; demolished?: boolean }

export type OpeningV1 =
  | { id: string; type: 'window'; rect: Rect }
  | { id: string; type: 'door'; rect: Rect; h: Point; c: Point; o: Point; len: number; name?: string; entry?: boolean }
  | { id: string; type: 'sliding-door'; rect: Rect; v?: boolean };

export interface PlanV1 extends PlanCommon { schemaVersion: 1; walls: WallV1[]; openings: OpeningV1[] }

// ---- Schema v2: walls as centre lines; openings by offset and width along their wall. ----

export interface WallV2 {
  id: string;
  type: WallType;
  /** End points of the centre line. The body extends thickness / 2 on each side, not past the ends. */
  a: Point;
  b: Point;
  thickness: number;
  demolished?: boolean;
  name?: string;
}

interface OpeningBase {
  id: string;
  wallId: string;
  /** Distance from the wall's `a` end, along the wall, to the start of the opening. */
  offset: number;
  /** Length along the wall. An opening always has the full wall thickness. */
  width: number;
  name?: string;
}

export interface WindowV2 extends OpeningBase { type: 'window'; sill: number; head: number }
export interface DoorV2 extends OpeningBase {
  type: 'door';
  /** `start`: hinge at `offset`; `end`: hinge at `offset + width`. */
  hinge: 'start' | 'end';
  /** Side of the wall, seen along a → b, that the door opens to. */
  swing: 'left' | 'right';
  head: number;
  entry?: boolean;
}
export interface SlidingDoorV2 extends OpeningBase { type: 'sliding-door'; head: number }
export interface HoleV2 extends OpeningBase { type: 'hole'; head: number }
export type OpeningV2 = WindowV2 | DoorV2 | SlidingDoorV2 | HoleV2;

/**
 * Normalized v2 plan: every height is present. This is what the app and the core commands work on.
 * An import or a plan file may leave heights out (`PlanV2Input`); the validator (roadmap Step B) fills
 * them with the defaults from roadmap A2 to make a PlanV2.
 */
export interface PlanV2 extends PlanCommon {
  schemaVersion: 2;
  /** Millimetres. */
  ceilingHeight: number;
  walls: WallV2[];
  openings: OpeningV2[];
}

// ---- Schema v2 input: what an import or a plan file may contain. Heights and the ceiling are optional. ----

type WithOptional<T, K extends keyof T> = Omit<T, K> & Partial<Pick<T, K>>;
export type OpeningV2Input =
  | WithOptional<WindowV2, 'sill' | 'head'>
  | WithOptional<DoorV2, 'head'>
  | WithOptional<SlidingDoorV2, 'head'>
  | WithOptional<HoleV2, 'head'>;
export interface PlanV2Input extends Omit<PlanV2, 'ceilingHeight' | 'openings'> {
  ceilingHeight?: number;
  openings: OpeningV2Input[];
}
