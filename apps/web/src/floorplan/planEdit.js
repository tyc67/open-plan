import { applyCommands, wallDirection, wallLength } from 'open-plan-core';

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
