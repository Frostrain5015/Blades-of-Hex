// test/noctis.test.mjs — 诺克提斯【血月之夜】规则层：激活、血潮门槛、禁疗、月蚀放血。
import assert from 'node:assert/strict';
import { test } from 'node:test';

const context = {};
globalThis.document = { getElementById() { return { getContext: () => context }; } };
globalThis.localStorage = { getItem: () => null, setItem: () => {} };

const [noctisRules, stateModule, unitModule, tileModule] = await Promise.all([
    import('../rules/noctis.js'),
    import('../engine/matchState.js'),
    import('../js/Unit.js'),
    import('../engine/HexTile.js')
]);

const {
    NOCTIS_BLOODMOON_BALANCE, BLOOD_MOON_WEATHER,
    hasNoctisSynergyActive, getActiveNoctisCampKeys,
    computeCritExcess, accrueBloodTide, accrueBloodTideFromHit,
    getBloodMoonChargeRatio, anyBloodMoonPending, consumeBloodMoonSummon,
    isBloodMoonWeatherActive, isBloodMoonHealSuppressed, resolveBloodMoonBleed
} = noctisRules;

const { createMatchState, serializeMatchState, restoreMatchState } = stateModule;
const { Unit, setGameStateRef, setLogMessageRef } = unitModule;
const { EngineHexTile } = tileModule;

function setup(tileCount = 8) {
    const state = createMatchState();
    const tiles = Array.from({ length: tileCount }, (_, i) => new EngineHexTile(i, 0));
    state.tiles = tiles;
    state.tileMap = new Map(tiles.map(t => [`${t.q},${t.r}`, t]));
    state.damageTexts = [];
    state.healTexts = [];
    state.goldTexts = [];
    setGameStateRef(state);
    setLogMessageRef(() => {});
    return { state, tiles };
}

function spawnNoctisPair(state, tiles) {
    const vampire = new Unit('infantry', state.factions.player1, tiles[1], false, 901, 'vampire');
    const necro = new Unit('infantry', state.factions.player1, tiles[2], false, 902, 'necromancer');
    return { vampire, necro };
}

// ===== 激活判定 =====
test('≥2 诺克提斯将领 → 激活；仅 1 名 → 不激活', () => {
    const { state, tiles } = setup();
    const vampire = new Unit('infantry', state.factions.player1, tiles[1], false, 901, 'vampire');
    assert.equal(hasNoctisSynergyActive(state, state.factions.player1), false);
    new Unit('infantry', state.factions.player1, tiles[2], false, 902, 'necromancer');
    assert.equal(hasNoctisSynergyActive(state, state.factions.player1), true);
    assert.deepEqual(getActiveNoctisCampKeys(state), ['player1']);
    vampire.hp = 0; // 打掉一名 → 失活
    assert.equal(hasNoctisSynergyActive(state, state.factions.player1), false);
});

// ===== 暴击超出计算 =====
test('computeCritExcess: 只取浮动超 1.00 部分', () => {
    assert.equal(computeCritExcess(100, 1.30), Math.round(100 * 0.30 / 1.30)); // 23
    assert.equal(computeCritExcess(100, 1.00), 0);
    assert.equal(computeCritExcess(100, 0.85), 0);
    assert.equal(computeCritExcess(0, 1.5), 0);
});

// ===== 血潮门槛 =====
test('accrueBloodTide: 仅 ≥2 将领时累积，跨阈值→moonsPending', () => {
    const { state, tiles } = setup();
    // 未激活时不累积
    assert.equal(accrueBloodTide(state, 'player1', 50), 0);
    spawnNoctisPair(state, tiles);
    accrueBloodTide(state, 'player1', 50);
    assert.equal(getBloodMoonChargeRatio(state, 'player1'), 50 / NOCTIS_BLOODMOON_BALANCE.bloodTideThreshold);
    const summoned = accrueBloodTide(state, 'player1', 100); // 150 累计 → 跨 bloodTideThreshold(125) 一次
    assert.equal(summoned, 1);
    assert.equal(anyBloodMoonPending(state), true);
    assert.equal(getBloodMoonChargeRatio(state, 'player1'), 1); // 有待召唤 → 显示满
});

test('accrueBloodTideFromHit: 敌对暴击命中累积；友军/真伤不累积', () => {
    const { state, tiles } = setup();
    const { vampire } = spawnNoctisPair(state, tiles);
    const enemy = new Unit('infantry', state.factions.player2, tiles[5], false, 500);
    const ally = new Unit('infantry', state.factions.player1, tiles[6], false, 501);
    accrueBloodTideFromHit(state, { attacker: vampire, target: enemy, dealt: 100, floatMult: 1.3 });
    const excess = computeCritExcess(100, 1.3);
    assert.equal(state._noctisBloodTide.player1.charge, excess);
    // 友军命中不累积
    accrueBloodTideFromHit(state, { attacker: vampire, target: ally, dealt: 100, floatMult: 1.3 });
    assert.equal(state._noctisBloodTide.player1.charge, excess);
    // 真伤（floatMult=1）不累积
    accrueBloodTideFromHit(state, { attacker: vampire, target: enemy, dealt: 100, floatMult: 1.0 });
    assert.equal(state._noctisBloodTide.player1.charge, excess);
});

test('consumeBloodMoonSummon: 蓄满后消费一次待召唤', () => {
    const { state, tiles } = setup();
    spawnNoctisPair(state, tiles);
    accrueBloodTide(state, 'player1', NOCTIS_BLOODMOON_BALANCE.bloodTideThreshold);
    assert.equal(anyBloodMoonPending(state), true);
    assert.equal(consumeBloodMoonSummon(state), true);
    assert.equal(anyBloodMoonPending(state), false);
    assert.equal(consumeBloodMoonSummon(state), false); // 无待召唤
});

// ===== 禁疗（永夜） =====
test('isBloodMoonHealSuppressed: 血月下敌方禁疗、己方不禁疗', () => {
    const { state, tiles } = setup();
    spawnNoctisPair(state, tiles);
    const enemy = new Unit('infantry', state.factions.player2, tiles[5], false, 500);
    const ally = new Unit('infantry', state.factions.player1, tiles[6], false, 501);
    // 非血月天气 → 不禁疗
    state.weather = 'clear';
    assert.equal(isBloodMoonHealSuppressed(enemy, state), false);
    // 血月天气 → 敌方禁疗、己方不禁疗
    state.weather = BLOOD_MOON_WEATHER;
    assert.equal(isBloodMoonWeatherActive(state), true);
    assert.equal(isBloodMoonHealSuppressed(enemy, state), true);
    assert.equal(isBloodMoonHealSuppressed(ally, state), false);
});

// ===== 月蚀放血曲线 =====
test('resolveBloodMoonBleed: ≤50% 放血 ⅓ 已损，>50% 免疫，随失血加速致死', () => {
    const { state, tiles } = setup();
    spawnNoctisPair(state, tiles);
    state.weather = BLOOD_MOON_WEATHER;

    // 目标单位（放在敌方，验证不分阵营也可）
    const mk = (i, id, hp) => {
        const u = new Unit('infantry', state.factions.player2, tiles[i], false, id);
        u.maxHp = 100; u.hp = hp; u.displayHp = hp;
        return u;
    };
    const u60 = mk(3, 601, 60); // >50% 免疫
    const u50 = mk(4, 650, 50); // 50% → 33 → 11 存活
    const u40 = mk(5, 640, 40); // 40% → 20 → 死
    const u20 = mk(7, 620, 20); // 20% → 首轮死

    // 第 1 轮
    let hits = resolveBloodMoonBleed(state);
    assert.equal(u60.hp, 60, '>50% 不放血');
    assert.equal(u50.hp, 33); // hp50, lost50, dmg round(50/3)=17 → 33
    assert.equal(u40.hp, 20);
    assert.equal(u20.hp <= 0, true, '20% 首轮阵亡');
    assert.ok(hits.some(h => h.unitId === 620 && h.killed));
    assert.ok(!hits.some(h => h.unitId === 601)); // 60% 不在清单

    // 第 2 轮
    resolveBloodMoonBleed(state);
    assert.equal(u50.hp, 11, '半血 2 轮后仅余极少');
    assert.equal(u40.hp <= 0, true, '40% 次轮阵亡');
});

test('resolveBloodMoonBleed: 非血月天气不放血', () => {
    const { state, tiles } = setup();
    spawnNoctisPair(state, tiles);
    state.weather = 'clear';
    const u = new Unit('infantry', state.factions.player2, tiles[3], false, 601);
    u.maxHp = 100; u.hp = 30;
    resolveBloodMoonBleed(state);
    assert.equal(u.hp, 30);
});

test('resolveBloodMoonBleed: 将领不豁免（决策②）', () => {
    const { state, tiles } = setup();
    spawnNoctisPair(state, tiles);
    state.weather = BLOOD_MOON_WEATHER;
    const enemyCmd = new Unit('infantry', state.factions.player2, tiles[7], false, 700, 'vampire');
    enemyCmd.maxHp = 100; enemyCmd.hp = 40;
    resolveBloodMoonBleed(state);
    assert.equal(enemyCmd.hp, 20, '将领同样被放血');
});

test('血潮计量 序列化/恢复（血月充能随快照同步）', () => {
    const { state, tiles } = setup();
    spawnNoctisPair(state, tiles);
    accrueBloodTide(state, 'player1', 80);
    assert.equal(state._noctisBloodTide.player1.charge, 80);

    const data = serializeMatchState(state);
    assert.ok(data.noctisBloodTide, '序列化包含 noctisBloodTide');
    assert.equal(data.noctisBloodTide.player1.charge, 80);
    assert.equal(data.noctisBloodTide.player1.moonsPending, 0);

    const newState = createMatchState();
    newState.tiles = [];
    newState.tileMap = new Map();
    restoreMatchState(newState, data, {
        HexTileClass: EngineHexTile, UnitClass: Unit,
        computeCampBorders: () => [], computeDistrictBorders: () => []
    });
    assert.equal(newState._noctisBloodTide.player1.charge, 80);
    assert.equal(newState._noctisBloodTide.player1.moonsPending, 0);
});
