// test/tianheng.test.mjs — 天衡【日月天衡】规则层（充能制被动）：
//   激活判定、剩余行动力充能、满阈值自动释放（全军回满+士气+全图视野）、
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
    SUN_MOON_CHARGE_THRESHOLD,
    hasTianhengSynergyActive, getLivingTianhengCommanders, getLivingCampUnits,
    resolveBorrowDay, accrueSunMoonCharge, getSunMoonChargeRatio,
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
    assert.equal(SUN_MOON_CHARGE_THRESHOLD, 180);
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

// ===== 释放效果 =====
test('resolveBorrowDay: 全军回满生命、士气提升至昂扬并置到期回合', () => {
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
        assert.equal(u.hp, u.maxHp, '生命回满');
        assert.equal(u.morale, 3, '士气昂扬');
        assert.equal(u.moraleBoostUntil, getRoundIndex(state) + 2, '士气提升持续 2 回合');
    }
});

test('resolveBorrowDay: 只作用释放方阵营，不影响敌方', () => {
    const { state, tiles } = setup();
    spawnTianhengPair(state, tiles);
    const enemy = new Unit('infantry', state.factions.player2, tiles[5], false, 500);
    enemy.hp = 1; enemy.morale = 2;
    resolveBorrowDay(state, 'player1');
    assert.equal(enemy.hp, 1, '敌方生命不受影响');
    assert.equal(enemy.morale, 2, '敌方士气不受影响');
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

// ===== 旧版兼容（岁耗机制已废弃）=====
test('旧版岁耗 API 已废弃为 no-op', () => {
    const { state, tiles } = setup();
    spawnTianhengPair(state, tiles);
    resolveBorrowDay(state, 'player1');
    assert.equal(hasBorrowDayPaybackPending(state, 'player1'), false, '不再置岁耗偿还');
    assert.deepEqual(applyBorrowDayPayback(state, 'player1'), [], '偿还为空 no-op');
});
