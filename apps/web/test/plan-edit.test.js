import { describe, expect, it } from 'vitest';
import { applyCommands, createEmptyPlan, createSamplePlan, wallLength } from 'open-plan-core';
import { addOpeningCommand, distanceAlong, dragOffset, joinCandidates, newWallThickness, OPENING_DEFAULTS, openingTypeCommand, openingTypeFields, runEdit, snapWallPoint, wallEnd, wallHeading, wallLengthCommand, wallPoint } from '../src/floorplan/planEdit.js';
import { editMessages, editNoteLines } from '../src/floorplan/issueMessages.js';

// Editing in the editor through the core commands (roadmap D4a): the editor builds the commands, and the core decides.
const wall = (id, a, b, more = {}) => ({ id, type: 'n', a, b, thickness: 120, ...more });
const plan = (walls, openings = []) => ({ ...createEmptyPlan(), walls, openings });
const door = (id, wallId, offset) => ({ id, type: 'door', wallId, offset, width: 900, hinge: 'start', swing: 'left', head: 2100 });

describe('edits through the core commands', () => {
  it('runEdit: ok with the plan, notes and the warnings of the commands; same; refused with no plan', () => {
    const p = plan([wall('w1', [0, 0], [4000, 0])], [door('d1', 'w1', 500)]);
    const deleted = runEdit(p, [{ op: 'delete_wall', wallId: 'w1' }]);
    expect([deleted.status, deleted.plan.walls.length, deleted.plan.openings.length, deleted.notes.map(n => n.code)]).toEqual(['ok', 0, 0, ['openings-deleted']]);
    expect(runEdit(p, [{ op: 'update_wall', wallId: 'w1', thickness: 120 }]).status).toBe('same');
    const refused = runEdit(p, [{ op: 'update_wall', wallId: 'w1', thickness: 5000 }]);
    expect([refused.status, refused.plan, refused.errors[0].code]).toEqual(['refused', undefined, 'thickness-out-of-range']);
    expect(p.walls[0].thickness).toBe(120);
  });
  it('a new length moves the chosen end along the wall line, for each direction of the wall; the other end stays', () => {
    for (const [a, b] of [[[0, 0], [4000, 0]], [[4000, 0], [0, 0]], [[0, 0], [0, 4000]], [[0, 4000], [0, 0]]]) {
      for (const end of ['a', 'b']) {
        const p = plan([wall('w1', a, b)]), result = runEdit(p, [wallLengthCommand(p.walls[0], end, 3000)]);
        const moved = result.plan.walls[0], kept = end === 'a' ? 'b' : 'a';
        expect([result.status, wallLength(moved), moved[kept]]).toEqual(['ok', 3000, p.walls[0][kept]]);
      }
    }
  });
  it('a shorter wall that would leave an opening outside is refused, with a message in zh-TW and no command path', () => {
    const p = plan([wall('w1', [0, 0], [4000, 0])], [door('d1', 'w1', 3000)]);
    const refused = runEdit(p, [wallLengthCommand(p.walls[0], 'b', 3500)]);
    expect(refused.status).toBe('refused');
    const lines = editMessages(refused.errors);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('超出牆的長度');
    expect(lines[0]).not.toContain('commands[');
    expect(editMessages(runEdit(p, [{ op: 'update_wall', wallId: 'w1', thickness: 5000 }]).errors)[0]).toMatch(/^厚度：/);
  });
  it('split: the point at a distance from a; a point in an opening is refused', () => {
    const p = plan([wall('w1', [0, 1000], [0, 5000])], [door('d1', 'w1', 1000)]);
    expect(wallPoint(p.walls[0], 2500)).toEqual([0, 3500]);
    const split = runEdit(p, [{ op: 'split_wall', wallId: 'w1', at: wallPoint(p.walls[0], 2500) }]);
    expect([split.status, split.plan.walls.map(w => wallLength(w))]).toEqual(['ok', [2500, 1500]]);
    const inDoor = runEdit(p, [{ op: 'split_wall', wallId: 'w1', at: wallPoint(p.walls[0], 1500) }]);
    expect([inDoor.status, editMessages(inDoor.errors)[0]]).toEqual(['refused', '分割位置在開口「d1」裡面']);
  });
  it('join candidates are exactly the walls that the join command accepts', () => {
    const p = plan([wall('w1', [0, 0], [2000, 0]), wall('touch', [2000, 0], [5000, 0]), wall('gap', [6000, 0], [8000, 0]), wall('thick', [-1000, 0], [0, 0], { thickness: 200 }),
      wall('type', [-2000, 0], [0, 0], { type: 'b' }), wall('corner', [0, 0], [0, 3000]), wall('parallel', [0, 500], [2000, 500])]);
    expect(joinCandidates(p, 'w1').map(w => w.id)).toEqual(['touch']);
    for (const other of p.walls.slice(1)) expect(applyCommands(p, [{ op: 'join_walls', wallId: 'w1', otherId: other.id }]).ok).toBe(other.id === 'touch');
    expect(joinCandidates(p, 'none')).toEqual([]);
  });
  it('a new wall: the thickness of the nearest wall, or 120 mm with no wall; the end from a direction and a length', () => {
    const p = plan([wall('thin', [0, 0], [4000, 0], { thickness: 100 }), wall('thick', [0, 5000], [4000, 5000], { thickness: 240 })]);
    expect([newWallThickness(p, [2000, 300]), newWallThickness(p, [2000, 4000]), newWallThickness(plan([]), [0, 0])]).toEqual([100, 240, 120]);
    expect([wallEnd([100, 200], 'right', 3000), wallEnd([100, 200], 'left', 3000), wallEnd([100, 200], 'down', 3000), wallEnd([100, 200], 'up', 3000)]).toEqual([[3100, 200], [-2900, 200], [100, 3200], [100, -2800]]);
  });
  it('add-wall points: the first goes to a near wall end or the 10 mm grid; the second makes a horizontal or vertical wall to the line of a near wall end', () => {
    const p = plan([wall('w1', [0, 0], [4000, 0]), wall('w2', [4000, 0], [4000, 3000])]);
    expect([snapWallPoint([3990, 12], p, 50), snapWallPoint([2003, 1504], p, 50)]).toEqual([[4000, 0], [2000, 1500]]);
    expect(snapWallPoint([3980, 3040], p, 50, [0, 3000])).toEqual([4000, 3000]);          // horizontal, to the line of the end of w2
    expect(snapWallPoint([2504, 3300], p, 50, [0, 3000])).toEqual([2500, 3000]);          // horizontal, on the grid
    expect(snapWallPoint([40, 5503], p, 50, [0, 3000])).toEqual([0, 5500]);               // vertical
    const added = runEdit(p, [{ op: 'add_wall', type: 'n', a: [0, 3000], b: snapWallPoint([3980, 3040], p, 50, [0, 3000]), thickness: 120 }]);
    expect([added.status, added.notes[0].code]).toEqual(['ok', 'id-generated']);
  });
  it('notes of an edit: deleted openings, and the rooms whose outline lost its wall', () => {
    const sample = createSamplePlan(), target = sample.walls.find(w => sample.openings.some(o => o.wallId === w.id));
    const result = runEdit(sample, [{ op: 'delete_wall', wallId: target.id }]);
    const also = editNoteLines(result), count = sample.openings.filter(o => o.wallId === target.id).length;
    expect(also.lines[0]).toBe(`牆上的 ${count} 個開口也一併刪除了。`);
    expect(also.roomIds.every(id => sample.rooms.some(r => r.id === id))).toBe(true);
    expect(editNoteLines({ notes: [], warnings: [{ path: 'rooms[0].poly', code: 'room-edge-off-wall', params: { roomId: 'r1' } }, { path: 'rooms[0].poly', code: 'room-edge-off-wall', params: { roomId: 'r1' } }] })).toEqual({ lines: ['有 1 個空間的外框不再貼著牆面；空間外框不會自動調整，請檢查。'], roomIds: ['r1'] });
  });
});

// Openings (roadmap D4b): the core gives no width, hinge or swing, and no heights for a change of type, so the editor
// supplies them. Each command below is run by the core, which decides.
describe('openings through the core commands', () => {
  const TYPES = ['door', 'window', 'sliding-door', 'hole'];
  const windowAt = (id, wallId, offset) => ({ id, type: 'window', wallId, offset, width: 1000, sill: 900, head: 2400 });
  it('a new opening of each type: the default width, in the free part nearest to the wall centre, accepted by the core', () => {
    const p = plan([wall('w1', [0, 0], [5000, 0])]);
    for (const type of TYPES) {
      const command = addOpeningCommand(p, p.walls[0], type), result = runEdit(p, [command]);
      expect([type, result.status, command.offset, command.width]).toEqual([type, 'ok', (5000 - OPENING_DEFAULTS[type].width) / 2, OPENING_DEFAULTS[type].width]);
      const added = result.plan.openings[0];
      expect(Object.keys(added).sort()).toEqual({ door: ['head', 'hinge', 'id', 'offset', 'swing', 'type', 'wallId', 'width'], window: ['head', 'id', 'offset', 'sill', 'type', 'wallId', 'width'] }[type] ?? ['head', 'id', 'offset', 'type', 'wallId', 'width']);
    }
  });
  it('a new opening goes beside an opening that has the centre; a wall with no free part long enough gets no command', () => {
    const p = plan([wall('w1', [0, 0], [5000, 0])], [door('d1', 'w1', 2000)]);                    // the door has 2000 to 2900
    const beside = addOpeningCommand(p, p.walls[0], 'door');
    expect([beside.offset, runEdit(p, [beside]).status]).toEqual([2900, 'ok']);                     // the centred place is 2050: 2900 is nearer than 1100
    const short = plan([wall('w1', [0, 0], [800, 0])]), full = plan([wall('w1', [0, 0], [2000, 0])], [door('d1', 'w1', 600)]);
    expect([addOpeningCommand(short, short.walls[0], 'door'), addOpeningCommand(full, full.walls[0], 'window')]).toEqual([null, null]);
    expect(addOpeningCommand(full, full.walls[0], 'door')).toBe(null);                              // 600 before the door and 500 after it
    const exact = plan([wall('w1', [0, 0], [900, 0])]);
    expect(runEdit(exact, [addOpeningCommand(exact, exact.walls[0], 'hole')]).status).toBe('ok');
  });
  it('a change of type sends every field of the new type, for each pair of types; the core accepts it', () => {
    const p = plan([wall('w1', [0, 0], [5000, 0])]);
    for (const from of TYPES) {
      const made = runEdit(p, [{ ...addOpeningCommand(p, p.walls[0], from), id: 'o1' }]).plan;
      for (const to of TYPES.filter(t => t !== from)) {
        const result = runEdit(made, [openingTypeCommand(made, made.openings[0], to)]);
        expect([from, to, result.status, result.plan?.openings[0].type]).toEqual([from, to, 'ok', to]);
        expect(result.plan.openings[0].width).toBe(made.openings[0].width);
      }
    }
  });
  it('type fields: a door, a sliding door and a hole keep the head of each other; a window starts from its defaults; no height is above a low ceiling', () => {
    const p = plan([wall('w1', [0, 0], [5000, 0])]), tall = { id: 'o1', type: 'hole', wallId: 'w1', offset: 0, width: 900, head: 2500 };
    expect(openingTypeFields('door', p, tall)).toEqual({ hinge: 'start', swing: 'left', head: 2500 });
    expect(openingTypeFields('window', p, tall)).toEqual({ sill: 900, head: 2400 });
    expect(openingTypeFields('hole', p, windowAt('w', 'w1', 0))).toEqual({ head: 2100 });
    const low = { ...p, ceilingHeight: 2000, openings: [{ ...tall, head: 1900 }] };
    expect(openingTypeFields('window', low)).toEqual({ sill: 900, head: 2000 });
    expect(openingTypeFields('door', low).head).toBe(2000);
    for (const to of ['door', 'window', 'sliding-door']) expect(runEdit(low, [openingTypeCommand(low, low.openings[0], to)]).status).toBe('ok');
    expect(runEdit(low, [addOpeningCommand({ ...low, openings: [] }, low.walls[0], 'window')]).status).toBe('ok');
  });
  it('a window is refused in a low wall, by a change of type and by a move; a window that is there can still be edited', () => {
    const p = plan([wall('low', [0, 0], [5000, 0], { type: 'low' }), wall('n', [0, 3000], [5000, 3000])], [{ id: 'h1', type: 'hole', wallId: 'low', offset: 500, width: 900, head: 2100 }, windowAt('win', 'n', 500)]);
    const changed = runEdit(p, [openingTypeCommand(p, p.openings[0], 'window')]);
    expect([changed.status, editMessages(changed.errors)[0]]).toEqual(['refused', '類型：窗戶位在矮牆上，玻璃會高出矮牆']);
    const moved = runEdit(p, [{ op: 'move_opening', openingId: 'win', wallId: 'low', offset: 2000 }]);
    const move = [{ op: 'move_opening', openingId: 'win', wallId: 'low', offset: 2000 }];
    expect([moved.status, editMessages(moved.errors, move)[0]]).toEqual(['refused', '所在牆：窗戶位在矮牆上，玻璃會高出矮牆']);
    // In a wall command, `wallId` is the wall itself: the reason gets no field name (found in a review).
    const outer = plan([wall('e1', [0, 0], [5000, 0], { type: 'e' })]), toggle = [{ op: 'toggle_demolition', wallId: 'e1' }];
    expect(editMessages(runEdit(outer, toggle).errors, toggle)).toEqual(['外牆不能標記拆除；可在牆體屬性按「恢復牆體」']);
    expect(runEdit(p, [addOpeningCommand(p, p.walls[0], 'window')]).errors[0].code).toBe('window-in-low-wall');
  });
  it('an opening in a demolished wall: no move in the wall, no resize and no drag; a new name, new heights, delete and a move out are accepted', () => {
    const p = plan([wall('gone', [0, 0], [5000, 0], { demolished: true }), wall('n', [0, 3000], [5000, 3000])], [door('d1', 'gone', 500)]);
    expect(runEdit(p, [{ op: 'move_opening', openingId: 'd1', offset: 1000 }]).errors[0].code).toBe('wall-demolished');
    expect(runEdit(p, [{ op: 'resize_opening', openingId: 'd1', width: 800, keep: 'start' }]).errors[0].code).toBe('wall-demolished');
    expect(dragOffset(p, 'd1', 1000)).toBe(null);
    for (const command of [{ op: 'update_opening', openingId: 'd1', name: '舊門' }, { op: 'update_opening', openingId: 'd1', head: 2000 }, { op: 'delete_opening', openingId: 'd1' }, { op: 'move_opening', openingId: 'd1', wallId: 'n', offset: 500 }])
      expect([command, runEdit(p, [command]).status]).toEqual([command, 'ok']);
  });
  it('resize: the edge at a, or the edge at b, stays', () => {
    const p = plan([wall('w1', [0, 0], [5000, 0])], [door('d1', 'w1', 1000)]);
    const start = runEdit(p, [{ op: 'resize_opening', openingId: 'd1', width: 700, keep: 'start' }]).plan.openings[0];
    const end = runEdit(p, [{ op: 'resize_opening', openingId: 'd1', width: 700, keep: 'end' }]).plan.openings[0];
    expect([[start.offset, start.width], [end.offset, end.width]]).toEqual([[1000, 700], [1200, 700]]);
  });
  it('a door that moves to a wall with the opposite direction keeps its offset, hinge and swing: they are from end a of the new wall', () => {
    const p = plan([wall('east', [0, 0], [5000, 0]), wall('west', [5000, 3000], [0, 3000])], [door('d1', 'east', 500)]);
    expect([wallHeading(p.walls[0]), wallHeading(p.walls[1]), wallHeading(wall('s', [0, 0], [0, 9])), wallHeading(wall('n', [0, 9], [0, 0]))]).toEqual(['right', 'left', 'down', 'up']);
    const moved = runEdit(p, [{ op: 'move_opening', openingId: 'd1', wallId: 'west', offset: 500 }]).plan.openings[0];
    expect(moved).toEqual({ ...p.openings[0], wallId: 'west' });
    // In the plan, the door is now 500 mm from the right end, not from the left one.
    expect(distanceAlong(p.walls[1], [4500, 3000])).toBe(500);
  });
  it('a dragged opening stays on the 10 mm grid, in the wall, and between the openings beside it; an existing overlap cannot be dragged', () => {
    const p = plan([wall('w1', [0, 0], [5000, 0])], [door('left', 'w1', 0), door('mid', 'w1', 2000), door('right', 'w1', 4100)]);
    expect([dragOffset(p, 'mid', 2504), dragOffset(p, 'mid', -400), dragOffset(p, 'mid', 9000), dragOffset(p, 'left', -50), dragOffset(p, 'right', 4800)]).toEqual([2500, 900, 3200, 0, 4100]);
    for (const wanted of [-400, 2504, 9000]) expect(runEdit(p, [{ op: 'move_opening', openingId: 'mid', offset: dragOffset(p, 'mid', wanted) }]).status).toBe('ok');
    const vertical = plan([wall('up', [0, 4000], [0, 0])], [door('d1', 'up', 1000)]);
    expect(dragOffset(vertical, 'd1', distanceAlong(vertical.walls[0], [0, 1500]))).toBe(2500);
    // A limit that is not on the grid is kept exactly, not rounded past the wall end or the opening beside it.
    const fine = plan([wall('w1', [0, 0], [5000.4, 0])], [door('d1', 'w1', 1000), { ...door('d2', 'w1', 3000.3), width: 900.2 }]);
    expect([dragOffset(fine, 'd2', 9000), dragOffset(fine, 'd1', 9000)]).toEqual([5000.4 - 900.2, 3000.3 - 900]);
    for (const [id, wanted] of [['d1', 9000], ['d2', 9000], ['d2', 0]]) expect(runEdit(fine, [{ op: 'move_opening', openingId: id, offset: dragOffset(fine, id, wanted) }]).status).toBe('ok');
    const crowded = plan([wall('w1', [0, 0], [1500, 0])], [door('a', 'w1', 0), door('b', 'w1', 600)]);
    expect([dragOffset(crowded, 'a', 100), dragOffset(p, 'none', 0)]).toEqual([null, null]);
  });
});
