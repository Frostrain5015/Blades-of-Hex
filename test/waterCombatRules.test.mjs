import assert from 'node:assert/strict';
import { test } from 'node:test';

const context = {};
globalThis.document = {
    getElementById() {
        return { getContext: () => context };
    }
};
globalThis.localStorage = { getItem: () => null, setItem: () => {} };

const [{ Unit, setGameStateRef, setLogMessageRef }, { EngineHexTile }, { createMatchState, restoreMatchState, serializeMatchState }] = await Promise.all([
    import('../js/Unit.js'),
    import('../engine/HexTile.js'),
    import('../engine/matchState.js')
]);
const [{ areCommanderMechanicsSuppressed, canUnitAssaultOccupiedTile, getTransportBaseDefense, resolveMovementStep }, { getCommander }] = await Promise.all([
    import('../rules/movement.js'),
    import('../commander/index.js')
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
    const port = tile(1, 0, 'shallowWater', { isPort: true });
    const water = tile(2, 0, 'deepWater');
    const state = setupState([land, port, water]);

    assert.throws(() => new Unit('infantry', state.factions.player1, water), /cannot occupy/);
    assert.throws(() => new Unit('warship', state.factions.player1, land), /cannot occupy/);
    assert.doesNotThrow(() => new Unit('warship', state.factions.player1, port));
    assert.doesNotThrow(() => new Unit('warship', state.factions.player1, water));
    const transport = new Unit('cavalry', state.factions.player1, water, false, null, null, { isEmbarked: true });
    assert.equal(transport.isEmbarked, true);
    assert.equal(transport.getEffectiveSpeed(), 4);
});

test('melee may counter across a coast and a cruiser keeps its ranged counter', () => {
    const water = tile(0, 0, 'deepWater');
    const coast = tile(1, 0);
    const distantLand = tile(2, 0);
    const state = setupState([water, coast, distantLand]);
    const ship = new Unit('warship', state.factions.player1, water);
    const infantry = new Unit('infantry', state.factions.player2, coast);

    assert.ok(infantry.calculateCounterDamage(ship).dmg > 0);

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

test('embarked transport state and four-point speed cap survive snapshot restore', () => {
    const land = tile(0, 0);
    const water = tile(1, 0, 'shallowWater');
    const match = setupState([land, water]);
    const transport = new Unit('cavalry', match.factions.player1, water, false, 501, null, { isEmbarked: true });
    transport.remainingMP = 4;
    transport._transportTransitionedThisTurn = true;
    const snapshot = serializeMatchState(match);
    assert.equal(snapshot.tiles.find(entry => entry.q === 1).unit.isEmbarked, true);
    assert.equal(snapshot.tiles.find(entry => entry.q === 1).unit.transportTransitionedThisTurn, true);

    const restored = createMatchState();
    restoreMatchState(restored, snapshot, {
        HexTileClass: EngineHexTile,
        UnitClass: Unit,
        computeCampBorders: () => [],
        computeDistrictBorders: () => []
    });
    const restoredTransport = restored.tileMap.get('1,0').unit;
    assert.equal(restoredTransport.isEmbarked, true);
    assert.equal(restoredTransport.getEffectiveSpeed(), 4);
    assert.equal(restoredTransport.remainingMP, 4);
    assert.equal(restoredTransport._transportTransitionedThisTurn, true);
});

test('transport locks attack to 20 before retained commander percentage and locks range to one', () => {
    const water = tile(0, 0, 'shallowWater');
    const state = setupState([water]);
    const transport = new Unit('cavalry', state.factions.player1, water, false, 601, 'centurion', { isEmbarked: true });

    assert.equal(transport.getEffectiveAttack(), 28);
    assert.equal(transport.getEffectiveRange(), 1);
    assert.equal(areCommanderMechanicsSuppressed(transport), true);
    const effect = transport.getTimedEffects(state).find(item => item.label === '运输状态');
    assert.equal(effect?.desc, '正处于海洋地块，攻击力下降至20，防御力下降至-25%');
});

test('deep-water transport uses minus fifty percent base defense and may assault an occupied coast', () => {
    const deepWater = tile(0, 0, 'deepWater');
    const coast = tile(1, 0);
    const state = setupState([deepWater, coast]);
    const transport = new Unit('infantry', state.factions.player1, deepWater, false, 606, null, { isEmbarked: true });

    assert.equal(getTransportBaseDefense(transport), -0.5);
    assert.equal(canUnitAssaultOccupiedTile(transport, coast), true);
    assert.equal(transport.getTimedEffects(state).find(item => item.label === '运输状态')?.desc,
        '正处于深水地块，攻击力下降至20，防御力下降至-50%');
});

test('landing transition blocks attacks and counters for the transition turn', () => {
    const water = tile(0, 0, 'shallowWater');
    const enemyWater = tile(1, 0, 'deepWater');
    const state = setupState([water, enemyWater]);
    const transport = new Unit('archer', state.factions.player1, water, false, 602, null, {
        isEmbarked: true,
        transitionedThisTurn: true
    });
    const enemy = new Unit('warship', state.factions.player2, enemyWater);

    assert.deepEqual(transport.calculateCounterDamage(enemy), { dmg: 0, isCrit: false });
});

test('primed martyr cannot embark', () => {
    const land = tile(0, 0);
    const water = tile(1, 0, 'shallowWater');
    const state = setupState([land, water]);
    const martyr = new Unit('infantry', state.factions.player1, land, false, 603, 'martyr');
    martyr._martyrPrimed = true;

    const step = resolveMovementStep(martyr, land, water, state, { baseCost: 1 });
    assert.equal(step.allowed, false);
    assert.equal(step.reason, 'martyr-primed');
});

test('naval magician keeps ship form after killing transported land unit but gains a stack', () => {
    const shipWater = tile(0, 0, 'deepWater');
    const targetWater = tile(1, 0, 'shallowWater');
    const state = setupState([shipWater, targetWater]);
    const magician = new Unit('warship', state.factions.player1, shipWater, false, 604, 'magician');
    const victim = new Unit('infantry', state.factions.player2, targetWater, false, 605, null, { isEmbarked: true });
    const result = getCommander('magician').onKill(magician, victim, {
        spawnFx() {}, spawnExplosion() {}, logMessage() {}
    });

    assert.equal(magician.type, 'warship');
    assert.equal(magician._phantomStacks, 1);
    assert.equal(result.transformed, false);
});
