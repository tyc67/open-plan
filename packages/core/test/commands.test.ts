import { describe, expect, it } from 'vitest';
import { applyCommands, COMMAND_OPS, hingePoint, openingRect, validatePlan, wallLength } from '../src/index.js';
import type { CommandIssue, DoorV2, PlanV2 } from '../src/index.js';

// One room, 6 × 4 m: exterior wall w1 on top with a window and a door, partition w2 on the right, low wall w3 below,
// and w4 on the left. The room outline is on the inside faces of all four walls.
const base = (): PlanV2 => ({
  schemaVersion: 2, id: 'p', name: 'Plan', units: 'mm', ceilingHeight: 2800,
  walls: [
    { id: 'w1', type: 'e', a: [0, 0], b: [6000, 0], thickness: 200 },
    { id: 'w2', type: 'n', a: [6000, 0], b: [6000, 4000], thickness: 120 },
    { id: 'w3', type: 'low', a: [0, 4000], b: [6000, 4000], thickness: 120 },
    { id: 'w4', type: 'e', a: [0, 0], b: [0, 4000], thickness: 200 },
  ],
  openings: [
    { id: 'win', type: 'window', wallId: 'w1', offset: 1000, width: 1200, sill: 900, head: 2400 },
    { id: 'd1', type: 'door', wallId: 'w1', offset: 3000, width: 900, hinge: 'start', swing: 'right', head: 2100 },
  ],
  rooms: [{ id: 'r1', name: 'Room', mat: 'wood', poly: [[100, 100], [5940, 100], [5940, 3940], [100, 3940]] }],
  materials: { wood: { name: 'Wood', sw: '#cc9966' } },
  furniture: [], measurements: [], dimensions: [],
});
const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value));
const run = (commands: unknown[], plan: unknown = base()) => applyCommands(plan, commands);
/** The plan after the commands; fails the test if they are refused. */
function ok(commands: unknown[], plan: unknown = base()) {
  const result = run(commands, plan);
  if (!result.ok) throw new Error(JSON.stringify(result.errors));
  return result;
}
/** The one error of a refused batch. */
function refused(commands: unknown[], plan: unknown = base()): CommandIssue {
  const result = run(commands, plan);
  if (result.ok) throw new Error('not refused');
  expect(result).not.toHaveProperty('plan');
  return result.errors[0];
}
const wall = (plan: PlanV2, id: string) => plan.walls.find(w => w.id === id)!;
const opening = (plan: PlanV2, id: string) => plan.openings.find(o => o.id === id)!;
/** Where each opening is in the plan: its rect, and the hinge point of a door. */
const placed = (plan: PlanV2) => Object.fromEntries(plan.openings.map(o => {
  const w = wall(plan, o.wallId);
  return [o.id, { rect: openingRect(o, w), hinge: o.type === 'door' ? hingePoint(o as DoorV2, w) : null }];
}));

describe('batch contract', () => {
  it('never changes the input plan', () => {
    const plan = base(), before = JSON.stringify(plan);
    ok([{ op: 'move_wall', wallId: 'w1', by: [0, -100] }, { op: 'delete_wall', wallId: 'w2' }, { op: 'set_plan_name', name: 'New' }], plan);
    run([{ op: 'delete_wall', wallId: 'w2' }, { op: 'delete_wall', wallId: 'nope' }], plan);
    expect(JSON.stringify(plan)).toBe(before);
  });
  it('a batch with one bad command changes nothing and returns no plan; the index is zero-based', () => {
    const result = run([{ op: 'delete_wall', wallId: 'w2' }, { op: 'delete_wall', wallId: 'nope' }, { op: 'set_plan_name', name: 'x' }]);
    expect(result).toEqual({ ok: false, errors: [{ commandIndex: 1, path: 'commands[1].wallId', code: 'wall-missing', params: { op: 'delete_wall', wallId: 'nope' } }] });
    expect(refused([{ op: 'delete_wall', wallId: 'nope' }]).commandIndex).toBe(0);
  });
  it('rejects a command list that is not a list, a command that is not an object, and an unknown op', () => {
    expect(run({} as never).ok).toBe(false);
    expect(refused([5])).toMatchObject({ commandIndex: 0, path: 'commands[0]', code: 'type-invalid' });
    const unknown = refused([{ op: 'paint_wall' }]);
    expect(unknown).toMatchObject({ commandIndex: 0, path: 'commands[0].op', code: 'command-op-unknown' });
    expect(unknown.params.allowed).toEqual(COMMAND_OPS);
  });
  it('a plan with errors that block rendering runs no command; its errors have no command index', () => {
    const plan = base(); plan.walls[0].thickness = 5;
    const result = run([{ op: 'set_plan_name', name: 'x' }], plan);
    expect(result).toEqual({ ok: false, errors: [validatePlan(plan, 'saved').errors[0]] });
    expect((result as { errors: CommandIssue[] }).errors[0]).not.toHaveProperty('commandIndex');
  });
  it('an error from the final validation names the first command after which it exists', () => {
    // Commands check their own rules; the final validation still catches the rest, here a coordinate that overflows.
    const result = run([{ op: 'set_plan_name', name: 'x' }, { op: 'move_wall', wallId: 'w2', by: [1.7e308, 0] }, { op: 'move_wall', wallId: 'w2', by: [1.7e308, 0] }]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.map(e => [e.commandIndex, e.path, e.code])).toEqual([[2, 'walls[1].a', 'type-invalid'], [2, 'walls[1].b', 'type-invalid']]);
  });
  it('success returns the normalized plan (default heights filled in), its warnings and the notes', () => {
    const input = copy(base()) as Record<string, any>;
    delete input.ceilingHeight; delete input.openings[0].sill; delete input.openings[1].head;
    const result = ok([{ op: 'set_plan_name', name: 'x' }], input);
    expect([result.plan.ceilingHeight, opening(result.plan, 'win').type === 'window' && (opening(result.plan, 'win') as any).sill, (opening(result.plan, 'd1') as DoorV2).head]).toEqual([2800, 900, 2100]);
    expect(result.warnings).toEqual([]);
  });
  it('a warning that the plan had before has no command index; a new one names the first command after which it exists', () => {
    const plan = base(); plan.walls[3].demolished = true;                        // a demolished exterior wall: tolerable
    // Deleting w2 moves w4 from walls[3] to walls[2]: the warning is still the same one, so it gets no index.
    const result = ok([{ op: 'delete_wall', wallId: 'w2' }, { op: 'move_wall', wallId: 'w3', by: [200_000, 0] }, { op: 'set_plan_name', name: 'y' }], plan);
    const [old, large] = [result.warnings.find(w => w.code === 'wall-not-demolishable')!, result.warnings.find(w => w.code === 'plan-too-large')!];
    expect(old).toEqual({ path: 'walls[2].demolished', code: 'wall-not-demolishable', params: { type: 'e' } });
    expect(large.commandIndex).toBe(1);
  });
  it('an existing tolerable issue does not block an unrelated edit, and the edit can repair it', () => {
    const plan = base(); plan.walls[3].demolished = true;
    expect(ok([{ op: 'set_plan_name', name: 'x' }], plan).plan.name).toBe('x');
    const restored = ok([{ op: 'toggle_demolition', wallId: 'w4', demolished: false }], plan);
    expect(restored.warnings).toEqual([]);
  });
  it('generated ids are deterministic, free in their list, and in the notes; given ids can be used later in the same batch', () => {
    const result = ok([
      { op: 'add_wall', type: 'n', a: [0, 2000], b: [3000, 2000], thickness: 100 },
      { op: 'add_wall', type: 'n', a: [3000, 2000], b: [3000, 3000], thickness: 100 },
      { op: 'add_wall', id: 'mid', type: 'n', a: [3000, 3000], b: [4000, 3000], thickness: 100 },
      { op: 'add_opening', wallId: 'mid', type: 'hole', offset: 100, width: 600 },
    ]);
    expect(result.notes).toEqual([
      { commandIndex: 0, code: 'id-generated', params: { list: 'walls', id: 'wall' } },
      { commandIndex: 1, code: 'id-generated', params: { list: 'walls', id: 'wall-2' } },
      { commandIndex: 3, code: 'id-generated', params: { list: 'openings', id: 'hole' } },
    ]);
    expect(run([{ op: 'add_wall', type: 'n', a: [0, 2000], b: [3000, 2000], thickness: 100 }])).toEqual(run([{ op: 'add_wall', type: 'n', a: [0, 2000], b: [3000, 2000], thickness: 100 }]));
  });
  it('every op has an implementation and is listed once', () => {
    expect(new Set(COMMAND_OPS).size).toBe(COMMAND_OPS.length);
    expect(COMMAND_OPS).toHaveLength(17);
  });
});

describe('command fields', () => {
  it('an unknown field is refused and lists the allowed fields', () => {
    expect(refused([{ op: 'delete_wall', wallId: 'w2', force: true }])).toMatchObject({ path: 'commands[0].force', code: 'command-field-unknown', params: { allowed: ['wallId'] } });
  });
  it('names of Object.prototype properties are unknown fields too (commands come from JSON)', () => {
    for (const text of [
      '{"op":"delete_wall","wallId":"w1","constructor":"typo"}',
      '{"op":"delete_wall","wallId":"w1","toString":"typo"}',
      '{"op":"delete_wall","wallId":"w1","__proto__":"typo"}',
      '{"op":"update_wall","wallId":"w1","hasOwnProperty":1}',
      '{"op":"add_opening","type":"hole","wallId":"w2","offset":100,"width":500,"valueOf":1}',
    ]) {
      const command = JSON.parse(text), field = Object.keys(command).at(-1);
      expect(refused([command])).toMatchObject({ path: `commands[0].${field}`, code: 'command-field-unknown' });
    }
  });
  it('a missing field, a wrong type and a wrong enum value are refused with the field path', () => {
    expect(refused([{ op: 'add_wall', type: 'n', a: [0, 0], b: [1000, 0] }])).toMatchObject({ path: 'commands[0].thickness', code: 'missing-field' });
    expect(refused([{ op: 'add_wall', type: 'n', a: [0, 0], b: [1000, 0, 0], thickness: 100 }])).toMatchObject({ path: 'commands[0].b', code: 'type-invalid' });
    expect(refused([{ op: 'add_wall', type: 'x', a: [0, 0], b: [1000, 0], thickness: 100 }])).toMatchObject({ path: 'commands[0].type', code: 'enum-invalid' });
  });
});

describe('wall commands', () => {
  it('add_wall adds a wall and refuses a zero-length, diagonal, too thin, demolished bearing or duplicate wall', () => {
    const plan = ok([{ op: 'add_wall', id: 'w5', type: 'n', a: [3000, 0], b: [3000, 4000], thickness: 100, name: 'Middle' }]).plan;
    expect(wall(plan, 'w5')).toEqual({ id: 'w5', type: 'n', a: [3000, 0], b: [3000, 4000], thickness: 100, name: 'Middle' });
    const add = (fields: object) => refused([{ op: 'add_wall', type: 'n', a: [0, 0], b: [1000, 0], thickness: 100, ...fields }]).code;
    expect([add({ b: [0, 0] }), add({ b: [1000, 10] }), add({ thickness: 10 }), add({ type: 'b', demolished: true }), add({ id: 'w1' })])
      .toEqual(['wall-zero-length', 'wall-not-axis-aligned', 'thickness-out-of-range', 'wall-not-demolishable', 'id-duplicate']);
  });

  it('update_wall changes type, thickness and name only, and names the command for other fields', () => {
    const plan = ok([{ op: 'update_wall', wallId: 'w2', type: 'b', thickness: 240, name: 'East' }]).plan;
    expect(wall(plan, 'w2')).toMatchObject({ type: 'b', thickness: 240, name: 'East', a: [6000, 0], b: [6000, 4000] });
    expect(refused([{ op: 'update_wall', wallId: 'w1', a: [0, 10] }])).toMatchObject({ path: 'commands[0].a', code: 'field-not-updatable', params: { use: ['move_wall_end', 'move_wall'] } });
    expect(refused([{ op: 'update_wall', wallId: 'w2', demolished: true }]).params.use).toEqual(['toggle_demolition']);
  });
  it('update_wall: a thickness change keeps the centre line, and a door hinge moves with the face', () => {
    const before = placed(base()).d1.hinge!, after = placed(ok([{ op: 'update_wall', wallId: 'w1', thickness: 300 }]).plan).d1.hinge!;
    expect([before, after]).toEqual([[3000, 100], [3000, 150]]);
  });
  it('update_wall refuses a window in a low wall, and a bearing or exterior type for a demolished wall', () => {
    expect(refused([{ op: 'update_wall', wallId: 'w1', type: 'low' }])).toMatchObject({ code: 'window-in-low-wall', params: { openingId: 'win' } });
    expect(refused([{ op: 'toggle_demolition', wallId: 'w2' }, { op: 'update_wall', wallId: 'w2', type: 'b' }])).toMatchObject({ commandIndex: 1, code: 'wall-demolished-type' });
    expect(wall(ok([{ op: 'toggle_demolition', wallId: 'w2' }, { op: 'update_wall', wallId: 'w2', type: 'low' }]).plan, 'w2').type).toBe('low');
  });
  it('update_wall: a room edge that is no longer on a wall face gives a warning with the command index', () => {
    const result = ok([{ op: 'set_plan_name', name: 'x' }, { op: 'update_wall', wallId: 'w1', thickness: 300 }]);
    expect(result.warnings).toEqual([{ commandIndex: 1, path: 'rooms[0].poly', code: 'room-edge-off-wall', params: { roomId: 'r1', edge: 0, wallId: 'w1', uncoveredLength: 5840 } }]);
  });
  it('room edges: a wall that only gets shorter warns with the length that lost support', () => {
    // The room edge x = 5940 runs from y = 100 to 3940 along w2; w2 now ends at y = 2000.
    const result = ok([{ op: 'move_wall_end', wallId: 'w2', end: 'b', to: [6000, 2000] }]);
    expect(result.warnings).toEqual([{ commandIndex: 0, path: 'rooms[0].poly', code: 'room-edge-off-wall', params: { roomId: 'r1', edge: 1, wallId: 'w2', uncoveredLength: 1940 } }]);
  });
  it('room edges: a part that another wall still supports does not warn; the part that no wall supports does', () => {
    const covered = ok([{ op: 'add_wall', id: 'w5', type: 'n', a: [6000, 2000], b: [6000, 4000], thickness: 120 }, { op: 'move_wall_end', wallId: 'w2', end: 'b', to: [6000, 2000] }]);
    expect(covered.warnings).toEqual([]);
    const partly = ok([{ op: 'add_wall', id: 'w5', type: 'n', a: [6000, 3000], b: [6000, 4000], thickness: 120 }, { op: 'move_wall_end', wallId: 'w2', end: 'b', to: [6000, 2000] }]);
    expect(partly.warnings.map(w => w.params.uncoveredLength)).toEqual([1000]);
    const pieceDeleted = ok([{ op: 'split_wall', wallId: 'w2', at: [6000, 2000], newId: 'w2b' }, { op: 'delete_wall', wallId: 'w2b' }]);
    expect(pieceDeleted.warnings).toMatchObject([{ commandIndex: 1, params: { wallId: 'w2b', uncoveredLength: 1940 } }]);
    expect(ok([{ op: 'split_wall', wallId: 'w2', at: [6000, 2000], newId: 'w2b' }]).warnings).toEqual([]);
  });

  it('delete_wall deletes its openings and lists them; the room edge on it gives a warning', () => {
    const result = ok([{ op: 'delete_wall', wallId: 'w1' }]);
    expect(result.plan.openings).toEqual([]);
    expect(result.notes).toEqual([{ commandIndex: 0, code: 'openings-deleted', params: { wallId: 'w1', openingIds: ['win', 'd1'] } }]);
    expect(result.warnings.map(w => [w.code, w.params.uncoveredLength])).toEqual([['room-edge-off-wall', 5840]]);
    expect(ok([{ op: 'delete_wall', wallId: 'w2' }]).notes).toEqual([]);
  });

  it('move_wall moves the wall; openings move with it and their offsets do not change', () => {
    const plan = ok([{ op: 'move_wall', wallId: 'w1', by: [500, -300] }]).plan;
    expect(wall(plan, 'w1')).toMatchObject({ a: [500, -300], b: [6500, -300] });
    expect(plan.openings).toEqual(base().openings);
    expect(placed(plan).d1.rect).toEqual([3500, -400, 4400, -200]);
  });

  it('move_wall_end: moving a keeps every opening in place in the plan (offsets change); moving b changes no offset', () => {
    const a = ok([{ op: 'move_wall_end', wallId: 'w1', end: 'a', to: [-1000, 0] }]).plan;
    expect([wallLength(wall(a, 'w1')), opening(a, 'win').offset, opening(a, 'd1').offset]).toEqual([7000, 2000, 4000]);
    expect(placed(a)).toEqual(placed(base()));
    const b = ok([{ op: 'move_wall_end', wallId: 'w1', end: 'b', to: [5000, 0] }]).plan;
    expect([wallLength(wall(b, 'w1')), b.openings]).toEqual([5000, base().openings]);
    const shorterA = ok([{ op: 'move_wall_end', wallId: 'w1', end: 'a', to: [800, 0] }]).plan;
    expect(placed(shorterA)).toEqual(placed(base()));
  });
  it('move_wall_end refuses an opening outside the wall, a point off the wall line, and passing the other end', () => {
    expect(refused([{ op: 'move_wall_end', wallId: 'w1', end: 'b', to: [3500, 0] }])).toMatchObject({ path: 'commands[0].to', code: 'opening-outside-wall', params: { openingId: 'd1', wallLength: 3500, end: 3900 } });
    expect(refused([{ op: 'move_wall_end', wallId: 'w1', end: 'a', to: [1500, 0] }])).toMatchObject({ code: 'opening-outside-wall', params: { openingId: 'win' } });
    expect(refused([{ op: 'move_wall_end', wallId: 'w1', end: 'a', to: [0, 10] }]).code).toBe('wall-end-off-line');
    expect(refused([{ op: 'move_wall_end', wallId: 'w2', end: 'a', to: [6000, 5000] }])).toMatchObject({ code: 'wall-end-past-other', params: { use: ['reverse_wall'] } });
  });

  it('split_wall: each opening goes to the piece that contains it, with a new offset; nothing moves in the plan', () => {
    const result = ok([{ op: 'split_wall', wallId: 'w1', at: [2500, 0] }]);
    expect(wall(result.plan, 'w1')).toMatchObject({ a: [0, 0], b: [2500, 0] });
    expect(wall(result.plan, 'w1-2')).toMatchObject({ type: 'e', thickness: 200, a: [2500, 0], b: [6000, 0] });
    expect(opening(result.plan, 'd1')).toMatchObject({ wallId: 'w1-2', offset: 500 });
    expect(opening(result.plan, 'win')).toMatchObject({ wallId: 'w1', offset: 1000 });
    expect(placed(result.plan)).toEqual(placed(base()));
    expect(result.notes.map(n => n.code)).toEqual(['id-generated', 'wall-split']);
    expect(result.warnings).toEqual([]);
  });
  it('split_wall refuses a point inside an opening, off the wall, or at an end; an opening edge is allowed', () => {
    expect(refused([{ op: 'split_wall', wallId: 'w1', at: [1500, 0] }])).toMatchObject({ code: 'split-point-in-opening', params: { openingId: 'win' } });
    expect(refused([{ op: 'split_wall', wallId: 'w1', at: [2500, 10] }]).code).toBe('split-point-off-wall');
    expect(refused([{ op: 'split_wall', wallId: 'w1', at: [6000, 0] }]).code).toBe('split-point-off-wall');
    expect(opening(ok([{ op: 'split_wall', wallId: 'w1', at: [2200, 0], newId: 'east' }]).plan, 'd1')).toMatchObject({ wallId: 'east', offset: 800 });
  });

  it('join_walls after split_wall gives back the original walls and openings', () => {
    const plan = ok([{ op: 'split_wall', wallId: 'w1', at: [2500, 0], newId: 'east' }, { op: 'join_walls', wallId: 'w1', otherId: 'east' }]).plan;
    expect([plan.walls, plan.openings]).toEqual([base().walls, base().openings]);
  });
  it('join_walls with a wall that runs the other way: doors change hinge end and swing side, and stay in place', () => {
    const plan = ok([{ op: 'split_wall', wallId: 'w1', at: [2500, 0], newId: 'east' }, { op: 'reverse_wall', wallId: 'east' }, { op: 'join_walls', wallId: 'w1', otherId: 'east' }]).plan;
    expect([plan.walls, plan.openings]).toEqual([base().walls, base().openings]);
    const reversedFirst = ok([{ op: 'split_wall', wallId: 'w1', at: [2500, 0], newId: 'east' }, { op: 'reverse_wall', wallId: 'east' }, { op: 'join_walls', wallId: 'east', otherId: 'w1' }]).plan;
    expect(placed(reversedFirst)).toEqual(placed(base()));
    expect(opening(reversedFirst, 'd1')).toMatchObject({ wallId: 'east', hinge: 'end', swing: 'left' });
  });
  it('join_walls refuses different lines, types, thicknesses or demolition states, a gap, the same wall, and overlapping openings', () => {
    const split = { op: 'split_wall', wallId: 'w2', at: [6000, 2000], newId: 'w2b' };
    expect(refused([{ op: 'join_walls', wallId: 'w1', otherId: 'w2' }]).code).toBe('walls-not-collinear');
    expect(refused([{ op: 'join_walls', wallId: 'w1', otherId: 'w3' }]).code).toBe('walls-not-collinear');
    expect(refused([split, { op: 'update_wall', wallId: 'w2b', type: 'low' }, { op: 'join_walls', wallId: 'w2', otherId: 'w2b' }]).code).toBe('walls-type-differs');
    expect(refused([split, { op: 'update_wall', wallId: 'w2b', thickness: 100 }, { op: 'join_walls', wallId: 'w2', otherId: 'w2b' }]).code).toBe('walls-thickness-differs');
    expect(refused([split, { op: 'toggle_demolition', wallId: 'w2b' }, { op: 'join_walls', wallId: 'w2', otherId: 'w2b' }]).code).toBe('walls-demolition-differs');
    expect(refused([split, { op: 'move_wall_end', wallId: 'w2b', end: 'a', to: [6000, 2500] }, { op: 'join_walls', wallId: 'w2', otherId: 'w2b' }]).code).toBe('walls-not-touching');
    expect(refused([{ op: 'join_walls', wallId: 'w1', otherId: 'w1' }]).code).toBe('join-same-wall');
    const overlap = refused([
      { op: 'add_wall', id: 'top', type: 'e', a: [3000, 0], b: [8000, 0], thickness: 200 },
      { op: 'add_opening', id: 'h', type: 'hole', wallId: 'top', offset: 200, width: 500 },
      { op: 'join_walls', wallId: 'w1', otherId: 'top' },
    ]);
    expect(overlap).toMatchObject({ commandIndex: 2, code: 'openings-overlap', params: { openingId: 'h', otherId: 'd1' } });
  });

  it('reverse_wall: offsets are measured from the new a end, doors change hinge and swing, and nothing moves in the plan', () => {
    const plan = ok([{ op: 'reverse_wall', wallId: 'w1' }]).plan;
    expect(wall(plan, 'w1')).toMatchObject({ a: [6000, 0], b: [0, 0] });
    expect(opening(plan, 'win').offset).toBe(6000 - 1000 - 1200);
    expect(opening(plan, 'd1')).toMatchObject({ offset: 2100, hinge: 'end', swing: 'left' });
    expect(placed(plan)).toEqual(placed(base()));
    expect(ok([{ op: 'reverse_wall', wallId: 'w1' }, { op: 'reverse_wall', wallId: 'w1' }]).plan).toEqual(base());
  });

  it('toggle_demolition switches or sets demolition; a bearing or exterior wall cannot be demolished', () => {
    const plan = ok([{ op: 'toggle_demolition', wallId: 'w2' }]).plan;
    expect(wall(plan, 'w2').demolished).toBe(true);
    expect(wall(ok([{ op: 'toggle_demolition', wallId: 'w2' }], plan).plan, 'w2').demolished).toBe(false);
    expect(refused([{ op: 'toggle_demolition', wallId: 'w1' }])).toMatchObject({ path: 'commands[0].wallId', code: 'wall-not-demolishable', params: { type: 'e' } });
    expect(refused([{ op: 'toggle_demolition', wallId: 'w1', demolished: true }]).path).toBe('commands[0].demolished');
  });
});

describe('opening commands', () => {
  const add = (fields: object) => [{ op: 'add_opening', wallId: 'w2', offset: 500, width: 900, ...fields }];
  it('add_opening fills the default heights and refuses fields of another type', () => {
    const plan = ok(add({ type: 'window' })).plan;
    expect(opening(plan, 'window')).toEqual({ id: 'window', wallId: 'w2', offset: 500, width: 900, type: 'window', sill: 900, head: 2400 });
    expect(opening(ok(add({ type: 'door', hinge: 'end', swing: 'left', entry: true })).plan, 'door')).toMatchObject({ head: 2100, entry: true });
    expect(refused(add({ type: 'door', hinge: 'end' }))).toMatchObject({ path: 'commands[0].swing', code: 'missing-field' });
    expect(refused(add({ type: 'door', hinge: 'end', swing: 'left', sill: 900 }))).toMatchObject({ path: 'commands[0].sill', code: 'field-not-for-type', params: { type: 'door' } });
    expect(refused(add({ type: 'gate' })).code).toBe('enum-invalid');
  });
  it('add_opening refuses an opening outside the wall, an overlap, a window in a low wall, a demolished wall and heights out of range', () => {
    expect(refused(add({ type: 'hole', offset: 3500 }))).toMatchObject({ code: 'opening-outside-wall', params: { wallLength: 4000, end: 4400 } });
    expect(refused([{ op: 'add_opening', type: 'hole', wallId: 'w1', offset: 2000, width: 500 }])).toMatchObject({ code: 'openings-overlap', params: { otherId: 'win' } });
    expect(refused([{ op: 'add_opening', type: 'window', wallId: 'w3', offset: 500, width: 900 }]).code).toBe('window-in-low-wall');
    expect(refused([{ op: 'toggle_demolition', wallId: 'w2' }, ...add({ type: 'hole' })]).code).toBe('wall-demolished');
    expect(refused(add({ type: 'hole', head: 2900 }))).toMatchObject({ path: 'commands[0].head', code: 'height-out-of-range', params: { max: 2800 } });
    expect(refused(add({ type: 'window', sill: 2500 })).code).toBe('window-sill-not-below-head');
    expect(refused(add({ type: 'hole', offset: -1 })).code).toBe('value-out-of-range');
    expect(refused(add({ type: 'hole', width: 0 })).code).toBe('size-not-positive');
    expect(refused(add({ type: 'hole', id: 'win' })).code).toBe('id-duplicate');
  });
  it('a hole that only touches another opening is allowed', () => {
    expect(ok([{ op: 'add_opening', type: 'hole', wallId: 'w1', offset: 2200, width: 800 }]).plan.openings).toHaveLength(3);
  });

  it('update_opening changes allowed fields for the type and names the command for other fields', () => {
    const plan = ok([{ op: 'update_opening', openingId: 'd1', head: 2200, hinge: 'end', name: 'Front', entry: true }]).plan;
    expect(opening(plan, 'd1')).toMatchObject({ head: 2200, hinge: 'end', name: 'Front', entry: true, offset: 3000 });
    expect(refused([{ op: 'update_opening', openingId: 'd1', width: 1000 }])).toMatchObject({ code: 'field-not-updatable', params: { use: ['resize_opening'] } });
    expect(refused([{ op: 'update_opening', openingId: 'd1', offset: 10 }]).params.use).toEqual(['move_opening']);
    expect(refused([{ op: 'update_opening', openingId: 'd1', type: 'hole' }]).params.use).toEqual(['change_opening_type']);
    expect(refused([{ op: 'update_opening', openingId: 'd1', sill: 500 }]).code).toBe('field-not-for-type');
    expect(refused([{ op: 'update_opening', openingId: 'win', sill: 2400 }]).code).toBe('window-sill-not-below-head');
    expect(refused([{ op: 'update_opening', openingId: 'nope', head: 2000 }]).code).toBe('opening-missing');
  });

  it('delete_opening deletes one opening', () => {
    expect(ok([{ op: 'delete_opening', openingId: 'win' }]).plan.openings.map(o => o.id)).toEqual(['d1']);
  });

  it('move_opening changes the offset or the wall, with the same checks', () => {
    expect(opening(ok([{ op: 'move_opening', openingId: 'd1', offset: 4500 }]).plan, 'd1').offset).toBe(4500);
    expect(opening(ok([{ op: 'move_opening', openingId: 'd1', wallId: 'w2', offset: 100 }]).plan, 'd1')).toMatchObject({ wallId: 'w2', offset: 100 });
    expect(refused([{ op: 'move_opening', openingId: 'd1', offset: 1500 }]).code).toBe('openings-overlap');
    expect(refused([{ op: 'move_opening', openingId: 'win', wallId: 'w3', offset: 100 }]).code).toBe('window-in-low-wall');
    expect(refused([{ op: 'move_opening', openingId: 'd1', offset: 5500 }]).code).toBe('opening-outside-wall');
  });

  it('resize_opening keeps the start edge, or the end edge with keep: end', () => {
    expect(opening(ok([{ op: 'resize_opening', openingId: 'd1', width: 1000 }]).plan, 'd1')).toMatchObject({ offset: 3000, width: 1000 });
    expect(opening(ok([{ op: 'resize_opening', openingId: 'd1', width: 1000, keep: 'end' }]).plan, 'd1')).toMatchObject({ offset: 2900, width: 1000 });
    expect(refused([{ op: 'resize_opening', openingId: 'd1', width: 1000, keep: 'end' }, { op: 'resize_opening', openingId: 'win', width: 2000 }]).code).toBe('openings-overlap');
  });

  it('change_opening_type needs every field of the new type and removes the fields it does not use', () => {
    const plan = ok([{ op: 'change_opening_type', openingId: 'win', type: 'door', hinge: 'start', swing: 'left', head: 2100 }]).plan;
    expect(opening(plan, 'win')).toEqual({ id: 'win', wallId: 'w1', offset: 1000, width: 1200, type: 'door', hinge: 'start', swing: 'left', head: 2100 });
    expect(opening(ok([{ op: 'change_opening_type', openingId: 'd1', type: 'hole', head: 2100 }]).plan, 'd1')).toEqual({ id: 'd1', wallId: 'w1', offset: 3000, width: 900, type: 'hole', head: 2100 });
    expect(refused([{ op: 'change_opening_type', openingId: 'win', type: 'door', hinge: 'start', head: 2100 }])).toMatchObject({ path: 'commands[0].swing', code: 'missing-field' });
    expect(refused([{ op: 'change_opening_type', openingId: 'd1', type: 'hole', head: 2100, hinge: 'start' }]).code).toBe('field-not-for-type');
    expect(refused([{ op: 'change_opening_type', openingId: 'win', type: 'window', sill: 900, head: 2400 }]).code).toBe('opening-type-unchanged');
    expect(refused([{ op: 'add_opening', id: 'lowdoor', type: 'door', wallId: 'w3', offset: 100, width: 800, hinge: 'start', swing: 'left' },
      { op: 'change_opening_type', openingId: 'lowdoor', type: 'window', sill: 300, head: 1000 }]).code).toBe('window-in-low-wall');
  });
});

describe('plan commands', () => {
  it('set_plan_name sets the name', () => {
    expect(ok([{ op: 'set_plan_name', name: 'Home' }]).plan.name).toBe('Home');
  });
  it('set_material creates or replaces one material by key; rooms keep using it', () => {
    const created = ok([{ op: 'set_material', key: 'tile', name: 'Tile', sw: '#eee', price: 200 }]);
    expect(created.plan.materials.tile).toEqual({ name: 'Tile', sw: '#eee', price: 200 });
    expect(created.notes[0]).toMatchObject({ code: 'material-created', params: { key: 'tile' } });
    const replaced = ok([{ op: 'set_material', key: 'wood', name: 'Oak', sw: '#d8b88a' }]);
    expect([replaced.plan.materials.wood, replaced.notes[0].code, replaced.plan.rooms[0].mat]).toEqual([{ name: 'Oak', sw: '#d8b88a' }, 'material-replaced', 'wood']);
    expect(refused([{ op: 'set_material', key: 'x', name: 'X', sw: '#000', price: -1 }]).code).toBe('value-out-of-range');
  });
});
