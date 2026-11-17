// ai/core/ 新架构的核心决策规则回归测试。
// 只测纯函数与确定性行为；完整对局行为由 tools/runBenchmark.mjs 的 10 局矩阵验收。

import test from 'node:test';
import assert from 'node:assert/strict';

import { HEX_NEIGHBORS, hexDistance } from '../rules/hex.js';
import { UNIT_CONFIG } from '../rules/units.js';
import { createRng } from '../core/rng.js';
import { selectCommander, selectCommanderPair } from '../ai/doctrine.js';
import {
    TIER_CAPABILITIES,
    W,
    hpGold,
    noiseJitter,
    residualGold,
    tradeNetValue
} from '../ai/core/weights.js';
import { estimateForceValue } from '../ai/strategy.js';
import { planFollowupAttack, planTurn } from '../ai/core/planner.js';
import { planCards, shouldDrawCard } from '../ai/core/cards.js';
import { estimateCaptureEta } from '../ai/core/strategize.js';
import { enemyCapturerPremium } from '../ai/core/tactics.js';
import { rankCityObjectives } from '../ai/core/perceive.js';
import { CULTURE_CONFIG } from '../rules/cultures.js';

// ── 权重与估值 ────────────────────────────────────────────────

test('同一候选池可选出多组 AI 将领，同一种子复现，禁配将领不会同时入选', () => {
    const pool = ['vampire', 'berserker', 'ironGuard', 'colonel', 'diplomat'];
    const singles = new Set();
    const pairs = new Set();
    for (let seed = 1; seed <= 48; seed++) {
        const opts = () => ({ rng: createRng(seed), preferSynergy: true });
        singles.add(selectCommander(pool, opts()));
        const pair = selectCommanderPair(pool, opts());
        assert.deepEqual(pair, selectCommanderPair(pool, opts()));
        assert.equal(new Set(pair).size, 2);
        assert.ok(pair.every(id => pool.includes(id)));
        assert.ok(!(pair.includes('colonel') && pair.includes('diplomat')));
        pairs.add([...pair].sort().join(','));
    }
    assert.ok(singles.size >= 4);
    assert.ok(pairs.size >= 5);
});

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

test('无主航路按活航母估价，困难档可读迷雾中的航母', async () => {
    const { buildWorld } = await loadCore();
    const me = { id: 'player1', name: 'red' };
    const foe = { id: 'player2', name: 'blue' };
    const neutral = { id: 'neutral', name: 'neutral' };
    const home = makeTile(0, 0, { isCity: true, camp: me, districtId: 1 });
    const prize = makeTile(1, -2, { isCity: true, camp: neutral, districtId: 5 });
    const fleetTile = makeTile(6, 2, { districtId: 10, surface: 'deepWater' });
    const linkedTile = makeTile(-5, 3, { districtId: 9 });
    makeUnit(1, 'infantry', me, home);
    const transferable = makeUnit(20, 'carrier', neutral, fleetTile);
    makeUnit(21, 'shoreBattery', neutral, linkedTile, {
        _followsCity: { q: -9, r: 3 }
    });
    const tiles = [home, prize, fleetTile, linkedTile];
    const state = makeState(tiles, { player1: me, player2: foe, neutral }, {
        standardMapId: 'uncharted-passage'
    });
    const world = buildWorld(state, makeHelpers(tiles), me, TIER_CAPABILITIES.hard);
    const prizeCity = world.cities.find(city => city.tile === prize);
    const expectedTransfer = estimateForceValue([transferable]);
    assert.equal(prizeCity.asset.reward, expectedTransfer);
    transferable.camp = foe;
    prize.camp = foe;
    assert.equal(buildWorld(state, makeHelpers(tiles), me, TIER_CAPABILITIES.hard)
        .cities.find(city => city.tile === prize).asset.reward, expectedTransfer);
    state.skirmishFog = true;
    const fogHelpers = { ...makeHelpers(tiles), isTileVisible: tile => tile !== fleetTile };
    assert.equal(buildWorld(state, fogHelpers, me, TIER_CAPABILITIES.hard)
        .cities.find(city => city.tile === prize).asset.reward, expectedTransfer);
    assert.equal(buildWorld(state, fogHelpers, me, TIER_CAPABILITIES.medium)
        .cities.find(city => city.tile === prize).asset.reward, 0);
    assert.equal(buildWorld({ ...state, campaignMode: true }, fogHelpers, me, TIER_CAPABILITIES.hard)
        .cities.find(city => city.tile === prize).asset.reward, 0);
    state.skirmishFog = false;
    transferable.hp = 0;
    assert.equal(buildWorld(state, makeHelpers(tiles), me, TIER_CAPABILITIES.hard)
        .cities.find(city => city.tile === prize).asset.reward, 0);
});

test('Imperator races for an uncharted prize that a rival can take', async () => {
    const { buildWorld, decideStrategy, assignMissions } = await loadCore();
    const me = { id: 'player1', name: 'red' };
    const foe = { id: 'player2', name: 'blue' };
    const neutral = { id: 'neutral', name: 'neutral' };
    const home = makeTile(0, 0, { isCity: true, camp: me, districtId: 1 });
    const decoy = makeTile(-1, 0, { isCity: true, camp: neutral, districtId: 6, hp: 0 });
    const prize = makeTile(1, -2, { isCity: true, camp: neutral, districtId: 5, hp: 0 });
    const fleetTile = makeTile(5, 1, { districtId: 10, surface: 'deepWater' });
    const rivalTile = makeTile(3, -2);
    makeUnit(1, 'infantry', me, home);
    makeUnit(10, 'infantry', foe, rivalTile);
    makeUnit(20, 'carrier', neutral, fleetTile);
    const tiles = [home, decoy, prize, fleetTile, rivalTile, makeTile(0, -1), makeTile(2, -2)];
    const state = makeState(tiles, { player1: me, player2: foe, neutral }, {
        standardMapId: 'uncharted-passage'
    });
    const world = buildWorld(state, makeHelpers(tiles), me, TIER_CAPABILITIES.hard);
    const strategy = decideStrategy(world);
    const { missions } = assignMissions(world, strategy);
    const siege = missions.find(mission => mission.kind === 'siege');
    assert.deepEqual([siege.targetQ, siege.targetR], [prize.q, prize.r]);
    fleetTile.unit.hp = 0;
    state._aiCoreMemory = {};
    const withoutCarrier = buildWorld(state, makeHelpers(tiles), me, TIER_CAPABILITIES.hard);
    const nextSiege = assignMissions(withoutCarrier, decideStrategy(withoutCarrier))
        .missions.find(mission => mission.kind === 'siege');
    assert.deepEqual([nextSiege.targetQ, nextSiege.targetR], [decoy.q, decoy.r],
        '失去航母收益后应允许选择更近的外围城');
});

test('Imperator stages a safe landing, then uses ranged fire to hand the city to its occupier', async () => {
    const { buildWorld, planTactics } = await loadCore();
    const me = { id: 'player1' };
    const foe = { id: 'player2' };
    const neutral = { id: 'neutral', controller: 'ai' };
    const water = Array.from({ length: 5 }, (_, q) => makeTile(q, 0, { surface: 'shallowWater', terrain: 'water' }));
    const shore = makeTile(4, 1);
    const closeShore = makeTile(5, 0);
    const goal = makeTile(6, 0, { isCity: true, camp: neutral, hp: 68 });
    const rivalTile = makeTile(6, -1);
    const supportTile = makeTile(5, -1, { surface: 'shallowWater', terrain: 'water' });
    const carrierTile = makeTile(4, -1, { surface: 'shallowWater', terrain: 'water' });
    const cavalry = makeUnit(1, 'cavalry', me, water[0], { isEmbarked: true });
    const ship = makeUnit(2, 'warship', me, supportTile);
    const rival = makeUnit(3, 'infantry', foe, rivalTile);
    makeUnit(4, 'carrier', neutral, carrierTile);
    const tiles = [...water, shore, closeShore, goal, rivalTile, supportTile, carrierTile];
    const state = makeState(tiles, { player1: me, player2: foe, neutral }, { standardMapId: 'uncharted-passage' });
    const helpers = {
        ...makeHelpers(tiles),
        getMovableTiles: unit => unit === cavalry && unit.tile === water[3] ? [water[4], shore, closeShore] : [],
        getAttackableTiles: unit => unit === ship || (unit === cavalry && unit.tile === closeShore) ? [goal] : []
    };
    const mission = { kind: 'siege', targetQ: goal.q, targetR: goal.r, occupierId: cavalry.id, escortIds: [ship.id] };
    const context = { missions: [mission], assignment: new Map([[cavalry.id, mission], [ship.id, mission]]) };
    const turn = () => {
        const world = buildWorld(state, helpers, me, TIER_CAPABILITIES.hard);
        world.estimateSiegeDamage = unit => unit === ship ? 27 : 44;
        world.threatAt = (tile, defender) => {
            if (tile === water[4] || tile === closeShore) {
                assert.equal(defender.isEmbarked, tile === water[4]);
                return cavalry.hp;
            }
            return 0;
        };
        return world;
    };
    const relocate = (tile, isEmbarked) => {
        cavalry.tile.unit = null;
        cavalry.tile = tile;
        cavalry.isEmbarked = isEmbarked;
        tile.unit = cavalry;
    };
    const strategy = { posture: 'expand', reserve: 0 };
    assert.equal(buildWorld(state, helpers, me, TIER_CAPABILITIES.hard).threatAt(water[4], cavalry, rival),
        0, '停飞的中立航母不威胁登陆通道');
    assert.ok(turn().captureRoute(cavalry, goal).turns > 1.5, '跨海期间骑兵采用运输速度');
    const early = planTactics(turn(), strategy, context);
    assert.ok(!early.some(action => action.type === 'siegeCityAttack'), '友军过海时保留敌军脚下的城防');

    relocate(water[3], true);
    const approaching = planTactics(turn(), strategy, context);
    assert.ok(!approaching.some(action => action.type === 'siegeCityAttack'), '登陆当回合仍无法接城');
    const landing = approaching.find(action => action.type === 'move' && action.unitId === cavalry.id);
    assert.deepEqual(landing, { type: 'move', unitId: cavalry.id, tileQ: shore.q, tileR: shore.r, autoAttack: false });

    relocate(closeShore, false);
    const breach = planTactics(turn(), strategy, context).filter(action => action.type === 'siegeCityAttack');
    assert.deepEqual(breach.map(action => action.unitId), [ship.id, cavalry.id], '27 点火力先削墙，44 点近战接力进城');
});

test('Imperator targets the three-player leader for the late two-point city swing', async () => {
    const { buildWorld, decideStrategy, assignMissions } = await loadCore();
    const me = { id: 'player1', name: 'red' };
    const leader = { id: 'player2', name: 'blue' };
    const trailer = { id: 'player3', name: 'green' };
    const neutral = { id: 'neutral', name: 'neutral' };
    const home = makeTile(0, 0, { isCity: true, camp: me, districtId: 1 });
    const home2 = makeTile(-2, 0, { isCity: true, camp: me, districtId: 2 });
    const leaderTarget = makeTile(2, 0, { isCity: true, camp: leader, districtId: 3, hp: 0 });
    const leaderCity2 = makeTile(7, 0, { isCity: true, camp: leader, districtId: 4 });
    const leaderCity3 = makeTile(9, 0, { isCity: true, camp: leader, districtId: 5 });
    const trailerTarget = makeTile(1, 0, { isCity: true, camp: trailer, districtId: 6, hp: 0 });
    makeUnit(1, 'infantry', me, home);
    const tiles = [home, home2, leaderTarget, leaderCity2, leaderCity3, trailerTarget];
    const state = makeState(tiles, { player1: me, player2: leader, player3: trailer, neutral }, {
        turnCounter: 21 * 4,
        isThreePlayer: true
    });
    const world = buildWorld(state, makeHelpers(tiles), me, TIER_CAPABILITIES.hard);
    const strategy = decideStrategy(world);
    const { missions } = assignMissions(world, strategy);
    const siege = missions.find(mission => mission.kind === 'siege');
    assert.deepEqual([siege.targetQ, siege.targetR], [leaderTarget.q, leaderTarget.r]);
});

test('Imperator keeps all-in for the turn when approaching shortens capture ETA', async () => {
    const { buildWorld, decideStrategy } = await loadCore();
    const me = { id: 'player1', name: 'red' };
    const foe = { id: 'player2', name: 'blue' };
    const third = { id: 'player3', name: 'green' };
    const neutral = { id: 'neutral', name: 'neutral' };
    const home = makeTile(0, 0, { isCity: true, camp: me, districtId: 1 });
    const target = makeTile(14, 0, { isCity: true, camp: foe, districtId: 2, hp: 0 });
    const foeCity2 = makeTile(16, 0, { isCity: true, camp: foe, districtId: 3 });
    const thirdCity = makeTile(-8, 0, { isCity: true, camp: third, districtId: 4 });
    const movedTile = makeTile(2, 0);
    const occupier = makeUnit(1, 'infantry', me, home);
    const reserveTiles = Array.from({ length: 5 }, (_, index) => makeTile(-index - 1, -1));
    reserveTiles.forEach((tile, index) => makeUnit(index + 2, 'infantry', me, tile));
    const tiles = [home, target, foeCity2, thirdCity, movedTile, ...reserveTiles];
    const state = makeState(tiles, { player1: me, player2: foe, player3: third, neutral }, {
        turnCounter: 20 * 4,
        isThreePlayer: true
    });
    const helpers = makeHelpers(tiles);
    const first = decideStrategy(buildWorld(state, helpers, me, TIER_CAPABILITIES.hard));
    assert.equal(first.posture, 'allin');

    home.unit = null;
    movedTile.unit = occupier;
    occupier.tile = movedTile;
    const replanned = decideStrategy(buildWorld(state, helpers, me, TIER_CAPABILITIES.hard));
    assert.equal(replanned.posture, 'allin');
});

test('two siege fronts receive distinct occupiers without overwriting the primary assignment', async () => {
    const { buildWorld, decideStrategy, assignMissions } = await loadCore();
    const me = { id: 'player1', name: 'red' };
    const foe = { id: 'player2', name: 'blue' };
    const neutral = { id: 'neutral', name: 'neutral' };
    const home = makeTile(0, 0, { isCity: true, camp: me, districtId: 1 });
    const primary = makeTile(3, 0, { isCity: true, camp: neutral, districtId: 2, hp: 0 });
    const secondary = makeTile(-3, 0, { isCity: true, camp: neutral, districtId: 3, hp: 0 });
    const unitTiles = Array.from({ length: 8 }, (_, index) =>
        index === 0 ? home : makeTile(index % 2 ? index : -index, 1));
    unitTiles.forEach((tile, index) => makeUnit(index + 1, 'infantry', me, tile));
    const tiles = [home, primary, secondary, ...unitTiles.filter(tile => tile !== home)];
    const state = makeState(tiles, { player1: me, player2: foe, neutral });
    const world = buildWorld(state, makeHelpers(tiles), me, TIER_CAPABILITIES.hard);
    const result = assignMissions(world, decideStrategy(world));
    const sieges = result.missions.filter(mission => mission.kind === 'siege');
    assert.equal(sieges.length, 2);
    assert.notEqual(sieges[0].occupierId, sieges[1].occupierId);
    for (const siege of sieges) {
        const assigned = result.assignment.get(siege.occupierId);
        assert.deepEqual([assigned.targetQ, assigned.targetR], [siege.targetQ, siege.targetR]);
    }
});

test('Legatus vacates a minister for urgent recruitment and assigns the return next turn', async () => {
    const { buildWorld, decideStrategy, assignMissions, planProduction } = await loadCore();
    const me = { id: 'player1', name: 'blue' };
    const foe = { id: 'player2', name: 'red' };
    const neutral = { id: 'neutral', name: 'neutral' };
    const home = makeTile(0, 0, { isCity: true, camp: me, districtId: 1 });
    const exit = makeTile(1, 0);
    const enemyCity = makeTile(8, 0, { isCity: true, camp: foe, districtId: 2 });
    const minister = makeUnit(1, 'infantry', me, home, { commander: 'minister' });
    const tiles = [home, exit, enemyCity];
    for (let index = 0; index < 5; index++) {
        const tile = makeTile(8 + index, 1);
        tiles.push(tile);
        makeUnit(index + 10, 'infantry', foe, tile);
    }
    const helpers = {
        ...makeHelpers(tiles),
        getMovableTiles: unit => unit.id === minister.id ? [exit] : [],
        canRecruitTypeAtSite: (type, tile) => !tile.unit && tile.isCity && tile.camp === me
    };
    const state = makeState(tiles, { player1: me, player2: foe, neutral }, {
        playerGold: { player1: 60, player2: 20, neutral: 0 }
    });
    const world = buildWorld(state, helpers, me, TIER_CAPABILITIES.medium);
    const strategy = decideStrategy(world);
    const missions = assignMissions(world, strategy);
    const production = planProduction(world, strategy, missions);
    assert.deepEqual(production.setup[0], {
        type: 'move', unitId: minister.id, tileQ: exit.q, tileR: exit.r,
        autoAttack: false, returnToCity: { q: home.q, r: home.r, round: world.round }
    });
    assert.ok(production.setup.some(action => action.type === 'recruit'
        && action.tileQ === home.q && action.tileR === home.r));
    assert.equal(state._aiCoreMemory.player1.ministerReturn, undefined, '规划不能提前写入成功腾位');

    home.unit = null;
    exit.unit = minister;
    minister.tile = exit;
    minister.canAct = true;
    state._aiCoreMemory.player1.ministerReturn = {
        unitId: minister.id, cityQ: home.q, cityR: home.r, vacatedRound: world.round
    };
    state.turnCounter += 3;
    const nextWorld = buildWorld(state, helpers, me, TIER_CAPABILITIES.medium);
    const nextMissions = assignMissions(nextWorld, decideStrategy(nextWorld));
    const returnMission = nextMissions.missions.find(mission =>
        mission.kind === 'garrison' && mission.occupierId === minister.id);
    assert.deepEqual([returnMission.targetQ, returnMission.targetR], [home.q, home.r]);
});

test('移动后追击拒绝骑兵与岸防炮的亏损交换，也拒绝致死反击', async () => {
    const me = { id: 'player1' }, foe = { id: 'player2' }, neutral = { id: 'neutral' };
    const from = makeTile(0, 0, { surface: 'shallowWater' }), target = makeTile(1, 0);
    const cavalry = makeUnit(1, 'cavalry', me, from, { isEmbarked: true });
    const battery = makeUnit(2, 'shoreBattery', neutral, target);
    const tiles = [from, target];
    const state = makeState(tiles, { player1: me, player2: foe, neutral });
    const helpers = { ...makeHelpers(tiles), getAttackableTiles: () => [target] };
    assert.equal(planFollowupAttack(state, helpers, me, TIER_CAPABILITIES.hard, cavalry.id), null);
    cavalry.hp = 15;
    assert.equal(planFollowupAttack(state, helpers, me, TIER_CAPABILITIES.hard, cavalry.id, battery.id), null);
    battery.hp = 1;
    assert.equal(planFollowupAttack(state, helpers, me, TIER_CAPABILITIES.hard, cavalry.id)?.targetId, battery.id,
        '仍应收掉能安全击杀的目标');
});

test('困难 AI 保留海军将领，拒绝反击后会被下一轮舰炮收掉的亏损交换', () => {
    const me = { id: 'player1' }, foe = { id: 'player2' }, neutral = { id: 'neutral' };
    const sea = { surface: 'shallowWater', terrain: 'water' };
    const from = makeTile(2, 1, sea), target = makeTile(1, 2, sea);
    const cruiser = makeUnit(1, 'warship', me, from, {
        commander: 'vampire', hp: 165, maxHp: 216, getEffectiveAttack: () => 70
    });
    const battleship = makeUnit(2, 'gb_battleship', foe, target, {
        commander: 'centurion', hp: 245, maxHp: 245, getEffectiveAttack: () => 105
    });
    const tiles = [from, target];
    const state = makeState(tiles, { player1: me, player2: foe, neutral });
    const helpers = { ...makeHelpers(tiles), getAttackableTiles: () => [target] };
    const attack = () => planFollowupAttack(state, helpers, me, TIER_CAPABILITIES.hard, cruiser.id, battleship.id);

    assert.equal(attack(), null);
    battleship.counterAttackCount = 1;
    assert.equal(attack()?.targetId, battleship.id, '对手已经反击时，仍可安全开火');
    battleship.counterAttackCount = 0;
    battleship.hp = 30;
    assert.equal(attack()?.targetId, battleship.id, '仍可直接斩杀');
});

test('陆军移动到任务目标旁时，优先一击拿下低血城防', () => {
    const me = { id: 'player1' }, foe = { id: 'player2' }, neutral = { id: 'neutral' };
    const from = makeTile(0, 0);
    const city = makeTile(1, 0, { isCity: true, camp: neutral, hp: 30 });
    const ship = makeTile(0, 1, { surface: 'shallowWater' });
    const infantry = makeUnit(1, 'infantry', me, from);
    const destroyer = makeUnit(2, 'destroyer', neutral, ship, { hp: 1 });
    const tiles = [from, city, ship];
    const state = makeState(tiles, { player1: me, player2: foe, neutral }, {
        _aiCoreMemory: { player1: { missions: [{ kind: 'siege', targetQ: city.q, targetR: city.r }] } }
    });
    const helpers = { ...makeHelpers(tiles), getAttackableTiles: () => [ship, city] };
    const followup = () => planFollowupAttack(state, helpers, me, TIER_CAPABILITIES.hard, infantry.id);
    assert.deepEqual(followup(), { type: 'siegeCityAttack', unitId: infantry.id, tileQ: city.q, tileR: city.r });
    city.hp = 200;
    assert.equal(followup()?.targetId, destroyer.id);
});

test('陆军谋士有安全陆地时不登船，已经登船则优先返回安全陆地', async () => {
    const { buildWorld, planTactics } = await loadCore();
    const me = { id: 'player1' }, foe = { id: 'player2' }, neutral = { id: 'neutral' };
    const land = makeTile(0, 0, { camp: me });
    const port = makeTile(1, 0, { isPort: true, surface: 'shallowWater', camp: neutral });
    const advisor = makeUnit(1, 'archer', me, land, { commander: 'advisor' });
    const tiles = [land, port];
    const state = makeState(tiles, { player1: me, player2: foe, neutral });
    const helpers = { ...makeHelpers(tiles), getMovableTiles: () => advisor.isEmbarked ? [land] : [port] };
    const context = { missions: [], assignment: new Map() };
    const actions = () => planTactics(buildWorld(state, helpers, me, TIER_CAPABILITIES.hard), { posture: 'contest' }, context);
    assert.deepEqual(actions(), []);

    land.unit = null;
    port.unit = advisor;
    advisor.tile = port;
    advisor.isEmbarked = true;
    assert.deepEqual(actions(), [{ type: 'move', unitId: advisor.id, tileQ: land.q, tileR: land.r }]);
});

test('南城回归：困难骑兵放弃反击后会被步炮收掉的冲城，保留斩杀占城', () => {
    const me = { id: 'player1' }, foe = { id: 'player2' }, neutral = { id: 'neutral' };
    const from = makeTile(-1, 4), city = makeTile(-2, 5, { isCity: true, camp: neutral, hp: 250 });
    const flank = makeTile(-2, 4), artillery = makeTile(-3, 5);
    const cavalry = makeUnit(1, 'cavalry', me, from);
    const garrison = makeUnit(2, 'infantry', neutral, city);
    makeUnit(3, 'infantry', neutral, flank);
    makeUnit(4, 'archer', neutral, artillery);
    const tiles = [from, city, flank, artillery];
    const state = makeState(tiles, { player1: me, player2: foe, neutral }, { skirmishFog: true });
    const helpers = { ...makeHelpers(tiles), getAttackableTiles: () => [city] };
    assert.equal(planFollowupAttack(state, helpers, me, TIER_CAPABILITIES.hard, cavalry.id, garrison.id), null);
    garrison.hp = 1;
    assert.equal(planFollowupAttack(state, helpers, me, TIER_CAPABILITIES.hard, cavalry.id, garrison.id)?.targetId, garrison.id);
});

test('困难档按敌方实有金币及被占村庄收入判断空城补兵风险', async () => {
    const { buildWorld } = await loadCore();
    const me = { id: 'player1' }, foe = { id: 'player2' }, neutral = { id: 'neutral' };
    const home = makeTile(0, 0, { isCity: true, camp: me, districtId: 1 });
    const city = makeTile(5, 0, { isCity: true, camp: foe, districtId: 2, hp: 100 });
    const village = makeTile(4, 0, { isVillage: true, camp: foe, districtId: 2 });
    makeUnit(1, 'infantry', me, village);
    const tiles = [home, city, village];
    const state = makeState(tiles, { player1: me, player2: foe, neutral }, {
        skirmishFog: true,
        villageTiles: new Map([['4,0', { districtId: 2 }]]),
        playerGold: { player1: 10, player2: 3 }
    });
    const helpers = { ...makeHelpers(tiles), isTileVisible: tile => tile === home };
    const poor = buildWorld(state, helpers, me, TIER_CAPABILITIES.hard);
    assert.equal(poor.rivalEconomyByKey.get('player2').projectedIncome, 4);
    assert.equal(poor.rivalEconomyByKey.get('player2').gold, 3);
    state.playerGold.player2 = 4;
    const funded = buildWorld(state, helpers, me, TIER_CAPABILITIES.hard);
    assert.equal(rankCityObjectives(poor, () => 2)[0].score
        - rankCityObjectives(funded, () => 2)[0].score, W.rivalRecruitmentPressure);
    const medium = buildWorld(state, helpers, me, TIER_CAPABILITIES.medium);
    assert.equal(medium.rivalEconomyByKey.get('player2').gold, undefined);
});

test('移动后追击不能给更近的敌军占领者清空中立城', () => {
    const me = { id: 'player1' }, foe = { id: 'player2' }, neutral = { id: 'neutral' };
    const from = makeTile(0, 0), city = makeTile(2, 0, { isCity: true, camp: neutral, hp: 9 });
    const rivalTile = makeTile(2, 1);
    const shooter = makeUnit(1, 'archer', me, from);
    makeUnit(2, 'infantry', neutral, city, { hp: 1 });
    makeUnit(3, 'infantry', foe, rivalTile);
    const tiles = [from, city, rivalTile];
    const state = makeState(tiles, { player1: me, player2: foe, neutral });
    const helpers = { ...makeHelpers(tiles), getAttackableTiles: () => [city] };
    assert.equal(planFollowupAttack(state, helpers, me, TIER_CAPABILITIES.hard, shooter.id), null);
});

test('经济将领不虚报占领兵力或夺城时间，残局恢复仍须追分', async () => {
    const { buildWorld, decideStrategy } = await loadCore();
    const me = { id: 'player1' }, foe = { id: 'player2' }, neutral = { id: 'neutral' };
    const home = makeTile(0, 0, { isCity: true, camp: me });
    const enemy = makeTile(9, 0, { isCity: true, camp: foe });
    const extra = makeTile(10, 0, { isCity: true, camp: foe });
    makeUnit(1, 'infantry', me, home, { commander: 'minister' });
    makeUnit(2, 'infantry', foe, enemy);
    makeUnit(3, 'infantry', foe, extra);
    const tiles = [home, enemy, extra];
    const state = makeState(tiles, { player1: me, player2: foe, neutral }, { turnCounter: 17 * 3 });
    const world = buildWorld(state, makeHelpers(tiles), me, TIER_CAPABILITIES.hard);
    assert.equal(estimateCaptureEta(world, world.cities.find(city => city.tile === enemy)), null);
    const strategy = decideStrategy(world);
    assert.equal(strategy.assaultCapacity.available, 0);
    assert.equal(strategy.posture, 'allin');
    for (let i = 0; i < 15; i++) decideStrategy(world);
    assert.equal(state._aiCoreMemory.player1.unitCountHistory.length, 1, '同回合重规划不冲掉跨回合历史');
});

test('生产计划使用累计余额，不同时承诺买不起的多城招募', async () => {
    const { buildWorld, decideStrategy, assignMissions, planProduction } = await loadCore();
    const me = { id: 'player1' }, foe = { id: 'player2' }, neutral = { id: 'neutral' };
    const tiles = [makeTile(0, 0, { isCity: true, camp: me }), makeTile(2, 0, { isCity: true, camp: me })];
    const state = makeState(tiles, { player1: me, player2: foe, neutral }, {
        playerGold: { player1: 8, player2: 0, neutral: 0 }
    });
    const world = buildWorld(state, makeHelpers(tiles), me, TIER_CAPABILITIES.hard);
    const strategy = { ...decideStrategy(world), reserve: 0 };
    const production = planProduction(world, strategy, assignMissions(world, strategy));
    assert.equal(production.actions.filter(action => action.type === 'recruit').length, 1);
    assert.equal(production.recruitSpend, 8);
});

test('致死毒伤的疗愈优先于两张进攻卡，不把护盾当作净化', async () => {
    const { buildWorld, decideStrategy } = await loadCore();
    const me = { id: 'player1' }, foe = { id: 'player2' }, neutral = { id: 'neutral' };
    const home = makeTile(0, 0), enemy = makeTile(3, 0);
    const sick = makeUnit(1, 'warship', me, home, { hp: 20, _poison: { remainingTicks: 3 } });
    makeUnit(2, 'warship', foe, enemy, { commander: 'ironGuard' });
    const tiles = [home, enemy];
    const state = makeState(tiles, { player1: me, player2: foe, neutral }, {
        playerHands: { player1: ['lightning', 'imprison', 'heal'], player2: [] }
    });
    const world = buildWorld(state, makeHelpers(tiles), me, TIER_CAPABILITIES.hard);
    const cards = planCards(world, decideStrategy(world), { missions: [], assignment: new Map() });
    assert.deepEqual(cards.setup[0], { type: 'tacticalCard', cardId: 'heal', targetId: sick.id });
    assert.equal(cards.setup.length + cards.sustain.length, 2);
});

test('满手中毒时使用合法防御卡并预留抽牌位置，不能在水面部署碉堡', async () => {
    const { buildWorld, decideStrategy } = await loadCore();
    const me = { id: 'player1' }, foe = { id: 'player2' }, neutral = { id: 'neutral' };
    const home = makeTile(0, 0, { isCity: true, camp: me });
    const site = makeTile(1, 0, { camp: me });
    const sea = makeTile(0, 1, { surface: 'shallowWater', camp: me });
    const enemy = makeTile(3, 0);
    makeUnit(1, 'infantry', me, home, { hp: 60, _poison: { remainingTicks: 3 } });
    makeUnit(2, 'infantry', foe, enemy);
    const tiles = [home, site, sea, enemy];
    const state = makeState(tiles, { player1: me, player2: foe, neutral }, {
        playerHands: { player1: ['mgNest', 'landmine', 'shield'], player2: [] }
    });
    const helpers = makeHelpers(tiles);
    const world = buildWorld(state, helpers, me, TIER_CAPABILITIES.hard);
    const strategy = { ...decideStrategy(world), posture: 'contest', cardPolicy: 'normal', reserve: 0 };
    const cards = planCards(world, strategy, { missions: [], assignment: new Map() });
    const uses = [...cards.setup, ...cards.sustain];
    assert.ok(uses.some(action => action.cardId === 'mgNest' && action.targetId === site.id));
    assert.ok(!uses.some(action => action.cardId === 'mgNest' && action.targetId === sea.id));
    assert.equal(shouldDrawCard(world, strategy, 0, uses.length), true);
    assert.equal(shouldDrawCard(world, strategy, 0, 0), false, '没有实际用牌计划时不能绕过手牌上限');
});

test('投毒评分扣除相邻关键友军的传染成本', async () => {
    const { buildWorld, decideStrategy } = await loadCore();
    const me = { id: 'player1' }, foe = { id: 'player2' }, neutral = { id: 'neutral' };
    const enemy = makeTile(0, 0);
    const tiles = [enemy];
    makeUnit(10, 'carrier', foe, enemy);
    const escorts = HEX_NEIGHBORS.map(([q, r], index) => {
        const tile = makeTile(q, r); tiles.push(tile);
        return makeUnit(index + 1, 'warship', me, tile, { commander: index === 0 ? 'priest' : null });
    });
    const state = makeState(tiles, { player1: me, player2: foe, neutral }, {
        playerHands: { player1: ['poison'], player2: [] }
    });
    const world = buildWorld(state, makeHelpers(tiles), me, TIER_CAPABILITIES.hard);
    const cards = planCards(world, decideStrategy(world), {
        missions: [{ kind: 'siege', occupierId: escorts[0].id, escortIds: escorts.slice(1).map(unit => unit.id) }],
        assignment: new Map()
    });
    assert.ok(!cards.setup.some(action => action.cardId === 'poison'));
});

test('二人对局中未激活的第三阵营席位不会触发崩塌收官死斗', async () => {
    const { buildWorld, decideStrategy } = await loadCore();
    const me = { id: 'player1', active: true, participatesInTurns: true };
    const foe = { id: 'player2', active: true, participatesInTurns: true };
    const ghost = { id: 'player3', active: false, participatesInTurns: false };
    const neutral = { id: 'neutral', active: true, participatesInTurns: true };
    const home = makeTile(0, 0, { isCity: true, camp: me, districtId: 1 });
    const enemyCity1 = makeTile(6, 0, { isCity: true, camp: foe, districtId: 2 });
    const enemyCity2 = makeTile(8, 0, { isCity: true, camp: foe, districtId: 3 });
    const tiles = [home, enemyCity1, enemyCity2];
    for (let i = 0; i < 6; i++) {
        const t1 = i === 0 ? home : makeTile(i, 1);
        const t2 = i === 0 ? enemyCity1 : makeTile(6 + i, 1);
        if (i > 0) tiles.push(t1, t2);
        makeUnit(i + 1, 'infantry', me, t1);
        makeUnit(i + 20, 'infantry', foe, t2);
    }
    const state = makeState(tiles, { player1: me, player2: foe, player3: ghost, neutral }, {
        turnCounter: 6 * 3,
        isThreePlayer: false
    });
    const world = buildWorld(state, makeHelpers(tiles), me, TIER_CAPABILITIES.hard);
    const strategy = decideStrategy(world);
    assert.equal(world.rivalFactions.includes(ghost), false);
    assert.equal(world.collapseTarget, null);
    assert.notEqual(strategy.posture, 'allin');
});

test('圣骑士激活至圣斩后同轮计入真伤并一击夺取零城防中立城', async () => {
    const { buildWorld, decideStrategy, assignMissions, planTactics } = await loadCore();
    const me = { id: 'player1' }, foe = { id: 'player2' }, neutral = { id: 'neutral' };
    const home = makeTile(5, 0, { isCity: true, camp: me, districtId: 1 });
    const centerCity = makeTile(0, 0, { isCity: true, camp: neutral, districtId: 3, hp: 0 });
    const paladinTile = makeTile(1, -1);
    const flankerTile = makeTile(-1, 0);
    const paladin = makeUnit(1, 'cavalry', me, paladinTile, {
        commander: 'paladin', _faith: 1, hp: 100, maxHp: 187
    });
    const garrison = makeUnit(2, 'infantry', neutral, centerCity, { hp: 55 });
    makeUnit(3, 'infantry', neutral, flankerTile, { hp: 180 });
    const tiles = [home, centerCity, paladinTile, flankerTile];
    const helpers = {
        ...makeHelpers(tiles),
        getAttackableTiles: unit => unit === paladin ? [centerCity] : []
    };
    const state = makeState(tiles, { player1: me, player2: foe, neutral }, { turnCounter: 6 });
    const world = buildWorld(state, helpers, me, TIER_CAPABILITIES.hard);
    const strategy = decideStrategy(world);
    const missions = assignMissions(world, strategy);
    const actions = planTactics(world, strategy, missions);
    assert.deepEqual(actions.slice(0, 2), [
        { type: 'activateSkill', unitId: paladin.id },
        { type: 'attack', unitId: paladin.id, targetId: garrison.id }
    ]);
    assert.equal(paladin._smiteReady, undefined, '规划阶段虚拟状态不会残留到单位实例');
});

test('陆图占领者撤退远离后及时换人，且内陆城攻城不编入潜艇护航', async () => {
    const { buildWorld, decideStrategy, assignMissions } = await loadCore();
    const me = { id: 'player1' }, foe = { id: 'player2' }, neutral = { id: 'neutral' };
    const home = makeTile(5, 0, { isCity: true, camp: me, districtId: 1 });
    const target = makeTile(0, 0, { isCity: true, camp: foe, districtId: 2, hp: 0 });
    const farTile = makeTile(-1, -7);
    const nearTile = makeTile(2, 0);
    const seaTile = makeTile(6, 0, { surface: 'shallowWater', terrain: 'water' });
    const retreated = makeUnit(1, 'infantry', me, farTile, { hp: 40 });
    const fresh = makeUnit(2, 'infantry', me, nearTile);
    const sub = makeUnit(3, 'submarine', me, seaTile);
    makeUnit(10, 'infantry', foe, target, { hp: 120 });
    const tiles = [home, target, farTile, nearTile, seaTile];
    const state = makeState(tiles, { player1: me, player2: foe, neutral }, {
        turnCounter: 15,
        _aiCoreMemory: {
            player1: {
                missions: [{
                    id: 'm-old', kind: 'siege', targetQ: 0, targetR: 0,
                    occupierId: retreated.id, escortIds: [sub.id], createdRound: 4
                }]
            }
        }
    });
    const world = buildWorld(state, makeHelpers(tiles), me, TIER_CAPABILITIES.hard);
    const { missions } = assignMissions(world, decideStrategy(world));
    const siege = missions.find(m => m.kind === 'siege');
    assert.equal(siege.occupierId, fresh.id);
    assert.equal(siege.escortIds.includes(sub.id), false);
});

test('中共游击纵队推断敌军防守盲区并先开启敌后隐匿再渗透侧翼', async () => {
    const { buildWorld, decideStrategy, assignMissions, planTactics } = await loadCore();
    const me = { id: 'player1', flagPreset: 'img/flags/chinese-communist-party-old.svg' };
    const foe = { id: 'player2' };
    const neutral = { id: 'neutral' };
    const home = makeTile(0, 0, { isCity: true, camp: me, districtId: 1 });
    const startTile = makeTile(0, 1);
    // 主战场 (5,0) 敌军重兵抱团
    const mainFront1 = makeTile(5, 0, { isCity: true, camp: foe, districtId: 2, hp: 250 });
    const mainFront2 = makeTile(5, -1, { camp: foe });
    const mainFront3 = makeTile(4, 0, { camp: foe });
    // 侧翼盲区 (1,3) 有敌方疏于防守的村庄与孤立后排炮兵 (2,3)（距 (0,2) 恰为 3 格，处于下回合 2 步移动 + 1 格奇袭半径内）
    const flankStep = makeTile(0, 2, { terrain: 'forest' });
    const frontStep = makeTile(1, 1, { terrain: 'plains' });
    const neglectedVillage = makeTile(1, 3, { isVillage: true, camp: foe, districtId: 2 });
    const isolatedArcher = makeTile(2, 3, { camp: foe });

    const guerrilla = makeUnit(1, 'cpc_guerrilla', me, startTile, { remainingMP: 5 });
    makeUnit(2, 'infantry', me, home);
    makeUnit(10, 'infantry', foe, mainFront1);
    makeUnit(11, 'infantry', foe, mainFront2);
    makeUnit(12, 'cavalry', foe, mainFront3);
    makeUnit(13, 'archer', foe, isolatedArcher, { hp: 70 });

    const tiles = [home, startTile, mainFront1, mainFront2, mainFront3, flankStep, frontStep, neglectedVillage, isolatedArcher];
    const helpers = {
        ...makeHelpers(tiles),
        getMovableTiles: unit => unit === guerrilla ? [flankStep, frontStep] : []
    };
    const state = makeState(tiles, { player1: me, player2: foe, neutral }, {
        factionRuleMode: 'culture',
        currentCamp: me
    });
    const world = buildWorld(state, helpers, me, TIER_CAPABILITIES.hard);
    const strategy = decideStrategy(world);
    const missions = assignMissions(world, strategy);
    const actions = planTactics(world, strategy, missions);

    const concealIdx = actions.findIndex(a => a.type === 'guerrillaConcealment' && a.unitId === guerrilla.id);
    const moveAct = actions.find(a => a.type === 'move' && a.unitId === guerrilla.id);
    assert.ok(concealIdx >= 0, '游击纵队应主动开启敌后隐匿');
    assert.ok(moveAct, '游击纵队应向盲区机动');
    assert.deepEqual([moveAct.tileQ, moveAct.tileR], [flankStep.q, flankStep.r], '应绕开重兵正面，走向敌方忽视的侧翼盲区');
    assert.equal(moveAct.autoAttack, false, '隐匿渗透盲区时不主动普攻暴露');
});

test('游击纵队按 1 点全地形步耗计算剩余行动力，不被己方后方村庄吸走或堵住无威胁主城', async () => {
    const { buildWorld, decideStrategy, assignMissions, planTactics } = await loadCore();
    const me = { id: 'player1', flagPreset: 'img/flags/chinese-communist-party-old.svg' };
    const foe = { id: 'player2' };
    const neutral = { id: 'neutral' };
    const home = makeTile(0, 0, { isCity: true, camp: me, districtId: 1 });
    // 同行政区内尚未变更 camp 字段的己方后方村庄（应视作归己方城市控制，不能吸走前线游击队）
    const ownBackVillage = makeTile(-2, 0, { isVillage: true, camp: neutral, districtId: 1 });
    const startTile = makeTile(2, 0, { terrain: 'mountain' });
    const stepForward = makeTile(3, 0, { terrain: 'mountain' }); // 共 1~3 格，1 MP/格
    const isolatedArcher = makeTile(5, 0, { camp: foe });
    const enemyCity = makeTile(8, 0, { isCity: true, camp: foe, districtId: 2, hp: 200 });

    const guerrilla = makeUnit(1, 'cpc_guerrilla', me, startTile, { remainingMP: 5 });
    const foeArcher = makeUnit(10, 'archer', foe, isolatedArcher, { hp: 75 });
    makeUnit(11, 'infantry', foe, enemyCity);
    const tiles = [home, ownBackVillage, startTile, stepForward, isolatedArcher, enemyCity];
    const helpers = {
        ...makeHelpers(tiles),
        getMovableTiles: unit => unit === guerrilla ? [home, ownBackVillage, stepForward] : []
    };
    const state = makeState(tiles, { player1: me, player2: foe, neutral }, {
        factionRuleMode: 'culture',
        currentCamp: me
    });
    const world = buildWorld(state, helpers, me, TIER_CAPABILITIES.hard);
    const strategy = decideStrategy(world);
    const missions = assignMissions(world, strategy);
    const actions = planTactics(world, strategy, missions);

    const concealAct = actions.find(a => a.type === 'guerrillaConcealment' && a.unitId === guerrilla.id);
    const moveAct = actions.find(a => a.type === 'move' && a.unitId === guerrilla.id);
    assert.ok(concealAct, '1 MP/格步耗下，山地机动 1~3 格后仍足够支付 2 MP 开启敌后隐匿');
    assert.deepEqual([moveAct.tileQ, moveAct.tileR], [stepForward.q, stepForward.r], '应前出切入 2 格内准备下回合奇袭，而不是退回自家村庄或主城');
    assert.notEqual(foeArcher.hp, 0);
});

test('日本帝国武士检测可达范围内中低血量敌人，配合友军软化执行移动+万岁冲锋斩首', async () => {
    const { buildWorld, decideStrategy, assignMissions, planTactics } = await loadCore();
    const me = { id: 'player1', flagPreset: 'img/flags/svg/jp.svg' };
    const foe = { id: 'player2' };
    const neutral = { id: 'neutral' };
    const home = makeTile(0, 0, { isCity: true, camp: me, districtId: 1 });
    const stageTile = makeTile(1, 0);
    const midTile = makeTile(2, 0);
    const targetTile = makeTile(3, 0);
    const archerTile = makeTile(1, -1);
    const enemyCity = makeTile(8, 0, { isCity: true, camp: foe, districtId: 2, hp: 250 });

    const samurai = makeUnit(1, 'jp_samurai', me, home, { remainingMP: 5, hp: 160 });
    const archer = makeUnit(2, 'archer', me, archerTile);
    // 敌军在 3 格处（超出原地 2 格冲锋，但在移动 1 格 + 冲锋 2 格的可达范围内），经炮兵软化后进入万岁冲锋斩杀线
    const enemy = makeUnit(10, 'infantry', foe, targetTile, { hp: 100, maxHp: 180 });
    makeUnit(11, 'infantry', foe, enemyCity);
    const tiles = [home, stageTile, midTile, targetTile, archerTile, enemyCity];
    const helpers = {
        ...makeHelpers(tiles),
        getMovableTiles: unit => unit === samurai ? [stageTile, midTile] : [],
        getAttackableTiles: unit => unit === archer ? [targetTile] : []
    };
    const state = makeState(tiles, { player1: me, player2: foe, neutral }, {
        factionRuleMode: 'culture',
        currentCamp: me
    });
    const world = buildWorld(state, helpers, me, TIER_CAPABILITIES.hard);
    const strategy = decideStrategy(world);
    const missions = assignMissions(world, strategy);
    const actions = planTactics(world, strategy, missions);

    const archerAtkIdx = actions.findIndex(a => a.type === 'attack' && a.unitId === archer.id && a.targetId === enemy.id);
    const samMoveIdx = actions.findIndex(a => a.type === 'move' && a.unitId === samurai.id);
    const banzaiIdx = actions.findIndex(a => a.type === 'banzaiCharge' && a.unitId === samurai.id);
    assert.ok(archerAtkIdx >= 0, '友军远程先软化目标');
    assert.ok(samMoveIdx > archerAtkIdx, '武士先机动切入冲锋射程');
    assert.ok(banzaiIdx > samMoveIdx, '武士随后发动万岁冲锋斩首');
    assert.equal(actions[samMoveIdx].autoAttack, false, '垫步移动不触发普攻以保留冲锋窗口');
    assert.deepEqual([actions[banzaiIdx].targetQ, actions[banzaiIdx].targetR], [targetTile.q, targetTile.r]);
});

test('天眼保留 5 金部署预算，且过滤非法城市与山地邻格', async () => {
    const { buildWorld } = await loadCore();
    const me = { id: 'player1' }, foe = { id: 'player2' }, neutral = { id: 'neutral' };
    const home = makeTile(-2, 0, { isCity: true, camp: me, districtId: 1 });
    const tianyanTile = makeTile(0, 0);
    const cityAdj = makeTile(1, 0, { isCity: true, camp: me, districtId: 2 });
    const mountainAdj = makeTile(0, 1, { terrain: 'mountain' });
    const validAdj = makeTile(1, -1, { terrain: 'plains' });
    const capturerTile = makeTile(2, 0);
    const foeCity = makeTile(6, 0, { isCity: true, camp: foe, districtId: 3, hp: 200 });

    const tianyan = makeUnit(1, 'infantry', me, tianyanTile, { commander: 'tianyan' });
    makeUnit(2, 'infantry', me, capturerTile);
    makeUnit(3, 'infantry', me, home);
    makeUnit(10, 'infantry', foe, foeCity);
    const tiles = [home, tianyanTile, cityAdj, mountainAdj, validAdj, capturerTile, foeCity];
    const helpers = {
        ...makeHelpers(tiles),
        canRecruitTypeAtSite: (type, tile) => !tile.unit && tile.isCity && tile.camp === me
    };
    const state = makeState(tiles, { player1: me, player2: foe, neutral }, {
        playerGold: { player1: 11, player2: 10, neutral: 0 }
    });
    const actions = planTurn(state, helpers, me, TIER_CAPABILITIES.hard);
    const deploy = actions.find(a => a.type === 'droneDeploy' && a.unitId === tianyan.id);
    assert.ok(deploy, '有现成占城突击力量时，应保住 5 金部署天眼无人机而非被备用城招兵耗尽');
    assert.deepEqual([deploy.tileQ, deploy.tileR], [validAdj.q, validAdj.r], '跳过城市与山地邻格，选合法平地部署');
    assert.equal(actions.some(a => a.type === 'recruit'), false);

    // 验证当全队零突击单位且仅 12 金时，仍优先 8 金补步兵而不抢 5 金无人机
    capturerTile.unit = null;
    home.unit = null;
    tianyanTile.unit = null;
    const archerTile = makeTile(-1, 0);
    makeUnit(1, 'archer', me, archerTile, { commander: 'tianyan' });
    state.playerGold.player1 = 12;
    const tightActions = planTurn(state, helpers, me, TIER_CAPABILITIES.hard);
    assert.ok(tightActions.some(a => a.type === 'recruit' && a.unitType === 'infantry'));
    assert.equal(tightActions.some(a => a.type === 'droneDeploy'), false);
    buildWorld(state, helpers, me, TIER_CAPABILITIES.hard);
});

test('海军旗舰在重交叉火力下先撤离再求战，护盾卡优先保濒死单位', async () => {
    const { buildWorld, decideStrategy, assignMissions, planTactics } = await loadCore();
    const me = { id: 'player1' }, foe = { id: 'player2' }, neutral = { id: 'neutral', controller: 'ai' };
    const shipTile = makeTile(4, 0, { surface: 'shallowWater', terrain: 'water' });
    const safeSea = makeTile(6, 0, { surface: 'shallowWater', terrain: 'water' });
    const safeAllyTile = makeTile(9, 0, { surface: 'shallowWater', terrain: 'water' });
    const neutralPort = makeTile(3, 0, { surface: 'shallowWater', terrain: 'water', isPort: true, camp: neutral, districtId: 3 });
    const b1Tile = makeTile(3, -1, { camp: neutral, districtId: 3 });
    const b2Tile = makeTile(2, 2, { camp: neutral, districtId: 3 });
    const neutralCity = makeTile(3, -2, { isCity: true, camp: neutral, districtId: 3, hp: 100 });
    const foeCity = makeTile(11, 0, { isCity: true, camp: foe, districtId: 2, hp: 200 });

    const flagship = makeUnit(1, 'warship', me, shipTile, { hp: 200, maxHp: 286, _shield: 15, commander: 'ironGuard' });
    const healthyEscort = makeUnit(2, 'destroyer', me, safeAllyTile);
    makeUnit(3, 'shoreBattery', neutral, b1Tile);
    makeUnit(4, 'shoreBattery', neutral, b2Tile);
    makeUnit(10, 'infantry', foe, foeCity);

    const tiles = [shipTile, safeSea, safeAllyTile, neutralPort, b1Tile, b2Tile, neutralCity, foeCity];
    const helpers = {
        ...makeHelpers(tiles),
        getMovableTiles: unit => unit === flagship ? [safeSea] : [],
        getAttackableTiles: unit => unit === flagship && unit.tile === shipTile ? [b1Tile, b2Tile] : []
    };
    const state = makeState(tiles, { player1: me, player2: foe, neutral }, {
        playerHands: { player1: ['shield'], player2: [] }
    });
    const world = buildWorld(state, helpers, me, TIER_CAPABILITIES.hard);
    world.threatAt = (tile, unit) => tile === shipTile ? 200 : 0;
    const strategy = decideStrategy(world);
    const missions = assignMissions(world, strategy);
    const cards = planCards(world, strategy, missions);
    assert.deepEqual(cards.sustain[0], { type: 'tacticalCard', cardId: 'shield', targetId: flagship.id }, '护盾卡应优先保命给受致命火力威胁的旗舰');
    assert.notEqual(healthyEscort.id, flagship.id);

    const actions = planTactics(world, strategy, missions);
    assert.equal(actions[0]?.type, 'move', '濒死旗舰先撤出交叉火力网，而非原地开炮耗尽行动');
    assert.deepEqual([actions[0].tileQ, actions[0].tileR], [safeSea.q, safeSea.r]);
});

test('航母绑定城优先争抢且不白打即将转交的中立航母', async () => {
    const { buildWorld, decideStrategy, assignMissions, planTactics } = await loadCore();
    const me = { id: 'player1' }, foe = { id: 'player2' }, neutral = { id: 'neutral', controller: 'ai' };
    const home = makeTile(-5, 0, { isCity: true, camp: me, districtId: 1 });
    const prizeCity = makeTile(1, -2, { isCity: true, camp: neutral, districtId: 5, hp: 100 });
    const nearCity = makeTile(0, 0, { isCity: true, camp: neutral, districtId: 6, hp: 100 });
    const carrierTile = makeTile(1, -1, { surface: 'shallowWater', terrain: 'water', districtId: 5 });
    const destroyerTile = makeTile(0, -1, { surface: 'shallowWater', terrain: 'water' });
    const foeCity = makeTile(8, 0, { isCity: true, camp: foe, districtId: 2, hp: 200 });

    makeUnit(1, 'infantry', me, home);
    const ship = makeUnit(2, 'destroyer', me, destroyerTile);
    const neutralCarrier = makeUnit(20, 'carrier', neutral, carrierTile);
    makeUnit(30, 'infantry', foe, foeCity);

    const tiles = [home, prizeCity, nearCity, carrierTile, destroyerTile, foeCity];
    const helpers = {
        ...makeHelpers(tiles),
        getAttackableTiles: unit => unit === ship ? [carrierTile] : []
    };
    const state = makeState(tiles, { player1: me, player2: foe, neutral }, { standardMapId: 'uncharted-passage' });
    const world = buildWorld(state, helpers, me, TIER_CAPABILITIES.hard);
    const ranked = rankCityObjectives(world, () => 2);
    assert.equal(ranked[0].city.tile, prizeCity, '航母绑定城即使距同程也不劣于普通中立城');

    const strategy = decideStrategy(world);
    const missions = assignMissions(world, strategy);
    const actions = planTactics(world, strategy, missions);
    assert.equal(actions.some(a => a.type === 'attack' && a.targetId === neutralCarrier.id), false,
        '在己方仍有机会拿下航母控制城前，不白打削减即将归顺的中立航母');
});

test('国军【同心同德】双教导旅通过安全后方主城补员远程救治前线姐妹', async () => {
    const { buildWorld, decideStrategy, assignMissions, planProduction } = await loadCore();
    const me = { id: 'player1', flagPreset: CULTURE_CONFIG.kmt.flagPreset };
    const foe = { id: 'player2' }, neutral = { id: 'neutral' };
    const home = makeTile(-5, 0, { isCity: true, camp: me, districtId: 1 });
    const front = makeTile(3, 0, { camp: neutral });
    const enemyCity = makeTile(9, 0, { isCity: true, camp: foe, districtId: 2, hp: 200 });

    const rearBrigade = makeUnit(1, 'kmt_training_brigade', me, home, { hp: 155, maxHp: 170, commander: 'minister' });
    makeUnit(2, 'kmt_training_brigade', me, front, { hp: 25, maxHp: 170, commander: 'colonel' });
    makeUnit(10, 'infantry', foe, enemyCity);
    const tiles = [home, front, enemyCity];
    const state = makeState(tiles, { player1: me, player2: foe, neutral }, {
        factionRuleMode: 'culture',
        playerGold: { player1: 12, player2: 10, neutral: 0 }
    });
    const world = buildWorld(state, makeHelpers(tiles), me, TIER_CAPABILITIES.hard);
    const strategy = decideStrategy(world);
    const production = planProduction(world, strategy, assignMissions(world, strategy));
    assert.ok(production.actions.some(a => a.type === 'reinforce' && a.unitId === rearBrigade.id),
        '后方主城教导旅自身仅微伤但共享血池亏空时，应通过安全主城补员远程奶血前线姐妹');
});

test('狂战士识别先开【泣血】再机动斩首将领，【禁锢】优先配合【投毒】锁死目标', async () => {
    const { buildWorld, decideStrategy, assignMissions, planTactics } = await loadCore();
    const me = { id: 'player1' }, foe = { id: 'player2' }, neutral = { id: 'neutral' };
    const startTile = makeTile(0, 0, { surface: 'shallowWater', terrain: 'water' });
    const moveTile = makeTile(2, 0, { surface: 'shallowWater', terrain: 'water' });
    const enemyTile = makeTile(3, 0, { surface: 'shallowWater', terrain: 'water' });
    const unpoisonedTile = makeTile(5, 0, { surface: 'shallowWater', terrain: 'water' });
    const foeCity = makeTile(9, 0, { isCity: true, camp: foe, districtId: 2, hp: 200 });

    const berserker = makeUnit(1, 'warship', me, startTile, { commander: 'berserker', remainingMP: 6 });
    const poisonedCommander = makeUnit(10, 'warship', foe, enemyTile, {
        hp: 100, commander: 'tianyan', _poison: { remainingTicks: 2 }
    });
    makeUnit(11, 'warship', foe, unpoisonedTile, { hp: 100 });
    makeUnit(12, 'infantry', foe, foeCity);

    const tiles = [startTile, moveTile, enemyTile, unpoisonedTile, foeCity];
    const helpers = {
        ...makeHelpers(tiles),
        getMovableTiles: unit => unit === berserker ? [moveTile] : [],
        getAttackableTiles: unit => unit === berserker && unit.tile === moveTile ? [enemyTile] : []
    };
    const state = makeState(tiles, { player1: me, player2: foe, neutral }, {
        playerHands: { player1: ['imprison'], player2: [] }
    });
    const world = buildWorld(state, helpers, me, TIER_CAPABILITIES.hard);
    const strategy = decideStrategy(world);
    const missions = assignMissions(world, strategy);
    const cards = planCards(world, strategy, missions);
    assert.deepEqual(cards.setup[0], { type: 'tacticalCard', cardId: 'imprison', targetId: poisonedCommander.id },
        '投毒+禁锢组合优先锁死处于中毒状态的敌军核心将领');

    const actions = planTactics(world, strategy, missions);
    assert.ok(actions.some(a => a.type === 'activateSkill' && a.unitId === berserker.id),
        '机动后可切入射程重创/斩杀将领时，应在移动前先激活【泣血】');
});

test('全回合反机场斩杀线：残血或拼反伤后的将领避开敌方就绪机场扫射区，防空Aura可折减空袭威胁', async () => {
    const { buildWorld, decideStrategy, assignMissions, planTactics } = await loadCore();
    const me = { id: 'player1' }, foe = { id: 'player2' }, neutral = { id: 'neutral' };
    const home = makeTile(0, 0, { isCity: true, camp: me, districtId: 1 });
    const front = makeTile(1, 0, { terrain: 'plains' });
    const safeRear = makeTile(-1, 0, { terrain: 'forest' });
    const aaTile = makeTile(0, 1, { terrain: 'plains' });
    // 中盘第6回合，敌方主城机场距离front恰好9格（受敌方空军上校+2射程=10覆盖），距离safeRear=10或有森林+防空保护
    const foeAirport = makeTile(10, 0, {
        isCity: true, isUrban: true, camp: foe, districtId: 2, hp: 250,
        installation: { type: 'airfield', status: 'ready', airCommandReadyRound: { strafe: 5 } }
    });
    const farAir = makeTile(11, 0, {
        isCity: true, isUrban: true, camp: foe, districtId: 3, hp: 250,
        installation: { type: 'airfield', status: 'ready' }
    });

    const centurion = makeUnit(1, 'cavalry', me, front, { commander: 'centurion', hp: 82, maxHp: 150 });
    const foeColonel = makeUnit(10, 'archer', foe, foeAirport, { commander: 'colonel', hp: 100 });
    const outerTarget = makeUnit(11, 'infantry', foe, makeTile(2, 0), { hp: 180, maxHp: 180 });
    const tiles = [home, front, safeRear, aaTile, outerTarget.tile, foeAirport, farAir];
    const tileMap = new Map(tiles.map(t => [`${t.q},${t.r}`, t]));
    const helpers = {
        ...makeHelpers(tiles),
        getMovableTiles: unit => unit === centurion ? [safeRear, home] : [],
        getAttackableTiles: unit => unit === centurion ? [outerTarget.tile] : []
    };
    const state = makeState(tiles, { player1: me, player2: foe, neutral }, {
        currentCamp: me,
        turnCounter: 10, // Round 6
        tileMap,
        mechanics: { airCommands: true, morale: true },
        playerGold: { player1: 8, player2: 10, neutral: 0 }
    });

    const worldNoAa = buildWorld(state, helpers, me, TIER_CAPABILITIES.hard);
    const bareAir = worldNoAa.airThreatAt(front, centurion, 0);
    assert.ok(bareAir >= 75, `敌方上校就绪机场在9格处应对82血骑兵将领形成致命扫射威胁，实际=${bareAir}`);

    const strategy = decideStrategy(worldNoAa);
    const actions = planTactics(worldNoAa, strategy, assignMissions(worldNoAa, strategy));
    assert.equal(actions.some(a => a.type === 'attack' && a.unitId === centurion.id && a.targetId === outerTarget.id), false,
        '处在敌方机场扫射斩杀线内的残血百夫长禁止继续原地硬换');
    assert.ok(actions.some(a => a.type === 'move' && a.unitId === centurion.id && a.tileQ === safeRear.q),
        '残血将领应优先撤入后方森林安全区脱离机场斩杀线');

    // 部署防空炮（真实专精必为1阶以上）后，防空半径内及待走空地上的空袭预期威胁明显下降
    makeUnit(2, 'archer', me, aaTile, {
        _rank: 1,
        specializationKey: 'antiAirArtillery',
        getSpecializationAbility: name => name === 'antiAir' ? 0.35 : 0
    });
    const worldWithAa = buildWorld(state, helpers, me, TIER_CAPABILITIES.hard);
    const protectedAir = worldWithAa.airThreatAt(front, centurion, 0);
    assert.ok(protectedAir < bareAir, `己方防空炮覆盖下空袭威胁应降低：${protectedAir} < ${bareAir}`);
});

test('进攻型骑兵将领不为收割外围低价值单位而裸停在敌军地面+机场致死集火格内', async () => {
    const { buildWorld, decideStrategy, assignMissions, planTactics } = await loadCore();
    const me = { id: 'player1' }, foe = { id: 'player2' }, neutral = { id: 'neutral' };
    const home = makeTile(-2, 0, { isCity: true, camp: me, districtId: 1 });
    const startTile = makeTile(0, 0);
    const baitTile = makeTile(1, 0);
    const pawnTile = makeTile(2, 0);
    const guard1Tile = makeTile(3, -1);
    const guard2Tile = makeTile(3, 0);
    const foeAirport = makeTile(7, 0, {
        isCity: true, isUrban: true, camp: foe, districtId: 2, hp: 250,
        installation: { type: 'airfield', status: 'ready' }
    });

    const paladin = makeUnit(1, 'cavalry', me, startTile, { commander: 'paladin', hp: 150, maxHp: 150 });
    const pawn = makeUnit(10, 'cavalry', foe, pawnTile, { hp: 55, maxHp: 150 });
    makeUnit(11, 'archer', foe, guard1Tile, { hp: 100 });
    makeUnit(12, 'infantry', foe, guard2Tile, { hp: 180 });
    const tiles = [home, startTile, baitTile, pawnTile, guard1Tile, guard2Tile, foeAirport];
    const tileMap = new Map(tiles.map(t => [`${t.q},${t.r}`, t]));
    const helpers = {
        ...makeHelpers(tiles),
        getMovableTiles: unit => unit === paladin ? [baitTile, home] : [],
        getAttackableTiles: unit => unit === paladin && unit.tile === baitTile ? [pawnTile] : []
    };
    const state = makeState(tiles, { player1: me, player2: foe, neutral }, {
        currentCamp: me,
        tileMap,
        mechanics: { airCommands: true, morale: true },
        playerGold: { player1: 8, player2: 12, neutral: 0 }
    });

    const world = buildWorld(state, helpers, me, TIER_CAPABILITIES.hard);
    const strategy = decideStrategy(world);
    const actions = planTactics(world, strategy, assignMissions(world, strategy));
    const moveToBait = actions.find(a => a.type === 'move' && a.unitId === paladin.id && a.tileQ === baitTile.q);
    assert.equal(moveToBait, undefined, '击杀一名残血散兵会导致下回合被地面集火+机场收掉时，将领不应前冲送头');
});

test('非谋士陆战将领与残血陆军绝不逃海漂流，已误入水面时主动重返安全陆地', async () => {
    const { buildWorld, decideStrategy, assignMissions, planTactics } = await loadCore();
    const me = { id: 'player1' }, foe = { id: 'player2' }, neutral = { id: 'neutral' };
    const home = makeTile(-5, 0, { isCity: true, camp: me, districtId: 1 });
    const shore = makeTile(0, 0, { camp: me });
    const shallowPort = makeTile(0, 1, { surface: 'shallowWater', terrain: 'water', isPort: true, camp: me, districtId: 1 });
    const deepSea = makeTile(1, 1, { surface: 'deepWater', terrain: 'water' });
    const landRetreat = makeTile(-1, 0);
    const enemyArtillery = makeTile(2, 0);
    const enemyCity = makeTile(8, 0, { isCity: true, camp: foe, districtId: 2 });

    const magician = makeUnit(1, 'cavalry', me, shore, { commander: 'magician', hp: 52, maxHp: 150 });
    makeUnit(10, 'archer', foe, enemyArtillery, { hp: 90 });
    makeUnit(11, 'infantry', foe, enemyCity);
    const tiles = [home, shore, shallowPort, deepSea, landRetreat, enemyArtillery, enemyCity];
    const helpers = {
        ...makeHelpers(tiles),
        getMovableTiles: unit => unit === magician
            ? (magician.isEmbarked ? [shore, deepSea] : [shallowPort, landRetreat])
            : []
    };
    const state = makeState(tiles, { player1: me, player2: foe, neutral });

    const actions = planTactics(buildWorld(state, helpers, me, TIER_CAPABILITIES.hard), decideStrategy(buildWorld(state, helpers, me, TIER_CAPABILITIES.hard)), { missions: [], assignment: new Map() });
    assert.ok(!actions.some(a => a.type === 'move' && a.tileQ === shallowPort.q && a.tileR === shallowPort.r),
        '濒危陆战将领撤退时绝不能跳进港口/海面逃避，只能留在或退向陆地');

    // 若已身处水面且非海图跨海登陆任务，即使陆上有安全落点或须强返陆岸，也应立刻上岸，禁止向深海漂流
    shore.unit = null;
    shallowPort.unit = magician;
    magician.tile = shallowPort;
    magician.isEmbarked = true;
    const disembarkActions = planTactics(buildWorld(state, helpers, me, TIER_CAPABILITIES.hard), { posture: 'contest' }, { missions: [], assignment: new Map() });
    assert.deepEqual(disembarkActions, [{ type: 'move', unitId: magician.id, tileQ: shore.q, tileR: shore.r }],
        '已落水的非两栖陆战将领应优先回到安全陆地，不得继续向深海漂流');
});

test('Imperator 随机抽取四类作战分支，且中局顺逆风自动动态切换风格', async () => {
    const { IMPERATOR_DOCTRINE_IDS, resolveImperatorDoctrine } = await import('../ai/core/weights.js');
    const { createRng } = await import('../core/rng.js');

    const picked = new Set();
    for (let i = 1; i <= 40; i++) {
        const gs = { rng: createRng(i * 7919) };
        const profile = resolveImperatorDoctrine(gs, 'player1', { round: 1, oceanMap: i % 2 === 0 });
        picked.add(profile.id);
    }
    assert.deepEqual([...picked].sort(), [...IMPERATOR_DOCTRINE_IDS].sort(), '不同种子应覆盖全部四种 Imperator 分支');

    const pinnedState = { rng: createRng(123), _imperatorDoctrinePinByCamp: { player1: 'blitz' } };
    assert.equal(resolveImperatorDoctrine(pinnedState, 'player1', { round: 1 }).id, 'blitz');

    // 逆风动态切换：开局 grandmaster 落后后切向 blitz/trickster
    const shiftState = {
        rng: createRng(99),
        _aiCoreMemory: { player1: { openingDoctrine: 'grandmaster', doctrine: 'grandmaster', doctrineSinceRound: 1, lastCaptureRound: 1 } }
    };
    const shiftedBehind = resolveImperatorDoctrine(shiftState, 'player1', {
        round: 8, cityGap: -2, incomeRatio: 0.65, ownCities: 1, roundsRemaining: 10, gold: 10
    });
    assert.ok(['blitz', 'trickster'].includes(shiftedBehind.id), '落后局面应切入强攻或诡道分支');
    assert.equal(shiftedBehind.shiftedFrom, 'grandmaster');

    // 领先收官：开局 blitz 扩大优势后切向稳固分支
    const leadState = {
        rng: createRng(99),
        _aiCoreMemory: { player2: { openingDoctrine: 'blitz', doctrine: 'blitz', doctrineSinceRound: 1, lastCaptureRound: 9 } }
    };
    const shiftedAhead = resolveImperatorDoctrine(leadState, 'player2', {
        round: 10, cityGap: 2, incomeRatio: 1.5, ownCities: 4, roundsRemaining: 9, oceanMap: true, gold: 12
    });
    assert.equal(shiftedAhead.id, 'armada', '海图大比分领先后 blitz 应转入 armada 巩固优势');
});

test('残血三段优先：先城内补员再向野战分配治疗卡，退无可退的必死单位原地破罐破摔打满输出', async () => {
    const { buildWorld, decideStrategy, assignMissions, planTactics } = await loadCore();
    const me = { id: 'player1' }, foe = { id: 'player2' }, neutral = { id: 'neutral' };
    const cityTile = makeTile(0, 0, { isCity: true, camp: me, districtId: 1 });
    const safeRear = makeTile(-2, 0);
    const fieldTile = makeTile(2, 0);
    const foeTile = makeTile(4, 0);
    const foeCity = makeTile(9, 0, { isCity: true, camp: foe, districtId: 2 });

    // 城内残血单位可直接补员；野战残血单位无法补员，手牌仅有1张【疗愈】
    const garrison = makeUnit(1, 'infantry', me, cityTile, { hp: 50, maxHp: 180 });
    const fieldUnit = makeUnit(2, 'cavalry', me, fieldTile, { hp: 50, maxHp: 150 });
    makeUnit(10, 'archer', foe, foeTile, { hp: 90 });
    makeUnit(11, 'infantry', foe, foeCity);

    const tiles = [cityTile, safeRear, fieldTile, foeTile, foeCity];
    const helpers = {
        ...makeHelpers(tiles),
        getMovableTiles: unit => unit === fieldUnit ? [safeRear] : []
    };
    const state = makeState(tiles, { player1: me, player2: foe, neutral }, {
        currentCamp: me,
        playerGold: { player1: 12, player2: 10, neutral: 0 },
        playerHands: { player1: ['heal'], player2: [] }
    });

    const plan = planTurn(state, helpers, me, TIER_CAPABILITIES.hard);
    const reinforceIndex = plan.findIndex(a => a.type === 'reinforce' && a.unitId === garrison.id);
    const healIndex = plan.findIndex(a => a.type === 'tacticalCard' && a.cardId === 'heal');
    assert.ok(reinforceIndex >= 0 && healIndex > reinforceIndex,
        `能补员应优先于出治疗卡：${JSON.stringify(plan.map(a => [a.type, a.unitId || a.targetId || a.cardId]))}`);
    assert.equal(plan[healIndex].targetId, fieldUnit.id, '城内单位补员后，治疗卡应自动省给野战残血单位而非重复浪费');

    // 必死破罐破摔测试：45HP步兵四周陆地落点均处致命火力网内且旁边虽有看似安全的水面也禁止跳海，应直接爆掉打出最后一击
    const cornerTile = makeTile(0, 0);
    const waterTrap = makeTile(-1, 0, { surface: 'shallowWater', terrain: 'water' });
    const deadEndLand = makeTile(0, -1);
    const adjacentArcherTile = makeTile(1, 0);
    const coverArcherTile = makeTile(2, 0);
    const doomed = makeUnit(21, 'infantry', me, cornerTile, { hp: 50, maxHp: 180 });
    const targetArcher = makeUnit(30, 'archer', foe, adjacentArcherTile, { hp: 90, maxHp: 90 });
    makeUnit(31, 'archer', foe, coverArcherTile, { hp: 90, maxHp: 90 });
    makeUnit(32, 'infantry', foe, foeCity);
    const doomedTiles = [cornerTile, waterTrap, deadEndLand, adjacentArcherTile, coverArcherTile, foeCity];
    const doomedHelpers = {
        ...makeHelpers(doomedTiles),
        getMovableTiles: unit => unit === doomed ? [waterTrap, deadEndLand] : [],
        getAttackableTiles: unit => unit === doomed && unit.tile === cornerTile ? [adjacentArcherTile] : []
    };
    const doomedState = makeState(doomedTiles, { player1: me, player2: foe, neutral });
    const doomedWorld = buildWorld(doomedState, doomedHelpers, me, TIER_CAPABILITIES.hard);
    const doomedStrategy = decideStrategy(doomedWorld);
    const doomedActions = planTactics(doomedWorld, doomedStrategy, assignMissions(doomedWorld, doomedStrategy));
    assert.ok(!doomedActions.some(a => a.type === 'move' && a.tileQ === waterTrap.q), '必死单位绝不逃到水上');
    assert.deepEqual(doomedActions[0], { type: 'attack', unitId: doomed.id, targetId: targetArcher.id },
        '退无可退的必死单位应取消无意义后撤，直接打满最后一轮输出价值');
});

test('脆皮将领受保护不吃激进前压豁免，残血将领优先吃治疗且前期留足募兵费不被抽空', async () => {
    const { buildWorld, decideStrategy } = await loadCore();
    const me = { id: 'player1' }, foe = { id: 'player2' }, neutral = { id: 'neutral' };
    const home = makeTile(5, 0, { isCity: true, camp: me, districtId: 1 });
    const rearTile = makeTile(4, 0);
    const midTile = makeTile(0, 2);
    const dangerForward = makeTile(-1, 3);
    const frontSoldierTile = makeTile(-1, 4);
    const enemyCavalryTile = makeTile(-2, 4);
    const foeArcher1 = makeTile(-2, 2);
    const foeArcher2 = makeTile(-3, 3);
    const foeCity = makeTile(-5, 0, { isCity: true, camp: foe, districtId: 2 });

    // 48% 血量的亡灵法师虽在 trickster 分支，也不得绕过脆皮保护前压送进敌方双火力圈
    const necro = makeUnit(1, 'infantry', me, midTile, { hp: 108, maxHp: 225, commander: 'necromancer', isCommanderUnit: true });
    // 16/188 重伤退回后方的圣骑士，应优先于前线 103/170 普通攻城兵拿到 heal
    const paladin = makeUnit(2, 'cavalry', me, rearTile, { hp: 16, maxHp: 188, commander: 'paladin', isCommanderUnit: true });
    const soldier = makeUnit(3, 'infantry', me, frontSoldierTile, { hp: 103, maxHp: 170 });
    makeUnit(10, 'cavalry', foe, enemyCavalryTile, { hp: 150, maxHp: 150 });
    makeUnit(11, 'archer', foe, foeArcher1, { hp: 90, maxHp: 90, config: { attack: 60, range: 2, speed: 2, hp: 90, cost: 10, armor: 0, critRate: 0, dodgeRate: 0, movementDomain: 'land' } });
    makeUnit(12, 'archer', foe, foeArcher2, { hp: 90, maxHp: 90, config: { attack: 60, range: 2, speed: 2, hp: 90, cost: 10, armor: 0, critRate: 0, dodgeRate: 0, movementDomain: 'land' } });
    makeUnit(13, 'infantry', foe, foeCity);

    const tiles = [home, rearTile, midTile, dangerForward, frontSoldierTile, enemyCavalryTile, foeArcher1, foeArcher2, foeCity];
    const helpers = {
        ...makeHelpers(tiles),
        getMovableTiles: unit => unit === necro ? [dangerForward, rearTile] : [],
        getAttackableTiles: (unit, opts) => {
            const tile = opts?.fromTile || unit.tile;
            if (unit === necro && tile === dangerForward) return [enemyCavalryTile];
            return [];
        }
    };
    const state = makeState(tiles, { player1: me, player2: foe, neutral }, {
        currentCamp: me,
        round: 2,
        turnCount: 4,
        _imperatorDoctrinePin: 'trickster',
        playerGold: { player1: 8, player2: 12, neutral: 0 },
        playerHands: { player1: ['heal'], player2: [] }
    });

    const plan = planTurn(state, helpers, me, TIER_CAPABILITIES.hard);
    const necroMove = plan.find(a => a.type === 'move' && a.unitId === necro.id);
    assert.ok(!necroMove || necroMove.tileQ !== dangerForward.q,
        'trickster 绝不应放行 48% 血亡灵法师踩进致命火网前压');

    // 当亡灵法师未处于濒危抢救时，16/188 退回后方的圣骑士必须优于前线 103/170 普通攻城兵获得治疗卡
    necro.hp = 225;
    const healPlan = planTurn(state, helpers, me, TIER_CAPABILITIES.hard);
    const healAct = healPlan.find(a => a.type === 'tacticalCard' && a.cardId === 'heal');
    assert.equal(healAct?.targetId, paladin.id, '16/188 重伤后方将领应优先于 103/170 普通前线兵获得治疗卡');

    // 前期手头刚好 $8 且占着自己城市尚未募兵时，trickster 也不应先抽牌导致断招
    const paladinHealthy = makeUnit(2, 'cavalry', me, rearTile, { hp: 170, maxHp: 188, commander: 'paladin', isCommanderUnit: true });
    const homeUnit = makeUnit(4, 'infantry', me, home, { hp: 180, maxHp: 180 });
    const drawCheckState = makeState([home, rearTile, foeCity], { player1: me, player2: foe, neutral }, {
        currentCamp: me,
        round: 2,
        turnCount: 4,
        _imperatorDoctrinePin: 'trickster',
        playerGold: { player1: 8, player2: 12, neutral: 0 },
        playerHands: { player1: ['heal'], player2: [] }
    });
    paladinHealthy.camp = me;
    homeUnit.camp = me;
    const drawWorld = buildWorld(drawCheckState, makeHelpers([home, rearTile, foeCity]), me, TIER_CAPABILITIES.hard);
    const drawStrategy = decideStrategy(drawWorld);
    assert.equal(shouldDrawCard(drawWorld, drawStrategy, 0, 0), false,
        '前期手头仅 $8 且规划募兵尚未结算时，应保留至少 1 队步兵费而不先抽卡耗空');
});

test('反帮对手拆中立缓冲带：对手西侧压残中立兵时，Imperator 不对其浪费雷击与禁锢', async () => {
    const { buildWorld } = await loadCore();
    const me = { id: 'player1' }, foe = { id: 'player2' }, neutral = { id: 'neutral' };
    const myCity = makeTile(7, 0, { isCity: true, camp: me, districtId: 1 });
    const westNeutralCity = makeTile(-3, 0, { isCity: true, camp: neutral, districtId: 2, hp: 180 });
    const westFlankHex = makeTile(-4, 1);
    const rivalCity = makeTile(-7, 0, { isCity: true, camp: foe, districtId: 3 });

    makeUnit(1, 'infantry', me, myCity);
    const westNeutralGuard = makeUnit(20, 'infantry', neutral, westNeutralCity, { hp: 25, maxHp: 180 });
    const westNeutralScreen = makeUnit(21, 'cavalry', neutral, westFlankHex, { hp: 20, maxHp: 150 });
    // 西线对面的对手骑兵紧贴缓冲中立兵，正准备踩破西侧防线推进
    makeUnit(10, 'cavalry', foe, makeTile(-5, 1), { hp: 140, maxHp: 150 });
    makeUnit(11, 'infantry', foe, rivalCity);

    const tiles = [myCity, westNeutralCity, westFlankHex, makeTile(-5, 1), rivalCity];
    const state = makeState(tiles, { player1: me, player2: foe, neutral }, {
        currentCamp: me,
        round: 2,
        turnCount: 4,
        playerGold: { player1: 20, player2: 15, neutral: 0 },
        playerHands: { player1: ['lightning', 'imprison'], player2: [] }
    });
    const helpers = makeHelpers(tiles);
    const world = buildWorld(state, helpers, me, TIER_CAPABILITIES.hard);
    assert.equal(enemyCapturerPremium(world, westNeutralScreen), 0,
        '中立缓冲兵靠近中立城时绝不能按"即将夺城的敌方占城者"额外加分');

    const plan = planTurn(state, helpers, me, TIER_CAPABILITIES.hard);
    const cardHitsOnWestNeutrals = plan.filter(a => a.type === 'tacticalCard'
        && ['lightning', 'imprison'].includes(a.cardId)
        && [westNeutralGuard.id, westNeutralScreen.id].includes(a.targetId));
    assert.equal(cardHitsOnWestNeutrals.length, 0,
        `Imperator 不应对替对手拖节奏的西侧中立缓冲兵放雷击或禁锢：${JSON.stringify(cardHitsOnWestNeutrals)}`);
});
