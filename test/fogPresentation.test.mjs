import test from 'node:test';
import assert from 'node:assert/strict';

const canvasContext = { setTransform() {} };
globalThis.document = {
    getElementById() {
        return { getContext: () => canvasContext, style: {} };
    }
};

const {
    beginFogPresentationHold,
    getPresentedTileVisibilityState,
    isTileVisible,
    revealFogTiles,
    updateAllFogOfWar
} = await import('../js/fogOfWar.js');
const {
    TRIGGER_ACTIONS,
    createDefaultLevel,
    validateLevel
} = await import('../campaign/runtime/schema.js');

function tile(q, r) {
    return { q, r, s: -q - r, terrain: 'plains', unit: null, isCity: false, isVillage: false };
}

function stateFor(tiles, camp) {
    return {
        skirmishFog: true,
        mechanics: { fogOfWar: true, alliedVision: false, weatherEffects: true },
        weather: 'clear',
        tiles,
        tileMap: new Map(tiles.map(value => [`${value.q},${value.r}`, value])),
        factions: { player1: camp, neutral: { id: 'neutral', active: false } },
        visibleTiles: { player1: new Set(), neutral: new Set() },
        exploredTiles: { player1: new Set(), neutral: new Set() },
        scoutReveals: { player1: new Map(), neutral: new Map() },
        _prevVisibleTiles: { player1: new Set(), neutral: new Set() },
        _fogPresentationHolds: {},
        _fogTransitionStart: 0,
        turnCounter: 0
    };
}

test('weather-driven vision recalculation applies immediately to every faction', () => {
    const camp = { id: 'player1', active: true };
    const tiles = [tile(0, 0), tile(1, 0), tile(2, 0), tile(3, 0)];
    tiles[0].unit = { camp, type: 'archer', config: { range: 3 }, tile: tiles[0] };
    const state = stateFor(tiles, camp);

    updateAllFogOfWar(state);
    assert.equal(isTileVisible(tiles[3], camp, state), true);
    state.weather = 'fog';
    updateAllFogOfWar(state);
    assert.equal(isTileVisible(tiles[3], camp, state), false);
    assert.equal(isTileVisible(tiles[2], camp, state), true);
});

test('movement presentation holds new intelligence until the badge arrives', () => {
    const camp = { id: 'player1', active: true };
    const origin = tile(0, 0);
    const destination = tile(2, 0);
    const tiles = [origin, tile(1, 0), destination];
    const unit = { camp, type: 'infantry', config: { range: 1 }, tile: origin };
    origin.unit = unit;
    const state = stateFor(tiles, camp);
    updateAllFogOfWar(state);
    assert.equal(isTileVisible(destination, camp, state), false);

    assert.equal(beginFogPresentationHold(state, camp, 1000), true);
    origin.unit = null;
    destination.unit = unit;
    unit.tile = destination;
    updateAllFogOfWar(state);

    assert.equal(isTileVisible(destination, camp, state), true, 'simulation vision updates immediately');
    assert.equal(getPresentedTileVisibilityState(destination, camp, state), 'unexplored',
        'rendering keeps destination intelligence covered during movement');
});

test('scripted reveals support permanent and finite exact-tile visibility', () => {
    const camp = { id: 'player1', active: true };
    const target = tile(3, 0);
    const state = stateFor([target], camp);
    assert.equal(revealFogTiles(state, camp, [target]), 1);
    assert.equal(state.scoutReveals.player1.get('3,0'), Number.MAX_SAFE_INTEGER);
    assert.equal(isTileVisible(target, camp, state), true);

    state.scoutReveals.player1.clear();
    assert.equal(revealFogTiles(state, camp, [target], 2), 1);
    assert.equal(state.scoutReveals.player1.get('3,0'), 2);
});

test('campaign schema exposes and validates the AoE-style tile reveal action', () => {
    assert.equal(TRIGGER_ACTIONS.find(action => action.kind === 'revealTiles')?.arg, 'fogReveal');

    const level = createDefaultLevel();
    level.areas = [{ id: 'archive', label: '档案区', tiles: [{ q: 1, r: 0 }] }];
    level.triggers = [{
        id: 'reveal-archive',
        enabled: true,
        once: true,
        when: [],
        do: [{
            kind: 'revealTiles',
            camp: 'player1',
            target: { area: 'archive' },
            durationRounds: 2
        }]
    }];
    assert.deepEqual(validateLevel(level).errors, []);

    level.triggers[0].do[0].durationRounds = 0;
    assert.ok(validateLevel(level).errors.some(message => message.includes('持续回合必须是正整数')));
});
