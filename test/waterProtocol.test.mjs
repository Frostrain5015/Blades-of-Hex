import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EngineHexTile } from '../engine/HexTile.js';
import { createMatchState, restoreMatchState, serializeMatchState } from '../engine/matchState.js';
import { isValidSnapshot } from '../protocol/messages.js';
import { SURFACE_KIND } from '../rules/surfaces.js';

function snapshotWithTiles(tiles, extra = {}) {
    return {
        factions: { player1: { id: 'player1' } },
        currentCampKey: 'player1',
        tiles,
        turnOrder: ['player1'],
        roleAssignments: { player1: 'player1' },
        playerGold: { player1: 4 },
        turnCounter: 0,
        ...extra
    };
}

function landTile(id, q, r) {
    return { id, q, r, s: -q - r, campKey: 'player1' };
}

test('protocol keeps the exact MAX_TILES=512 boundary for borderless maps', () => {
    const exact = Array.from({ length: 512 }, (_, index) => landTile(index + 1, index, 0));
    assert.equal(isValidSnapshot(snapshotWithTiles(exact)), true);
    assert.equal(isValidSnapshot(snapshotWithTiles([...exact, landTile(999, 512, 0)])), false);
});

test('missing surface remains land while water requires campKey=null', () => {
    assert.equal(isValidSnapshot(snapshotWithTiles([landTile(1, 0, 0)])), true);
    const water = { id: 2, q: 1, r: 0, s: -1, surface: SURFACE_KIND.SHALLOW_WATER, campKey: null };
    assert.equal(isValidSnapshot(snapshotWithTiles([landTile(1, 0, 0), water])), true);
    assert.equal(isValidSnapshot(snapshotWithTiles([landTile(1, 0, 0), { ...water, campKey: 'player1' }])), false);
    assert.equal(isValidSnapshot(snapshotWithTiles([{ ...landTile(1, 0, 0), campKey: null }])), false);
});

test('protocol validates board layout, rivers, crossings, ports and rejects render-only tiles', () => {
    const tiles = [
        { ...landTile(1, 0, 0), surface: SURFACE_KIND.LAND, districtId: 1 },
        { id: 2, q: 1, r: 0, s: -1, surface: SURFACE_KIND.SHALLOW_WATER, campKey: 'player1', districtId: 1, isPort: true }
    ];
    const metadata = {
        boardLayout: 'borderless',
        rivers: [{
            id: 'main',
            width: 'river',
            navigable: false,
            points: [{ q: 0, r: 0, vertex: 5 }, { q: 0, r: 0, vertex: 0 }]
        }],
        crossings: [{ riverId: 'main', segmentIndex: 0, kind: 'bridge' }],
        ports: [{ q: 1, r: 0, districtId: 1, landQ: 0, landR: 0 }]
    };
    assert.equal(isValidSnapshot(snapshotWithTiles(tiles, metadata)), true);
    assert.equal(isValidSnapshot(snapshotWithTiles([{ ...tiles[0], renderOnly: true }, tiles[1]], metadata)), false);
    assert.equal(isValidSnapshot(snapshotWithTiles(tiles, { ...metadata, boardLayout: 'unknown' })), false);
    assert.equal(isValidSnapshot(snapshotWithTiles(tiles, { ...metadata, crossings: [{ riverId: 'main', segmentIndex: 4, kind: 'ford' }] })), false);
    assert.equal(isValidSnapshot(snapshotWithTiles(tiles, {
        ...metadata,
        rivers: [{
            id: 'jump', width: 'stream',
            points: [{ q: 0, r: 0, vertex: 5 }, { q: 0, r: 0, vertex: 2 }]
        }],
        crossings: [],
        riverCrossings: []
    })), false, 'protocol must reject discontinuous river segments');
    assert.equal(isValidSnapshot(snapshotWithTiles(tiles, {
        ...metadata,
        riverCrossings: [{ riverId: 'main', segmentIndex: 0, kind: 'ford' }]
    })), false, 'canonical and legacy crossing fields may not disagree');
    assert.equal(isValidSnapshot(snapshotWithTiles([
        { ...tiles[0], isPort: true },
        { ...tiles[1], q: 2, s: -2, isPort: false, campKey: null, districtId: null }
    ])), false, 'per-tile inland port flags are not trusted');
    assert.equal(isValidSnapshot(snapshotWithTiles([
        tiles[0],
        { ...tiles[1], isCity: true, districtId: 4 }
    ])), false, 'water cannot carry land ownership overlays');
});

test('match snapshot round-trips canonical water metadata through protocol validation', () => {
    const match = createMatchState();
    match.boardLayout = 'borderless';
    const land = new EngineHexTile(0, 0, 101);
    land.camp = match.factions.player1;
    land.districtId = 1;
    const port = new EngineHexTile(1, 0, 102);
    port.surface = SURFACE_KIND.SHALLOW_WATER;
    port.camp = match.factions.player1;
    port.districtId = 1;
    port.isPort = true;
    port.startColor = '#4e8794';
    port.targetColor = '#4e8794';
    port.currentColor = '#4e8794';
    match.tiles = [land, port];
    match.tileMap = new Map([['0,0', land], ['1,0', port]]);
    match.rivers = [{
        id: 'main', width: 'stream', navigable: false,
        points: [{ q: 0, r: 0, vertex: 5 }, { q: 0, r: 0, vertex: 0 }]
    }];
    match.riverCrossings = [{ riverId: 'main', segmentIndex: 0, kind: 'ford' }];
    match.ports = [{ q: 1, r: 0, districtId: 1, landQ: 0, landR: 0 }];

    const snapshot = serializeMatchState(match);
    assert.deepEqual(snapshot.crossings, match.riverCrossings);
    assert.equal(isValidSnapshot(snapshot), true);

    const restored = createMatchState();
    restoreMatchState(restored, snapshot, {
        HexTileClass: EngineHexTile,
        UnitClass: class UnitStub {},
        computeCampBorders: () => [],
        computeDistrictBorders: () => []
    });
    assert.equal(restored.boardLayout, 'borderless');
    assert.equal(restored.tileMap.get('1,0').surface, SURFACE_KIND.SHALLOW_WATER);
    assert.equal(restored.tileMap.get('1,0').camp.id, 'player1');
    assert.equal(restored.tileMap.get('1,0').currentColor, '#4e8794');
    assert.deepEqual(restored.riverCrossings, match.riverCrossings);
    assert.deepEqual(restored.ports, match.ports);
});

test('restore validates incoming ports before reconstructing naval units', () => {
    const match = createMatchState();
    const inland = new EngineHexTile(0, 0, 201);
    inland.camp = match.factions.player1;
    const distantWater = new EngineHexTile(2, 0, 202);
    distantWater.surface = SURFACE_KIND.SHALLOW_WATER;
    distantWater.camp = null;
    match.tiles = [inland, distantWater];
    match.tileMap = new Map([['0,0', inland], ['2,0', distantWater]]);

    const snapshot = serializeMatchState(match);
    snapshot.ports = [];
    snapshot.tiles[0].isPort = true;
    snapshot.tiles[0].unit = { type: 'warship', campKey: 'player1', isDrone: false };

    // Simulate a previous board that did have a port at this coordinate. The
    // incoming snapshot must not inherit this derived cache.
    match.portTiles = new Map([['0,0', inland]]);
    let constructed = 0;
    class UnitStub {
        constructor() { constructed++; }
    }
    restoreMatchState(match, snapshot, {
        HexTileClass: EngineHexTile,
        UnitClass: UnitStub,
        computeCampBorders: () => [],
        computeDistrictBorders: () => []
    });

    assert.equal(constructed, 0);
    assert.equal(match.tileMap.get('0,0').isPort, false);
    assert.equal(match.tileMap.get('0,0').unit, null);
    assert.deepEqual(match.ports, []);
    assert.equal(match.portTiles.size, 0);
});
