import test from 'node:test';
import assert from 'node:assert/strict';

import {
    TERRAIN_FEATURE,
    buildTerrainTopology
} from '../rules/terrainTopology.js';

function tile(q, r, overrides = {}) {
    return {
        q,
        r,
        s: -q - r,
        terrain: 'plains',
        fortification: null,
        ...overrides
    };
}

function index(tiles) {
    return new Map(tiles.map(value => [`${value.q},${value.r}`, value]));
}

test('cross-hex forest, mountain and trench topology is deterministic and playable-only', () => {
    const tiles = [
        tile(0, 0, { terrain: 'forest' }),
        tile(1, 0, { terrain: 'forest' }),
        tile(0, 1, { terrain: 'mountain', fortification: 'trench' }),
        tile(-1, 1, { terrain: 'mountain', fortification: 'trench' }),
        tile(2, 0),
        tile(3, 0, { terrain: 'forest', renderOnly: true, playable: false })
    ];
    const realTiles = tiles.filter(value => value.playable !== false);
    const topology = buildTerrainTopology(tiles, index(realTiles));

    assert.deepEqual(topology.playableTileKeys, ['-1,1', '0,0', '0,1', '1,0', '2,0']);
    assert.equal(topology.forest.tiles.length, 2);
    assert.equal(topology.forest.components.length, 1);
    assert.equal(topology.forest.links.length, 1);
    assert.deepEqual(topology.forest.links[0].from, { q: 0, r: 0, key: '0,0' });
    assert.deepEqual(topology.forest.links[0].to, { q: 1, r: 0, key: '1,0' });
    assert.equal(topology.mountain.components.length, 1);
    assert.equal(topology.mountain.links.length, 1);
    assert.equal(topology.trench.components.length, 1);
    assert.equal(topology.trench.links.length, 1);
    assert.equal(topology.forest.tiles.some(value => value.key === '3,0'), false);
});

test('urban and village outer walls use real neighbours and never close against a missing board edge', () => {
    const tiles = [
        tile(0, 0, { isCity: true, isUrban: true, urbanCenterKey: '0,0' }),
        tile(1, 0, { isUrban: true, urbanCenterKey: '0,0' }),
        tile(-1, 0),
        tile(0, 1),
        tile(1, -1),
        tile(2, 0),
        tile(-1, 1, { isVillage: true }),
        tile(-2, 1),
        tile(-1, 2)
    ];
    const topology = buildTerrainTopology(tiles, index(tiles));

    assert.equal(topology.urbanFootprints.length, 1);
    const city = topology.urbanFootprints[0];
    assert.equal(city.id, '0,0');
    assert.deepEqual(city.tiles.map(value => value.key), ['0,0', '1,0']);
    assert.equal(city.links.length, 1, 'the shared urban edge becomes one continuity link');
    assert.ok(city.boundaryEdges.length > 0);
    assert.ok(city.boundaryEdges.every(edge => edge.kind === TERRAIN_FEATURE.URBAN));
    assert.ok(city.boundaryEdges.every(edge => edge.neighbor?.key), 'every wall edge must have a real opposite tile');
    assert.equal(
        city.boundaryEdges.some(edge => new Set([edge.tile.key, edge.neighbor.key]).has('0,0')
            && new Set([edge.tile.key, edge.neighbor.key]).has('1,0')),
        false,
        'the internal footprint edge is never rendered as a wall'
    );

    assert.equal(topology.villageFootprints.length, 1);
    const village = topology.villageFootprints[0];
    assert.deepEqual(village.tiles.map(value => value.key), ['-1,1']);
    assert.ok(village.boundaryEdges.length > 0);
    assert.ok(village.boundaryEdges.every(edge => edge.neighbor?.key));
    assert.ok(village.boundaryEdges.length < 6, 'missing board neighbours are clipping, not a closed six-edge fence');
});

test('legacy adjacent urban cells without center ids still form one footprint', () => {
    const tiles = [
        tile(0, 0, { isCity: true }),
        tile(1, 0, { isUrban: true }),
        tile(2, 0)
    ];
    const topology = buildTerrainTopology(tiles, index(tiles));
    assert.equal(topology.urbanFootprints.length, 1);
    assert.deepEqual(topology.urbanFootprints[0].tiles.map(value => value.key), ['0,0', '1,0']);
});
