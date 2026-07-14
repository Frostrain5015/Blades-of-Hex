import assert from 'node:assert/strict';
import { test } from 'node:test';

const context = {};
globalThis.document = {
    getElementById() {
        return { getContext: () => context };
    }
};
globalThis.localStorage = { getItem: () => null, setItem: () => {} };

const [{ Unit, setGameStateRef, setLogMessageRef }, { EngineHexTile }, { createMatchState }] = await Promise.all([
    import('../js/Unit.js'),
    import('../engine/HexTile.js'),
    import('../engine/matchState.js')
]);

function tile(q, r, surface = 'land', extra = {}) {
    const result = new EngineHexTile(q, r);
    result.surface = surface;
    if (surface !== 'land') result.camp = null;
    Object.assign(result, extra);
    return result;
}

function setupState(tiles) {
    const state = createMatchState();
    state.tiles = tiles;
    state.tileMap = new Map(tiles.map(value => [`${value.q},${value.r}`, value]));
    state.damageTexts = [];
    setGameStateRef(state);
    setLogMessageRef(() => {});
    return state;
}

test('unit construction enforces land, water and port movement domains', () => {
    const land = tile(0, 0);
    const port = tile(1, 0, 'land', { isPort: true });
    const water = tile(2, 0, 'shallowWater');
    const state = setupState([land, port, water]);

    assert.throws(() => new Unit('infantry', state.factions.player1, water), /cannot occupy/);
    assert.throws(() => new Unit('warship', state.factions.player1, land), /cannot occupy/);
    assert.doesNotThrow(() => new Unit('warship', state.factions.player1, port));
    assert.doesNotThrow(() => new Unit('warship', state.factions.player1, water));
});

test('melee cannot counter across a coast while a warship keeps its range-two counter', () => {
    const water = tile(0, 0, 'deepWater');
    const coast = tile(1, 0);
    const distantLand = tile(2, 0);
    const state = setupState([water, coast, distantLand]);
    const ship = new Unit('warship', state.factions.player1, water);
    const infantry = new Unit('infantry', state.factions.player2, coast);

    assert.deepEqual(infantry.calculateCounterDamage(ship), { dmg: 0, isCrit: false });

    // Move the infantry to range two without changing its domain. Warship is
    // ranged and therefore may counter across the land/water boundary.
    coast.unit = null;
    infantry.tile = distantLand;
    distantLand.unit = infantry;
    ship.counterAttackCount = 0;
    const result = ship.calculateCounterDamage(infantry);
    assert.ok(result.dmg > 0);
    assert.equal(ship.counterAttackCount, 1);
});
