import { applyCommands, DEFAULT_HEIGHTS, wallDirection, wallLength } from 'open-plan-core';

// Editing in the editor through the core commands (roadmap D4): an edit is a batch of commands on the open plan, so
// the editor, the CLI and MCP follow the same rules. A refused batch changes nothing.

/**
 * The result of a batch on `plan`: `status` 'ok' (`plan`, the `warnings` that the commands caused, `notes`),
 * 'same' (the commands change nothing), or 'refused' (`errors`).
 */
export function runEdit(plan, commands) {
  const result = applyCommands(plan, commands);
  if (!result.ok) return { status: 'refused', errors: result.errors };
  if (JSON.stringify(result.plan) === JSON.stringify(plan)) return { status: 'same' };
  return { status: 'ok', plan: result.plan, warnings: result.warnings.filter(w => w.commandIndex !== undefined), notes: result.notes };
}

const round = v => Math.round(v * 10) / 10;

/** The point on the centre line of `wall` at `distance` from its end `a`. */
export function wallPoint(wall, distance) {
  const [dx, dy] = wallDirection(wall);
  return [round(wall.a[0] + dx * distance), round(wall.a[1] + dy * distance)];
}

/** The command that gives `wall` the length `length`: the end `end` moves along the wall line; the other end stays. */
export function wallLengthCommand(wall, end, length) {
  const [dx, dy] = wallDirection(wall);
  const to = end === 'b' ? wallPoint(wall, length) : [round(wall.b[0] - dx * length), round(wall.b[1] - dy * length)];
  return { op: 'move_wall_end', wallId: wall.id, end, to };
}

/** The walls that `wallId` can be joined with: the command decides, so the list follows its rules. */
export function joinCandidates(plan, wallId) {
  const wall = plan.walls.find(w => w.id === wallId);
  if (!wall) return [];
  const horizontal = wall.a[1] === wall.b[1], axis = horizontal ? 1 : 0;
  return plan.walls.filter(other => other.id !== wall.id && other.type === wall.type && other.thickness === wall.thickness &&
    other.a[axis] === wall.a[axis] && other.b[axis] === wall.a[axis] &&
    applyCommands(plan, [{ op: 'join_walls', wallId: wall.id, otherId: other.id }]).ok);
}

/** The thickness for a new wall: that of the wall nearest to `point`, or 120 mm in a plan with no wall. */
export function newWallThickness(plan, point) {
  let best = null, bestDistance = Infinity;
  for (const wall of plan.walls) {
    const length = wallLength(wall), [dx, dy] = length ? wallDirection(wall) : [0, 0];
    const along = Math.max(0, Math.min(length, (point[0] - wall.a[0]) * dx + (point[1] - wall.a[1]) * dy));
    const distance = Math.hypot(point[0] - wall.a[0] - dx * along, point[1] - wall.a[1] - dy * along);
    if (distance < bestDistance) { best = wall; bestDistance = distance; }
  }
  return best ? best.thickness : 120;
}

/**
 * A point for the add-wall tool. Without `anchor` (the first point): a wall end within `tolerance`, or the 10 mm grid.
 * With `anchor` (the second point): the wall is horizontal or vertical from the anchor, and its free end goes to the
 * line of a wall end within `tolerance`, or to the 10 mm grid.
 */
export function snapWallPoint(point, plan, tolerance, anchor = null) {
  const ends = plan.walls.flatMap(w => [w.a, w.b]), grid = v => Math.round(v / 10) * 10;
  if (!anchor) {
    let best = null, bestDistance = tolerance;
    for (const end of ends) { const d = Math.hypot(end[0] - point[0], end[1] - point[1]); if (d <= bestDistance) { best = end; bestDistance = d; } }
    return best ? [best[0], best[1]] : [grid(point[0]), grid(point[1])];
  }
  const horizontal = Math.abs(point[0] - anchor[0]) >= Math.abs(point[1] - anchor[1]), axis = horizontal ? 0 : 1;
  let value = grid(point[axis]), bestDistance = tolerance;
  for (const end of ends) { const d = Math.abs(end[axis] - point[axis]); if (d <= bestDistance) { value = end[axis]; bestDistance = d; } }
  return horizontal ? [value, anchor[1]] : [anchor[0], value];
}

/** The end point of a wall from `start` in `direction` ('right' | 'left' | 'down' | 'up'; y goes down) with `length`. */
export function wallEnd(start, direction, length) {
  const [dx, dy] = { right: [1, 0], left: [-1, 0], down: [0, 1], up: [0, -1] }[direction];
  return [round(start[0] + dx * length), round(start[1] + dy * length)];
}

// ---- Openings (roadmap D4b) ----

/**
 * The editor's values for a new opening, and for the fields that a change of type adds. The core gives defaults only
 * for the heights of a new opening; a width, and the hinge and swing of a door, are always necessary.
 */
export const OPENING_DEFAULTS = {
  door: { width: 900, hinge: 'start', swing: 'left' },
  window: { width: 1200 },
  'sliding-door': { width: 1600 },
  hole: { width: 900 },
};

/**
 * The fields that only the type `type` has, for a new opening or for `opening` when its type changes. A door, a
 * sliding door and a hole keep the head of each other; a window has other heights, so a change to or from a window
 * starts from the defaults. No height is above the ceiling.
 */
export function openingTypeFields(type, plan, opening = null) {
  const ceiling = plan.ceilingHeight;
  if (type === 'window') {
    const head = Math.min(DEFAULT_HEIGHTS.windowHead, ceiling);
    return { sill: Math.min(DEFAULT_HEIGHTS.windowSill, head - 100), head };
  }
  const head = Math.min(opening && opening.type !== 'window' ? opening.head : DEFAULT_HEIGHTS.head, ceiling);
  return type === 'door' ? { hinge: OPENING_DEFAULTS.door.hinge, swing: OPENING_DEFAULTS.door.swing, head } : { head };
}

/** The command that changes the type of `opening`, with every field that the new type needs. */
export const openingTypeCommand = (plan, opening, type) => ({ op: 'change_opening_type', openingId: opening.id, type, ...openingTypeFields(type, plan, opening) });

/** The openings of a wall, sorted from end a. */
export const openingsIn = (plan, wallId) => plan.openings.filter(o => o.wallId === wallId).sort((p, q) => p.offset - q.offset);

/**
 * The command that adds an opening of `type` with the default width to `wall`: in the free part of the wall that is
 * nearest to the wall centre. Null when no free part is long enough; the core decides the other rules.
 */
export function addOpeningCommand(plan, wall, type) {
  const width = OPENING_DEFAULTS[type].width, length = wallLength(wall), centre = (length - width) / 2;
  let offset = null, best = Infinity, cursor = 0;
  for (const other of [...openingsIn(plan, wall.id), { offset: length, width: 0 }]) {
    if (other.offset - cursor >= width) {
      const at = Math.min(Math.max(centre, cursor), other.offset - width);
      if (Math.abs(at - centre) < best) { offset = round(at); best = Math.abs(at - centre); }
    }
    cursor = Math.max(cursor, other.offset + other.width);
  }
  return offset === null ? null : { op: 'add_opening', type, wallId: wall.id, offset, width, ...openingTypeFields(type, plan) };
}

/** The distance of `point` from end a of `wall`, along the wall line. */
export function distanceAlong(wall, point) {
  const [dx, dy] = wallDirection(wall);
  return (point[0] - wall.a[0]) * dx + (point[1] - wall.a[1]) * dy;
}

/**
 * The offset for an opening that is dragged along its own wall to `wanted`: on the 10 mm grid, inside the wall, and
 * between the openings that are before and after it. Null when the opening cannot move (a demolished wall, or no room).
 */
export function dragOffset(plan, openingId, wanted) {
  const opening = plan.openings.find(o => o.id === openingId), wall = opening && plan.walls.find(w => w.id === opening.wallId);
  if (!wall || wall.demolished) return null;
  let low = 0, high = wallLength(wall) - opening.width;
  for (const other of plan.openings) {
    if (other.wallId !== wall.id || other.id === opening.id) continue;
    if (other.offset + other.width / 2 <= opening.offset + opening.width / 2) low = Math.max(low, other.offset + other.width);
    else high = Math.min(high, other.offset - opening.width);
  }
  if (high < low) return null;
  // The limits are kept exactly: a limit that is not on the grid is not rounded past the wall end or a neighbour.
  return Math.min(high, Math.max(low, Math.round(wanted / 10) * 10));
}

/** The direction of a wall from a to b, as seen on the drawing (y goes down). */
export function wallHeading(wall) {
  const [dx, dy] = wallDirection(wall);
  return dx > 0 ? 'right' : dx < 0 ? 'left' : dy > 0 ? 'down' : 'up';
}
