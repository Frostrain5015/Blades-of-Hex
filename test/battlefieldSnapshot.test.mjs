import assert from 'node:assert/strict';
import {
    BATTLEFIELD_SNAPSHOT_KIND,
    BATTLEFIELD_SNAPSHOT_VERSION,
    buildBattlefieldSnapshot,
    shouldSyncBattlefieldSnapshot
} from '../js/rendering/battlefieldSnapshot.js';
import {
    axialToBoardPixel,
    getPlayableBoardCoordinates,
    isBoardHexFullyVisible
} from '../rules/boardLayout.js';

class RuntimeTile {
    constructor(q, r, camp, id) {
        const center = axialToBoardPixel(q, r);
        this.id = id;
        this.q = q;
        this.r = r;
        this.s = -q - r;
        this.x = center.x;
        this.y = center.y;
        this.camp = camp;
        this.districtId = 0;
        this.terrain = 'plains';
        this.surface = 'land';
        this.fortification = null;
        this.isCity = false;
        this.isVillage = false;
        this.unit = null;
        this.startColor = camp.color;
        this.targetColor = camp.color;
        this.currentColor = camp.color;
        this.fadeStartTime = null;
        this.fadeDuration = 0;
    }
}

class RuntimeUnit {
    constructor(id, type, camp, tile) {
        this.id = id;
        this.type = type;
        this.camp = camp;
        this.tile = tile;
        this.hp = 72;
        this.maxHp = 100;
        this._shield = 18;
        this._shieldMax = 30;
        this._shieldTurns = 2;
        this.canAct = true;
        this.remainingMP = 3;
        this.morale = 3;
        tile.unit = this;
    }
}

function indexTiles(tiles) {
    return new Map(tiles.map(tile => [`${tile.q},${tile.r}`, tile]));
}

function assertJsonTree(value, path = 'snapshot') {
    const type = typeof value;
    assert.notEqual(type, 'function', `${path} leaked a function`);
    assert.notEqual(type, 'symbol', `${path} leaked a symbol`);
    assert.notEqual(type, 'bigint', `${path} leaked a bigint`);
    if (value === null || type !== 'object') return;
    assert.equal(value instanceof Map, false, `${path} leaked a Map`);
    assert.equal(value instanceof Set, false, `${path} leaked a Set`);
    const prototype = Object.getPrototypeOf(value);
    assert.ok(prototype === Object.prototype || prototype === Array.prototype,
        `${path} leaked a class instance`);
    assert.equal(Object.isFrozen(value), true, `${path} is mutable`);
    if (Array.isArray(value)) {
        value.forEach((child, index) => assertJsonTree(child, `${path}[${index}]`));
    } else {
        Object.entries(value).forEach(([key, child]) => assertJsonTree(child, `${path}.${key}`));
    }
}

const red = { id: 'player1', name: 'Red', colorId: 'red', color: '#ffaaaa', flag: 'R', controller: 'human' };
const blue = { id: 'player2', name: 'Blue', colorId: 'blue', color: '#aaaaff', flag: 'B', controller: 'ai' };
const neutral = { id: 'neutral', name: 'Neutral', colorId: 'gray', color: '#b0b0b0', flag: '' };
const city = new RuntimeTile(0, 0, red, 1);
city.isCity = true;
city.terrain = 'forest';
city.fortification = 'flak';
city.districtId = 1;
city.startColor = '#aaffaa';
city.targetColor = '#ffaaaa';
city.currentColor = '#ccbb99'; // Per-frame value must not become the sync source.
city.fadeStartTime = 100;
city.fadeDuration = 1500;
const enemy = new RuntimeTile(1, 0, blue, 2);
enemy.terrain = 'mountain';
enemy.districtId = 2;
const village = new RuntimeTile(0, 1, red, 3);
village.isVillage = true;
village.villageDistrictId = 1;
village.districtId = 1;
const unit = new RuntimeUnit('unit-red', 'infantry', red, city);
unit.commander = 'colonel';
unit.commanderName = 'Colonel';
unit.movePath = [{ x: city.x - 40, y: city.y }, { x: city.x, y: city.y }];
unit.movePathStart = 500;
unit.movePathDuration = 240;
const enemyUnit = new RuntimeUnit('unit-blue', 'archer', blue, enemy);

const classicTiles = [enemy, village, city]; // Deliberately unordered.
const classicState = {
    tiles: classicTiles,
    tileMap: indexTiles(classicTiles),
    factions: { player1: red, player2: blue, neutral },
    currentCamp: red,
    boardLayout: 'hex',
    skirmishFog: true,
    mechanics: { fogOfWar: true, alliedVision: false, fortifications: true, weatherEffects: true },
    visibleTiles: { player1: new Set(['0,0', '0,1']), player2: new Set(), neutral: new Set() },
    exploredTiles: { player1: new Set(['1,0']), player2: new Set(), neutral: new Set() },
    selectedUnit: unit,
    selectedTile: city,
    selectedCityTile: city,
    movableTiles: [village],
    attackableTiles: [enemy],
    hoveredTile: enemy,
    selectionTime: 123,
    cardTargeting: { cardId: 'heal', targeting: 'friendlyAlive', handIndex: 0 },
    campBorderEdges: [{
        x0: city.x + 10, y0: city.y - 20, x1: city.x + 10, y1: city.y + 20,
        qa: 0, ra: 0, qb: 1, rb: 0
    }],
    districtBorderEdges: []
};

const classic = buildBattlefieldSnapshot(classicState, { viewingCamp: red });
assert.equal(classic.kind, BATTLEFIELD_SNAPSHOT_KIND);
assert.equal(classic.version, BATTLEFIELD_SNAPSHOT_VERSION);
assert.match(classic.signature, /^battlefield-v1:[0-9a-f]{8}$/);
assert.equal(classic.board.layout, 'hex');
assert.deepEqual(classic.board.playableKeys, ['0,0', '1,0', '0,1']);
assert.deepEqual(classic.board.renderKeys, classic.board.playableKeys);
assert.deepEqual(classic.board.renderOnlyKeys, []);
assert.equal(classic.tiles.find(tile => tile.key === '0,0').terrain.type, 'forest');
assert.equal(classic.tiles.find(tile => tile.key === '0,0').fortification.type, 'flak');
assert.equal(classic.tiles.find(tile => tile.key === '0,0').city.kind, 'city');
assert.equal(classic.tiles.find(tile => tile.key === '0,0').surface.color, '#aaffaa');
assert.equal(classic.tiles.find(tile => tile.key === '0,0').surface.transition.to, '#ffaaaa');
assert.equal(classic.tiles.find(tile => tile.key === '1,0').visibility, 'explored');

const redDto = classic.units.find(candidate => candidate.id === 'unit-red');
assert.deepEqual(redDto.health, { current: 72, max: 100, ratio: 0.72 });
assert.deepEqual(redDto.shield, { current: 18, max: 30, turns: 2 });
assert.deepEqual(redDto.visualCenter, unit.movePath[0]);
assert.deepEqual(redDto.motion.path, unit.movePath);
assert.equal(redDto.commander.id, 'colonel');
assert.equal(redDto.relationToViewer, 'self');
assert.equal(classic.units.find(candidate => candidate.id === 'unit-blue').renderable, false);
assert.equal(classic.interaction.selection.unitId, 'unit-red');
assert.equal(classic.interaction.hover.tileKey, '1,0');
assert.equal(classic.interaction.hover.unitId, 'unit-blue');
assert.deepEqual(classic.interaction.targeting.candidateTileKeys, ['0,0']);
assert.deepEqual(classic.interaction.targetCandidates, [
    { tileKey: '0,0', kinds: ['card'], intent: 'heal' },
    { tileKey: '1,0', kinds: ['attack'], intent: null },
    { tileKey: '0,1', kinds: ['move'], intent: null }
]);
assert.equal(classic.borders.camp.length, 1);

assertJsonTree(classic);
assert.doesNotThrow(() => JSON.parse(JSON.stringify(classic)));
assert.throws(() => { classic.tiles[0].terrain = null; }, TypeError);

// Per-frame Canvas presentation values are intentionally absent from the sync
// contract; the backend interpolates the parametric transition and motion.
city.currentColor = '#bbccaa';
unit.displayHp = 65;
const presentationTick = buildBattlefieldSnapshot(classicState, { viewingCamp: red });
assert.equal(presentationTick.signature, classic.signature);

// Source mutations cannot alter an already-built renderer DTO.
const oldHealth = redDto.health.current;
const oldSurfaceColor = classic.tiles.find(tile => tile.key === '0,0').surface.color;
unit.hp = 41;
city.startColor = '#123456';
classicState.movableTiles.length = 0;
assert.equal(redDto.health.current, oldHealth);
assert.equal(classic.tiles.find(tile => tile.key === '0,0').surface.color, oldSurfaceColor);
const changed = buildBattlefieldSnapshot(classicState, { viewingCamp: red });
assert.notEqual(changed.signature, classic.signature);
assert.equal(shouldSyncBattlefieldSnapshot(classic, changed), true);
const unchanged = buildBattlefieldSnapshot(classicState, { viewingCamp: red });
assert.equal(unchanged.signature, changed.signature);
assert.equal(shouldSyncBattlefieldSnapshot(changed, unchanged), false);
assert.equal(shouldSyncBattlefieldSnapshot(null, unchanged), true);
assert.equal(shouldSyncBattlefieldSnapshot(unchanged, null), false);

// Legacy maps without boardLayout remain classic and never synthesize edge tiles.
const legacy = buildBattlefieldSnapshot({
    tiles: [city],
    tileMap: new Map([['0,0', city]]),
    currentCamp: red,
    movableTiles: [],
    attackableTiles: []
});
assert.equal(legacy.board.layout, 'hex');
assert.deepEqual(legacy.board.renderKeys, ['0,0']);

// Water is neutral material, not an owning faction/district. Its coastline is
// also excluded from camp/district borders even if an older producer supplies
// a stale precomputed edge for that land-water pair.
const coastLand = new RuntimeTile(0, 0, red, 20);
const coastWater = new RuntimeTile(1, 0, blue, 21);
coastWater.surface = 'deepWater';
coastWater.districtId = 7;
const coastState = {
    tiles: [coastLand, coastWater],
    tileMap: indexTiles([coastLand, coastWater]),
    factions: { player1: red, player2: blue, neutral },
    currentCamp: red,
    movableTiles: [],
    attackableTiles: [],
    campBorderEdges: [{
        x0: coastLand.x, y0: coastLand.y,
        x1: coastWater.x, y1: coastWater.y,
        qa: 0, ra: 0, qb: 1, rb: 0
    }],
    districtBorderEdges: [{
        x0: coastLand.x, y0: coastLand.y,
        x1: coastWater.x, y1: coastWater.y,
        qa: 0, ra: 0, qb: 1, rb: 0
    }]
};
const coast = buildBattlefieldSnapshot(coastState);
const waterDto = coast.tiles.find(tile => tile.key === '1,0');
assert.equal(waterDto.surface.kind, 'deepWater');
assert.equal(waterDto.surface.color, '#294f67');
assert.equal(waterDto.campKey, null);
assert.equal(waterDto.districtId, null);
assert.deepEqual(coast.borders.camp, []);
assert.deepEqual(coast.borders.district, []);

// A borderless board exposes every real playable tile and adds only partial,
// render-only edge cells. Those fillers can never enter interaction candidates.
const borderlessTiles = getPlayableBoardCoordinates({ layout: 'borderless' })
    .map(({ q, r }, index) => {
        const tile = new RuntimeTile(q, r, q < 0 ? red : blue, 1000 + index);
        tile.districtId = q < 0 ? 1 : 2;
        return tile;
    });
const borderlessState = {
    tiles: borderlessTiles,
    tileMap: indexTiles(borderlessTiles),
    factions: { player1: red, player2: blue, neutral },
    currentCamp: red,
    boardLayout: 'borderless',
    movableTiles: [],
    attackableTiles: [],
    visibleTiles: { player1: new Set(), player2: new Set(), neutral: new Set() },
    exploredTiles: { player1: new Set(), player2: new Set(), neutral: new Set() }
};
const borderless = buildBattlefieldSnapshot(borderlessState);
assert.equal(borderless.board.playableKeys.length, borderlessTiles.length);
assert.ok(borderless.board.renderOnlyKeys.length > 0);
assert.equal(borderless.board.renderKeys.length,
    borderless.board.playableKeys.length + borderless.board.renderOnlyKeys.length);
for (const key of borderless.board.renderOnlyKeys) {
    const coordinate = key.split(',').map(Number);
    assert.equal(isBoardHexFullyVisible(coordinate[0], coordinate[1]), false);
    const filler = borderless.tiles.find(tile => tile.key === key);
    assert.equal(filler.playable, false);
    assert.equal(filler.renderOnly, true);
    assert.equal(filler.terrain, null);
    assert.equal(filler.fortification, null);
    assert.equal(filler.city, null);
    assert.equal(filler.unitId, null);
    assert.ok(borderless.board.playableKeys.includes(filler.surface.inheritedFromKey));
}
const fakeKey = borderless.board.renderOnlyKeys[0];
const [fakeQ, fakeR] = fakeKey.split(',').map(Number);
const fakeInteractionTile = { q: fakeQ, r: fakeR };
borderlessState.hoveredTile = fakeInteractionTile;
borderlessState.movableTiles = [fakeInteractionTile];
const fakeGuard = buildBattlefieldSnapshot(borderlessState);
assert.equal(fakeGuard.interaction.hover.tileKey, null);
assert.deepEqual(fakeGuard.interaction.selection.moveTileKeys, []);
assert.deepEqual(fakeGuard.interaction.targetCandidates, []);
const renderKeys = new Set(fakeGuard.board.renderKeys);
for (const edge of [...fakeGuard.borders.camp, ...fakeGuard.borders.district]) {
    assert.equal(renderKeys.has(edge.aKey), true);
    assert.equal(renderKeys.has(edge.bKey), true);
}

console.log('battlefieldSnapshot tests passed');
