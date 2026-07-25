// test/tianheng.test.mjs — 天衡【日月天衡】规则层（充能制被动）：
//   激活判定、剩余行动力充能、满阈值自动释放（全军护盾+士气+暴击+全图视野）、
//   充能进度、序列化/恢复、旧版兼容 no-op。
import assert from 'node:assert/strict';
import { test } from 'node:test';

const context = {};
globalThis.document = { getElementById() { return { getContext: () => context }; } };
globalThis.localStorage = { getItem: () => null, setItem: () => {} };
globalThis.performance = globalThis.performance || { now: () => Date.now() };

const [tianhengRules, stateModule, unitModule, tileModule, turnsModule] = await Promise.all([
    import('../rules/tianheng.js'),
    import('../engine/matchState.js'),
    import('../js/Unit.js'),
    import('../engine/HexTile.js'),
    import('../rules/turns.js')
]);

const {
    SUN_MOON_CHARGE_THRESHOLD, SUN_MOON_SHIELD_AMOUNT,
    SUN_MOON_OATH_CRIT_BONUS, SUN_MOON_OATH_DURATION_ROUNDS,
    hasTianhengSynergyActive, getLivingTianhengCommanders, getLivingCampUnits,
    getUnusedMovementCharge,
    resolveBorrowDay, accrueSunMoonCharge, getSunMoonChargeRatio,
    getSunMoonOathRemainingRounds, hasSunMoonOathEffect, getSunMoonOathCritBonus,
    hasBorrowDayPaybackPending, applyBorrowDayPayback
} = tianhengRules;

const { createMatchState, serializeMatchState, restoreMatchState } = stateModule;
const { Unit, setGameStateRef, setLogMessageRef } = unitModule;
const { EngineHexTile } = tileModule;
const { getRoundIndex } = turnsModule;

function setup(tileCount = 8) {
    const state = createMatchState();
    const tiles = Array.from({ length: tileCount }, (_, i) => new EngineHexTile(i, 0));
    state.tiles = tiles;
    state.tileMap = new Map(tiles.map(t => [`${t.q},${t.r}`, t]));
    state.damageTexts = []; state.healTexts = []; state.goldTexts = [];
    setGameStateRef(state);
    setLogMessageRef(() => {});
    return { state, tiles };
}

function spawnTianhengPair(state, tiles) {
    const astro = new Unit('infantry', state.factions.player1, tiles[1], false, 301, 'astrologer');
    const staller = new Unit('infantry', state.factions.player1, tiles[2], false, 302, 'staller');
    return { astro, staller };
}

// ===== 激活判定 =====
test('≥2 天衡将领 → 激活；仅 1 名 → 不激活；打掉一名 → 失活', () => {
    const { state, tiles } = setup();
    const astro = new Unit('infantry', state.factions.player1, tiles[1], false, 301, 'astrologer');
    assert.equal(hasTianhengSynergyActive(state, state.factions.player1), false);
    new Unit('infantry', state.factions.player1, tiles[2], false, 302, 'staller');
    assert.equal(hasTianhengSynergyActive(state, state.factions.player1), true);
    assert.equal(getLivingTianhengCommanders(state, 'player1').length, 2);
    astro.hp = 0;
    assert.equal(hasTianhengSynergyActive(state, state.factions.player1), false);
});

// ===== 充能门槛（平衡数值守卫）=====
test('SUN_MOON_CHARGE_THRESHOLD 为约定值（改动需刻意）', () => {
    assert.equal(SUN_MOON_CHARGE_THRESHOLD, 100);
});

test('暴击加护数值为约定值（改动需刻意）', () => {
    assert.equal(SUN_MOON_OATH_CRIT_BONUS, 0.30);
    assert.equal(SUN_MOON_OATH_DURATION_ROUNDS, 2);
});

// ===== 充能累积 =====
test('accrueSunMoonCharge: 未激活不累积、不触发', () => {
    const { state, tiles } = setup();
    const astro = new Unit('infantry', state.factions.player1, tiles[1], false, 301, 'astrologer'); // 仅 1 名
    astro.hp = astro.maxHp;
    assert.deepEqual(accrueSunMoonCharge(state, 'player1', SUN_MOON_CHARGE_THRESHOLD * 2), []);
    assert.equal(getSunMoonChargeRatio(state, 'player1'), 0);
});

test('accrueSunMoonCharge: 激活时累积，未满阈值不触发', () => {
    const { state, tiles } = setup();
    spawnTianhengPair(state, tiles);
    const affected = accrueSunMoonCharge(state, 'player1', SUN_MOON_CHARGE_THRESHOLD - 1);
    assert.deepEqual(affected, [], '未满阈值不释放');
    assert.equal(state._sunMoonCharge.player1, SUN_MOON_CHARGE_THRESHOLD - 1);
    assert.equal(
        getSunMoonChargeRatio(state, 'player1'),
        (SUN_MOON_CHARGE_THRESHOLD - 1) / SUN_MOON_CHARGE_THRESHOLD
    );
});

test('accrueSunMoonCharge: 跨阈值→释放、返回受影响单位、扣除阈值保留溢出', () => {
    const { state, tiles } = setup();
    spawnTianhengPair(state, tiles);
    const soldier = new Unit('infantry', state.factions.player1, tiles[3], false, 310);
    // 攒到差 5 点满
    accrueSunMoonCharge(state, 'player1', SUN_MOON_CHARGE_THRESHOLD - 5);
    // 再来 8 点：跨过阈值一次，溢出 3 点保留
    const affected = accrueSunMoonCharge(state, 'player1', 8);
    assert.equal(affected.length, 3, '2 将领 + 1 士兵均被释放影响');
    assert.ok(affected.includes(soldier.id));
    assert.equal(state._sunMoonCharge.player1, 3, '扣除阈值后保留溢出');
    assert.equal(getSunMoonChargeRatio(state, 'player1'), 3 / SUN_MOON_CHARGE_THRESHOLD);
});

test('accrueSunMoonCharge: 负数/非法输入按 0 处理', () => {
    const { state, tiles } = setup();
    spawnTianhengPair(state, tiles);
    assert.deepEqual(accrueSunMoonCharge(state, 'player1', -50), []);
    assert.deepEqual(accrueSunMoonCharge(state, 'player1', NaN), []);
    assert.equal(getSunMoonChargeRatio(state, 'player1'), 0);
});

test('回合末只回收指定阵营重置前的真实闲置行动力', () => {
    const { state, tiles } = setup();
    const { astro, staller } = spawnTianhengPair(state, tiles);
    astro.remainingMP = 3;
    staller.remainingMP = 0;
    const enemy = new Unit('cavalry', state.factions.player2, tiles[4], false, 401);
    enemy.remainingMP = 99;

    assert.equal(getUnusedMovementCharge(state, 'player1'), 3);
    assert.equal(getUnusedMovementCharge(state, 'player2'), 99);

    // 模拟引擎随后执行的全场回合重置；截取值应来自重置前，而非满行动力。
    const capturedBeforeReset = getUnusedMovementCharge(state, 'player1');
    astro.remainingMP = astro.getEffectiveSpeed();
    staller.remainingMP = staller.getEffectiveSpeed();
    assert.equal(capturedBeforeReset, 3);
    assert.notEqual(getUnusedMovementCharge(state, 'player1'), capturedBeforeReset);
});

// ===== 释放效果 =====
test('resolveBorrowDay: 全军获得 40 点护盾（不回血）、士气提升至昂扬并置到期回合', () => {
    const { state, tiles } = setup();
    spawnTianhengPair(state, tiles);
    const soldier = new Unit('infantry', state.factions.player1, tiles[3], false, 310);
    // 模拟已受创、士气正常
    for (const u of getLivingCampUnits(state, 'player1')) {
        u.hp = 1;
        u.morale = 2;
    }

    const affected = resolveBorrowDay(state, 'player1');
    assert.equal(affected.length, 3);
    assert.ok(affected.includes(soldier.id));
    for (const u of getLivingCampUnits(state, 'player1')) {
        assert.equal(u.hp, 1, '不再回满生命（改为护盾）');
        assert.equal(u._shield, SUN_MOON_SHIELD_AMOUNT, '获得 40 点护盾');
        assert.equal(u._shieldMax, SUN_MOON_SHIELD_AMOUNT, '护盾峰值记录');
        assert.equal(u._shieldTurns, SUN_MOON_OATH_DURATION_ROUNDS, '护盾持续 2 回合');
        assert.equal(u.morale, 3, '士气昂扬');
        assert.equal(u.moraleBoostUntil, getRoundIndex(state) + 2, '士气提升持续 2 回合');
    }
});

test('resolveBorrowDay: 护盾在现有护盾上叠加，且不缩短更长的护盾时长', () => {
    const { state, tiles } = setup();
    const { astro } = spawnTianhengPair(state, tiles);
    astro._shield = 20;
    astro._shieldMax = 20;
    astro._shieldTurns = 5; // 已有一层更久的护盾

    resolveBorrowDay(state, 'player1');
    assert.equal(astro._shield, 20 + SUN_MOON_SHIELD_AMOUNT, '叠加到现有护盾');
    assert.equal(astro._shieldMax, 60, '峰值取更大值');
    assert.equal(astro._shieldTurns, 5, '不缩短更长的护盾时长');
});

test('resolveBorrowDay: 全军获得暴击加护，持续 2 回合', () => {
    const { state, tiles } = setup();
    spawnTianhengPair(state, tiles);
    const soldier = new Unit('infantry', state.factions.player1, tiles[3], false, 310);

    resolveBorrowDay(state, 'player1');
    for (const u of getLivingCampUnits(state, 'player1')) {
        assert.equal(hasSunMoonOathEffect(u, state), true, '加护生效');
        assert.equal(getSunMoonOathRemainingRounds(u, state), SUN_MOON_OATH_DURATION_ROUNDS);
        assert.equal(getSunMoonOathCritBonus(u, state), SUN_MOON_OATH_CRIT_BONUS, '暴击率提升 30%');
    }
    assert.ok(hasSunMoonOathEffect(soldier, state), '普通兵同样获得加护');
});

test('暴击加护跨 2 回合后到期，加成归零', () => {
    const { state, tiles } = setup();
    const { astro } = spawnTianhengPair(state, tiles);
    resolveBorrowDay(state, 'player1'); // 起始 roundIndex 0 → 到期回合 2

    state.turnCounter = state.turnOrder.length * 1; // roundIndex 1：仍在窗口内
    assert.equal(hasSunMoonOathEffect(astro, state), true);
    assert.equal(getSunMoonOathCritBonus(astro, state), SUN_MOON_OATH_CRIT_BONUS);

    state.turnCounter = state.turnOrder.length * 2; // roundIndex 2：到期
    assert.equal(hasSunMoonOathEffect(astro, state), false);
    assert.equal(getSunMoonOathCritBonus(astro, state), 0);
});

test('暴击加护对无单位/无 gameState 输入安全', () => {
    const { state } = setup();
    assert.equal(getSunMoonOathCritBonus(null, state), 0);
    assert.equal(getSunMoonOathRemainingRounds({}, state), 0);
    assert.equal(hasSunMoonOathEffect({ _sunMoonOathUntilRound: 5 }, null), false);
});

test('resolveBorrowDay: 只作用释放方阵营，不影响敌方', () => {
    const { state, tiles } = setup();
    spawnTianhengPair(state, tiles);
    const enemy = new Unit('infantry', state.factions.player2, tiles[5], false, 500);
    enemy.hp = 1; enemy.morale = 2;
    resolveBorrowDay(state, 'player1');
    assert.equal(enemy.hp, 1, '敌方生命不受影响');
    assert.equal(enemy.morale, 2, '敌方士气不受影响');
    assert.equal(enemy._shield, 0, '敌方不获得护盾');
    assert.equal(hasSunMoonOathEffect(enemy, state), false, '敌方不获得暴击加护');
});

test('resolveBorrowDay: 遭遇战模式下为释放方揭示全图视野（1 回合）', () => {
    const { state, tiles } = setup();
    spawnTianhengPair(state, tiles);
    state.skirmishFog = true;

    resolveBorrowDay(state, 'player1');
    const reveals = state.scoutReveals.player1;
    assert.ok(reveals instanceof Map);
    assert.equal(reveals.size, tiles.length, '全图每格均被揭示');
    for (const tile of tiles) {
        assert.equal(reveals.get(`${tile.q},${tile.r}`), getRoundIndex(state) + 1, '揭示 1 回合到期');
    }
});

test('resolveBorrowDay: 非遭遇战不触碰 scoutReveals', () => {
    const { state, tiles } = setup();
    spawnTianhengPair(state, tiles);
    state.skirmishFog = false;
    resolveBorrowDay(state, 'player1');
    assert.equal(state.scoutReveals.player1.size, 0);
});

// ===== 充能进度 =====
test('getSunMoonChargeRatio: 0~1 封顶', () => {
    const { state, tiles } = setup();
    spawnTianhengPair(state, tiles);
    state._sunMoonCharge = { player1: SUN_MOON_CHARGE_THRESHOLD * 3 };
    assert.equal(getSunMoonChargeRatio(state, 'player1'), 1, '超过阈值封顶为 1');
    state._sunMoonCharge = {};
    assert.equal(getSunMoonChargeRatio(state, 'player1'), 0, '无充能为 0');
});

// ===== 序列化/恢复 =====
test('日月天衡充能 序列化/恢复', () => {
    const { state, tiles } = setup();
    spawnTianhengPair(state, tiles);
    accrueSunMoonCharge(state, 'player1', 42);
    assert.equal(state._sunMoonCharge.player1, 42);

    const data = serializeMatchState(state);
    assert.equal(data.sunMoonCharge.player1, 42, '序列化含充能进度');

    const newState = createMatchState();
    newState.tiles = [];
    newState.tileMap = new Map();
    restoreMatchState(newState, data, {
        HexTileClass: EngineHexTile, UnitClass: Unit,
        computeCampBorders: () => [], computeDistrictBorders: () => []
    });
    assert.equal(newState._sunMoonCharge.player1, 42, '恢复后保留充能进度');
});

test('暴击加护到期回合 随快照序列化/恢复', () => {
    const { state, tiles } = setup();
    spawnTianhengPair(state, tiles); // astrologer@tiles[1], staller@tiles[2]
    resolveBorrowDay(state, 'player1');
    const expectedUntil = getRoundIndex(state) + SUN_MOON_OATH_DURATION_ROUNDS;

    const data = serializeMatchState(state);
    const newState = createMatchState();
    newState.tiles = [];
    newState.tileMap = new Map();
    restoreMatchState(newState, data, {
        HexTileClass: EngineHexTile, UnitClass: Unit,
        computeCampBorders: () => [], computeDistrictBorders: () => []
    });
    const restoredAstro = newState.tileMap.get('1,0').unit;
    assert.equal(restoredAstro._sunMoonOathUntilRound, expectedUntil, '恢复后保留加护到期回合');
    assert.equal(hasSunMoonOathEffect(restoredAstro, newState), true);
});

// ===== 旧版兼容（岁耗机制已废弃）=====
test('旧版岁耗 API 已废弃为 no-op', () => {
    const { state, tiles } = setup();
    spawnTianhengPair(state, tiles);
    resolveBorrowDay(state, 'player1');
    assert.equal(hasBorrowDayPaybackPending(state, 'player1'), false, '不再置岁耗偿还');
    assert.deepEqual(applyBorrowDayPayback(state, 'player1'), [], '偿还为空 no-op');
});
