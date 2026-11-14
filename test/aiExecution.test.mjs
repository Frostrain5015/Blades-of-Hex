// 通过实际引擎执行整回合，覆盖规划正确但动作顺序或合法性检查阻止兑现的回归。
import test, { after, afterEach } from 'node:test';
import assert from 'node:assert/strict';

const nativeSetTimeout = globalThis.setTimeout.bind(globalThis);
globalThis.setTimeout = (callback, ms = 0, ...args) =>
    nativeSetTimeout(callback, Math.max(0, Math.round(ms * 0.02)), ...args);
const { engine } = await import('../core/headless.js');
const { processOpponentTurn, configureAiRuntime } = await import('../js/ai.js');
const { SURFACE_KIND } = await import('../rules/surfaces.js');
const { getRound } = await import('../rules/turns.js');
const { isTileVisible } = await import('../js/fogOfWar.js');
const { BURN_MS, executeBanzaiCharge, resolvePoisonAtTurnStart } = await import('../js/gameLogic.js');
const { startMatchRecording, getCurrentMatchLog } = await import('../js/matchRecorder.js');
const state = engine.gameState;
const events = [];
const restoreRuntime = configureAiRuntime({
    delayScale: 1,
    actionTimeoutMs: 30000,
    onAction: event => {
        if (event.phase !== 'after') return;
        const unit = state.tiles.find(tile => tile.unit?.id === event.action.unitId)?.unit;
        events.push({ action: event.action, status: event.status, hp: unit?.hp });
    }
});
afterEach(async () => new Promise(resolve => nativeSetTimeout(resolve, 60)));
after(() => {
    restoreRuntime();
    globalThis.setTimeout = nativeSetTimeout;
});

function setupMatch() {
    engine.resetGameState();
    engine.seedMatchRng('ai-execution-regression');
    engine.configureSkirmishState({ playerCount: 2, controllers: { player1: 'ai', player2: 'ai' } });
    Object.assign(state, {
        gameMode: 'selfplay', commanderPhase: 'done', skirmishFog: false,
        aiDifficulty: 2, aiDifficultyId: 'hard', aiDifficultyByCamp: { player1: 'hard', player2: 'hard' },
        weather: 'clear', turnCounter: 0, _aiCoreMemory: {}, _imperatorStrategicTelemetry: {},
        playerGold: { player1: 60, player2: 60, neutral: 0 },
        previousGold: { player1: 60, player2: 60, neutral: 0 },
        playerHands: { player1: [], player2: [], neutral: [] },
        playerDrawsThisTurn: { player1: 0, player2: 0, neutral: 0 },
        playerUsesThisTurn: { player1: 0, player2: 0, neutral: 0 }
    });
    const me = state.factions.player1;
    const foe = state.factions.player2;
    state.currentCamp = me;
    state.turnOrder = ['player1', 'player2', 'neutral'];
    state.tiles = [];
    for (let q = -2; q <= 12; q++) {
        for (let r = -2; r <= 2; r++) {
            const tile = new engine.HexTile(q, r);
            tile.terrain = 'plains';
            tile.surface = SURFACE_KIND.LAND;
            tile.camp = q < 5 ? me : foe;
            state.tiles.push(tile);
        }
    }
    state.tileMap = new Map(state.tiles.map(tile => [`${tile.q},${tile.r}`, tile]));
    const home = state.tileMap.get('0,0');
    const enemyCity = state.tileMap.get('10,0');
    for (const [tile, districtId] of [[home, 1], [enemyCity, 2]]) {
        Object.assign(tile, { isCity: true, isUrban: true, hp: 250, maxHp: 250, districtId });
    }
    events.length = 0;
    return { me, foe, home, enemyCity };
}

function place(type, camp, tile, commander = null) {
    const unit = new engine.Unit(type, camp, tile, false, null, commander);
    tile.unit = unit;
    return unit;
}

test('疗愈卡对禁疗武士只允许净化，补员仍可回血', () => {
    const { me, home } = setupMatch();
    const samurai = place('jp_samurai', me, home);
    samurai.hp = 80;
    state.playerHands.player1 = ['heal'];

    engine.executeTacticalCard('heal', home);
    assert.deepEqual(state.playerHands.player1, ['heal']);
    assert.equal(samurai.hp, 80);

    samurai._poison = { turns: 2 };
    engine.executeTacticalCard('heal', home);
    assert.equal(state.playerHands.player1.length, 0);
    assert.equal(samurai._poison, null);
    assert.equal(samurai.hp, 80);
    engine.reinforceUnit(samurai);
    assert.equal(samurai.hp, 180);
});

test('武士冲锋拒绝新兵和堵路，合法冲锋的生命消耗绕过护盾', () => {
    const { me, foe, home } = setupMatch();
    const samurai = place('jp_samurai', me, home);
    const target = place('infantry', foe, state.tileMap.get('2,0'));
    const mid = state.tileMap.get('1,0');
    samurai.isNewRecruit = true;
    assert.equal(executeBanzaiCharge(samurai, target.tile), false);

    samurai.isNewRecruit = false;
    place('infantry', me, mid);
    assert.equal(executeBanzaiCharge(samurai, target.tile), false);
    assert.equal(samurai.hp, 200);

    mid.unit = null;
    samurai._shield = 60;
    assert.equal(executeBanzaiCharge(samurai, target.tile), true);
    assert.equal(samurai.hp, 50);
    assert.equal(samurai._shield, 60);
    assert.equal(samurai.tile, mid);
});

test('普通攻击触发铁卫转移，法国实际承受暴击后触发自由不屈', () => {
    const { me, foe } = setupMatch();
    foe.flagPreset = 'img/flags/svg/fr.svg';
    state.factionRuleMode = 'culture';
    const attacker = place('archer', me, state.tileMap.get('3,0'));
    const victim = place('infantry', foe, state.tileMap.get('5,0'));
    const guard = place('infantry', foe, state.tileMap.get('5,1'), 'ironGuard');
    guard._shield = 30;
    state.rng.range = (_min, max) => max - 0.001;

    engine.attackUnit(attacker, victim);
    assert.equal(guard._shield, 0);
    assert.ok(victim.hp < victim.maxHp);
    assert.equal(guard.morale, 3);
});

test('法国友军毒发阵亡后，自由不屈为邻格友军加24点临时护盾', () => {
    const { me, home } = setupMatch();
    me.flagPreset = 'img/flags/svg/fr.svg';
    state.factionRuleMode = 'culture';
    const victim = place('infantry', me, home);
    const ally = place('infantry', me, state.tileMap.get('1,0'));
    victim.hp = 1;
    victim._poison = { remainingTicks: 1 };
    resolvePoisonAtTurnStart(me);
    assert.equal(home.unit, null);
    assert.equal(ally.morale, 3);
    assert.equal(ally.activeShield, 24);
});

test('法国巨炮回合初以地块视野选靶，空城炮击写入攻城回合', async () => {
    const { me, foe, enemyCity } = setupMatch();
    me.flagPreset = 'img/flags/svg/fr.svg';
    state.factionRuleMode = 'culture';
    state.skirmishFog = true;
    state.weather = 'fog';
    const cannon = place('fr_heavy_cannon', me, state.tileMap.get('3,0'));
    // 单独验证自动选靶在射程长于视野时仍检查地块可见性。
    const effectiveRange = cannon.getEffectiveRange.bind(cannon);
    cannon.getEffectiveRange = () => 5;
    const target = place('infantry', foe, state.tileMap.get('8,0'));
    state.visibleTiles.player1.clear();
    state.turnOrder = ['player2', 'player1', 'neutral'];
    state.currentCamp = foe;
    await engine.advanceAutomatedTurn();
    assert.equal(target.hp, target.maxHp);
    assert.equal(cannon._heavyCannonAutoFiredThisTurn, false);

    state.skirmishFog = false;
    target.tile.unit = null;
    cannon.tile.unit = null;
    cannon.tile = state.tileMap.get('5,0');
    cannon.tile.unit = cannon;
    cannon.getEffectiveRange = effectiveRange;
    state.weather = 'clear';
    state.currentCamp = foe;
    state.turnCounter = 0;
    await engine.advanceAutomatedTurn();
    assert.ok(enemyCity.hp < enemyCity.maxHp);
    assert.equal(enemyCity._citySiegeDamageRound, 0);
});

test('尚书实际腾位招募，下一回合新兵出城后返城，预留格不被补招占用', async () => {
    const { me, foe, home, enemyCity } = setupMatch();
    const minister = place('infantry', me, home, 'minister');
    place('infantry', foe, enemyCity);
    await processOpponentTurn(me);
    assert.notEqual(minister.tile, home, '先腾位');
    assert.equal(home.unit?.type, 'infantry', '腾出的格子当回合完成招募');
    const recruit = home.unit;
    assert.notEqual(recruit.id, minister.id);
    assert.equal(state._aiCoreMemory.player1.ministerReturn?.unitId, minister.id);

    for (let step = 0; step < state.turnOrder.length; step++) await engine.advanceAutomatedTurn();
    assert.equal(state.currentCamp, me);
    assert.equal(getRound(state), 2);
    await processOpponentTurn(me);
    assert.notEqual(recruit.tile, home, '新兵应出城执行任务');
    assert.equal(home.unit?.id, minister.id, '尚书应回到原城恢复经济职责');
    assert.equal(state._aiCoreMemory.player1.ministerReturn, undefined);
});

test('港口维修走真实扣费回血路径，发生在舰船作战之前', async () => {
    const { me, foe, home, enemyCity } = setupMatch();
    place('infantry', me, home, 'minister');
    place('infantry', foe, enemyCity);
    state.playerGold.player1 = 15;
    const port = state.tileMap.get('0,1');
    Object.assign(port, { isPort: true, surface: SURFACE_KIND.SHALLOW_WATER, terrain: 'water' });
    const ship = place('warship', me, port);
    ship.hp = Math.floor(ship.maxHp * 0.5);
    await processOpponentTurn(me);
    const repair = events.find(event => event.action.type === 'repairShip');
    assert.ok(repair, '应执行维修动作');
    assert.equal(repair.hp, ship.maxHp);
    assert.equal(port._reinforcedThisTurn, true);
    assert.ok(state.playerGold.player1 < 15, '引擎实际扣费');
});

test('满手滞留卡实际使用后，同回合可抽新牌寻找疗愈', async () => {
    const { me, foe, home, enemyCity } = setupMatch();
    const defender = place('infantry', me, home, 'minister');
    defender._poison = { remainingTicks: 3 };
    place('infantry', foe, enemyCity);
    place('infantry', foe, state.tileMap.get('3,0'));
    state.playerGold.player1 = 15;
    state.playerHands.player1 = ['mgNest', 'lightning', 'landmine'];
    await processOpponentTurn(me);
    const useIndex = events.findIndex(event => event.action.type === 'tacticalCard');
    const drawIndex = events.findIndex(event => event.action.type === 'drawCard');
    assert.ok(useIndex >= 0 && drawIndex > useIndex);
    assert.ok(state.playerDrawsThisTurn.player1 > 0, '必须实际抽牌，而非仅生成抽牌意图');
    assert.ok(state.playerHands.player1.length <= 3);
});

test('困难档用对策卡打击迷雾中的敌军，地图视野保持原样', async () => {
    const { me, foe, home } = setupMatch();
    state.skirmishFog = true;
    state.playerGold.player1 = 0;
    state.playerHands.player1 = ['lightning'];
    const garrison = place('infantry', me, home, 'minister');
    garrison.canAct = false;
    const targetTile = state.tileMap.get('9,0');
    const target = place('infantry', foe, targetTile, 'engineer');
    target.hp = 1;
    startMatchRecording(state, { matchId: 'hard-intelligence-regression' });
    await processOpponentTurn(me);
    // 烧牌后的定时伤害略晚于 AI 的单次动作延迟。
    await new Promise(resolve => setTimeout(resolve, BURN_MS));
    assert.equal(isTileVisible(targetTile, me, state), false);
    assert.ok(events.some(event => event.action.cardId === 'lightning' && event.action.targetId === target.id));
    assert.equal(targetTile.unit, null);
    const strike = getCurrentMatchLog().timeline.find(item => item.payload?.cardId === 'lightning');
    assert.equal(strike.decisionContext.informationPolicy, 'fog-limited');
    assert.ok(strike.decisionContext.knownOtherUnits.every(unit => unit.id !== target.id));
});

test('困难 AI 可以攻击雾中射程内的目标，普通攻击预览仍按迷雾过滤', async () => {
    const { me, foe, home } = setupMatch();
    state.skirmishFog = true;
    state.playerGold.player1 = 0;
    Object.assign(home, { surface: SURFACE_KIND.SHALLOW_WATER });
    const carrier = place('carrier', me, home);
    carrier.remainingMP = 0;
    const targetTile = state.tileMap.get('4,0');
    const target = place('infantry', foe, targetTile, 'engineer');
    target.hp = 1;
    assert.ok(carrier.getEffectiveRange() >= 4);
    assert.equal(engine.getAttackableTiles(carrier).includes(targetTile), false);
    await processOpponentTurn(me);
    assert.equal(isTileVisible(targetTile, me, state), false);
    assert.ok(events.some(event => event.action.type === 'attack' && event.action.targetId === target.id));
    await new Promise(resolve => setTimeout(resolve, BURN_MS));
    assert.equal(targetTile.unit, null);
});

test('最后一座空城先用 8 金补步兵，维修不能占掉守城预算', async () => {
    const { me, foe, home, enemyCity } = setupMatch();
    place('infantry', foe, enemyCity);
    place('cavalry', foe, state.tileMap.get('2,0'));
    const port = state.tileMap.get('0,1');
    Object.assign(port, { isPort: true, surface: SURFACE_KIND.SHALLOW_WATER, terrain: 'water' });
    const ship = place('destroyer', me, port);
    ship.hp = 29;
    state.playerGold.player1 = 9;
    await processOpponentTurn(me);
    assert.equal(home.unit?.type, 'infantry');
    assert.equal(state.playerGold.player1, 1);
    assert.equal(events.some(event => event.action.type === 'repairShip'), false);
});

test('新对局清空 AI 的跨回合记忆和战略遥测', () => {
    setupMatch();
    state._aiCoreMemory.player1 = { missions: [{ occupierId: 300 }] };
    state._imperatorStrategicTelemetry.player1 = [{ round: 2 }];
    engine.resetGameState();
    assert.deepEqual(state._aiCoreMemory, {});
    assert.deepEqual(state._imperatorStrategicTelemetry, {});
});
