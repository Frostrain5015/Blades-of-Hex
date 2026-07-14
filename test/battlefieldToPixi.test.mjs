import assert from 'node:assert/strict';
import { battlefieldSnapshotToPixi } from '../js/rendering/battlefieldToPixi.js';

const snapshot = Object.freeze({
    kind: 'blades-of-hex/battlefield',
    signature: 'battlefield-v1:0000002a',
    viewerCampKey: 'player1',
    board: { hexSize: 30, logicalWidth: 1000, logicalHeight: 750 },
    camps: [{ key: 'player1', color: '#aa3030' }, { key: 'player2', color: '#304faa' }],
    tiles: [
        { key: '0,0', center: { x: 500, y: 375 }, campKey: 'player1', visibility: 'visible', renderOnly: false, surface: { kind: 'land', color: '#aa7777' } },
        { key: '1,0', center: { x: 552, y: 375 }, campKey: null, visibility: 'visible', renderOnly: false, surface: { kind: 'deepWater' } }
    ],
    units: [{ id: 'u1', campKey: 'player1', visualCenter: { x: 500, y: 375 }, renderable: true, relationToViewer: 'self', health: { ratio: 0.68, max: 100 }, shield: { current: 20 } }],
    borders: { camp: [], district: [] },
    interaction: { selection: { unitId: 'u1', attackTileKeys: [], moveTileKeys: ['1,0'] } }
});

const converted = battlefieldSnapshotToPixi(snapshot, { showGrid: false });
assert.equal(converted.revision, 42);
assert.equal(converted.tiles.length, 2);
assert.equal(converted.tiles[0].points.length, 6);
assert.equal(converted.tiles[0].gridAlpha, 0);
assert.equal(converted.tiles[1].fillColor, 0x264954);
assert.equal(converted.units[0].health.ratio, 0.68);
assert.equal(converted.units[0].health.shieldRatio, 0.2);
assert.ok(converted.units[0].health.shieldRadius + converted.units[0].health.shieldWidth / 2 <= 20.2);
assert.equal(converted.originMarker.x, 500);
assert.equal(converted.rangeRegions[0].id, 'movement-range');
assert.equal(converted.rangeRegions[0].cells.length, 1);
assert.equal(converted.rangeRegions[0].edges.length, 6);
assert.equal(Object.isFrozen(converted), true);
assert.throws(() => battlefieldSnapshotToPixi({}), /battlefield snapshot/);

console.log('battlefieldToPixi tests passed');
