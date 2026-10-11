import { describe, expect, it } from 'vitest';
import { applyCommands, createEmptyPlan, createSamplePlan, wallLength } from 'open-plan-core';
import { joinCandidates, newWallThickness, runEdit, snapWallPoint, wallEnd, wallLengthCommand, wallPoint } from '../src/floorplan/planEdit.js';
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
