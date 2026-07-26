import test from 'node:test';
import assert from 'node:assert/strict';

import {
    UNIT_CONFIG,
    getSpecializationAbilityValue,
    isRankLockedUnit,
    isStaticBattleStructure,
    resolveUnitRankProfile
} from '../rules/units.js';
import {
    CONSTRUCTION_CONFIG,
    DEFENSE_CONSTRUCTION_SUPPORT_RANGE,
    canBuildBunkerAt,
    canBuildFieldFortification,
    canBuildFieldFortificationAt,
    canBuildLaserTowerAt,
    canBuildShoreBatteryAt,
    canBuildAirfieldAt,
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
    assert.equal(resolveUnitRankProfile('archer', 2, 'antiAirArtillery').attack, 55,
        '防空炮保留普通攻击，防空火力是附加能力');
});

test('建筑锁定军衔，航母把2阶攻击奖励映射为航空火力', () => {
    assert.equal(isRankLockedUnit('mgNest'), true);
    assert.equal(isRankLockedUnit('shoreBattery'), true);
    assert.equal(isRankLockedUnit('drone'), true);
    // 固定火力点（无目标时自动跳过行动）：碉堡/岸防炮算，可移动的无人机不算
    assert.equal(isStaticBattleStructure('mgNest'), true);
    assert.equal(isStaticBattleStructure('shoreBattery'), true);
    assert.equal(isStaticBattleStructure('drone'), false);
    assert.equal(isStaticBattleStructure('infantry'), false);
    const carrier = resolveUnitRankProfile('carrier', 2, null);
    assert.equal(carrier.carrierAirPowerBonus, 10);
    assert.equal(carrier.unbranchedReward.damageBonus, 0.15);
});

test('通用建设与工程师折扣、机场逐城建设资格使用规则层单一配置', () => {
    const engineer = { commander: 'engineer' };
    assert.equal(constructionCost('trench'), CONSTRUCTION_CONFIG.trench.cost);
    assert.equal(constructionCost('trench', engineer), CONSTRUCTION_CONFIG.trench.engineerCost);
    assert.equal(constructionCost('bunker', engineer), 7);
    assert.equal(constructionCost('airfield', null, { unit: engineer }), 7);
    assert.equal(constructionCost('shoreBattery'), 10);

    const camp = { id: 'player1' };
    const state = { tiles: Array.from({ length: 4 }, () => ({ isCity: true, camp })) };
    assert.equal(getAirfieldCap(state, camp), Number.POSITIVE_INFINITY);
    state.airfieldCapOverrides = { player1: 3 };
    assert.equal(getAirfieldCap(state, camp), Number.POSITIVE_INFINITY);
    const availableCity = state.tiles[3];
    availableCity.hp = 300;
    state.mechanics = { airCommands: true };
    for (const city of state.tiles.slice(0, 3)) city.installation = { type: 'airfield', status: 'ready' };
    assert.equal(canBuildAirfieldAt(availableCity, camp, state), true,
        '已有任意数量机场时，无机场的己方城市仍可付费建设');
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

test('常驻建设规则：地形工事覆盖己方行政区，并允许己军脚下的非己方行政区', () => {
    const camp = { id: 'player1' };
    const enemy = { id: 'player2' };
    const owned = { q: 0, r: 0, surface: 'land', playable: true, camp, unit: null, fortification: null, fieldFortification: null };
    const occupiedEnemy = { q: 1, r: 0, surface: 'land', playable: true, camp: enemy, fortification: null, fieldFortification: null };
    occupiedEnemy.unit = { hp: 100, camp };
    const unsupportedEnemy = { q: 2, r: 0, surface: 'land', playable: true, camp: enemy, unit: null, fortification: null, fieldFortification: null };
    const state = { currentCamp: camp, mechanics: { fortifications: true }, tiles: [owned, occupiedEnemy, unsupportedEnemy] };

    assert.equal(canBuildFieldFortificationAt(owned, 'trench', camp, state), true);
    assert.equal(canBuildFieldFortificationAt(occupiedEnemy, 'flak', camp, state), true);
    assert.equal(canBuildFieldFortificationAt(unsupportedEnemy, 'trench', camp, state), false);
    owned.fortification = 'trench';
    assert.equal(canBuildFieldFortificationAt(owned, 'flak', camp, state), false, '同一格不得叠加地形工事');
});

test('常驻建设规则：防御建筑覆盖己方行政区，非己方行政区以任意己军6格支援', () => {
    const camp = { id: 'player1' };
    const enemy = { id: 'player2' };
    const support = { q: 0, r: 0, s: 0, surface: 'land', playable: true, camp: enemy };
    support.unit = { hp: 100, camp };
    const ownedFar = { q: 12, r: 0, s: -12, surface: 'land', playable: true, camp, unit: null };
    const enemyAtSix = { q: DEFENSE_CONSTRUCTION_SUPPORT_RANGE, r: 0, s: -DEFENSE_CONSTRUCTION_SUPPORT_RANGE, surface: 'land', playable: true, camp: enemy, unit: null };
    const enemyAtSeven = { q: DEFENSE_CONSTRUCTION_SUPPORT_RANGE + 1, r: 0, s: -(DEFENSE_CONSTRUCTION_SUPPORT_RANGE + 1), surface: 'land', playable: true, camp: enemy, unit: null };
    const state = { currentCamp: camp, mechanics: { fortifications: true }, tiles: [support, ownedFar, enemyAtSix, enemyAtSeven] };

    assert.equal(canBuildBunkerAt(camp, ownedFar, state), true, '己方行政区不受部队距离限制');
    assert.equal(canBuildLaserTowerAt(camp, enemyAtSix, state), true);
    assert.equal(canBuildLaserTowerAt(camp, enemyAtSeven, state), false);
    enemyAtSix.unit = { hp: 100, camp };
    assert.equal(canBuildBunkerAt(camp, enemyAtSix, state), false, '防御建筑只能建在空地');
    enemyAtSix.unit = null;
    enemyAtSix.fortification = 'trench';
    assert.equal(canBuildBunkerAt(camp, enemyAtSix, state), false, '防御建筑不得覆盖已有地形工事');
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
