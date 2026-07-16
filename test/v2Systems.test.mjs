import test from 'node:test';
import assert from 'node:assert/strict';

import {
    UNIT_CONFIG,
    getSpecializationAbilityValue,
    isRankLockedUnit,
    resolveUnitRankProfile
} from '../rules/units.js';
import {
    CONSTRUCTION_CONFIG,
    canBuildFieldFortification,
    canBuildShoreBatteryAt,
    constructionCost,
    getAirfieldCap
} from '../rules/construction.js';
import { createDefaultLevel, validateLevel } from '../campaign/runtime/schema.js';

test('0阶标准型、待专精与选定专精使用同一确定性军衔映射', () => {
    const base = resolveUnitRankProfile('infantry', 0, null);
    assert.equal(base.hp, UNIT_CONFIG.infantry.hp);
    assert.equal(base.pendingSpecialization, false);

    const pending = resolveUnitRankProfile('infantry', 2, null);
    assert.equal(pending.pendingSpecialization, true);
    assert.equal(pending.hp, UNIT_CONFIG.infantry.hp, '待选择期间不提前获得2阶奖励');

    const selected = resolveUnitRankProfile('infantry', 2, 'garrisonInfantry');
    assert.equal(selected.pendingSpecialization, false);
    assert.equal(selected.hp, 215);
    assert.equal(selected.attack, 50);
    assert.equal(getSpecializationAbilityValue({ type: 'infantry', specializationKey: 'garrisonInfantry', _rank: 3 }, 'cityRegen'), 0.20);
});

test('建筑锁定军衔，航母把2阶攻击奖励映射为航空火力', () => {
    assert.equal(isRankLockedUnit('mgNest'), true);
    assert.equal(isRankLockedUnit('shoreBattery'), true);
    assert.equal(isRankLockedUnit('drone'), true);
    const carrier = resolveUnitRankProfile('carrier', 2, null);
    assert.equal(carrier.carrierAirPowerBonus, 10);
    assert.equal(carrier.unbranchedReward.damageBonus, 0.15);
});

test('通用建设与工程师折扣、机场上限使用规则层单一配置', () => {
    const engineer = { commander: 'engineer' };
    assert.equal(constructionCost('trench'), CONSTRUCTION_CONFIG.trench.cost);
    assert.equal(constructionCost('trench', engineer), CONSTRUCTION_CONFIG.trench.engineerCost);
    assert.equal(constructionCost('bunker', engineer), 7);
    assert.equal(constructionCost('airfield', null, { unit: engineer }), 7);
    assert.equal(constructionCost('shoreBattery'), 10);

    const camp = { id: 'player1' };
    const state = { tiles: Array.from({ length: 4 }, () => ({ isCity: true, camp })) };
    assert.equal(getAirfieldCap(state, camp), 2);
    state.airfieldCapOverrides = { player1: 3 };
    assert.equal(getAirfieldCap(state, camp), 3);
});

test('岸防炮使用统一建设规则而非沿岸招募入口', () => {
    const camp = { id: 'player1' };
    const coast = { q: 0, r: 0, surface: 'land', playable: true, camp, unit: null };
    const water = { q: 1, r: 0, surface: 'shallowWater', playable: true, camp: null, unit: null };
    const state = {
        currentCamp: camp,
        mechanics: { fortifications: true },
        tiles: [coast, water],
        tileMap: new Map([['0,0', coast], ['1,0', water]]),
        turnCounter: 0,
        turnOrder: ['player1', 'player2']
    };
    assert.equal(canBuildShoreBatteryAt(coast, camp, state), true);
    state.shoreBatteryBuiltRound = { player1: 0 };
    assert.equal(canBuildShoreBatteryAt(coast, camp, state), false, '阵营共享冷却继续生效');
});

test('地面部队可在中立或敌控陆地就地修建战壕与高射机枪', () => {
    const camp = { id: 'player1' };
    const occupiedTile = {
        q: 0, r: 0, surface: 'land', playable: true,
        camp: { id: 'neutral' }, fortification: null, fieldFortification: null
    };
    const unit = {
        hp: 100, camp: { id: 'player1' }, tile: occupiedTile,
        config: { movementDomain: 'land' }, canAct: true, isNewRecruit: false,
        isEmbarked: false, _isDrone: false
    };
    const state = {
        currentCamp: camp,
        mechanics: { fortifications: true }
    };
    assert.equal(canBuildFieldFortification(unit, 'trench', state), true);
    assert.equal(canBuildFieldFortification(unit, 'flak', state), true);
});

test('战役 schema 接受机场、军衔专精和精确专精数量条件', () => {
    const level = createDefaultLevel();
    level.factions[0].airfieldCap = 1;
    level.board.installations.push({
        q: 0, r: 0, type: 'airfield', status: 'ready',
        airCommandReadyRound: { bombing: 2 }
    });
    level.units.push({
        id: 'guard', type: 'infantry', camp: 'player1', q: 0, r: 0,
        rank: 1, specializationKey: 'garrisonInfantry', hpPct: 100, morale: 2, canAct: true
    });
    level.triggers.push({
        id: 'guard_ready', enabled: true, once: true,
        when: [{ kind: 'factionUnitCount', camp: 'player1', type: 'infantry', specializationKey: 'garrisonInfantry', op: '>=', value: 1 }],
        do: [{ kind: 'showStep', mode: 'narrator', text: '守军就位。' }]
    });
    const valid = validateLevel(level);
    assert.deepEqual(valid.errors, []);

    level.triggers[0].when[0].specializationKey = 'heavyCavalry';
    assert.match(validateLevel(level).errors.join('\n'), /专精筛选/);
});
