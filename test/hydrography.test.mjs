import test from 'node:test';
import assert from 'node:assert/strict';

import {
    SURFACE_KIND,
    buildCoastTopology,
    buildSurfaceMap,
    getSurfaceKindAt
} from '../rules/surfaces.js';
import {
    areCanonicalRiverVerticesAdjacent,
    buildRiverTopology,
    canonicalRiverSegmentKey,
    canonicalRiverVertex,
    canonicalRiverVertexKey,
    findRiverPathSelfIntersections
} from '../rules/hydrography.js';
import {
    SCHEMA_VERSION,
    createDefaultLevel,
    normalizeLevel,
    validateLevel
} from '../campaign/runtime/schema.js';
import { EngineHexTile } from '../engine/HexTile.js';
import {
    createMatchState,
    restoreMatchState,
    serializeMatchState
} from '../engine/matchState.js';

function tile(q, r, surface = SURFACE_KIND.LAND) {
    return { q, r, surface };
}

test('canonical river vertices collapse physically coincident hex refs exactly', () => {
    const left = canonicalRiverVertex({ q: 0, r: 0, vertex: 0 });
    const right = canonicalRiverVertex({ q: 1, r: 0, vertex: 2 });
    assert.deepEqual(left, { x: 1, y: 1, key: '1,1' });
    assert.equal(canonicalRiverVertexKey({ q: 0, r: 0, vertex: 0 }), '1,1');
    assert.equal(right.key, left.key);

    const adjacent = canonicalRiverVertex({ q: 0, r: 0, vertex: 1 });
    assert.equal(areCanonicalRiverVerticesAdjacent(left, adjacent), true);
    assert.equal(canonicalRiverSegmentKey(left, adjacent), '0,2|1,1');
});

test('river topology deduplicates vertices and resolves crossings by exact segment ref', () => {
    const rivers = [{
        id: 'alpha',
        width: 'river',
        points: [
            { q: 0, r: 0, vertex: 5 },
            { q: 0, r: 0, vertex: 0 },
            { q: 0, r: 0, vertex: 1 }
        ]
    }, {
        id: 'tributary',
        width: 'stream',
        points: [
            { q: 1, r: 0, vertex: 2 }, // same physical vertex as alpha point 2
            { q: 1, r: 0, vertex: 1 }
        ]
    }];
    const topology = buildRiverTopology(rivers, [{ riverId: 'alpha', segmentIndex: 1, kind: 'bridge' }]);
    assert.equal(topology.vertices.size, 4);
    assert.equal(topology.segments.length, 3);
    assert.equal(topology.crossings[0].segment, topology.rivers.get('alpha').segments[1]);
    assert.equal(topology.vertices.get('1,1').refs.length, 2);
});

test('integer path intersection audit catches non-consecutive contacts', () => {
    const points = [
        { q: 0, r: 0, vertex: 0 },
        { q: 0, r: 0, vertex: 1 },
        { q: 0, r: 0, vertex: 2 },
        { q: 1, r: 0, vertex: 2 }
    ];
    assert.deepEqual(findRiverPathSelfIntersections(points), [
        { leftSegmentIndex: 0, rightSegmentIndex: 2 }
    ]);
});

test('coasts contain only real land-water shared edges, never missing board neighbours', () => {
    const tiles = [
        tile(0, 0),
        tile(1, 0, SURFACE_KIND.SHALLOW_WATER),
        tile(-1, 0)
    ];
    const tileMap = new Map(tiles.map(value => [`${value.q},${value.r}`, value]));
    const coasts = buildCoastTopology(tiles, tileMap);
    assert.equal(coasts.length, 1);
    assert.equal(coasts[0].key, '0,0|1,0');
    assert.deepEqual(coasts[0].land, { q: 0, r: 0 });
    assert.deepEqual(coasts[0].water, { q: 1, r: 0 });

    const realLandOnly = [tile(0, 0)];
    const mapWithRenderOnlyFake = new Map([
        ['0,0', realLandOnly[0]],
        ['1,0', tile(1, 0, SURFACE_KIND.SHALLOW_WATER)]
    ]);
    assert.deepEqual(buildCoastTopology(realLandOnly, mapWithRenderOnlyFake), []);
});

test('schema v3 migrates untouched v2 maps to implicit land and empty hydrography', () => {
    const legacy = createDefaultLevel();
    legacy.schemaVersion = 2;
    delete legacy.board.surface;
    delete legacy.board.rivers;
    delete legacy.board.crossings;
    delete legacy.board.ports;
    const before = JSON.stringify(legacy);
    const normalized = normalizeLevel(legacy);

    assert.equal(JSON.stringify(legacy), before, 'normalization must not mutate the v2 source');
    assert.equal(normalized.schemaVersion, SCHEMA_VERSION);
    assert.deepEqual(normalized.board.surface, []);
    assert.deepEqual(normalized.board.rivers, []);
    assert.deepEqual(normalized.board.crossings, []);
    assert.deepEqual(normalized.board.ports, []);
    assert.equal(getSurfaceKindAt(buildSurfaceMap(normalized.board.surface), 0, 0), SURFACE_KIND.LAND);
});

test('schema accepts a valid sparse-water, footprint, river, crossing and port board', () => {
    const level = createDefaultLevel();
    level.board.surface = [{ q: 1, r: 0, kind: 'shallowWater' }];
    level.board.cities[0].footprint = [{ q: 0, r: 0 }, { q: -1, r: 0 }];
    level.board.rivers = [{
        id: 'main-river',
        width: 'river',
        points: [
            { q: 0, r: 0, vertex: 5 },
            { q: 0, r: 0, vertex: 0 },
            { q: 0, r: 0, vertex: 1 }
        ],
        navigable: false
    }];
    level.board.crossings = [{ riverId: 'main-river', segmentIndex: 1, kind: 'bridge' }];
    level.board.ports = [{ q: 1, r: 0, districtId: 5, landQ: 0, landR: 0 }];
    assert.deepEqual(validateLevel(level).errors, []);
});

test('schema rejects villages that runtime would otherwise drop inside a city footprint', () => {
    const level = createDefaultLevel();
    level.board.cities[0].footprint = [{ q: 0, r: 1 }];
    level.board.villages = [{ q: 0, r: 1, districtId: level.board.cities[0].districtId }];
    const { errors } = validateLevel(level);
    assert.ok(errors.some(message => message.includes('不能与城市 footprint 重叠')));
});

test('schema applies movement-domain validation to trigger-spawned units', () => {
    const level = createDefaultLevel();
    level.board.surface = [{ q: 1, r: 0, kind: 'deepWater' }];
    level.triggers = [{
        id: 'spawn-invalid-domains',
        when: [],
        do: [{
            kind: 'spawnUnits',
            units: [
                { id: 'land-in-water', type: 'infantry', camp: 'player1', q: 1, r: 0 },
                { id: 'ship-inland', type: 'warship', camp: 'player1', q: -1, r: 0 }
            ]
        }],
        once: true,
        enabled: true
    }];
    const { errors } = validateLevel(level);
    assert.ok(errors.some(message => message.includes('生成单位 1') && message.includes('移动域 land')));
    assert.ok(errors.some(message => message.includes('生成单位 2') && message.includes('移动域 naval')));
});

test('schema blocks water overlays, malformed river topology, bad crossings and bad ports', () => {
    const level = createDefaultLevel();
    level.board.surface = [{ q: 1, r: 0, kind: 'deepWater' }];
    level.board.cities = [{ q: 1, r: 0, districtId: 5, camp: 'player1' }];
    level.board.villages = [{ q: 1, r: 0, districtId: 5 }];
    level.board.fortifications = [{ q: 1, r: 0, type: 'trench' }];
    level.board.districts = [{ q: 1, r: 0, districtId: 5 }];
    level.board.rivers = [{
        id: 'broken',
        width: 'stream',
        points: [
            { q: 0, r: 0, vertex: 0 },
            { q: 0, r: 0, vertex: 0 },
            { q: 2, r: 0, vertex: 0 }
        ]
    }];
    level.board.crossings = [{ riverId: 'missing', segmentIndex: 4, kind: 'tunnel' }];
    level.board.ports = [{ q: 1, r: 0 }];
    const { errors } = validateLevel(level);

    for (const fragment of ['footprint 不能覆盖水域', '不能放置村庄', '不能放置工事', '不能声明行政区',
        '零长度', '非相邻 canonical 顶点', '不存在的河流', '通行点类型', '必须是独立的浅水地块']) {
        assert.ok(errors.some(message => message.includes(fragment)), `missing validation: ${fragment}\n${errors.join('\n')}`);
    }
});

test('map builder applies water before ownership and keeps city footprint centres compatible', async () => {
    const context = {};
    globalThis.document = {
        getElementById(id) {
            return id === 'gameCanvas' ? { getContext: () => context } : null;
        }
    };
    const { buildBoardFromConfig } = await import('../campaign/runtime/mapBuilder.js');
    const level = createDefaultLevel();
    level.board.radius = 2;
    level.board.surface = [{ q: 1, r: 0, kind: 'shallowWater' }];
    level.board.cities[0].footprint = [{ q: 0, r: 0 }, { q: 0, r: 1 }];
    level.board.villages = [{ q: 1, r: 0, districtId: 5 }];
    level.board.fortifications = [{ q: 1, r: 0, type: 'trench' }];
    level.board.districts = [{ q: 1, r: 0, districtId: 5 }];
    level.board.ports = [{ q: 1, r: 0, districtId: 5, landQ: 0, landR: 0 }];
    level.board.rivers = [{
        id: 'main-river',
        width: 'river',
        points: [{ q: 0, r: 0, vertex: 5 }, { q: 0, r: 0, vertex: 0 }]
    }];
    const state = {};
    buildBoardFromConfig(normalizeLevel(level), state);

    const water = state.tileMap.get('1,0');
    const centre = state.tileMap.get('0,0');
    const footprint = state.tileMap.get('0,1');
    assert.equal(water.surface, SURFACE_KIND.SHALLOW_WATER);
    assert.equal(water.camp.id, 'player1');
    assert.equal(water.districtId, 5);
    assert.equal(water.currentColor, '#4e8794');
    assert.equal(water.isVillage, false);
    assert.equal(water.fortification, null);
    assert.equal(centre.isCity, true);
    assert.equal(centre.isUrban, true);
    assert.equal(footprint.isCity, false);
    assert.equal(footprint.isUrban, true);
    assert.equal(state.surfaceMap.get('1,0'), SURFACE_KIND.SHALLOW_WATER);
    assert.ok(state.coastEdges.length > 0);
    assert.equal(state.portTiles.get('1,0'), water);
    assert.equal(state.riverTopology.rivers.has('main-river'), true);
    assert.equal(state.campBorderEdges.some(edge => `${edge.qa},${edge.ra}` === '1,0' || `${edge.qb},${edge.rb}` === '1,0'), false);
});

test('match snapshots round-trip surfaces and rebuild derived hydrography', () => {
    const match = createMatchState();
    const land = new EngineHexTile(0, 0, 1001);
    land.camp = match.factions.player1;
    land.startColor = land.camp.color;
    land.targetColor = land.camp.color;
    land.currentColor = land.camp.color;
    land.isCity = true;
    land.isUrban = true;
    land.urbanCenterKey = '0,0';
    land.districtId = 5;
    const water = new EngineHexTile(1, 0, 1002);
    water.surface = SURFACE_KIND.SHALLOW_WATER;
    water.camp = match.factions.player1;
    water.districtId = 5;
    water.isPort = true;
    water.startColor = '#4e8794';
    water.targetColor = '#4e8794';
    water.currentColor = '#4e8794';
    match.tiles = [land, water];
    match.tileMap = new Map([['0,0', land], ['1,0', water]]);
    match.rivers = [{
        id: 'snapshot-river',
        width: 'stream',
        points: [{ q: 0, r: 0, vertex: 5 }, { q: 0, r: 0, vertex: 0 }]
    }];
    match.riverCrossings = [{ riverId: 'snapshot-river', segmentIndex: 0, kind: 'ford' }];
    match.ports = [{ q: 1, r: 0, districtId: 5, landQ: 0, landR: 0 }];
    const snapshot = serializeMatchState(match);
    assert.equal(snapshot.tiles[1].campKey, 'player1');

    const restored = createMatchState();
    restoreMatchState(restored, snapshot, {
        HexTileClass: EngineHexTile,
        UnitClass: class UnitStub {},
        computeCampBorders: tiles => [{ landTileCount: tiles.length }],
        computeDistrictBorders: tiles => [{ landTileCount: tiles.length }]
    });
    assert.equal(restored.tileMap.get('1,0').surface, SURFACE_KIND.SHALLOW_WATER);
    assert.equal(restored.tileMap.get('1,0').camp.id, 'player1');
    assert.equal(restored.tileMap.get('1,0').currentColor, '#4e8794');
    assert.equal(restored.coastEdges.length, 1);
    assert.equal(restored.riverTopology.rivers.has('snapshot-river'), true);
    assert.equal(restored.riverTopology.crossings[0].kind, 'ford');
    assert.equal(restored.portTiles.get('1,0').isPort, true);
    assert.deepEqual(restored.campBorderEdges, [{ landTileCount: 1 }]);
});
