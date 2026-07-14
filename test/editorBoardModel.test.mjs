import test from 'node:test';
import assert from 'node:assert/strict';

import { createDefaultLevel } from '../campaign/runtime/schema.js';
import {
    appendRiverDraftPoint,
    applySurfaceBrush,
    commitRiverDraft,
    hitRiverSegment,
    pruneLevelToBoard,
    riverVertexToPixel,
    snapRiverVertex,
    surfaceKindAt,
    toggleCityFootprint,
    togglePort,
    toggleRiverCrossing
} from '../campaign/editor/boardModel.js';

test('large-city footprint authoring attaches unambiguously and toggles existing cells', () => {
    const level = createDefaultLevel();
    level.board.cities = [{ q: 0, r: 0, districtId: 1, camp: 'player1' }];

    const first = toggleCityFootprint(level, 1, 0);
    assert.equal(first.changed, true);
    assert.equal(first.placed, true);
    assert.deepEqual(level.board.cities[0].footprint, [{ q: 1, r: 0 }]);

    const chained = toggleCityFootprint(level, 2, 0);
    assert.equal(chained.placed, true, 'a footprint can grow outward from its existing edge');
    assert.deepEqual(level.board.cities[0].footprint, [{ q: 1, r: 0 }, { q: 2, r: 0 }]);

    const removed = toggleCityFootprint(level, 2, 0);
    assert.equal(removed.placed, false);
    assert.deepEqual(level.board.cities[0].footprint, [{ q: 1, r: 0 }]);
    assert.match(toggleCityFootprint(level, 0, 0).error, /城市中心/);

    toggleCityFootprint(level, 2, 0);
    assert.match(toggleCityFootprint(level, 1, 0).error, /城郭外缘/);
    assert.match(applySurfaceBrush(level, 1, 0, 'shallowWater').error, /城郭外缘/);
    assert.equal(surfaceKindAt(level.board, 1, 0), 'land');

    applySurfaceBrush(level, 0, 1, 'shallowWater');
    assert.match(toggleCityFootprint(level, 0, 1).error, /水域/);
});

test('large-city footprint refuses detached, village and ambiguous ownership cells', () => {
    const level = createDefaultLevel();
    level.board.radius = 4;
    level.board.cities = [
        { q: 0, r: 0, districtId: 1, camp: 'player1' },
        { q: 2, r: 0, districtId: 2, camp: 'player2' }
    ];
    assert.match(toggleCityFootprint(level, 4, 0).error, /紧邻/);
    assert.match(toggleCityFootprint(level, 1, 0).error, /多个城市/);

    level.board.cities.pop();
    level.board.villages = [{ q: 1, r: 0, districtId: 1 }];
    assert.match(toggleCityFootprint(level, 1, 0).error, /村庄/);
});

test('surface brush persists water sparsely and removes illegal land overlays', () => {
    const level = createDefaultLevel();
    level.board.terrain.push({ q: 1, r: 0, type: 'forest' });
    level.board.villages.push({ q: 1, r: 0, districtId: 5 });
    level.board.fortifications.push({ q: 1, r: 0, type: 'trench' });
    level.board.districts.push({ q: 1, r: 0, districtId: 5 });
    level.board.cities[0].footprint = [{ q: 1, r: 0 }];
    level.units.push({ id: 'u1', type: 'infantry', camp: 'player1', q: 1, r: 0 });
    level.units.push({ id: 'ship', type: 'warship', camp: 'player1', q: 1, r: 0 });

    const water = applySurfaceBrush(level, 1, 0, 'shallowWater');
    assert.equal(water.changed, true);
    assert.equal(surfaceKindAt(level.board, 1, 0), 'shallowWater');
    assert.deepEqual(level.board.terrain, []);
    assert.deepEqual(level.board.villages, []);
    assert.deepEqual(level.board.fortifications, []);
    assert.deepEqual(level.board.districts, []);
    assert.deepEqual(level.board.cities[0].footprint, []);
    assert.deepEqual(level.units.map(unit => unit.id), ['ship']);

    applySurfaceBrush(level, 1, 0, 'deepWater');
    assert.deepEqual(level.board.surface, [{ q: 1, r: 0, kind: 'deepWater' }]);
    applySurfaceBrush(level, 1, 0, 'land');
    assert.deepEqual(level.board.surface, []);
});

test('port toggle accepts only a real land tile next to authored water', () => {
    const level = createDefaultLevel();
    assert.match(togglePort(level, 0, 0).error, /邻接/);
    applySurfaceBrush(level, 1, 0, 'shallowWater');
    assert.deepEqual(togglePort(level, 0, 0), { changed: true, placed: true, error: '' });
    assert.deepEqual(level.board.ports, [{ q: 0, r: 0 }]);
    level.units.push({ id: 'ship', type: 'warship', q: 0, r: 0 });
    assert.match(togglePort(level, 0, 0).error, /先移走/);
    level.units = [];
    assert.deepEqual(togglePort(level, 0, 0), { changed: true, placed: false, error: '' });
    assert.match(togglePort(level, 1, 0).error, /陆地/);
    assert.match(togglePort(level, 99, 99).error, /可编辑棋盘/);
});

test('surface and board edits prune stranded ports and naval occupants', () => {
    const level = createDefaultLevel();
    applySurfaceBrush(level, 1, 0, 'shallowWater');
    assert.equal(togglePort(level, 0, 0).placed, true);
    level.units.push({ id: 'ship-at-port', type: 'warship', q: 0, r: 0 });

    const restoredLand = applySurfaceBrush(level, 1, 0, 'land');
    assert.deepEqual(level.board.ports, []);
    assert.deepEqual(level.units, []);
    assert.equal(restoredLand.removed, 2, 'one stranded port and its naval occupant are removed');

    level.board.radius = 2;
    applySurfaceBrush(level, 2, 0, 'deepWater');
    assert.equal(togglePort(level, 1, 0).placed, true);
    level.units.push({ id: 'resize-ship', type: 'warship', q: 1, r: 0 });
    level.board.radius = 1;
    pruneLevelToBoard(level);
    assert.deepEqual(level.board.surface, []);
    assert.deepEqual(level.board.ports, []);
    assert.deepEqual(level.units, []);
});

test('river draft snaps canonical vertices and only extends along adjacent edges', () => {
    const ref = { q: 0, r: 0, vertex: 0 };
    const pixel = riverVertexToPixel(ref);
    const snapped = snapRiverVertex([{ q: 0, r: 0 }, { q: 1, r: 0 }], pixel.x + 1, pixel.y - 1);
    assert.equal(snapped.canonicalKey, '1,1');

    let draft = appendRiverDraftPoint([], ref);
    assert.equal(draft.changed, true);
    draft = appendRiverDraftPoint(draft.points, { q: 0, r: 0, vertex: 1 });
    assert.equal(draft.changed, true);
    const invalidJump = appendRiverDraftPoint(draft.points, { q: 1, r: 0, vertex: 1 });
    assert.equal(invalidJump.changed, false);
    assert.match(invalidJump.error, /相邻/);
    const loop = appendRiverDraftPoint(draft.points, { q: 1, r: 0, vertex: 2 });
    assert.equal(loop.changed, false);
    assert.match(loop.error, /重复/);
});

test('commit, segment hit and crossing toggle share exact persisted segment refs', () => {
    const level = createDefaultLevel();
    const draft = {
        id: 'main', width: 'river', navigable: false,
        points: [{ q: 0, r: 0, vertex: 5 }, { q: 0, r: 0, vertex: 0 }]
    };
    assert.deepEqual(commitRiverDraft(level, draft), { changed: true, id: 'main', error: '' });
    const from = riverVertexToPixel(draft.points[0]);
    const to = riverVertexToPixel(draft.points[1]);
    const hit = hitRiverSegment(level.board, (from.x + to.x) / 2, (from.y + to.y) / 2);
    assert.equal(hit.riverId, 'main');
    assert.equal(hit.segmentIndex, 0);
    assert.equal(hitRiverSegment(level.board, 0, 0), null);

    assert.deepEqual(toggleRiverCrossing(level, hit, 'bridge'), { changed: true, placed: true, error: '' });
    assert.deepEqual(level.board.crossings, [{ riverId: 'main', segmentIndex: 0, kind: 'bridge' }]);
    assert.deepEqual(toggleRiverCrossing(level, hit, 'ford'), { changed: true, placed: true, error: '' });
    assert.equal(level.board.crossings[0].kind, 'ford');
    assert.deepEqual(toggleRiverCrossing(level, hit, 'ford'), { changed: true, placed: false, error: '' });
    assert.match(toggleRiverCrossing(level, null, 'bridge').error, /已有河段/);
});

test('resize pruning splits rivers and remaps or deletes crossings', () => {
    const level = createDefaultLevel();
    level.board.radius = 2;
    level.board.surface = [{ q: 2, r: 0, kind: 'deepWater' }];
    level.board.ports = [{ q: 2, r: -1 }];
    level.board.rivers = [{
        id: 'main', width: 'river', navigable: false,
        points: [
            { q: -2, r: 0, vertex: 0 },
            { q: -1, r: 0, vertex: 3 },
            { q: -1, r: 0, vertex: 4 },
            { q: 0, r: 0, vertex: 3 }
        ]
    }];
    // Segments 0 and 2 survive after shrinking to radius 1 as two-point runs
    // only if their referenced tiles both survive. Here segment 0 is deleted,
    // while original segment 2 is remapped from index 2 to index 0.
    level.board.crossings = [
        { riverId: 'main', segmentIndex: 0, kind: 'ford' },
        { riverId: 'main', segmentIndex: 2, kind: 'bridge' }
    ];
    level.board.radius = 1;

    const result = pruneLevelToBoard(level);
    assert.ok(result.removed >= 3);
    assert.deepEqual(level.board.surface, []);
    assert.deepEqual(level.board.ports, []);
    assert.equal(level.board.rivers.length, 1);
    assert.deepEqual(level.board.rivers[0].points, [
        { q: -1, r: 0, vertex: 3 },
        { q: -1, r: 0, vertex: 4 },
        { q: 0, r: 0, vertex: 3 }
    ]);
    assert.deepEqual(level.board.crossings, [
        { riverId: 'main', segmentIndex: 1, kind: 'bridge' }
    ]);
    assert.equal(result.remappedCrossings, 1);
});
