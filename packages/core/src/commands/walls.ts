import { wallDirection, wallLength } from '../geometry.js';
import type { OpeningV2, PlanV2, Point, WallV2 } from '../types.js';
import { LENGTH_TOLERANCE, WALL_TYPES } from '../validate.js';
import type { WallCommand } from './types.js';
import {
  checkDemolishable, checkThickness, checkWallLine, cleanLength, findWall, flipDoor, newId, openingsIn, readFields,
  refuse, replaceOpenings, replaceWall, type Step,
} from './support.js';

const wallType = { enum: WALL_TYPES };
const end = { enum: ['a', 'b'] as const };
const add = (p: Point, q: Point): Point => [p[0] + q[0], p[1] + q[1]];
/** Distance of `p` from the wall's `a` end, along the wall (negative before `a`). */
const along = (wall: WallV2, p: Point) => { const [ux, uy] = wallDirection(wall); return (p[0] - wall.a[0]) * ux + (p[1] - wall.a[1]) * uy; };
/** True if `p` is on the wall's centre line (extended past its ends). */
const onLine = (wall: WallV2, p: Point) => wall.a[1] === wall.b[1] ? p[1] === wall.a[1] : p[0] === wall.a[0];

// ---- Room edges on wall faces (roadmap C1: rooms are not linked to walls; a wall change warns about them) ----

interface Line { horizontal: boolean; at: number; lo: number; hi: number }
function faces(wall: WallV2): Line[] {
  const horizontal = wall.a[1] === wall.b[1], half = wall.thickness / 2;
  const [c, lo, hi] = horizontal ? [wall.a[1], Math.min(wall.a[0], wall.b[0]), Math.max(wall.a[0], wall.b[0])] : [wall.a[0], Math.min(wall.a[1], wall.b[1]), Math.max(wall.a[1], wall.b[1])];
  return [{ horizontal, at: c - half, lo, hi }, { horizontal, at: c + half, lo, hi }];
}
function edgeLine(p: Point, q: Point): Line | null {
  if (p[1] === q[1] && p[0] !== q[0]) return { horizontal: true, at: p[1], lo: Math.min(p[0], q[0]), hi: Math.max(p[0], q[0]) };
  if (p[0] === q[0] && p[1] !== q[1]) return { horizontal: false, at: p[0], lo: Math.min(p[1], q[1]), hi: Math.max(p[1], q[1]) };
  return null;
}
/** The part of `edge` that lies on `face`, as [lo, hi] along the edge axis, or null if none (or only a point). */
function overlap(edge: Line, face: Line): [number, number] | null {
  if (edge.horizontal !== face.horizontal || edge.at !== face.at) return null;
  const lo = Math.max(edge.lo, face.lo), hi = Math.min(edge.hi, face.hi);
  return hi > lo ? [lo, hi] : null;
}
/** The parts of `parts` that no interval in `covers` covers. */
function uncovered(parts: [number, number][], covers: [number, number][]): [number, number][] {
  let rest = parts;
  for (const [clo, chi] of covers) rest = rest.flatMap(([lo, hi]): [number, number][] =>
    chi <= lo || clo >= hi ? [[lo, hi]] : [...(clo > lo ? [[lo, clo] as [number, number]] : []), ...(chi < hi ? [[chi, hi] as [number, number]] : [])]);
  return rest;
}

/**
 * A warning for each room edge that loses wall support: the parts of the edge that were on a face of a changed wall
 * before, minus the parts on any wall face after. A wall that only gets shorter, or moves partly away, warns too.
 */
function roomEdgeWarnings(before: PlanV2, after: PlanV2, wallIds: string[]): NonNullable<Step['warnings']> {
  const changed = before.walls.filter(w => wallIds.includes(w.id));
  const allFaces = after.walls.flatMap(faces), warnings: NonNullable<Step['warnings']> = [];
  after.rooms.forEach((room, i) => room.poly.forEach((p, k) => {
    const edge = edgeLine(p, room.poly[(k + 1) % room.poly.length]);
    if (!edge) return;
    for (const wall of changed) {
      const supported = faces(wall).map(f => overlap(edge, f)).filter(r => r !== null);
      const lost = uncovered(supported, allFaces.map(f => overlap(edge, f)).filter(r => r !== null));
      if (!lost.length) continue;
      warnings.push({ path: `rooms[${i}].poly`, code: 'room-edge-off-wall', params: { roomId: room.id, edge: k, wallId: wall.id, uncoveredLength: lost.reduce((sum, [lo, hi]) => sum + hi - lo, 0) } });
    }
  }));
  return warnings;
}
const withRoomWarnings = (before: PlanV2, step: Step, wallIds: string[]): Step =>
  ({ ...step, warnings: [...(step.warnings ?? []), ...roomEdgeWarnings(before, step.plan, wallIds)] });

// ---- Commands ----

function addWall(plan: PlanV2, c: Extract<WallCommand, { op: 'add_wall' }>): Step {
  readFields(c, { required: { type: wallType, a: 'point', b: 'point', thickness: 'number' }, optional: { id: 'id', name: 'string', demolished: 'boolean' } });
  checkWallLine(c.a, c.b, 'b'); checkThickness(c.thickness); checkDemolishable(c.type, c.demolished, 'demolished');
  const { id, notes } = newId(plan.walls, c.id, 'wall', 'walls');
  const wall: WallV2 = { id, type: c.type, a: [...c.a], b: [...c.b], thickness: c.thickness };
  if (c.demolished !== undefined) wall.demolished = c.demolished;
  if (c.name !== undefined) wall.name = c.name;
  return { plan: { ...plan, walls: [...plan.walls, wall] }, notes };
}

function updateWall(plan: PlanV2, c: Extract<WallCommand, { op: 'update_wall' }>): Step {
  readFields(c, {
    required: { wallId: 'id' }, optional: { type: wallType, thickness: 'number', name: 'string' },
    use: { a: ['move_wall_end', 'move_wall'], b: ['move_wall_end', 'move_wall'], demolished: ['toggle_demolition'], id: [] },
  });
  const wall = findWall(plan, c.wallId), next: WallV2 = { ...wall };
  if (c.type !== undefined) {
    // A demolished wall can only be a partition or a low wall; restore it first to make it bearing or exterior.
    if (wall.demolished && (c.type === 'b' || c.type === 'e')) refuse('type', 'wall-demolished-type', { type: c.type });
    if (c.type === 'low') { const glass = openingsIn(plan, wall.id).find(o => o.type === 'window'); if (glass) refuse('type', 'window-in-low-wall', { wallId: wall.id, openingId: glass.id }); }
    next.type = c.type;
  }
  if (c.thickness !== undefined) { checkThickness(c.thickness); next.thickness = c.thickness; }
  if (c.name !== undefined) next.name = c.name;
  // A thickness change keeps the centre line; door hinges are on the faces, so they move with the faces.
  return withRoomWarnings(plan, { plan: replaceWall(plan, next) }, [wall.id]);
}

function deleteWall(plan: PlanV2, c: Extract<WallCommand, { op: 'delete_wall' }>): Step {
  readFields(c, { required: { wallId: 'id' } });
  const wall = findWall(plan, c.wallId), removed = openingsIn(plan, wall.id).map(o => o.id);
  const next = { ...plan, walls: plan.walls.filter(w => w.id !== wall.id), openings: plan.openings.filter(o => o.wallId !== wall.id) };
  return withRoomWarnings(plan, { plan: next, notes: removed.length ? [{ code: 'openings-deleted', params: { wallId: wall.id, openingIds: removed } }] : [] }, [wall.id]);
}

function moveWall(plan: PlanV2, c: Extract<WallCommand, { op: 'move_wall' }>): Step {
  readFields(c, { required: { wallId: 'id', by: 'point' } });
  const wall = findWall(plan, c.wallId);
  // Offsets are measured from `a`, so openings move with the wall and do not change.
  return withRoomWarnings(plan, { plan: replaceWall(plan, { ...wall, a: add(wall.a, c.by), b: add(wall.b, c.by) }) }, [wall.id]);
}

function moveWallEnd(plan: PlanV2, c: Extract<WallCommand, { op: 'move_wall_end' }>): Step {
  readFields(c, { required: { wallId: 'id', end, to: 'point' } });
  const wall = findWall(plan, c.wallId);
  // In this phase an end moves only along the wall line, so the wall stays horizontal or vertical.
  if (!onLine(wall, c.to)) refuse('to', 'wall-end-off-line', { wallId: wall.id });
  const s = along(wall, c.to), length = wallLength(wall);
  const newLength = c.end === 'a' ? length - s : s;
  if (newLength <= 0) refuse('to', 'wall-end-past-other', { wallId: wall.id, use: ['reverse_wall'] });
  const next: WallV2 = c.end === 'a' ? { ...wall, a: [...c.to] } : { ...wall, b: [...c.to] };
  // Openings keep their position in the plan: moving `a` by s along the wall changes every offset by -s.
  const shift = c.end === 'a' ? s : 0;
  const moved = openingsIn(plan, wall.id).map(o => ({ ...o, offset: cleanLength(o.offset - shift) }));
  for (const o of moved) if (o.offset < 0 || o.offset + o.width > newLength + LENGTH_TOLERANCE) refuse('to', 'opening-outside-wall', { openingId: o.id, wallLength: newLength, end: o.offset + o.width });
  return withRoomWarnings(plan, { plan: replaceOpenings(replaceWall(plan, next), moved) }, [wall.id]);
}

function splitWall(plan: PlanV2, c: Extract<WallCommand, { op: 'split_wall' }>): Step {
  readFields(c, { required: { wallId: 'id', at: 'point' }, optional: { newId: 'id' } });
  const wall = findWall(plan, c.wallId), s = along(wall, c.at);
  if (!onLine(wall, c.at) || s <= 0 || s >= wallLength(wall)) refuse('at', 'split-point-off-wall', { wallId: wall.id });
  const inside = openingsIn(plan, wall.id).find(o => o.offset < s - LENGTH_TOLERANCE && s < o.offset + o.width - LENGTH_TOLERANCE);
  if (inside) refuse('at', 'split-point-in-opening', { openingId: inside.id });
  const { id, notes } = newId(plan.walls, c.newId, wall.id, 'walls', 'newId');
  const first: WallV2 = { ...wall, b: [...c.at] }, second: WallV2 = { ...wall, id, a: [...c.at] };
  // Each opening goes to the piece that contains it; the second piece starts at the split point.
  const moved = openingsIn(plan, wall.id).filter(o => o.offset >= s - LENGTH_TOLERANCE).map(o => ({ ...o, wallId: id, offset: cleanLength(o.offset - s) }));
  const walls = plan.walls.flatMap(w => w.id === wall.id ? [first, second] : [w]);
  return {
    plan: replaceOpenings({ ...plan, walls }, moved),
    notes: [...notes!, { code: 'wall-split', params: { wallId: wall.id, newWallId: id, movedOpeningIds: moved.map(o => o.id) } }],
  };
}

function joinWalls(plan: PlanV2, c: Extract<WallCommand, { op: 'join_walls' }>): Step {
  readFields(c, { required: { wallId: 'id', otherId: 'id' } });
  const wall = findWall(plan, c.wallId), other = findWall(plan, c.otherId, 'otherId');
  if (wall.id === other.id) refuse('otherId', 'join-same-wall', { wallId: wall.id });
  const horizontal = wall.a[1] === wall.b[1];
  if (horizontal !== (other.a[1] === other.b[1]) || !onLine(wall, other.a)) refuse('otherId', 'walls-not-collinear', { wallId: wall.id, otherId: other.id });
  if (wall.type !== other.type) refuse('otherId', 'walls-type-differs', { type: wall.type, otherType: other.type });
  if (wall.thickness !== other.thickness) refuse('otherId', 'walls-thickness-differs', { thickness: wall.thickness, otherThickness: other.thickness });
  if (!!wall.demolished !== !!other.demolished) refuse('otherId', 'walls-demolition-differs', { wallId: wall.id, otherId: other.id });
  const k = horizontal ? 0 : 1, span = (w: WallV2) => [Math.min(w.a[k], w.b[k]), Math.max(w.a[k], w.b[k])];
  const [lo1, hi1] = span(wall), [lo2, hi2] = span(other);
  if (lo2 > hi1 || lo1 > hi2) refuse('otherId', 'walls-not-touching', { wallId: wall.id, otherId: other.id });
  // The joined wall keeps the direction of `wallId`.
  const lo = Math.min(lo1, lo2), hi = Math.max(hi1, hi2), forward = wall.b[k] > wall.a[k];
  const point = (v: number): Point => horizontal ? [v, wall.a[1]] : [wall.a[0], v];
  const joined: WallV2 = { ...wall, a: point(forward ? lo : hi), b: point(forward ? hi : lo) };
  // Openings keep their position in the plan. An opening of the other wall, if that wall runs the other way, is seen
  // from the other end: its door hinge and swing change, so the door stays the same.
  const relocate = (o: OpeningV2, from: WallV2): OpeningV2 => {
    const fromForward = from.b[k] > from.a[k], start = fromForward ? from.a[k] + o.offset : from.a[k] - o.offset - o.width;
    const moved = { ...o, wallId: wall.id, offset: cleanLength(forward ? start - lo : hi - (start + o.width)) };
    return fromForward === forward ? moved : flipDoor(moved);
  };
  const changed = [...openingsIn(plan, wall.id).map(o => relocate(o, wall)), ...openingsIn(plan, other.id).map(o => relocate(o, other))];
  const next = replaceOpenings({ ...plan, walls: plan.walls.filter(w => w.id !== other.id).map(w => w.id === wall.id ? joined : w) }, changed);
  // Where the two walls overlapped, their openings can overlap too.
  let reach: OpeningV2 | null = null;
  for (const o of [...changed].sort((p, q) => p.offset - q.offset)) {
    if (reach && o.offset < reach.offset + reach.width - LENGTH_TOLERANCE) refuse('otherId', 'openings-overlap', { openingId: o.id, otherId: reach.id });
    if (!reach || o.offset + o.width > reach.offset + reach.width) reach = o;
  }
  return withRoomWarnings(plan, { plan: next, notes: [{ code: 'walls-joined', params: { wallId: wall.id, removedWallId: other.id, movedOpeningIds: openingsIn(plan, other.id).map(o => o.id) } }] }, [wall.id, other.id]);
}

function reverseWall(plan: PlanV2, c: Extract<WallCommand, { op: 'reverse_wall' }>): Step {
  readFields(c, { required: { wallId: 'id' } });
  const wall = findWall(plan, c.wallId), length = wallLength(wall);
  // offset becomes length − offset − width; doors change hinge end and swing side, so every door stays the same.
  const changed = openingsIn(plan, wall.id).map(o => flipDoor({ ...o, offset: cleanLength(length - o.offset - o.width) }));
  return { plan: replaceOpenings(replaceWall(plan, { ...wall, a: wall.b, b: wall.a }), changed) };
}

function toggleDemolition(plan: PlanV2, c: Extract<WallCommand, { op: 'toggle_demolition' }>): Step {
  readFields(c, { required: { wallId: 'id' }, optional: { demolished: 'boolean' } });
  const wall = findWall(plan, c.wallId), demolished = c.demolished ?? !wall.demolished;
  checkDemolishable(wall.type, demolished, c.demolished === undefined ? 'wallId' : 'demolished');
  return { plan: replaceWall(plan, { ...wall, demolished }) };
}

export const WALL_COMMANDS = {
  add_wall: addWall, update_wall: updateWall, delete_wall: deleteWall, move_wall: moveWall, move_wall_end: moveWallEnd,
  split_wall: splitWall, join_walls: joinWalls, reverse_wall: reverseWall, toggle_demolition: toggleDemolition,
} as const;
