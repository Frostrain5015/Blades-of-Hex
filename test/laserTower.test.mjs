// test/laserTower.test.mjs — 激光塔【集束激光】齐射规则 + 同类防御建筑间距规则：
//   伤害公式（25 + 10×(N−1)，封顶 65）、目标过滤（射程/敌我/中立/迷雾/脚手架）、
//   击杀归属、造价守卫、同类建筑 7 格最小间距（碉堡/岸防炮/激光塔全建造路径）。
import assert from 'node:assert/strict';
import { test } from 'node:test';

const context = {};
globalThis.document = { getElementById() { return { getContext: () => context }; } };
globalThis.localStorage = { getItem: () => null, setItem: () => {} };
globalThis.performance = globalThis.performance || { now: () => Date.now() };

const [laserRules, construction, units, stateModule, unitModule, tileModule] = await Promise.all([
    import('../rules/laserTower.js'),
    import('../rules/construction.js'),
    import('../rules/units.js'),
    import('../engine/matchState.js'),
    import('../js/Unit.js'),
    import('../engine/HexTile.js')
]);

const { resolveLaserTowerVolley, laserTowerShotDamage, LASER_TOWER_BALANCE } = laserRules;
const {
    CONSTRUCTION_CONFIG, canBuildBunkerAt, canBuildShoreBatteryAt,
    canBuildLaserTowerAt, hasSameTypeBuildingWithin
} = construction;
const { DEFENSE_BUILDING_MIN_DISTANCE } = units;
const { createMatchState } = stateModule;
const { Unit, setGameStateRef, setLogMessageRef } = unitModule;
const { EngineHexTile } = tileModule;

function setup() {
    const state = createMatchState();
    state.tiles = [];
    state.tileMap = new Map();
    state.damageTexts = []; state.healTexts = []; state.goldTexts = [];
    setGameStateRef(state);
    setLogMessageRef(() => {});
    state.currentCamp = state.factions.player1;
    return state;
}

function addTile(state, q, r, camp = null, surface = 'land') {
    const tile = new EngineHexTile(q, r);
    if (camp) tile.camp = camp;
    tile.surface = surface;
    state.tiles.push(tile);
    state.tileMap.set(`${q},${r}`, tile);
    return tile;
}

let _nextId = 900;
function spawn(state, type, faction, tile) {
    return new Unit(type, faction, tile, false, _nextId++);
}

// ===== 齐射伤害公式（数值守卫，改动需刻意）=====
test('激光塔单发伤害公式：25 + 10×(N−1)，N≥5 封顶 65', () => {
    assert.deepEqual(
        [1, 2, 3, 4, 5, 6, 7, 10].map(n => laserTowerShotDamage(n)),
        [25, 35, 45, 55, 65, 65, 65, 65]
    );
    assert.equal(LASER_TOWER_BALANCE.baseDamage, 25);
    assert.equal(LASER_TOWER_BALANCE.perExtraTarget, 10);
    assert.equal(LASER_TOWER_BALANCE.maxDamage, 65);
});

// ===== 造价守卫（比现有两种防御建筑均贵）=====
test('激光塔造价 15，高于碉堡与岸防炮', () => {
    assert.equal(CONSTRUCTION_CONFIG.laserTower.cost, 15);
    assert.ok(CONSTRUCTION_CONFIG.laserTower.cost > CONSTRUCTION_CONFIG.bunker.cost);
    assert.ok(CONSTRUCTION_CONFIG.laserTower.cost > CONSTRUCTION_CONFIG.shoreBattery.cost);
});

// ===== 齐射结算 =====
test('单目标齐射：命中 1 个射程内敌人，伤害 25', () => {
    const state = setup();
    const towerTile = addTile(state, 0, 0, state.factions.player1);
    const targetTile = addTile(state, 2, 0, state.factions.player2);
    spawn(state, 'laserTower', state.factions.player1, towerTile);
    const enemy = spawn(state, 'infantry', state.factions.player2, targetTile);
    const result = resolveLaserTowerVolley(state, 'player1');
    assert.equal(result.volleys.length, 1);
    assert.equal(result.volleys[0].hits.length, 1);
    assert.equal(result.volleys[0].hits[0].dmg, 25);
    assert.equal(enemy.hp, 180 - 25);
});

test('多目标齐射：3 个敌人各受 45；友军与射程外敌人不受影响', () => {
    const state = setup();
    const towerTile = addTile(state, 0, 0, state.factions.player1);
    spawn(state, 'laserTower', state.factions.player1, towerTile);
    const e1 = spawn(state, 'infantry', state.factions.player2, addTile(state, 1, 0, state.factions.player2));
    const e2 = spawn(state, 'cavalry', state.factions.player2, addTile(state, 0, 2, state.factions.player2));
    const e3 = spawn(state, 'infantry', state.factions.player2, addTile(state, -1, 1, state.factions.player2));
    const friend = spawn(state, 'infantry', state.factions.player1, addTile(state, 1, 1, state.factions.player1));
    const far = spawn(state, 'infantry', state.factions.player2, addTile(state, 4, 0, state.factions.player2));
    const result = resolveLaserTowerVolley(state, 'player1');
    assert.equal(result.volleys.length, 1);
    assert.equal(result.volleys[0].hits.length, 3);
    for (const hit of result.volleys[0].hits) assert.equal(hit.dmg, 45);
    assert.equal(e1.hp, 180 - 45);
    assert.equal(e2.hp, 150 - 45);
    assert.equal(e3.hp, 180 - 45);
    assert.equal(friend.hp, 180);
    assert.equal(far.hp, 180);
});

test('7 个目标时单发封顶 65；中立敌对单位同样被命中', () => {
    const state = setup();
    const towerTile = addTile(state, 0, 0, state.factions.player1);
    spawn(state, 'laserTower', state.factions.player1, towerTile);
    const positions = [[1, 0], [0, 1], [-1, 0], [0, -1], [1, -1], [-1, 1], [2, 0]];
    const unitsSpawned = positions.map(([q, r], i) =>
        spawn(state, 'infantry', state.factions.player2, addTile(state, q, r, state.factions.player2)));
    const neutral = spawn(state, 'infantry', state.factions.neutral, addTile(state, 3, 0, state.factions.neutral));
    const result = resolveLaserTowerVolley(state, 'player1');
    assert.equal(result.volleys[0].hits.length, 8);
    for (const hit of result.volleys[0].hits) assert.equal(hit.dmg, 65);
    assert.equal(neutral.hp, 180 - 65);
    assert.ok(unitsSpawned.every(u => u.hp === 180 - 65));
});

test('击杀归属：齐射击杀记入塔的阵营击杀数；脚手架塔不开火', () => {
    const state = setup();
    const towerTile = addTile(state, 0, 0, state.factions.player1);
    const tower = spawn(state, 'laserTower', state.factions.player1, towerTile);
    const weak = spawn(state, 'infantry', state.factions.player2, addTile(state, 1, 0, state.factions.player2));
    weak.hp = 10;
    const killsBefore = state.killCount.player1 || 0;
    const result = resolveLaserTowerVolley(state, 'player1');
    assert.equal(result.volleys[0].hits[0].killed, true);
    assert.ok((state.killCount.player1 || 0) > killsBefore);

    // 脚手架（建造中）不开火
    const state2 = setup();
    const scaffold = spawn(state2, 'laserTower', state2.factions.player1, addTile(state2, 0, 0, state2.factions.player1));
    scaffold._constructionScaffold = { type: 'laserTower', campKey: 'player1', readyRound: 99 };
    spawn(state2, 'infantry', state2.factions.player2, addTile(state2, 1, 0, state2.factions.player2));
    assert.equal(resolveLaserTowerVolley(state2, 'player1').volleys.length, 0);
    assert.ok(tower.type === 'laserTower');
});

test('迷雾下不可见目标不吃齐射；非本方回合的塔不开火', () => {
    const state = setup();
    state.skirmishFog = true;
    spawn(state, 'laserTower', state.factions.player1, addTile(state, 0, 0, state.factions.player1));
    const hidden = spawn(state, 'infantry', state.factions.player2, addTile(state, 1, 0, state.factions.player2));
    const result = resolveLaserTowerVolley(state, 'player1', { isTileVisible: () => false });
    assert.equal(result.volleys.length, 0);
    assert.equal(hidden.hp, 180);
    // 非回合方
    const result2 = resolveLaserTowerVolley(state, 'player2', { isTileVisible: () => true });
    assert.equal(result2.volleys.length, 0);
});

// ===== 同类防御建筑间距 =====
test('hasSameTypeBuildingWithin：<7 格同类命中，≥7 格与跨类不命中', () => {
    const state = setup();
    spawn(state, 'mgNest', state.factions.player1, addTile(state, 0, 0, state.factions.player1));
    spawn(state, 'shoreBattery', state.factions.player1, addTile(state, 0, 3, state.factions.player1));
    assert.equal(hasSameTypeBuildingWithin(state, addTile(state, 6, 0), 'mgNest'), true);
    assert.equal(hasSameTypeBuildingWithin(state, addTile(state, 7, 0), 'mgNest'), false);
    assert.equal(hasSameTypeBuildingWithin(state, addTile(state, 1, 0), 'laserTower'), false); // 跨类
    assert.equal(DEFENSE_BUILDING_MIN_DISTANCE, 7);
});

function setupBuilder(state) {
    const builderTile = addTile(state, 0, 0, state.factions.player1);
    const builder = spawn(state, 'infantry', state.factions.player1, builderTile);
    builder.canAct = true;
    return builder;
}

test('碉堡建造：7 格内已有碉堡时拒绝，满 7 格允许', () => {
    const state = setup();
    spawn(state, 'mgNest', state.factions.player1, addTile(state, 3, 0, state.factions.player1));
    const builder = setupBuilder(state);
    assert.equal(canBuildBunkerAt(builder, addTile(state, 1, 0, state.factions.player1), state), false);
    // 把已有碉堡挪到 7 格外
    state.tiles.find(t => t.unit?.type === 'mgNest').unit.hp = 0;
    assert.equal(canBuildBunkerAt(builder, addTile(state, 0, 1, state.factions.player1), state), true);
});

test('岸防炮建造：沿海可建，但 7 格内已有岸防炮时拒绝', () => {
    const state = setup();
    // 海岸：目标格 (1,0) 邻水格 (2,0)
    const coast = addTile(state, 1, 0, state.factions.player1);
    addTile(state, 2, 0, null, 'deepWater');
    spawn(state, 'shoreBattery', state.factions.player1, addTile(state, 0, 4, state.factions.player1));
    assert.equal(canBuildShoreBatteryAt(coast, state.factions.player1, state), false);
    state.tiles.find(t => t.unit?.type === 'shoreBattery').unit.hp = 0;
    assert.equal(canBuildShoreBatteryAt(coast, state.factions.player1, state), true);
});

test('激光塔建造：相邻己方空地可建，7 格内已有激光塔时拒绝', () => {
    const state = setup();
    spawn(state, 'laserTower', state.factions.player1, addTile(state, 5, 0, state.factions.player1));
    const builder = setupBuilder(state);
    assert.equal(canBuildLaserTowerAt(builder, addTile(state, 1, 0, state.factions.player1), state), false);
    state.tiles.find(t => t.unit?.type === 'laserTower').unit.hp = 0;
    assert.equal(canBuildLaserTowerAt(builder, addTile(state, 0, 1, state.factions.player1), state), true);
    // 碉堡不占激光塔的间距（跨类）
    spawn(state, 'mgNest', state.factions.player1, addTile(state, 0, 2, state.factions.player1));
    assert.equal(canBuildLaserTowerAt(builder, addTile(state, 0, 1, state.factions.player1), state), true);
});
