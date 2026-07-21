import assert from 'node:assert/strict';
import { test } from 'node:test';

const context = {};
globalThis.document = {
    getElementById() {
        return { getContext: () => context };
    }
};
globalThis.localStorage = { getItem: () => null, setItem: () => {} };

const [celestineRules, factionSynergyRules, stateModule, unitModule, tileModule] = await Promise.all([
    import('../rules/celestine.js'),
    import('../rules/factionSynergies.js'),
    import('../engine/matchState.js'),
    import('../js/Unit.js'),
    import('../engine/HexTile.js')
]);

const {
    CELESTINE_FACTION_PASSIVE,
    CELESTINE_ORACLE_BALANCE,
    CELESTINE_IDENTITY_GROUPS,
    getOracleStage,
    getOracleDamagePct,
    hasCelestineSynergyActive,
    getLivingCelestineCommanders,
    getCelestineOracleState,
    getOracleStatueAnchor,
    resolveOraclePulse
} = celestineRules;

const {
    CELESTINE_FACTION_SYNERGY,
    getFactionSynergy,
    getCommanderFactionSynergy,
    NOCTIS_FACTION_SYNERGY,
    TIANHENG_FACTION_SYNERGY,
    getActiveFactionSynergies,
    FELLOW_ROBE_FACTION_SYNERGY
} = factionSynergyRules;

const { createMatchState } = stateModule;
const { Unit, setGameStateRef, setLogMessageRef } = unitModule;
const { EngineHexTile } = tileModule;

function createTile(q, r) {
    return new EngineHexTile(q, r);
}

function setupCelestineState(tileCount = 6) {
    const state = createMatchState();
    const tiles = Array.from({ length: tileCount }, (_, index) => createTile(index, 0));
    // Mark some tiles as cities for statue anchor
    tiles[0].isCity = true;
    tiles[0].districtId = 1;
    tiles[0].camp = state.factions.player1;
    tiles[0].hp = 100;
    tiles[0].maxHp = 100;
    tiles[0].x = 100;
    tiles[0].y = 100;

    state.tiles = tiles;
    state.tileMap = new Map(tiles.map(tile => [`${tile.q},${tile.r}`, tile]));
    state.damageTexts = [];
    state.healTexts = [];
    state.goldTexts = [];
    state._celestineOracle = {};
    setGameStateRef(state);
    setLogMessageRef(() => {});
    return { state, tiles };
}

function spawnCelestinePair(state, tiles) {
    const priest = new Unit('infantry', state.factions.player1, tiles[1], false, 801, 'priest');
    const paladin = new Unit('infantry', state.factions.player1, tiles[2], false, 802, 'paladin');
    return { priest, paladin };
}

function spawnCelestineNonPair(state, tiles) {
    const priest = new Unit('infantry', state.factions.player1, tiles[1], false, 801, 'priest');
    const martyr = new Unit('infantry', state.factions.player1, tiles[2], false, 802, 'martyr');
    return { priest, martyr };
}

// ===== 注册表测试 =====

test('塞莱斯廷圣国注册表：成员与徽标', () => {
    const synergy = getFactionSynergy('celestine');
    assert.equal(synergy, CELESTINE_FACTION_SYNERGY);
    assert.deepEqual([...synergy.commanderIds], ['priest', 'martyr', 'paladin', 'fallenAngel']);
    assert.equal(synergy.skillImplemented, true);
    assert.equal(getCommanderFactionSynergy('priest'), synergy);
    assert.equal(getCommanderFactionSynergy('martyr'), synergy);
    assert.equal(getCommanderFactionSynergy('paladin'), synergy);
    assert.equal(getCommanderFactionSynergy('fallenAngel'), synergy);
    assert.equal(synergy.marker.symbol, '🔆');
    assert.equal(synergy.hero.title, '神谕');
    assert.equal(CELESTINE_FACTION_PASSIVE.name, '神谕');
    assert.ok(CELESTINE_FACTION_PASSIVE.description.includes('神罚'));
    assert.ok(CELESTINE_FACTION_PASSIVE.description.includes('赐福'));
});

test('诺克提斯共和国注册表：skillImplemented=false', () => {
    const synergy = getFactionSynergy('noctis');
    assert.equal(synergy, NOCTIS_FACTION_SYNERGY);
    assert.equal(synergy.skillImplemented, false);
    assert.deepEqual([...synergy.commanderIds], ['vampire', 'necromancer', 'magician']);
    // 未实装技能不应抢占【与子同袍】
    assert.equal(getCommanderFactionSynergy('vampire'), synergy);
    assert.equal(getCommanderFactionSynergy('necromancer'), synergy);
    assert.equal(getCommanderFactionSynergy('magician'), synergy);
});

test('天衡联邦注册表：skillImplemented=false', () => {
    const synergy = getFactionSynergy('tianheng');
    assert.equal(synergy, TIANHENG_FACTION_SYNERGY);
    assert.equal(synergy.skillImplemented, false);
    assert.deepEqual([...synergy.commanderIds], ['astrologer', 'staller', 'diplomat']);
});

// ===== 身份组测试 =====

test('CELESTINE_IDENTITY_GROUPS: priest/martyr 同属 sacredVessel', () => {
    assert.equal(CELESTINE_IDENTITY_GROUPS.priest, 'sacredVessel');
    assert.equal(CELESTINE_IDENTITY_GROUPS.martyr, 'sacredVessel');
    assert.equal(CELESTINE_IDENTITY_GROUPS.paladin, 'paladin');
    assert.equal(CELESTINE_IDENTITY_GROUPS.fallenAngel, 'fallenAngel');
});

// ===== 激活判定测试 =====

test('priest+martyr 只算1身份 → 不激活', () => {
    const { state, tiles } = setupCelestineState();
    spawnCelestineNonPair(state, tiles);
    assert.equal(hasCelestineSynergyActive(state, state.factions.player1), false);
});

test('priest+paladin 不同身份 → 激活', () => {
    const { state, tiles } = setupCelestineState();
    spawnCelestinePair(state, tiles);
    assert.equal(hasCelestineSynergyActive(state, state.factions.player1), true);
});

test('激活后取代【与子同袍】', () => {
    const { state, tiles } = setupCelestineState();
    spawnCelestinePair(state, tiles);
    // 激活 celestine 后不应有 fellow-robe
    const synergies = getActiveFactionSynergies(state, state.factions.player1);
    const hasCelestine = synergies.some(s => s.id === 'celestine');
    const hasFellowRobe = synergies.some(s => s.id === 'fellow-robe');
    assert.equal(hasCelestine, true);
    assert.equal(hasFellowRobe, false);
});

// ===== 阶段推进测试 =====

test('getOracleStage: 边界映射', () => {
    assert.equal(getOracleStage(0), 1);  // 首轮激活
    assert.equal(getOracleStage(1), 1);  // 1-4 回合
    assert.equal(getOracleStage(3), 1);
    assert.equal(getOracleStage(4), 2);  // 5-8 回合
    assert.equal(getOracleStage(7), 2);
    assert.equal(getOracleStage(8), 3);  // 9-12 回合
    assert.equal(getOracleStage(11), 3);
    assert.equal(getOracleStage(12), 3); // 封顶 3 阶：13+ 回合不再升阶
    assert.equal(getOracleStage(15), 3);
    assert.equal(getOracleStage(16), 3); // 17+ 回合仍为 3 阶
    assert.equal(getOracleStage(99), 3);
});

test('getOracleDamagePct: 百分比映射', () => {
    assert.equal(getOracleDamagePct(0), 0.10);
    assert.equal(getOracleDamagePct(3), 0.10);
    assert.equal(getOracleDamagePct(4), 0.30);
    assert.equal(getOracleDamagePct(8), 0.50);
    assert.equal(getOracleDamagePct(12), 0.50); // 封顶 50%
    assert.equal(getOracleDamagePct(16), 0.50);
});

// ===== 神谕脉冲测试 =====

test('resolveOraclePulse: 未激活返回 null', () => {
    const { state } = setupCelestineState();
    const pulse = resolveOraclePulse(state, 'player1');
    assert.equal(pulse, null);
});

test('resolveOraclePulse: 激活后产生脉冲', () => {
    const { state, tiles } = setupCelestineState();
    spawnCelestinePair(state, tiles);
    // 给两个单位不同的攻击力
    const priest = tiles[1].unit;
    const paladin = tiles[2].unit;
    priest.getEffectiveAttack = () => 50;
    paladin.getEffectiveAttack = () => 80;
    // 防御力
    priest.config = { defense: 5 };
    paladin.config = { defense: 10 };

    const pulse = resolveOraclePulse(state, 'player1');
    assert.notEqual(pulse, null);
    assert.equal(pulse.campKey, 'player1');
    assert.equal(pulse.activeRounds, 1);
    assert.equal(pulse.stage, 1);
    // 神罚目标：paladin（攻击力80 > 50）
    assert.equal(pulse.smite.unitId, paladin.id);
    assert.ok(pulse.smite.dmg > 0);
    // 护盾目标：priest（防御5 < 10）
    assert.equal(pulse.shield.unitId, priest.id);
    assert.equal(pulse.shield.amount, pulse.smite.dmg);
    // 护盾仅当回合有效
    assert.equal(priest._shieldTurns, 1);
});

test('resolveOraclePulse: 连续脉冲推进阶段', () => {
    const { state, tiles } = setupCelestineState();
    spawnCelestinePair(state, tiles);
    const priest = tiles[1].unit;
    const paladin = tiles[2].unit;
    priest.getEffectiveAttack = () => 50;
    paladin.getEffectiveAttack = () => 80;
    priest.config = { defense: 5 };
    paladin.config = { defense: 10 };
    // 给足够血量避免被神罚击杀
    priest.maxHp = 500; priest.hp = 500;
    paladin.maxHp = 500; paladin.hp = 500;

    // 第1轮
    let p = resolveOraclePulse(state, 'player1');
    assert.equal(p.activeRounds, 1);
    assert.equal(p.stage, 1);

    // 第2轮
    p = resolveOraclePulse(state, 'player1');
    assert.equal(p.activeRounds, 2);
    assert.equal(p.stage, 1);

    // 第3-4轮
    for (let i = 0; i < 2; i++) resolveOraclePulse(state, 'player1');
    assert.equal(state._celestineOracle.player1.activeRounds, 4);
    assert.equal(state._celestineOracle.player1.stage, 2); // 第4轮末 → stage 2

    // 第5轮
    p = resolveOraclePulse(state, 'player1');
    assert.equal(p.activeRounds, 5);
    assert.equal(p.stage, 2);
});

test('resolveOraclePulse: 最大生命值百分比伤害', () => {
    const { state, tiles } = setupCelestineState();
    spawnCelestinePair(state, tiles);
    const priest = tiles[1].unit;
    const paladin = tiles[2].unit;
    priest.getEffectiveAttack = () => 50;
    paladin.getEffectiveAttack = () => 80;
    priest.config = { defense: 5 };
    paladin.config = { defense: 10 };
    paladin.maxHp = 200;
    paladin.hp = 200;
    priest.maxHp = 200;
    priest.hp = 200;

    const pulse = resolveOraclePulse(state, 'player1');
    // 第1阶段10% → 200*0.10=20
    assert.equal(pulse.smite.dmg, 20);
});

// ===== 失效清零测试 =====

test('resolveOraclePulse: 将领死亡后失效', () => {
    const { state, tiles } = setupCelestineState();
    spawnCelestinePair(state, tiles);
    const priest = tiles[1].unit;
    const paladin = tiles[2].unit;
    priest.getEffectiveAttack = () => 50;
    paladin.getEffectiveAttack = () => 80;
    priest.config = { defense: 5 };
    paladin.config = { defense: 10 };

    // 激活一次
    resolveOraclePulse(state, 'player1');
    assert.ok(state._celestineOracle.player1);

    // 杀死paladin
    paladin.hp = 0;
    const pulse = resolveOraclePulse(state, 'player1');
    assert.equal(pulse, null);
    // 计量清零
    assert.equal(state._celestineOracle.player1, undefined);
});

test('resolveOraclePulse: 投降后失效', () => {
    const { state, tiles } = setupCelestineState();
    spawnCelestinePair(state, tiles);
    const priest = tiles[1].unit;
    const paladin = tiles[2].unit;
    priest.getEffectiveAttack = () => 50;
    paladin.getEffectiveAttack = () => 80;
    priest.config = { defense: 5 };
    paladin.config = { defense: 10 };

    resolveOraclePulse(state, 'player1');
    assert.ok(state._celestineOracle.player1);

    // 投降（用 camp key 字符串设置）
    state.surrenderedCamps = ['player1'];
    const pulse = resolveOraclePulse(state, 'player1');
    assert.equal(pulse, null);
    assert.equal(state._celestineOracle.player1, undefined);
});

// ===== 神像锚点测试 =====

test('getOracleStatueAnchor: 返回首座城市（按districtId排序）', () => {
    const { state, tiles } = setupCelestineState();
    tiles[0].camp = state.factions.player1;
    tiles[0].isCity = true;
    tiles[0].districtId = 2;
    tiles[3].camp = state.factions.player1;
    tiles[3].isCity = true;
    tiles[3].districtId = 1;

    const anchor = getOracleStatueAnchor(state, 'player1');
    assert.notEqual(anchor, null);
    // districtId=1 在 districtId=2 之前
    assert.equal(anchor.q, tiles[3].q);
    assert.equal(anchor.r, tiles[3].r);
});

test('getOracleStatueAnchor: 无城市返回 null', () => {
    const { state, tiles } = setupCelestineState();
    tiles[0].camp = state.factions.player2; // 非己方城市
    const anchor = getOracleStatueAnchor(state, 'player1');
    assert.equal(anchor, null);
});

// ===== 快照测试 =====

test('celestineOracle 状态序列化/恢复', () => {
    const { state, tiles } = setupCelestineState();
    spawnCelestinePair(state, tiles);
    const priest = tiles[1].unit;
    const paladin = tiles[2].unit;
    priest.getEffectiveAttack = () => 50;
    paladin.getEffectiveAttack = () => 80;
    priest.config = { defense: 5 };
    paladin.config = { defense: 10 };

    // 推进2轮
    resolveOraclePulse(state, 'player1');
    resolveOraclePulse(state, 'player1');

    const { serializeMatchState, restoreMatchState } = stateModule;
    const data = serializeMatchState(state);

    // 验证序列化
    assert.ok(data.celestineOracle);
    assert.equal(data.celestineOracle.player1.activeRounds, 2);
    assert.equal(data.celestineOracle.player1.stage, 1);

    // 创建新状态并恢复
    const newState = createMatchState();
    newState.tiles = [];
    newState.tileMap = new Map();
    restoreMatchState(newState, data, {
        HexTileClass: EngineHexTile,
        UnitClass: Unit,
        computeCampBorders: () => [],
        computeDistrictBorders: () => []
    });

    // 验证恢复
    // 注意：_celestineOracle 的恢复需要 Unit 实例在 tiles 上重建后才有 commander 引用
    // 这里只验证字段存在，具体恢复在 restoreMatchState 中处理
    assert.ok(newState._celestineOracle);
});