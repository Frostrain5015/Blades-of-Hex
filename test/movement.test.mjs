import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildRiverTopology } from '../rules/hydrography.js';
import {
    MOVEMENT_DOMAIN,
    canUnitOccupyTile,
    isLandDeploymentTile,
    resolveMovementStep,
    sharedHexEdgeSegmentKey
} from '../rules/movement.js';
import { SURFACE_KIND } from '../rules/surfaces.js';

function tile(q, r, surface = SURFACE_KIND.LAND, extra = {}) {
    return { q, r, s: -q - r, surface, terrain: 'plains', ...extra };
}

function stateFor(tiles, river = null, crossing = null) {
    return {
        tiles,
        tileMap: new Map(tiles.map(value => [`${value.q},${value.r}`, value])),
        riverTopology: buildRiverTopology(river ? [river] : [], crossing ? [crossing] : []),
        portTiles: new Map(tiles.filter(value => value.isPort).map(value => [`${value.q},${value.r}`, value]))
    };
}

test('legacy units remain land-only and deployments reject water/render-only tiles', () => {
    const land = tile(0, 0);
    const water = tile(1, 0, SURFACE_KIND.SHALLOW_WATER);
    assert.equal(canUnitOccupyTile('infantry', land), true);
    assert.equal(canUnitOccupyTile('infantry', water), false);
    assert.equal(isLandDeploymentTile(land), true);
    assert.equal(isLandDeploymentTile(water), false);
    assert.equal(isLandDeploymentTile({ ...land, renderOnly: true }), false);
});

test('warships occupy only water or authored land ports', () => {
    const land = tile(0, 0);
    const port = tile(1, 0, SURFACE_KIND.LAND, { isPort: true });
    const shallow = tile(2, 0, SURFACE_KIND.SHALLOW_WATER);
    const deep = tile(3, 0, SURFACE_KIND.DEEP_WATER);
    assert.equal(canUnitOccupyTile('warship', land), false);
    assert.equal(canUnitOccupyTile('warship', port), true);
    assert.equal(canUnitOccupyTile('warship', shallow), true);
    assert.equal(canUnitOccupyTile('warship', deep), true);
});

test('land armies embark from any coast, normal beaches drain movement and ports waive the extra cost', () => {
    const coast = tile(0, 0);
    const water = tile(1, 0, SURFACE_KIND.SHALLOW_WATER);
    const state = stateFor([coast, water]);
    const amphibious = { movementDomain: MOVEMENT_DOMAIN.AMPHIBIOUS };
    assert.equal(resolveMovementStep(amphibious, coast, water, state).allowed, true);
    const beachEmbark = resolveMovementStep('infantry', coast, water, state);
    assert.equal(beachEmbark.allowed, true);
    assert.equal(beachEmbark.drainRemaining, true);
    assert.equal(beachEmbark.transportSpeedCap, 4);
    assert.equal(resolveMovementStep('warship', coast, water, state).allowed, false);

    water.isPort = true;
    const portEmbark = resolveMovementStep('infantry', coast, water, state);
    assert.equal(portEmbark.allowed, true);
    assert.equal(portEmbark.drainRemaining, false);
    assert.equal(portEmbark.transportSpeedCap, 4);
    assert.equal(canUnitOccupyTile({ type: 'infantry', isEmbarked: true }, water, state), true);
});

test('shared movement edge maps exactly to authored river segment', () => {
    const from = tile(0, 0);
    const to = tile(1, 0);
    const river = {
        id: 'east-edge',
        width: 'stream',
        points: [{ q: 0, r: 0, vertex: 5 }, { q: 0, r: 0, vertex: 0 }]
    };
    const state = stateFor([from, to], river);
    assert.equal(sharedHexEdgeSegmentKey(from, to), state.riverTopology.segments[0].key);
});

test('bridge costs +0, ford costs +2, direct crossing drains all MP', () => {
    const from = tile(0, 0);
    const to = tile(1, 0);
    const makeRiver = () => ({
        id: 'main',
        width: 'river',
        points: [{ q: 0, r: 0, vertex: 5 }, { q: 0, r: 0, vertex: 0 }]
    });

    const directStep = resolveMovementStep('infantry', from, to, stateFor([from, to], makeRiver()), { baseCost: 1 });
    assert.equal(directStep.allowed, true);
    assert.equal(directStep.drainRemaining, true);
    assert.equal(directStep.cost, 1);

    const bridge = { riverId: 'main', segmentIndex: 0, kind: 'bridge' };
    const bridgeStep = resolveMovementStep('infantry', from, to, stateFor([from, to], makeRiver(), bridge), { baseCost: 1 });
    assert.equal(bridgeStep.allowed, true);
    assert.equal(bridgeStep.cost, 1);
    assert.equal(bridgeStep.drainRemaining, false);

    const ford = { riverId: 'main', segmentIndex: 0, kind: 'ford' };
    const fordStep = resolveMovementStep('infantry', from, to, stateFor([from, to], makeRiver(), ford), { baseCost: 1 });
    assert.equal(fordStep.allowed, true);
    assert.equal(fordStep.cost, 3);
    assert.equal(fordStep.drainRemaining, false);
});

test('naval movement ignores land river crossing costs while staying on water/ports', () => {
    const port = tile(0, 0, SURFACE_KIND.LAND, { isPort: true });
    const water = tile(1, 0, SURFACE_KIND.SHALLOW_WATER);
    const river = {
        id: 'estuary',
        width: 'river',
        points: [{ q: 0, r: 0, vertex: 5 }, { q: 0, r: 0, vertex: 0 }]
    };
    const step = resolveMovementStep('warship', port, water, stateFor([port, water], river), { baseCost: 1 });
    assert.equal(step.allowed, true);
    assert.equal(step.cost, 1);
});

test('rivers affect land crossings only and do not block amphibious coast transitions', () => {
    const land = tile(0, 0);
    const water = tile(1, 0, SURFACE_KIND.SHALLOW_WATER);
    const river = {
        id: 'river-mouth',
        width: 'river',
        points: [{ q: 0, r: 0, vertex: 5 }, { q: 0, r: 0, vertex: 0 }]
    };
    const amphibious = { movementDomain: MOVEMENT_DOMAIN.AMPHIBIOUS };
    const step = resolveMovementStep(amphibious, land, water, stateFor([land, water], river), { baseCost: 1 });
    assert.equal(step.allowed, true);
    assert.equal(step.cost, 1);
    assert.equal(step.river.kind, null);
});
