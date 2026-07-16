import test from 'node:test';
import assert from 'node:assert/strict';

import {
    ANTI_AIR_RADIUS,
    FLAK_SELF_REDUCTION,
    getAntiAirReduction,
    isAntiAirUnit,
    resolveAntiAirCoverage
} from '../rules/antiAir.js';

const P1 = { id: 'player1' };
const P2 = { id: 'player2' };
const P3 = { id: 'player3' };

function makeTile(q, r, { fortification = null, fieldFortification = null, camp = P2, unit = null } = {}) {
    return { q, r, s: -q - r, fortification, fieldFortification, camp, unit };
}

function makeUnit(type, camp, extra = {}) {
    return { id: `${type}-${camp.id}`, type, camp, hp: 100, _rank: 1, ...extra };
}

function makeMap(...tiles) {
    return new Map(tiles.map(tile => [`${tile.q},${tile.r}`, tile]));
}

function state(extra = {}) {
    return {
        factions: { player1: P1, player2: P2, player3: P3 },
        diplomacy: {
            player1: { player2: 'enemy', player3: 'enemy' },
            player2: { player1: 'enemy', player3: 'ally' },
            player3: { player1: 'enemy', player2: 'ally' }
        },
        mechanics: { fortifications: true },
        ...extra
    };
}

test('only explicit specialization or commander ability provides mobile AA', () => {
    assert.equal(isAntiAirUnit(makeUnit('archer', P2)), false);
    assert.equal(isAntiAirUnit(makeUnit('mgNest', P2)), false);
    assert.equal(isAntiAirUnit(makeUnit('archer', P2, { specializationKey: 'antiAirArtillery' })), true);
    assert.equal(isAntiAirUnit(makeUnit('destroyer', P2, { specializationKey: 'antiAirDestroyer' })), true);
    assert.equal(isAntiAirUnit(makeUnit('infantry', P2, { commander: 'staller' })), true);
});

test('legacy ownerless flak remains a 30% self-tile compatibility source', () => {
    const target = makeTile(0, 0, { fortification: 'flak' });
    const result = resolveAntiAirCoverage(target, P1, makeMap(target), { state: state(), includeSources: true });
    assert.equal(result.reduction, FLAK_SELF_REDUCTION);
    assert.equal(result.sources.length, 1);
    assert.equal(result.sources[0].ownerKnown, false);
});

test('owned flak protects its owner and allies but never the attacker', () => {
    const fort = { type: 'flak', campKey: 'player3', ownerKnown: true };
    const allyTarget = makeTile(0, 0, { camp: P2, fieldFortification: fort });
    assert.equal(getAntiAirReduction(allyTarget, P1, makeMap(allyTarget), { state: state() }), 0.30);
    assert.equal(getAntiAirReduction(allyTarget, P3, makeMap(allyTarget), { state: state() }), 0);
    const hostileTarget = makeTile(0, 0, { camp: P1, fieldFortification: fort });
    assert.equal(getAntiAirReduction(hostileTarget, P2, makeMap(hostileTarget), { state: state() }), 0);
});

test('AA percentages add directly, strengthen at rank 3 and are not layer-capped', () => {
    const target = makeTile(0, 0, { camp: P2, fieldFortification: { type: 'flak', campKey: 'player2', ownerKnown: true } });
    const artillery = makeTile(1, 0, { unit: makeUnit('archer', P2, { specializationKey: 'antiAirArtillery' }) });
    const destroyer = makeTile(0, 1, { camp: P3, unit: makeUnit('destroyer', P3, { specializationKey: 'antiAirDestroyer', _rank: 3 }) });
    const result = resolveAntiAirCoverage(target, P1, makeMap(target, artillery, destroyer), { state: state(), includeSources: true });
    assert.equal(result.reduction, 1.15);
    assert.deepEqual(result.sources.map(source => source.reduction), [0.30, 0.35, 0.50]);
});

test('radius, faction relation and mechanic gates filter sources', () => {
    const target = makeTile(0, 0, { camp: P2, fieldFortification: { type: 'flak', campKey: 'player2', ownerKnown: true } });
    const friendly = makeTile(ANTI_AIR_RADIUS, 0, { unit: makeUnit('archer', P2, { specializationKey: 'antiAirArtillery' }) });
    const enemy = makeTile(0, 1, { camp: P1, unit: makeUnit('archer', P1, { specializationKey: 'antiAirArtillery' }) });
    const tooFar = makeTile(ANTI_AIR_RADIUS + 1, 0, { unit: makeUnit('destroyer', P2, { specializationKey: 'antiAirDestroyer' }) });
    const result = resolveAntiAirCoverage(target, P1, makeMap(target, friendly, enemy, tooFar), {
        state: state({ mechanics: { fortifications: false } }), includeSources: true
    });
    assert.equal(result.reduction, 0.35);
    assert.equal(result.sources[0].unitId, friendly.unit.id);
});
