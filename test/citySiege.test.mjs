import test from 'node:test';
import assert from 'node:assert/strict';

import {
    CITY_SIEGE_CONFIG,
    getCityDefenseBonus,
    getCityRegenAmount,
    isCityDisabled,
    isCitySiegeBlocked,
    isSiegeableCityTile
} from '../rules/citySiege.js';
import { isStrongpointTarget } from '../rules/units.js';

const P1 = { id: 'player1' };
const P2 = { id: 'player2' };
const NEUTRAL = { id: 'neutral' };

function state(extra = {}) {
    return {
        factions: { player1: P1, player2: P2, neutral: NEUTRAL },
        diplomacy: {
            player1: { player2: 'enemy' },
            player2: { player1: 'enemy' }
        },
        ...extra
    };
}

function cityTile(hp, { maxHp = CITY_SIEGE_CONFIG.maxHp, camp = P2, unit = null } = {}) {
    return { isCity: true, hp, maxHp, camp, unit };
}

test('getCityDefenseBonus converts current HP at 8%/100hp, using current not max HP', () => {
    assert.equal(getCityDefenseBonus(cityTile(200)), 0.16);
    assert.equal(getCityDefenseBonus(cityTile(100)), 0.08);
    assert.equal(getCityDefenseBonus(cityTile(0)), 0);
    assert.equal(getCityDefenseBonus(cityTile(50, { maxHp: 200 })), 0.04);
});

test('getCityRegenAmount is 10% of maxHp regardless of current HP', () => {
    assert.equal(getCityRegenAmount(cityTile(0)), 20);
    assert.equal(getCityRegenAmount(cityTile(200)), 20);
    assert.equal(getCityRegenAmount({ isCity: true, hp: 0, maxHp: 150 }), 15);
});

test('isCityDisabled is true only at hp<=0 on a city tile', () => {
    assert.equal(isCityDisabled(cityTile(0)), true);
    assert.equal(isCityDisabled(cityTile(1)), false);
    assert.equal(isCityDisabled({ isCity: false, hp: 0 }), false);
});

test('isCitySiegeBlocked: empty enemy/neutral city with hp>0 blocks entry; garrisoned, hp=0, or friendly does not', () => {
    const s = state();
    assert.equal(isCitySiegeBlocked(cityTile(200, { camp: P2 }), P1, s), true, '空敌城hp>0应封锁');
    assert.equal(isCitySiegeBlocked(cityTile(200, { camp: P2, unit: {} }), P1, s), false, '有驻军不算封锁（驻军按常规单位战斗判定）');
    assert.equal(isCitySiegeBlocked(cityTile(0, { camp: P2 }), P1, s), false, 'hp=0城墙已破，不封锁');
    assert.equal(isCitySiegeBlocked(cityTile(200, { camp: P1 }), P1, s), false, '己方城市不封锁自己');
    assert.equal(isCitySiegeBlocked(cityTile(200, { camp: NEUTRAL }), P1, s), true, '中立空城hp>0同样封锁');
});

test('isSiegeableCityTile excludes submarine and carrier, otherwise matches isCitySiegeBlocked', () => {
    const s = state();
    const enemyEmptyCity = cityTile(200, { camp: P2 });
    assert.equal(isSiegeableCityTile({ type: 'infantry', camp: P1 }, enemyEmptyCity, s), true);
    assert.equal(isSiegeableCityTile({ type: 'destroyer', camp: P1 }, enemyEmptyCity, s), true);
    assert.equal(isSiegeableCityTile({ type: 'submarine', camp: P1 }, enemyEmptyCity, s), false);
    assert.equal(isSiegeableCityTile({ type: 'carrier', camp: P1 }, enemyEmptyCity, s), false);
});

test('isStrongpointTarget covers city/fortification tiles and building-type units, excluding drone', () => {
    assert.equal(isStrongpointTarget({ tile: { isCity: true } }), true);
    assert.equal(isStrongpointTarget({ tile: { fortification: 'trench' } }), true);
    assert.equal(isStrongpointTarget({ tile: { isCity: false, fortification: null } }), false);
    assert.equal(isStrongpointTarget({ type: 'mgNest', tile: {} }), true);
    assert.equal(isStrongpointTarget({ type: 'shoreBattery', tile: {} }), true);
    assert.equal(isStrongpointTarget({ type: 'drone', tile: {} }), false);
    assert.equal(isStrongpointTarget({ type: 'infantry', tile: {} }), false);
    assert.equal(isStrongpointTarget(null), false);
});
