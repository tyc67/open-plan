import { describe, expect, it } from 'vitest';
import { applyCommands, COMMAND_OPS, createEmptyPlan, createSamplePlan, hingePoint, openingRect, validatePlan, wallLength } from '../src/index.js';
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
    expect(COMMAND_OPS).toHaveLength(26);
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

describe('room commands', () => {
  const square = [[1000, 1000], [3000, 1000], [3000, 3000], [1000, 3000]];
  it('add_room adds a room with a generated id; the same batch can create its material first', () => {
    const result = ok([{ op: 'set_material', key: 'tile', name: 'Tile', sw: '#eee' }, { op: 'add_room', name: 'Bath', mat: 'tile', poly: square, counted: false }]);
    expect(result.plan.rooms[1]).toEqual({ id: 'room', name: 'Bath', mat: 'tile', poly: square, counted: false });
    expect(result.notes[1]).toEqual({ commandIndex: 1, code: 'id-generated', params: { list: 'rooms', id: 'room' } });
  });
  it('add_room refuses a missing material, too few points, a crossing outline and a tiny area', () => {
    const add = (fields: object) => refused([{ op: 'add_room', name: 'X', mat: 'wood', poly: square, ...fields }]);
    expect(add({ mat: 'stone' })).toMatchObject({ path: 'commands[0].mat', code: 'room-material-missing', params: { use: ['set_material'] } });
    expect(add({ poly: [[0, 0], [1, 1]] }).code).toBe('room-too-few-points');
    expect(add({ poly: [[0, 0], [1000, 1000], [1000, 0], [0, 1000]] }).code).toBe('room-self-crossing');
    expect(add({ poly: [[0, 0], [50, 0], [50, 50], [0, 50]] }).code).toBe('room-area-too-small');
    expect(add({ poly: [[0, 0], [1, 'x']] })).toMatchObject({ path: 'commands[0].poly', code: 'type-invalid' });
    expect(add({ id: 'r1' }).code).toBe('id-duplicate');
  });
  it('update_room changes fields with the same checks; delete_room deletes', () => {
    const plan = ok([{ op: 'update_room', roomId: 'r1', name: 'Living', poly: square, at: [2000, 2000], counted: false }]).plan;
    expect(plan.rooms[0]).toEqual({ id: 'r1', name: 'Living', mat: 'wood', poly: square, at: [2000, 2000], counted: false });
    expect(refused([{ op: 'update_room', roomId: 'r1', mat: 'stone' }]).code).toBe('room-material-missing');
    expect(refused([{ op: 'update_room', roomId: 'r1', id: 'r2' }]).code).toBe('field-not-updatable');
    expect(refused([{ op: 'update_room', roomId: 'nope', name: 'x' }]).code).toBe('room-missing');
    expect(ok([{ op: 'delete_room', roomId: 'r1' }]).plan.rooms).toEqual([]);
  });
});

describe('furniture commands', () => {
  const sofa = { op: 'add_furniture', type: 'sofa', name: 'Sofa', cx: 3000, cy: 2000, w: 2000, d: 900 };
  it('add_furniture adds an item with rot 0 and a generated id; size must be above 0', () => {
    expect(ok([sofa]).plan.furniture).toEqual([{ id: 'furniture', type: 'sofa', name: 'Sofa', cx: 3000, cy: 2000, w: 2000, d: 900, rot: 0 }]);
    expect(refused([{ ...sofa, w: 0 }])).toMatchObject({ path: 'commands[0].w', code: 'size-not-positive' });
  });
  it('update_furniture changes fields; delete_furniture also removes its price', () => {
    const plan = ok([{ ...sofa, id: 's' }, { op: 'update_furniture', furnitureId: 's', cx: 3500, rot: 90, color: '#888' }]).plan;
    expect(plan.furniture[0]).toMatchObject({ cx: 3500, rot: 90, color: '#888', w: 2000 });
    expect(refused([{ ...sofa, id: 's' }, { op: 'update_furniture', furnitureId: 's', d: -1 }]).code).toBe('size-not-positive');
    expect(refused([{ op: 'update_furniture', furnitureId: 'nope', cx: 1 }]).code).toBe('furniture-missing');
    const priced = { ...base(), costEstimate: { furniturePrices: { s: 12000, other: 5 }, wastePercent: 10 } };
    const result = ok([{ ...sofa, id: 's' }, { op: 'delete_furniture', furnitureId: 's' }], priced);
    expect([result.plan.furniture, result.plan.costEstimate]).toEqual([[], { furniturePrices: { other: 5 }, wastePercent: 10 }]);
    expect(result.notes.at(-1)).toEqual({ commandIndex: 1, code: 'furniture-price-removed', params: { furnitureId: 's' } });
    expect(ok([{ ...sofa, id: 's' }, { op: 'delete_furniture', furnitureId: 's' }]).notes).toEqual([]);
  });
});

describe('set_dimensions', () => {
  const chain = { horizontal: true, at: -600, start: 0, segments: [3000, 5000] };
  it('replaces all chains, removes them with an empty list, and does not change the input', () => {
    const plan = { ...base(), dimensions: [{ horizontal: false, at: 9000, start: 0, segments: [100] }] }, before = copy(plan), sent = copy(chain);
    const result = ok([{ op: 'set_dimensions', dimensions: [sent, { ...chain, horizontal: false }] }], plan);
    expect(result.plan.dimensions).toEqual([chain, { ...chain, horizontal: false }]);
    expect(result.notes).toEqual([{ commandIndex: 0, code: 'dimensions-set', params: { before: 1, after: 2 } }]);
    expect(plan).toEqual(before);
    sent.segments.push(1);                                        // the plan has its own copy of the list
    expect(result.plan.dimensions![0].segments).toEqual([3000, 5000]);
    expect(ok([{ op: 'set_dimensions', dimensions: [] }], plan).plan.dimensions).toEqual([]);
    const { dimensions: _none, ...bare } = base();                // a plan with no `dimensions` field
    expect(ok([{ op: 'set_dimensions', dimensions: [chain] }], bare).notes[0].params).toEqual({ before: 0, after: 1 });
  });
  it('refuses a chain that is not complete or not usable, with the path of the value', () => {
    const one = (value: unknown) => refused([{ op: 'set_dimensions', dimensions: [chain, value] }]);
    expect(refused([{ op: 'set_dimensions' }])).toMatchObject({ path: 'commands[0].dimensions', code: 'missing-field' });
    expect(refused([{ op: 'set_dimensions', dimensions: chain }])).toMatchObject({ path: 'commands[0].dimensions', code: 'type-invalid' });
    expect(refused([{ op: 'set_dimensions', dimensions: [], chains: [] }])).toMatchObject({ path: 'commands[0].chains', code: 'command-field-unknown', params: { allowed: ['dimensions'] } });
    expect(one(null)).toMatchObject({ path: 'commands[0].dimensions[1]', code: 'type-invalid' });
    expect(one({ ...chain, id: 'c' })).toMatchObject({ path: 'commands[0].dimensions[1].id', code: 'command-field-unknown' });
    const { at: _at, ...noAt } = chain;
    expect(one(noAt)).toMatchObject({ path: 'commands[0].dimensions[1].at', code: 'missing-field' });
    expect(one({ ...chain, horizontal: 'yes' })).toMatchObject({ path: 'commands[0].dimensions[1].horizontal', code: 'type-invalid' });
    expect(one({ ...chain, start: '0' })).toMatchObject({ path: 'commands[0].dimensions[1].start', code: 'type-invalid' });
    expect(one({ ...chain, segments: 3000 })).toMatchObject({ path: 'commands[0].dimensions[1].segments', code: 'type-invalid' });
    expect(one({ ...chain, segments: [] })).toMatchObject({ path: 'commands[0].dimensions[1].segments', code: 'dimension-no-segments' });
    expect(one({ ...chain, segments: [100, '5'] })).toMatchObject({ path: 'commands[0].dimensions[1].segments[1]', code: 'type-invalid' });
    expect(one({ ...chain, segments: [100, 0] })).toMatchObject({ path: 'commands[0].dimensions[1].segments[1]', code: 'size-not-positive' });
    expect(one({ ...chain, segments: [-100] })).toMatchObject({ path: 'commands[0].dimensions[1].segments[0]', code: 'size-not-positive' });
  });
  it('refuses a chain that is too far away, a list with a hole, and an inherited field (found in a review)', () => {
    const one = (value: unknown) => refused([{ op: 'set_dimensions', dimensions: [value] }]);
    // Very large numbers are finite one by one, but their sum is not, and the view of the plan would have no size.
    expect(one({ ...chain, segments: [1e308, 1e308] })).toMatchObject({ path: 'commands[0].dimensions[0].segments[0]', code: 'value-out-of-range', params: { max: 1_000_000 } });
    expect(one({ ...chain, at: -1_000_001 })).toMatchObject({ path: 'commands[0].dimensions[0].at', code: 'value-out-of-range' });
    expect(one({ ...chain, start: 1_000_001 })).toMatchObject({ path: 'commands[0].dimensions[0].start', code: 'value-out-of-range' });
    expect(one({ ...chain, start: 999_000, segments: [500, 501] })).toMatchObject({ path: 'commands[0].dimensions[0].segments[1]', code: 'value-out-of-range' });
    // At the edge of the reach, in a plan with no walls (there the chains can be anywhere, but their box is 100 m at most).
    expect(ok([{ op: 'set_dimensions', dimensions: [{ ...chain, at: 1_000_000, start: 900_000, segments: [100_000] }] }], createEmptyPlan('e')).plan.dimensions).toHaveLength(1);
    expect(refused([{ op: 'set_dimensions', dimensions: [{ ...chain, at: 1_000_000, start: 800_000, segments: [100_001] }] }], createEmptyPlan('e'))).toMatchObject({ path: 'commands[0].dimensions', code: 'annotation-out-of-range' });
    // JSON has no list with a hole, but a caller of the core can make one.
    expect(refused([{ op: 'set_dimensions', dimensions: new Array(1) }])).toMatchObject({ path: 'commands[0].dimensions[0]', code: 'type-invalid' });
    const holes = new Array(2); holes[1] = 100;
    expect(one({ ...chain, segments: holes })).toMatchObject({ path: 'commands[0].dimensions[0].segments[0]', code: 'type-invalid' });
    const { segments: _segments, ...rest } = chain;
    expect(one(Object.assign(Object.create({ segments: [100] }), rest))).toMatchObject({ path: 'commands[0].dimensions[0].segments', code: 'missing-field' });
    expect(refused([Object.assign(Object.create({ dimensions: [] }), { op: 'set_dimensions' })])).toMatchObject({ path: 'commands[0].dimensions', code: 'missing-field' });
  });
  it('scale_plan refuses a result with a chain out of reach or with a length of 0 (found in a review)', () => {
    // Each scaled length is finite, but the end of the chain is not.
    const empty = createEmptyPlan('e');                              // no wall: only the chains can stop the scaling
    // A chain of 1000 m is from a file: set_dimensions refuses it (the far level of the validator).
    const long = { ...empty, dimensions: [{ horizontal: true, at: 0, start: 0, segments: Array(100).fill(10000) }] };
    const far = refused([{ op: 'set_plan_name', name: 'n' }, { op: 'scale_plan', factor: 1e303, pivot: [0, 0] }], long);
    expect(far).toMatchObject({ commandIndex: 1, code: 'scale-result-invalid' });
    expect((far.params.issues as CommandIssue[])[0]).toMatchObject({ path: 'dimensions[0]', code: 'value-out-of-range' });
    expect((refused([{ op: 'scale_plan', factor: 1.01, pivot: [0, 0] }], long).params.issues as CommandIssue[])[0].path).toBe('dimensions[0]');
    const small = { op: 'set_dimensions', dimensions: [{ ...chain, segments: [3000, 0.4] }] };
    const zero = refused([small, { op: 'scale_plan', factor: 0.1, pivot: [0, 0] }], empty);
    expect((zero.params.issues as CommandIssue[])[0]).toMatchObject({ path: 'dimensions[0].segments[1]', code: 'size-not-positive' });
    // A chain that a file already has out of reach, or with a length of 0, does not block a scaling that makes it no worse.
    const loose = { ...empty, dimensions: [{ horizontal: true, at: 0, start: 0, segments: [3_000_000, 0] }] };
    expect(ok([{ op: 'scale_plan', factor: 0.5, pivot: [0, 0] }], loose).plan.dimensions![0].segments).toEqual([1_500_000, 0]);
    expect(refused([{ op: 'scale_plan', factor: 1.5, pivot: [0, 0] }], loose).code).toBe('scale-result-invalid');
    // With no physical content, the box around the annotations is the measure: the two-point form with the same distance changes nothing.
    const box = { ...empty, measurements: [{ id: 'm', a: { x: 0, y: 0 }, b: { x: 150_000, y: 0 } }] };
    expect(ok([{ op: 'scale_plan', a: [0, 0], b: [150_000, 0], distance: 150_000 }], box).plan.measurements![0].b.x).toBe(150_000);
    expect(ok([{ op: 'scale_plan', factor: 0.5, pivot: [0, 0] }], box).warnings).toEqual([]);
    expect((refused([{ op: 'scale_plan', factor: 1.1, pivot: [0, 0] }], box).params.issues as CommandIssue[])[0]).toMatchObject({ path: 'measurements', code: 'annotation-out-of-range' });
    // A chain of a file that is already not finite stays refused when the scaled result is not finite: "no worse" is for finite values.
    const overflow = { ...empty, dimensions: [{ horizontal: true, at: 0, start: 0, segments: Array(100).fill(1e307) }] };
    expect((refused([{ op: 'scale_plan', factor: 0.5, pivot: [0, 0] }], overflow).params.issues as CommandIssue[])[0]).toMatchObject({ path: 'dimensions[0]', code: 'value-out-of-range' });
    // A negative length of a file: an end in the middle of the chain counts, not only the last end.
    const back = { ...empty, dimensions: [{ horizontal: true, at: 0, start: 0, segments: [900_000, -900_000] }] };
    expect(refused([{ op: 'scale_plan', factor: 1.2, pivot: [0, 0] }], back).code).toBe('scale-result-invalid');
  });
  it('a new chain far from the plan: a warning at the near level, a refusal at the far level; scale_plan follows the same levels', () => {
    // base() is a plan of 8 m. Near level: more than 20 m outside its walls. Far level: more than 100 m outside.
    const at = (y: number) => [{ op: 'set_dimensions', dimensions: [{ ...chain, at: y }] }];
    expect(ok(at(-600)).warnings.filter(w => w.code.startsWith('annotation'))).toEqual([]);
    expect(ok(at(-30_000)).warnings.filter(w => w.code.startsWith('annotation'))).toMatchObject([{ commandIndex: 0, path: 'dimensions[0]', code: 'annotation-far-from-plan' }]);
    expect(refused(at(-150_000))).toMatchObject({ path: 'commands[0].dimensions[0]', code: 'annotation-out-of-range', params: { limit: 100_000, finite: true } });
    // An old measurement of the plan that is far away does not make a new chain wrong.
    const old = { ...base(), measurements: [{ id: 'm', a: { x: 0, y: 0 }, b: { x: 500_000, y: 0 } }] };
    expect(ok(at(-600), old).plan.dimensions).toHaveLength(1);
    // The limits are fixed lengths: a scaling can move an annotation over them. Near: a warning. Far: refused, if new or worse.
    const measured = (x: number) => ({ ...base(), measurements: [{ id: 'm', a: { x: 0, y: 0 }, b: { x, y: 0 } }] });
    expect(ok([{ op: 'scale_plan', factor: 2, pivot: [0, 0] }], measured(20_000)).warnings.map(w => w.code)).toContain('annotation-far-from-plan');
    const moved = refused([{ op: 'scale_plan', factor: 3, pivot: [0, 0] }], measured(50_000));
    expect((moved.params.issues as CommandIssue[]).map(i => [i.path, i.code])).toContainEqual(['measurements[0]', 'annotation-out-of-range']);
    // Already at the far level in the file: a scaling that brings it nearer is accepted, one that moves it farther is refused.
    expect(ok([{ op: 'scale_plan', factor: 0.9, pivot: [0, 0] }], measured(500_000)).plan.measurements![0].b.x).toBe(450_000);
    expect(refused([{ op: 'scale_plan', factor: 1.1, pivot: [0, 0] }], measured(500_000)).code).toBe('scale-result-invalid');
  });
  it('the chains scale with the plan in a later command of the same batch', () => {
    const result = ok([{ op: 'set_dimensions', dimensions: [chain] }, { op: 'scale_plan', factor: 2, pivot: [0, 0] }]);
    expect(result.plan.dimensions).toEqual([{ horizontal: true, at: -1200, start: 0, segments: [6000, 10000] }]);
  });
});

describe('set_ceiling_height', () => {
  it('sets the ceiling; refuses a value out of range or below an opening head', () => {
    expect(ok([{ op: 'set_ceiling_height', ceilingHeight: 2600 }]).plan.ceilingHeight).toBe(2600);
    expect(refused([{ op: 'set_ceiling_height', ceilingHeight: 2300 }])).toMatchObject({ code: 'opening-head-above-ceiling', params: { openingId: 'win', head: 2400 } });
    expect(refused([{ op: 'set_ceiling_height', ceilingHeight: 7000 }]).code).toBe('height-out-of-range');
  });
});

describe('scale_plan (roadmap D3)', () => {
  const multipleOfTenth = (v: number) => Math.abs(v * 10 - Math.round(v * 10)) < 1e-6;
  it('scales the D3 fields about the pivot and keeps the others', () => {
    const plan = { ...base(), rooms: base().rooms.map(r => ({ ...r, at: [3000, 2000] as [number, number] })), furniture: [{ id: 'f', type: 'sofa', name: 'S', cx: 3000, cy: 2000, w: 2000, d: 900, rot: 30 }],
      measurements: [{ id: 'm', a: { x: 0, y: 0 }, b: { x: 1000, y: 500 } }], dimensions: [{ horizontal: true, at: -500, start: 0, segments: [1000, 5000] }] };
    const result = ok([{ op: 'scale_plan', factor: 2, pivot: [0, 0] }], plan);
    const p = result.plan;
    expect(wall(p, 'w1')).toEqual({ id: 'w1', type: 'e', a: [0, 0], b: [12000, 0], thickness: 400 });
    expect(opening(p, 'd1')).toEqual({ ...base().openings[1], offset: 6000, width: 1800 });
    expect(opening(p, 'win')).toMatchObject({ offset: 2000, width: 2400, sill: 900, head: 2400 });
    expect(p.rooms[0].poly).toEqual([[200, 200], [11880, 200], [11880, 7880], [200, 7880]]);
    expect(p.rooms[0].at).toEqual([6000, 4000]);
    expect(p.furniture[0]).toEqual({ id: 'f', type: 'sofa', name: 'S', cx: 6000, cy: 4000, w: 2000, d: 900, rot: 30 });
    expect(p.measurements).toEqual([{ id: 'm', a: { x: 0, y: 0 }, b: { x: 2000, y: 1000 } }]);
    expect(p.dimensions).toEqual([{ horizontal: true, at: -1000, start: 0, segments: [2000, 10000] }]);
    expect([p.ceilingHeight, p.materials]).toEqual([2800, base().materials]);
    expect(result.notes).toEqual([{ commandIndex: 0, code: 'plan-scaled', params: { factor: 2, pivot: [0, 0] } }]);
  });
  it('two points and their real distance give the factor, with the first point as the pivot', () => {
    const result = ok([{ op: 'scale_plan', a: [6000, 0], b: [6000, 4000], distance: 4400 }]);
    expect(result.notes[0].params).toEqual({ factor: 1.1, pivot: [6000, 0] });
    expect(wall(result.plan, 'w1')).toMatchObject({ a: [-600, 0], b: [6000, 0], thickness: 220 });
  });
  it('the sample scaled by an odd factor about an odd pivot: values are multiples of 0.1 mm, and no new issue appears', () => {
    const sample = createSamplePlan('s');
    const result = ok([{ op: 'scale_plan', factor: 1.0371, pivot: [123.45, 678.9] }], sample);
    expect(result.warnings).toEqual([]);
    const p = result.plan, values = [...p.walls.flatMap(w => [...w.a, ...w.b, w.thickness]), ...p.openings.flatMap(o => [o.offset, o.width]), ...p.rooms.flatMap(r => r.poly.flat()), ...p.furniture.flatMap(f => [f.cx, f.cy])];
    expect(values.every(multipleOfTenth)).toBe(true);
    // An opening that filled its wall piece still ends at the wall end.
    const full = sample.openings.filter(o => o.offset + o.width === wallLength(wall(sample, o.wallId)));
    expect(full.length).toBeGreaterThan(10);
    for (const o of full) { const s = opening(p, o.id); expect(Math.abs(s.offset + s.width - wallLength(wall(p, o.wallId)))).toBeLessThan(1e-6); }
  });
  it('refuses a factor of 0, the same two points, and a result with errors, with no change', () => {
    expect(refused([{ op: 'scale_plan', factor: 0, pivot: [0, 0] }])).toMatchObject({ path: 'commands[0].factor', code: 'size-not-positive' });
    expect(refused([{ op: 'scale_plan', a: [1, 1], b: [1, 1], distance: 100 }]).code).toBe('scale-points-same');
    expect(refused([{ op: 'scale_plan', factor: 2, pivot: [0, 0], a: [0, 0] }]).code).toBe('command-field-unknown');
    const thick = refused([{ op: 'scale_plan', factor: 6, pivot: [0, 0] }]);
    expect(thick).toMatchObject({ path: 'commands[0]', code: 'scale-result-invalid' });
    expect((thick.params.issues as { code: string }[]).map(i => i.code)).toContain('thickness-out-of-range');
  });
  it('refuses a result larger than 100 × 100 m, although a saved plan only warns about the size', () => {
    const thin = { ...base(), walls: base().walls.map(w => ({ ...w, thickness: 20 })) };
    const large = refused([{ op: 'scale_plan', factor: 20, pivot: [0, 0] }], thin);
    expect((large.params.issues as { code: string }[]).map(i => i.code)).toEqual(['plan-too-large']);
  });
});

describe('decimal lengths through wall changes', () => {
  // 2000.3 − 1000.1 − 1000.2 is −1.1e−13 in binary floating point.
  const decimal = (): PlanV2 => ({ ...base(), rooms: [],
    walls: [{ id: 'w', type: 'n', a: [0, 0], b: [2000.3, 0], thickness: 100 }],
    openings: [{ id: 'o', type: 'door', wallId: 'w', offset: 1000.1, width: 1000.2, hinge: 'start', swing: 'right', head: 2100 }] });
  it('the plan is valid as it is', () => expect(validatePlan(decimal(), 'import').errors).toEqual([]));
  it('reverse_wall gives offset 0, and reversing twice gives back the exact plan', () => {
    expect(opening(ok([{ op: 'reverse_wall', wallId: 'w' }], decimal()).plan, 'o')).toMatchObject({ offset: 0, hinge: 'end', swing: 'left' });
    expect(ok([{ op: 'reverse_wall', wallId: 'w' }, { op: 'reverse_wall', wallId: 'w' }], decimal()).plan).toEqual(decimal());
  });
  it('move_wall_end gives clean offsets, also to exactly 0', () => {
    expect(opening(ok([{ op: 'move_wall_end', wallId: 'w', end: 'a', to: [1000.1, 0] }], decimal()).plan, 'o').offset).toBe(0);
    expect(opening(ok([{ op: 'move_wall_end', wallId: 'w', end: 'a', to: [-0.2, 0] }], decimal()).plan, 'o').offset).toBe(1000.3);
    expect(refused([{ op: 'move_wall_end', wallId: 'w', end: 'a', to: [1000.2, 0] }], decimal()).code).toBe('opening-outside-wall');
  });
  it('split_wall at the opening start, and join_walls after it, give clean values and the exact plan back', () => {
    const split = ok([{ op: 'split_wall', wallId: 'w', at: [1000.1, 0], newId: 'w2' }], decimal()).plan;
    expect(opening(split, 'o')).toMatchObject({ wallId: 'w2', offset: 0 });
    expect(ok([{ op: 'split_wall', wallId: 'w', at: [1000.1, 0], newId: 'w2' }, { op: 'join_walls', wallId: 'w', otherId: 'w2' }], decimal()).plan).toEqual(decimal());
    expect(ok([{ op: 'split_wall', wallId: 'w', at: [1000.1, 0], newId: 'w2' }, { op: 'reverse_wall', wallId: 'w2' }, { op: 'join_walls', wallId: 'w', otherId: 'w2' }], decimal()).plan).toEqual(decimal());
  });
  it('split_wall in a wall that starts at a decimal point gives a clean offset', () => {
    const shifted = decimal(); shifted.walls[0] = { ...shifted.walls[0], a: [0.2, 0], b: [2000.5, 0] };
    expect(1000.1 - (1000.3 - 0.2)).not.toBe(0);
    expect(opening(ok([{ op: 'split_wall', wallId: 'w', at: [1000.3, 0], newId: 'w2' }], shifted).plan, 'o')).toMatchObject({ wallId: 'w2', offset: 0 });
  });
  it('split_wall exactly at an opening start whose distance comes out a little larger in binary', () => {
    const plan = decimal(); plan.walls[0] = { ...plan.walls[0], a: [5.6, 0], b: [2005.6, 0] }; plan.openings[0] = { ...plan.openings[0], offset: 2.7, width: 500 };
    expect(8.3 - 5.6 > 2.7).toBe(true);
    expect(opening(ok([{ op: 'split_wall', wallId: 'w', at: [8.3, 0], newId: 'w2' }], plan).plan, 'o')).toMatchObject({ wallId: 'w2', offset: 0 });
  });
  it('resize_opening keeping the end gives a clean offset', () => {
    expect(opening(ok([{ op: 'resize_opening', openingId: 'o', width: 500, keep: 'end' }], decimal()).plan, 'o')).toMatchObject({ offset: 1500.3, width: 500 });
  });
  it('an input offset below 0 is still refused, however small', () => {
    expect(refused([{ op: 'move_opening', openingId: 'o', offset: -1e-9 }], decimal()).code).toBe('value-out-of-range');
    const negative = decimal(); negative.openings[0].offset = -1e-9;
    expect(validatePlan(negative, 'import').errors.map(e => e.code)).toEqual(['value-out-of-range']);
  });
});

describe('existing tolerable issues on the changed item (Step C follow-up)', () => {
  // The issue is already in the saved plan; the command is checked against the item just before it.
  const withDoorHead = (head: number) => { const plan = base(); (plan.openings[1] as DoorV2).head = head; return plan; };
  const err = (commands: unknown[], plan: PlanV2) => { const e = refused(commands, plan); return [e.commandIndex, e.path, e.code]; };

  it('heights: an unrelated edit keeps the issue; a partial repair is accepted; a worse or new value is refused on the field that changed it', () => {
    const plan = withDoorHead(2900);                                             // above the 2800 ceiling: a saved warning
    expect(validatePlan(plan, 'saved').warnings.map(w => w.code)).toEqual(['height-out-of-range']);
    for (const command of [{ op: 'update_opening', openingId: 'd1', name: 'x' }, { op: 'move_opening', openingId: 'd1', offset: 3000 },
      { op: 'move_opening', openingId: 'd1', offset: 3500 }, { op: 'resize_opening', openingId: 'd1', width: 800 }, { op: 'update_opening', openingId: 'd1', head: 2850 }]) ok([command], plan);
    expect(err([{ op: 'update_opening', openingId: 'd1', head: 3000 }], plan)).toEqual([0, 'commands[0].head', 'height-out-of-range']);
    expect(err([{ op: 'update_opening', openingId: 'd1', head: 2900 }], base())).toEqual([0, 'commands[0].head', 'height-out-of-range']);
    // In a batch, each command is compared with the state just before it: a repair cannot be undone in part.
    expect(err([{ op: 'update_opening', openingId: 'd1', head: 2850 }, { op: 'update_opening', openingId: 'd1', head: 2900 }], plan)).toEqual([1, 'commands[1].head', 'height-out-of-range']);
  });
  it('a window sill at or above its head: valid to invalid is refused (also equal); a smaller gap is accepted; the field that changed is named', () => {
    const plan = base(); Object.assign(plan.openings[0], { sill: 2500, head: 2400 });
    ok([{ op: 'update_opening', openingId: 'win', name: 'x' }], plan);
    ok([{ op: 'update_opening', openingId: 'win', sill: 2450 }], plan);
    ok([{ op: 'update_opening', openingId: 'win', sill: 2000 }], plan);
    expect(err([{ op: 'update_opening', openingId: 'win', sill: 2600 }], plan)).toEqual([0, 'commands[0].sill', 'window-sill-not-below-head']);
    expect(err([{ op: 'update_opening', openingId: 'win', head: 2300 }], plan)).toEqual([0, 'commands[0].head', 'window-sill-not-below-head']);
    expect(err([{ op: 'update_opening', openingId: 'win', sill: 2400 }], base())).toEqual([0, 'commands[0].sill', 'window-sill-not-below-head']);
  });
  it('a type change checks the heights as new; a default height is reported on `type`', () => {
    const plan = withDoorHead(1500);                                             // below the 1800 door minimum
    ok([{ op: 'update_opening', openingId: 'd1', name: 'x' }], plan);
    expect(err([{ op: 'change_opening_type', openingId: 'd1', type: 'hole', head: 1500 }], plan)).toEqual([0, 'commands[0].head', 'height-out-of-range']);
    const low = base(); low.ceilingHeight = 2000;                                // the default window head 2400 is above it
    expect(err([{ op: 'add_opening', type: 'window', wallId: 'w2', offset: 500, width: 800 }], low)).toEqual([0, 'commands[0].type', 'height-out-of-range']);
  });
  it('overlap: an existing pair can stay or shrink, not grow; a new pair is refused, on wallId after a move to another wall', () => {
    const plan = base(); plan.openings.push({ id: 'win2', type: 'window', wallId: 'w1', offset: 2000, width: 600, sill: 900, head: 2400 }); // 200 into `win`
    expect(validatePlan(plan, 'saved').warnings.map(w => w.code)).toEqual(['openings-overlap']);
    ok([{ op: 'update_opening', openingId: 'win2', name: 'x' }], plan);
    ok([{ op: 'move_opening', openingId: 'win2', offset: 2100 }], plan);
    ok([{ op: 'resize_opening', openingId: 'win2', width: 500 }], plan);
    expect(err([{ op: 'move_opening', openingId: 'win2', offset: 1900 }], plan)).toEqual([0, 'commands[0].offset', 'openings-overlap']);
    expect(err([{ op: 'move_opening', openingId: 'win2', offset: 2100 }, { op: 'move_opening', openingId: 'win2', offset: 2050 }], plan)).toEqual([1, 'commands[1].offset', 'openings-overlap']);
    expect(err([{ op: 'move_opening', openingId: 'win2', offset: 2500 }], plan)).toEqual([0, 'commands[0].offset', 'openings-overlap']); // 100 into the door
    const two = base(); two.openings.push({ id: 'd2', type: 'door', wallId: 'w2', offset: 1000, width: 900, hinge: 'start', swing: 'left', head: 2100 });
    expect(err([{ op: 'move_opening', openingId: 'd1', wallId: 'w2', offset: 1500 }], two)).toEqual([0, 'commands[0].wallId', 'openings-overlap']);
  });
  it('a window in a low wall: kept by edits in place; a move into a low wall or a type change to window there is refused', () => {
    const plan = base(); plan.openings.push({ id: 'lw', type: 'window', wallId: 'w3', offset: 1000, width: 800, sill: 0, head: 900 },
      { id: 'd3', type: 'door', wallId: 'w3', offset: 3000, width: 900, hinge: 'start', swing: 'left', head: 2100 });
    expect(validatePlan(plan, 'saved').warnings.map(w => w.code)).toEqual(['window-in-low-wall']);
    ok([{ op: 'update_opening', openingId: 'lw', name: 'x' }, { op: 'resize_opening', openingId: 'lw', width: 700 }, { op: 'move_opening', openingId: 'lw', offset: 1200 }], plan);
    expect(err([{ op: 'move_opening', openingId: 'win', wallId: 'w3', offset: 4500 }], plan)).toEqual([0, 'commands[0].wallId', 'window-in-low-wall']);
    expect(err([{ op: 'change_opening_type', openingId: 'd3', type: 'window', sill: 0, head: 900 }], plan)).toEqual([0, 'commands[0].type', 'window-in-low-wall']);
  });
  it('rooms: an outline that crosses itself or a missing material stays for other edits; a new outline or material must be valid; a small area can grow, not shrink', () => {
    const crossing = base(); crossing.rooms[0].poly = [[100, 100], [5940, 3940], [5940, 100], [100, 3940]];
    ok([{ op: 'update_room', roomId: 'r1', name: 'x' }], crossing);
    expect(err([{ op: 'update_room', roomId: 'r1', poly: [[100, 100], [3000, 3940], [3000, 100], [100, 3940]] }], crossing)).toEqual([0, 'commands[0].poly', 'room-self-crossing']);
    ok([{ op: 'update_room', roomId: 'r1', poly: [[100, 100], [5940, 100], [5940, 3940], [100, 3940]] }], crossing);
    const missing = base(); missing.rooms[0].mat = 'stone';
    ok([{ op: 'update_room', roomId: 'r1', name: 'x' }], missing);
    expect(err([{ op: 'update_room', roomId: 'r1', mat: 'marble' }], missing)).toEqual([0, 'commands[0].mat', 'room-material-missing']);
    const small = base(); small.rooms[0].poly = [[100, 100], [150, 100], [150, 150], [100, 150]];   // 50 × 50 mm, under the 100 × 100 minimum
    ok([{ op: 'update_room', roomId: 'r1', name: 'x' }], small);
    ok([{ op: 'update_room', roomId: 'r1', poly: [[100, 100], [180, 100], [180, 180], [100, 180]] }], small);
    expect(err([{ op: 'update_room', roomId: 'r1', poly: [[100, 100], [140, 100], [140, 140], [100, 140]] }], small)).toEqual([0, 'commands[0].poly', 'room-area-too-small']);
  });
  it('set_ceiling_height: a head already above the ceiling does not block a ceiling that comes closer to it; a lower one is refused', () => {
    const plan = withDoorHead(2900);                                             // 100 above the 2800 ceiling
    expect(ok([{ op: 'set_ceiling_height', ceilingHeight: 2850 }], plan).plan.ceilingHeight).toBe(2850);
    expect(ok([{ op: 'set_ceiling_height', ceilingHeight: 3000 }], plan).warnings).toEqual([]);
    expect(refused([{ op: 'set_ceiling_height', ceilingHeight: 2750 }], plan)).toMatchObject({ path: 'commands[0].ceilingHeight', code: 'opening-head-above-ceiling', params: { openingId: 'd1', head: 2900 } });
    // The window head 2400 was below the ceiling, so a ceiling under it is new and refused.
    expect(refused([{ op: 'set_ceiling_height', ceilingHeight: 2300 }], plan)).toMatchObject({ code: 'opening-head-above-ceiling', params: { openingId: 'win', head: 2400 } });
  });
  it('new items stay strict', () => {
    expect(err([{ op: 'add_opening', type: 'door', wallId: 'w2', offset: 500, width: 800, hinge: 'start', swing: 'left', head: 2900 }], base())).toEqual([0, 'commands[0].head', 'height-out-of-range']);
    expect(err([{ op: 'add_room', name: 'x', mat: 'stone', poly: [[0, 0], [1000, 0], [1000, 1000], [0, 1000]] }], base())).toEqual([0, 'commands[0].mat', 'room-material-missing']);
  });
});
