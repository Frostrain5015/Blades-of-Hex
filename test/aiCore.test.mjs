// ai/core/ 新架构的核心决策规则回归测试。
// 只测纯函数与确定性行为；完整对局行为由 tools/runBenchmark.mjs 的 10 局矩阵验收。

import test from 'node:test';
import assert from 'node:assert/strict';

import { HEX_NEIGHBORS, hexDistance } from '../rules/hex.js';
import { UNIT_CONFIG } from '../rules/units.js';
import {
    TIER_CAPABILITIES,
    W,
    hpGold,
    noiseJitter,
    residualGold,
    tradeNetValue
} from '../ai/core/weights.js';

// ── 权重与估值 ────────────────────────────────────────────────

test('金币量纲：伤害/击杀/反击按每 HP 金价折算', () => {
    const infantry = { type: 'infantry', hp: 180, maxHp: 180, config: UNIT_CONFIG.infantry };
    assert.ok(hpGold(infantry) > 0);
    assert.ok(residualGold(infantry) >= UNIT_CONFIG.infantry.cost * 0.9);
    // 击杀一笔 > 只打掉等值 HP 的交易
    const scratch = tradeNetValue({ damageDealt: 30, target: infantry, attacker: infantry });
    const kill = tradeNetValue({ damageDealt: 200, target: infantry, kills: true, attacker: infantry });
    assert.ok(kill > scratch);
    // 反击成本让亏本交换变负
    const bad = tradeNetValue({ damageDealt: 10, target: infantry, counterDamage: 150, attacker: infantry });
    assert.ok(bad < 0);
});

test('档位噪声：hard 恒为 1，easy 确定性地落在噪声区间内', () => {
    assert.equal(noiseJitter(TIER_CAPABILITIES.hard, 'anything'), 1);
    const sample = noiseJitter(TIER_CAPABILITIES.easy, 'atk:3:12:45');
    assert.ok(sample > 0.4 && sample < 1.6);
    // 同一盐值必然复现（自对局种子确定性）
    assert.equal(noiseJitter(TIER_CAPABILITIES.easy, 'atk:3:12:45'), sample);
    // 不同盐值应散开
    const spread = new Set(Array.from({ length: 20 }, (_, i) =>
        noiseJitter(TIER_CAPABILITIES.easy, `salt-${i}`).toFixed(3)));
    assert.ok(spread.size > 10);
});

// ── 最小世界模型（供战略/任务层测试）─────────────────────────

function makeTile(q, r, extra = {}) {
    return {
        q, r, s: -q - r, id: `t${q},${r}`, x: q * 10, y: r * 10,
        surface: 'land', terrain: 'plains',
        isCity: false, isPort: false, isVillage: false,
        districtId: 0, hp: 0, camp: null, unit: null,
        ...extra
    };
}

function makeUnit(id, type, camp, tile, extra = {}) {
    const config = UNIT_CONFIG[type];
    const unit = {
        id, type, camp, tile,
        hp: config.hp, maxHp: config.hp,
        canAct: true, config,
        commander: null, _rank: 0,
        ...extra
    };
    tile.unit = unit;
    return unit;
}

function makeHelpers(tiles) {
    return {
        hexDistance,
        HEX_NEIGHBORS,
        UNIT_CONFIG,
        weather: 'clear',
        isHostileFaction: (a, b) => a !== b,
        isTileVisible: () => true,
        getMovableTiles: () => [],
        getAttackableTiles: () => [],
        CARD_SYSTEM_CONFIG: { drawCost: 4, maxHandSize: 3, maxDrawsPerTurn: 2, maxUsesPerTurn: 2 },
        CAMP: {}
    };
}

async function loadCore() {
    const [{ buildWorld }, { decideStrategy }, { assignMissions }, { planProduction }, { planTactics }] = await Promise.all([
        import('../ai/core/perceive.js'),
        import('../ai/core/strategize.js'),
        import('../ai/core/missions.js'),
        import('../ai/core/production.js'),
        import('../ai/core/tactics.js')
    ]);
    return { buildWorld, decideStrategy, assignMissions, planProduction, planTactics };
}

function makeState(tiles, factions, extra = {}) {
    return {
        tiles,
        tileMap: new Map(tiles.map(t => [`${t.q},${t.r}`, t])),
        factions,
        playerGold: { player1: 20, player2: 20, neutral: 0 },
        playerHands: { player1: [], player2: [] },
        playerUsesThisTurn: { player1: 0, player2: 0 },
        playerDrawsThisTurn: { player1: 0, player2: 0 },
        weather: 'clear',
        turnCounter: extra.turnCounter ?? 0,
        isThreePlayer: false,
        standardMapId: 'crown-ring',
        skirmishFog: false,
        ...extra
    };
}

test('胜利时钟：城市领先且时钟将尽时切守钟，落后时切死斗', async () => {
    const { buildWorld, decideStrategy } = await loadCore();
    const me = { id: 'player1', name: '紫军' };
    const foe = { id: 'player2', name: '红军' };
    const neutral = { id: 'neutral', name: '中立' };
    const tiles = [];
    // 我 2 城、敌 1 城、第 17 回合（剩 2 回合）→ 守钟
    const c1 = makeTile(0, 0, { isCity: true, camp: me, districtId: 1 });
    const c2 = makeTile(4, 0, { isCity: true, camp: me, districtId: 2 });
    const c3 = makeTile(9, 0, { isCity: true, camp: foe, districtId: 3 });
    makeUnit(1, 'infantry', me, c1);
    makeUnit(2, 'infantry', me, c2);
    makeUnit(3, 'infantry', foe, c3);
    tiles.push(c1, c2, c3);
    const state = makeState(tiles, { player1: me, player2: foe, neutral }, { turnCounter: 16 * 3 });
    const world = buildWorld(state, makeHelpers(tiles), me, TIER_CAPABILITIES.hard);
    const strategy = decideStrategy(world);
    assert.equal(strategy.posture, 'hold');
});

test('胜利时钟：落后且时钟将尽时切死斗', async () => {
    const { buildWorld, decideStrategy } = await loadCore();
    const me = { id: 'player1', name: '紫军' };
    const foe = { id: 'player2', name: '红军' };
    const neutral = { id: 'neutral', name: '中立' };
    const c1 = makeTile(0, 0, { isCity: true, camp: me, districtId: 1 });
    const c2 = makeTile(5, 0, { isCity: true, camp: foe, districtId: 2 });
    const c3 = makeTile(9, 0, { isCity: true, camp: foe, districtId: 3 });
    const c4 = makeTile(2, 0, { isCity: true, camp: neutral, districtId: 4, hp: 0 });
    makeUnit(1, 'infantry', me, c1);
    const cavTile = makeTile(1, 0);
    makeUnit(2, 'cavalry', me, cavTile);
    makeUnit(3, 'infantry', foe, c2);
    makeUnit(4, 'infantry', foe, c3);
    const tiles = [c1, c2, c3, c4, cavTile];
    const state = makeState(tiles, { player1: me, player2: foe, neutral }, { turnCounter: 16 * 3 });
    const world = buildWorld(state, makeHelpers(tiles), me, TIER_CAPABILITIES.hard);
    const strategy = decideStrategy(world);
    assert.equal(strategy.posture, 'allin');
});

test('攻城任务：指定最近近战为占领者并跨回合保留', async () => {
    const { buildWorld, decideStrategy, assignMissions } = await loadCore();
    const me = { id: 'player1', name: '紫军' };
    const foe = { id: 'player2', name: '红军' };
    const neutral = { id: 'neutral', name: '中立' };
    const home = makeTile(0, 0, { isCity: true, camp: me, districtId: 1 });
    const target = makeTile(6, 0, { isCity: true, camp: foe, districtId: 2, hp: 0 });
    const near = makeTile(4, 0);
    const far = makeTile(1, 0);
    const occupierNear = makeUnit(1, 'infantry', me, near);
    makeUnit(2, 'cavalry', me, far);
    const garrison = makeUnit(3, 'infantry', foe, target);
    garrison.hp = 60;
    const tiles = [home, target, near, far];
    const state = makeState(tiles, { player1: me, player2: foe, neutral }, { turnCounter: 3 });
    const world = buildWorld(state, makeHelpers(tiles), me, TIER_CAPABILITIES.hard);
    const strategy = decideStrategy(world);
    const { missions, assignment } = assignMissions(world, strategy);
    const siege = missions.find(m => m.kind === 'siege');
    assert.ok(siege, '应生成攻城任务');
    assert.equal(siege.occupierId, occupierNear.id, '占领者应是最近的近战');
    assert.equal(assignment.get(occupierNear.id)?.kind, 'siege');
    // 记忆写回：下回合仍认得这条任务
    assert.ok(state._aiCoreMemory.player1.missions.some(m => m.id === siege.id));
});

test('Imperator 会把已崩塌对手识别为收官目标，而不是继续扩张中立区', async () => {
    const { buildWorld, decideStrategy, assignMissions } = await loadCore();
    const me = { id: 'player1', name: '紫军' };
    const foe = { id: 'player2', name: '红军' };
    const neutral = { id: 'neutral', name: '中立' };
    const home = makeTile(0, 0, { isCity: true, camp: me, districtId: 1 });
    const target = makeTile(6, 0, { isCity: true, camp: foe, districtId: 2, hp: 0 });
    const tiles = [home, target];
    for (let index = 0; index < 6; index++) {
        const troopTile = index === 0 ? home : makeTile(index, 1);
        if (index > 0) tiles.push(troopTile);
        makeUnit(index + 1, index % 2 ? 'cavalry' : 'infantry', me, troopTile);
    }
    makeUnit(20, 'infantry', foe, target, { hp: 50 });
    const state = makeState(tiles, { player1: me, player2: foe, neutral }, { turnCounter: 21 });
    const world = buildWorld(state, makeHelpers(tiles), me, TIER_CAPABILITIES.hard);
    const strategy = decideStrategy(world);
    const missions = assignMissions(world, strategy);
    assert.equal(strategy.posture, 'allin');
    assert.equal(strategy.finishTargetCampKey, 'player2');
    assert.equal(missions.suppressNeutralEngagements, true);
    assert.equal(missions.missions.find(mission => mission.kind === 'siege')?.targetQ, target.q);
});

test('Imperator 发现两格内敌方占领者时立即停止攻城并转入紧急守城', async () => {
    const { buildWorld, decideStrategy, assignMissions } = await loadCore();
    const me = { id: 'player1', name: '紫军' };
    const foe = { id: 'player2', name: '红军' };
    const neutral = { id: 'neutral', name: '中立' };
    const home = makeTile(0, 0, { isCity: true, camp: me, districtId: 1 });
    const enemyCity = makeTile(8, 0, { isCity: true, camp: foe, districtId: 2 });
    const invaderTile = makeTile(2, 0);
    const reserveTile = makeTile(4, 0);
    makeUnit(1, 'infantry', me, reserveTile);
    makeUnit(2, 'cavalry', foe, invaderTile);
    const tiles = [home, enemyCity, invaderTile, reserveTile];
    const state = makeState(tiles, { player1: me, player2: foe, neutral }, { turnCounter: 6 });
    const world = buildWorld(state, makeHelpers(tiles), me, TIER_CAPABILITIES.hard);
    const strategy = decideStrategy(world);
    const { missions } = assignMissions(world, strategy);
    assert.equal(strategy.posture, 'defend');
    assert.equal(strategy.emergencyDefenseCity, home);
    assert.equal(missions.some(mission => mission.kind === 'siege'), false);
    assert.equal(missions.some(mission => mission.kind === 'garrison'), true);
});

test('死斗目标已经破城或削弱驻军时保持锁定，并把多支近战编入同一攻坚组', async () => {
    const { buildWorld, decideStrategy, assignMissions } = await loadCore();
    const me = { id: 'player1', name: '绿军' };
    const foe = { id: 'player2', name: '紫军' };
    const neutral = { id: 'neutral', name: '中立' };
    const home = makeTile(0, 0, { isCity: true, camp: me, districtId: 1 });
    const committed = makeTile(3, 0, { isCity: true, camp: foe, districtId: 2, hp: 0 });
    const tempting = makeTile(1, 2, { isCity: true, camp: foe, districtId: 3, hp: 0 });
    const nearCommitted = makeTile(2, 0);
    const nearTempting = makeTile(0, 2);
    const reserve = makeTile(-1, 1);
    makeUnit(1, 'infantry', me, home);
    makeUnit(2, 'infantry', me, nearCommitted);
    makeUnit(3, 'cavalry', me, nearTempting);
    makeUnit(4, 'infantry', me, reserve);
    makeUnit(20, 'infantry', foe, committed, { hp: 60 });
    const tiles = [home, committed, tempting, nearCommitted, nearTempting, reserve];
    const state = makeState(tiles, { player1: me, player2: foe, neutral }, { turnCounter: 16 * 3 });
    state._aiCoreMemory = {
        player1: {
            missions: [{
                id: 'committed-siege', kind: 'siege', targetQ: 3, targetR: 0,
                occupierId: 2, escortIds: [], phase: 'breach', createdRound: 15
            }]
        }
    };
    const world = buildWorld(state, makeHelpers(tiles), me, TIER_CAPABILITIES.hard);
    const strategy = decideStrategy(world);
    const result = assignMissions(world, strategy);
    const siege = result.missions.find(mission => mission.kind === 'siege');
    assert.equal(strategy.posture, 'allin');
    assert.deepEqual([siege.targetQ, siege.targetR], [3, 0]);
    assert.equal(siege.targetLocked, true);
    assert.equal(siege.escortIds.length, 3);
    assert.equal(result.suppressNeutralEngagements, true);
});

test('死斗攻坚存在城防或驻军且炮兵比例不足时优先补炮兵', async () => {
    const { buildWorld, decideStrategy, assignMissions, planProduction } = await loadCore();
    const me = { id: 'player1', name: '绿军' };
    const foe = { id: 'player2', name: '紫军' };
    const neutral = { id: 'neutral', name: '中立' };
    const home = makeTile(0, 0, { isCity: true, camp: me, districtId: 1 });
    const factory = makeTile(-2, 0, { isCity: true, camp: me, districtId: 2 });
    const target = makeTile(3, 0, { isCity: true, camp: foe, districtId: 3, hp: 180 });
    const rival2 = makeTile(6, 0, { isCity: true, camp: foe, districtId: 4 });
    const rival3 = makeTile(8, 0, { isCity: true, camp: foe, districtId: 5 });
    const front = makeTile(1, 0);
    const reserve = makeTile(0, 1);
    makeUnit(1, 'infantry', me, home);
    makeUnit(2, 'infantry', me, front);
    makeUnit(3, 'cavalry', me, reserve);
    makeUnit(20, 'infantry', foe, target);
    makeUnit(21, 'infantry', foe, rival2);
    makeUnit(22, 'infantry', foe, rival3);
    const tiles = [home, factory, target, rival2, rival3, front, reserve];
    const helpers = makeHelpers(tiles);
    const state = makeState(tiles, { player1: me, player2: foe, neutral }, {
        turnCounter: 16 * 3,
        playerGold: { player1: 24, player2: 20, neutral: 0 }
    });
    const world = buildWorld(state, helpers, me, TIER_CAPABILITIES.hard);
    const strategy = decideStrategy(world);
    const missions = assignMissions(world, strategy);
    const production = planProduction(world, strategy, missions);
    assert.equal(strategy.posture, 'allin');
    assert.equal(production.actions.find(action => action.type === 'recruit')?.unitType, 'archer');
});

test('时钟告急时即使无法一轮斩杀，也会让在位火力持续压低决胜城驻军', async () => {
    const { buildWorld, decideStrategy, assignMissions, planTactics } = await loadCore();
    const me = { id: 'player1', name: '绿军' };
    const foe = { id: 'player2', name: '紫军' };
    const neutral = { id: 'neutral', name: '中立' };
    const home = makeTile(0, 0, { isCity: true, camp: me, districtId: 1 });
    const target = makeTile(2, 0, { isCity: true, camp: foe, districtId: 2, hp: 0 });
    const rival2 = makeTile(5, 0, { isCity: true, camp: foe, districtId: 3 });
    const meleeTile = makeTile(1, 0);
    const artilleryTile = makeTile(1, -1);
    const melee = makeUnit(1, 'infantry', me, meleeTile);
    const artillery = makeUnit(2, 'archer', me, artilleryTile);
    const garrison = makeUnit(20, 'infantry', foe, target);
    const tiles = [home, target, rival2, meleeTile, artilleryTile];
    const helpers = {
        ...makeHelpers(tiles),
        getAttackableTiles: unit => unit === melee || unit === artillery ? [target] : [],
        getMovableTiles: () => []
    };
    const state = makeState(tiles, { player1: me, player2: foe, neutral }, { turnCounter: 16 * 3 });
    const world = buildWorld(state, helpers, me, TIER_CAPABILITIES.hard);
    const strategy = decideStrategy(world);
    const missions = assignMissions(world, strategy);
    const actions = planTactics(world, strategy, missions);
    const pressure = actions.filter(action => action.type === 'attack' && action.targetId === garrison.id);
    assert.equal(missions.missions.find(mission => mission.kind === 'siege')?.clockCritical, true);
    assert.equal(pressure.length, 2);
});
