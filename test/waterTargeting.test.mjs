import assert from 'node:assert/strict';
import { test } from 'node:test';
import { resolveTargetingPreview } from '../rules/targeting.js';
import { SURFACE_KIND } from '../rules/surfaces.js';

const camp = { id: 'player1' };

function tile(q, r, surface, extra = {}) {
    return { q, r, s: -q - r, surface, terrain: 'plains', camp: surface === SURFACE_KIND.LAND ? camp : null, ...extra };
}

function state(tiles) {
    return {
        tiles,
        tileMap: new Map(tiles.map(value => [`${value.q},${value.r}`, value])),
        currentCamp: camp,
        weather: 'clear',
        mechanics: { weatherEffects: true },
        _colonelDeployed: { player1: true }
    };
}

test('deployment and airdrop targeting excludes water while non-deployment global targeting retains it', () => {
    const land = tile(0, 0, SURFACE_KIND.LAND);
    const water = tile(1, 0, SURFACE_KIND.SHALLOW_WATER);
    const gameState = state([land, water]);

    for (const [cardId, targeting] of [
        ['airdrop', 'emptyTile'],
        ['mgNest', 'emptyFriendlyNonCity'],
        ['landmine', 'emptyFriendlyLandmine']
    ]) {
        const preview = resolveTargetingPreview(gameState, { cardId, targeting }, { myCamp: camp });
        assert.equal(preview.candidateTileKeys.has('0,0'), true, `${cardId} should retain land`);
        assert.equal(preview.candidateTileKeys.has('1,0'), false, `${cardId} must reject water`);
    }

    const scout = resolveTargetingPreview(gameState, { cardId: 'scout', targeting: 'anyTileGlobal' }, { myCamp: camp });
    assert.equal(scout.candidateTileKeys.has('1,0'), true);
});

test('airlift destination cannot be water', () => {
    const sourceTile = tile(0, 0, SURFACE_KIND.LAND);
    const colonelTile = tile(0, 1, SURFACE_KIND.LAND);
    const land = tile(1, -1, SURFACE_KIND.LAND);
    const water = tile(1, 0, SURFACE_KIND.DEEP_WATER);
    const source = { id: 'transport', type: 'infantry', camp, tile: sourceTile, hp: 100, commander: null };
    const colonel = { id: 'colonel', type: 'infantry', camp, tile: colonelTile, hp: 100, commander: 'colonel' };
    sourceTile.unit = source;
    colonelTile.unit = colonel;
    const gameState = state([sourceTile, colonelTile, land, water]);
    gameState._airliftTarget = { unitId: source.id };

    const preview = resolveTargetingPreview(gameState, {
        cardId: 'airlift_dest',
        targeting: 'emptyTile'
    }, { myCamp: camp });
    assert.equal(preview.candidateTileKeys.has('1,-1'), true);
    assert.equal(preview.candidateTileKeys.has('1,0'), false);
});
