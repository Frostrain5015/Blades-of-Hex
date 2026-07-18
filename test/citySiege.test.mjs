import test from 'node:test';
import assert from 'node:assert/strict';

import {
    CITY_SIEGE_CONFIG,
    damageCityPool,
    getCityDefenseBonus,
    getCityMaxHp,
    getCityRadiusFromTileCount,
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

function cityTile(hp, { maxHp = CITY_SIEGE_CONFIG.baseMaxHp, camp = P2, unit = null } = {}) {
    return { isCity: true, hp, maxHp, camp, unit };
}

test('getCityMaxHp scales with radius: 200 at r0, +400 per ring', () => {
    assert.equal(getCityMaxHp(0), 200);
    assert.equal(getCityMaxHp(1), 600);
    assert.equal(getCityMaxHp(2), 1000);
    assert.equal(getCityMaxHp(3), 1400);
});

test('getCityRadiusFromTileCount inverts hex-disc counts (1/7/19/37)', () => {
    assert.equal(getCityRadiusFromTileCount(1), 0);
    assert.equal(getCityRadiusFromTileCount(7), 1);
    assert.equal(getCityRadiusFromTileCount(19), 2);
    assert.equal(getCityRadiusFromTileCount(37), 3);
    assert.equal(getCityRadiusFromTileCount(5), 1);
});

test('getCityDefenseBonus is 20% of the HP ratio (full=+20%, half=+10%)', () => {
    assert.equal(getCityDefenseBonus(cityTile(200)), 0.2);
    assert.equal(getCityDefenseBonus(cityTile(100)), 0.1);
    assert.equal(getCityDefenseBonus(cityTile(0)), 0);
    assert.equal(getCityDefenseBonus(cityTile(50, { maxHp: 200 })), 0.05);
    assert.equal(getCityDefenseBonus(cityTile(1000, { maxHp: 1000 })), 0.2);
    assert.equal(getCityDefenseBonus(cityTile(500, { maxHp: 1000 })), 0.1);
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

function largeCity(hp, maxHp = 600) {
    const centre = { isCity: true, isUrban: true, urbanCenterKey: '0,0', q: 0, r: 0, hp, maxHp, camp: P2 };
    const footprint = { isUrban: true, urbanCenterKey: '0,0', q: 1, r: 0, hp, maxHp, camp: P2 };
    const tileMap = new Map([['0,0', centre], ['1,0', footprint]]);
    return { centre, footprint, tileMap };
}

test('damageCityPool deducts the shared pool from any urban tile and mirrors hp', () => {
    const { centre, footprint, tileMap } = largeCity(600);
    const remaining = damageCityPool(footprint, 250, tileMap);
    assert.equal(remaining, 350);
    assert.equal(centre.hp, 350);
    assert.equal(footprint.hp, 350);
    assert.equal(footprint.maxHp, 600);
    assert.equal(damageCityPool(centre, 400, tileMap), 0, '扣到0为止不倒扣');
    assert.equal(footprint.hp, 0);
});

test('isCitySiegeBlocked covers ungarrisoned urban footprint tiles while pool hp>0', () => {
    const s = state();
    const { centre, footprint, tileMap } = largeCity(600);
    s.tileMap = tileMap;
    assert.equal(isCitySiegeBlocked(footprint, P1, s), true, '城郭格hp>0同样封锁');
    centre.hp = 0; footprint.hp = 0;
    assert.equal(isCitySiegeBlocked(footprint, P1, s), false, '血池归零后城郭格放开');
});
