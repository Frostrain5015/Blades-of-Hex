// 通过实际引擎执行整回合，覆盖规划正确但动作顺序或合法性检查阻止兑现的回归。
import test, { after, afterEach } from 'node:test';
import assert from 'node:assert/strict';

const nativeSetTimeout = globalThis.setTimeout.bind(globalThis);
globalThis.setTimeout = (callback, ms = 0, ...args) =>
    nativeSetTimeout(callback, Math.max(0, Math.round(ms * 0.02)), ...args);
const { engine } = await import('../core/headless.js');
const { processOpponentTurn, configureAiRuntime } = await import('../js/ai.js');
const { applyRemoteState, refreshInspectionSelection, serializeState, setInspectionTarget } = await import('../js/state.js');
const { SURFACE_KIND } = await import('../rules/surfaces.js');
const { CULTURE_CONFIG } = await import('../rules/cultures.js');
const { getStandardMap } = await import('../rules/standardMaps.js');
const { getRound } = await import('../rules/turns.js');
const { isTileVisible, updateFogOfWar } = await import('../js/fogOfWar.js');
const { isUnitVisibleToCamp } = await import('../rules/visibility.js');
const { getUndergroundIntelligenceStatus } = await import('../rules/undergroundIntelligence.js');
const { BURN_MS, attackCityTile, executeBanzaiCharge, executeGuerrillaConcealment, resolvePoisonAtTurnStart } = await import('../js/gameLogic.js');
const { droneProjectiles, HEAVY_CANNON_IMPACT_MS, heavyCannonShells, ringWaves, spawnHeavyCannonShell, updateHeavyCannonShells } = await import('../js/effects.js');
const { KATYUSHA_IMPACT_TIMES, getKatyushaDamageShares, getKatyushaPresentedHealth, katyushaRockets } = await import('../js/effects.js');
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

test('中等 AI 让炮兵破墙，再用可达的步兵当回合进城', async () => {
    const { me, foe, enemyCity } = setupMatch();
    state.aiDifficultyByCamp.player1 = 'medium';
    state.playerGold.player1 = 0;
    enemyCity.hp = 1;
    const artillery = place('archer', me, state.tileMap.get('8,0'));
    const infantry = place('infantry', me, state.tileMap.get('8,1'));
    assert.equal(enemyCity.camp, foe);
    startMatchRecording(state);

    await processOpponentTurn(me);

    const timeline = getCurrentMatchLog().timeline;
    const breach = timeline.find(entry => entry.actionType === 'attack'
        && entry.payload.attackerUnitId === artillery.id && entry.payload.cityHpAfter === 0);
    const capture = timeline.find(entry => entry.eventType === 'cityCaptured');
    assert.equal(enemyCity.camp, me);
    assert.ok(breach && breach.sequence < capture.sequence);
    assert.equal(capture.payload.attackerUnitId, infantry.id);
    assert.equal(timeline.find(entry => entry.actionId === capture.causedByActionId)?.actionType, 'move');
});

test('中等 AI 让占领步兵向空城推进，先保留其行动而非与侧翼炮兵交战', async () => {
    const { me, foe, enemyCity } = setupMatch();
    state.aiDifficultyByCamp.player1 = 'medium';
    state.playerGold.player1 = 0;
    enemyCity.hp = 0;
    const occupier = place('infantry', me, state.tileMap.get('7,0'));
    occupier.remainingMP = 1;
    place('archer', foe, state.tileMap.get('7,-1')).hp = 10;
    startMatchRecording(state);

    await processOpponentTurn(me);

    const actions = getCurrentMatchLog().timeline.filter(entry => entry.kind === 'action'
        && (entry.payload.unitId === occupier.id || entry.payload.attackerUnitId === occupier.id));
    assert.equal(actions[0]?.actionType, 'move');
    assert.ok(occupier.tile.q > 7);
    assert.equal(enemyCity.camp, foe);
});

test('中等 AI 的炮兵可直接占领空城', async () => {
    const { me, enemyCity } = setupMatch();
    state.aiDifficultyByCamp.player1 = 'medium';
    state.playerGold.player1 = 0;
    enemyCity.hp = 0;
    const artillery = place('archer', me, state.tileMap.get('9,0'));

    await processOpponentTurn(me);

    assert.equal(enemyCity.unit, artillery);
    assert.equal(enemyCity.camp, me);
});

test('中等 AI 保留机场扫射，地面攻击打残目标后同回合补刀', async () => {
    const { me, foe, home } = setupMatch();
    state.aiDifficultyByCamp.player1 = 'medium';
    state.playerGold.player1 = 4;
    state.playerDrawsThisTurn.player1 = 2;
    state.rng.range = (min, max) => (min + max) / 2;
    state.rng.chance = () => false;
    home.installation = { type: 'airfield', status: 'ready' };
    place('infantry', me, home).canAct = false;
    const artillery = place('archer', me, state.tileMap.get('3,0'));
    artillery.getEffectiveAttack = () => 110;
    const target = place('infantry', foe, state.tileMap.get('5,0'));
    assert.equal(target.hp, target.maxHp);
    startMatchRecording(state);

    await processOpponentTurn(me);

    const timeline = getCurrentMatchLog().timeline;
    const groundAttack = timeline.find(entry => entry.actionType === 'attack'
        && entry.payload.attackerUnitId === artillery.id && entry.payload.targetUnitId === target.id);
    const airAttack = timeline.find(entry => entry.actionType === 'airCommand');
    assert.ok(groundAttack && airAttack && groundAttack.sequence < airAttack.sequence,
        JSON.stringify({ hp: target.hp, gold: state.playerGold.player1, actions: timeline.filter(entry => entry.kind === 'action')
            .map(entry => [entry.actionType, entry.payload.attackDmg, entry.payload.targetUnitId, entry.payload.kind]) }));
    assert.equal(groundAttack.payload.killed, false);
    assert.equal(events.find(event => event.action.airKind === 'strafe')?.action.airPhase, 'followup');
    assert.equal(airAttack.payload.kind, 'strafe');
    assert.equal(airAttack.payload.aiPhase, 'followup');
    assert.ok(airAttack.payload.results.some(result => result.unitId === target.id && result.killed));
    assert.equal(state.playerGold.player1, 0);
});

test('历史模式二人和三人开局按主城换特色兵种，英国改换本土巡洋舰', () => {
    const cases = [['us',9], ['gb',4], ['fr',4], ['ru',7], ['kmt',10], ['cpc',11], ['de',12], ['jp',10]];
    for (const family of ['crown-ring', 'uncharted-passage']) {
        for (const seats of [2, 3]) {
            const map = getStandardMap(seats, family);
            for (const [cultureId, gold] of cases) {
                engine.resetGameState();
                const campKey = 'player' + seats;
                const culture = CULTURE_CONFIG[cultureId];
                engine.configureSkirmishState({ playerCount: seats, flagPresets: { [campKey]: culture.flagPreset } });
                state.standardMapId = family;
                state.factionRuleMode = 'culture';
                engine.initMap();
                const home = map.board.installations.find(site => site.type === 'airfield' && site.camp === campKey);
                const own = state.tiles.flatMap(tile => tile.unit?.camp === state.factions[campKey] ? [tile.unit] : []);
                assert.equal(own.length, map.initialUnits.filter(unit => unit.camp === campKey).length);
                assert.equal(state.playerGold[campKey], gold);
                assert.equal(state.tileMap.get(`${home.q},${home.r}`).unit.type,
                    cultureId === 'gb' || cultureId === 'de' ? 'infantry' : culture.uniqueUnitType);
                if (cultureId === 'gb') {
                    const battleship = own.find(unit => unit.type === 'gb_battleship');
                    assert.ok(battleship?.tile.isPort);
                    assert.ok(map.initialUnits.some(unit => unit.type === 'warship' && unit.camp === campKey
                        && unit.q === battleship.tile.q && unit.r === battleship.tile.r));
                }
            }
        }
    }
});

test('非历史模式和半成品河谷图维持原先初始兵力与资金', () => {
    for (const [family, mode] of [['river-valley','culture'], ['crown-ring','synergy']]) {
        engine.resetGameState();
        engine.configureSkirmishState({ playerCount: 2, flagPresets: { player1: CULTURE_CONFIG.us.flagPreset, player2: CULTURE_CONFIG.de.flagPreset } });
        state.standardMapId = family;
        state.factionRuleMode = mode;
        engine.initMap();
        assert.ok(!state.tiles.some(tile => tile.unit?.type === 'us_marine'));
        assert.equal(state.playerGold.player1, 4);
        assert.equal(state.playerGold.player2, 4);
    }
});

test('法国 AI 保留资金补上巨炮，已有可夺城兵力时优先招特色炮兵', async () => {
    const { me } = setupMatch();
    me.flagPreset = CULTURE_CONFIG.fr.flagPreset;
    state.factionRuleMode = 'culture';
    place('archer', me, state.tileMap.get('1,0'));
    place('infantry', me, state.tileMap.get('2,0'));
    place('cavalry', me, state.tileMap.get('3,0'));
    state.playerGold.player1 = 14;
    await processOpponentTurn(me);
    assert.equal(state.playerGold.player1, 14);
    state.playerGold.player1 = 15;
    await processOpponentTurn(me);
    assert.ok(state.tiles.some(tile => tile.unit?.type === 'fr_heavy_cannon' && tile.unit.camp === me));
});

test('英国 AI 允许在安全港口补战列舰，并遵守两艘上限', async () => {
    const { me, home } = setupMatch();
    me.flagPreset = CULTURE_CONFIG.gb.flagPreset;
    state.factionRuleMode = 'culture';
    place('infantry', me, home);
    const ports = ['0,1', '1,1', '2,1'].map(key => state.tileMap.get(key));
    for (const port of ports) Object.assign(port, { isPort: true, surface: SURFACE_KIND.SHALLOW_WATER });
    const battleship = place('gb_battleship', me, ports[0]);
    battleship.canAct = false;
    await processOpponentTurn(me);
    assert.equal(state.tiles.filter(tile => tile.unit?.type === 'gb_battleship' && tile.unit.camp === me).length, 2);
    assert.ok(ports.some(port => !port.unit));
});

test('对手 AI 移动后，观察目标跟随单位并保持只读，切回己方时仍保留', async () => {
    const { me, foe, home } = setupMatch();
    state.gameMode = 'pve';
    state.aiOpponentCamp = me;
    foe.controller = 'human';
    const watched = place('cavalry', me, state.tileMap.get('4,0'));
    const previousTile = watched.tile;
    place('infantry', me, home);
    state.selectedTile = previousTile;
    setInspectionTarget(previousTile);
    await processOpponentTurn(me);
    assert.notEqual(watched.tile, previousTile);
    assert.equal(refreshInspectionSelection(), watched.tile);
    assert.equal(state.inspectionTarget.unitId, watched.id);
    assert.equal(state.selectedUnit, null);
    assert.deepEqual(state.attackableTiles, []);
    await engine.advanceAutomatedTurn();
    assert.equal(state.currentCamp, foe);
    assert.equal(refreshInspectionSelection(), watched.tile);
});

test('联机快照让观察目标跟随移动后的同一单位，并在其阵亡后清除选中', () => {
    const { me, foe } = setupMatch();
    const origin = state.tileMap.get('5,0');
    const destination = state.tileMap.get('6,0');
    const watched = place('infantry', foe, origin);
    state.selectedTile = origin;
    setInspectionTarget(origin);
    origin.unit = null;
    destination.unit = watched;
    watched.tile = destination;
    applyRemoteState(serializeState(), engine.HexTile, engine.Unit);
    assert.equal(state.selectedTile, state.tileMap.get('6,0'));
    assert.equal(state.selectedTile.unit.id, watched.id);
    assert.notEqual(state.selectedTile.unit, watched);
    state.selectedTile.unit = null;
    applyRemoteState(serializeState(), engine.HexTile, engine.Unit);
    assert.equal(state.inspectionTarget, null);
    assert.equal(state.selectedTile, null);
});

test('特殊天气五个等概率结果分别映射为两雨、一雾、两风，可重复上轮天气', async () => {
    for (const [ticket, expected] of ['rain', 'rain', 'fog', 'wind', 'wind'].entries()) {
        const { foe } = setupMatch();
        state.turnOrder = ['player1', 'player2'];
        state.currentCamp = foe;
        state.turnCounter = 3;
        state.lastWeather = expected;
        const rngInt = state.rng.int;
        state.rng.int = count => count === 5 ? ticket : rngInt(count);
        await engine.advanceAutomatedTurn();
        assert.equal(state.weather, expected);
    }
});

test('历史模式 AI 为法国巨炮选射界并架设，下个己方回合自动炮击', async () => {
    const { me, foe, home } = setupMatch();
    me.flagPreset = 'img/flags/svg/fr.svg';
    state.factionRuleMode = 'culture';
    const cannon = place('fr_heavy_cannon', me, home);
    const target = place('infantry', foe, state.tileMap.get('4,0'));
    await processOpponentTurn(me);
    assert.equal(cannon._heavyCannonDeployed, true);
    assert.equal(cannon.remainingMP, 0);
    assert.ok(events.some(({ action, status }) => action.type === 'heavyCannonStance' && status === 'executed'));
    state.currentCamp = foe;
    state.turnOrder = ['player2', 'player1', 'neutral'];
    await engine.advanceAutomatedTurn();
    assert.ok(target.hp < target.maxHp);
});

test('历史模式德国 AI 用同一机场连续俯冲并分别标记两支部队', async () => {
    const { me, foe, home } = setupMatch();
    me.flagPreset = 'img/flags/germany-iron-cross.svg';
    state.factionRuleMode = 'culture';
    home.installation = { type: 'airfield', status: 'ready' };
    place('infantry', me, home);
    const targets = ['4,0', '4,1'].map(key => place('infantry', foe, state.tileMap.get(key)));
    await processOpponentTurn(me);
    assert.equal(events.filter(({ action, status }) => action.airKind === 'stukaDiveBomb' && status === 'executed').length, 2);
    assert.ok(targets.every(unit => unit.fireSea?.roundsRemaining === 2));
});

test('火海在受影响单位的两个回合开始各扣5%最大生命', async () => {
    const { me, foe } = setupMatch();
    me.flagPreset = 'img/flags/germany-iron-cross.svg';
    state.factionRuleMode = 'culture';
    state.turnOrder = ['player1', 'player2'];
    const target = place('infantry', foe, state.tileMap.get('6,0'));
    target.fireSea = { roundsRemaining: 2 };
    target._shield = 40;
    const tick = Math.round(target.maxHp * 0.05);
    await engine.advanceAutomatedTurn();
    assert.equal(target.hp, target.maxHp - tick);
    assert.equal(target.fireSea.roundsRemaining, 1);
    assert.equal(target._shield, 40);
    await engine.advanceAutomatedTurn();
    assert.equal(target.hp, target.maxHp - tick);
    await engine.advanceAutomatedTurn();
    assert.equal(target.hp, target.maxHp - tick * 2);
    assert.equal(target.fireSea, null);
});

test('地下情报网覆盖村庄相邻格，离开非己方村庄两回合后消失', () => {
    const { me, foe } = setupMatch();
    me.flagPreset = 'img/flags/chinese-communist-party-old.svg';
    state.factionRuleMode = 'culture';
    state.skirmishFog = true;
    const village = state.tileMap.get('8,1');
    Object.assign(village, { isVillage: true, villageDistrictId: 2, camp: foe });
    const scout = place('infantry', me, village);
    const neighbor = state.tileMap.get('7,1');
    updateFogOfWar(state, me);
    assert.equal(getUndergroundIntelligenceStatus(state, village, me).active, true);
    village.unit = null;
    scout.tile = state.tileMap.get('2,1');
    scout.tile.unit = scout;
    updateFogOfWar(state, me);
    assert.equal(getUndergroundIntelligenceStatus(state, village, me).roundsRemaining, 2);
    assert.equal(isTileVisible(neighbor, me, state), true);
    state.turnCounter += state.turnOrder.length * 2;
    updateFogOfWar(state, me);
    assert.equal(getUndergroundIntelligenceStatus(state, village, me), null);
    assert.equal(isTileVisible(neighbor, me, state), false);
});

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
    samurai.remainingMP = 1;
    assert.equal(executeBanzaiCharge(samurai, target.tile), false);
    samurai.remainingMP = 5;
    samurai._shield = 60;
    assert.equal(executeBanzaiCharge(samurai, target.tile), true);
    assert.equal(samurai.hp, 140);
    assert.equal(samurai._shield, 60);
    assert.equal(samurai.tile, mid);
});

test('武士首次斩杀返还行动，两次斩杀均可叠加武运长久回血', () => {
    const { me, foe, home } = setupMatch();
    me.flagPreset = 'img/flags/svg/jp.svg';
    state.factionRuleMode = 'culture';
    const samurai = place('jp_samurai', me, home);
    const targets = ['1,0', '2,0', '3,0'].map(key => {
        const unit = place('infantry', foe, state.tileMap.get(key));
        unit.hp = 60;
        return unit;
    });
    samurai._calcFloat = () => 1;
    samurai.hp = 100;
    samurai.remainingMP = 2;
    assert.equal(executeBanzaiCharge(samurai, targets[0].tile), true);
    assert.equal(targets[0].hp, 0);
    assert.equal(samurai.hp, 166);
    assert.equal(samurai.remainingMP, 2);
    assert.equal(samurai.canAct, true);
    assert.equal(executeBanzaiCharge(samurai, targets[1].tile), true);
    assert.equal(targets[1].hp, 0);
    assert.equal(samurai.hp, 200);
    assert.equal(samurai.canAct, false);
    assert.equal(executeBanzaiCharge(samurai, targets[2].tile), false);
});

test('游击纵队消耗2行动力隐匿，贴身仍可奇袭，闪避也消耗隐匿', () => {
    const { me, foe, home } = setupMatch();
    const guerrilla = place('cpc_guerrilla', me, home);
    const target = place('infantry', foe, state.tileMap.get('1,0'));
    guerrilla._calcFloat = () => 1;
    assert.equal(executeGuerrillaConcealment(guerrilla), true);
    assert.equal(guerrilla.remainingMP, 3);
    assert.equal(guerrilla.canAct, true);
    assert.equal(isUnitVisibleToCamp(guerrilla, foe, state), true);
    engine.attackUnit(guerrilla, target);
    assert.equal(target.hp, 180 - Math.round(42 * 1.65));
    assert.equal(guerrilla._guerrillaHiddenThroughRound, null);
    assert.equal(guerrilla._guerrillaReadyRound, 2);
    assert.equal(executeGuerrillaConcealment(guerrilla), false);
    guerrilla.canAct = true;
    state.turnCounter = 2 * state.turnOrder.length;
    target.rollDodge = () => true;
    assert.equal(executeGuerrillaConcealment(guerrilla), true);
    engine.attackUnit(guerrilla, target);
    assert.equal(target.hp, 180 - Math.round(42 * 1.65));
    assert.equal(guerrilla._guerrillaHiddenThroughRound, null);
});

test('游击纵队自然隐匿在下一次己方回合结束时失效，并冷却一回合', async () => {
    const { me, foe, home, enemyCity } = setupMatch();
    place('infantry', foe, enemyCity);
    const guerrilla = place('cpc_guerrilla', me, home);
    assert.equal(executeGuerrillaConcealment(guerrilla), true);
    for (let step = 0; step < state.turnOrder.length; step++) await engine.advanceAutomatedTurn();
    assert.equal(state.currentCamp, me);
    assert.equal(guerrilla._guerrillaHiddenThroughRound, 1);
    await engine.advanceAutomatedTurn();
    assert.equal(guerrilla._guerrillaHiddenThroughRound, null);
    assert.equal(guerrilla._guerrillaReadyRound, 3);
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

test('法国友军毒发阵亡后，自由不屈为邻格友军加30点临时护盾', () => {
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
    assert.equal(ally.activeShield, 30);
});

test('巨炮先蓄力再开火，只有命中时触发范围冲击波', () => {
    setupMatch();
    heavyCannonShells.length = 0;
    const startedAt = performance.now();
    let impacts = 0;
    let waves = ringWaves.length;
    spawnHeavyCannonShell(0, 0, 60, 0, false, () => impacts++, { startedAt });
    updateHeavyCannonShells(startedAt + 100);
    assert.equal(heavyCannonShells.at(-1).fired, false);
    updateHeavyCannonShells(startedAt + HEAVY_CANNON_IMPACT_MS - 1);
    assert.equal(heavyCannonShells.at(-1).fired, true);
    assert.equal(impacts, 0);
    assert.equal(ringWaves.length, waves);
    updateHeavyCannonShells(startedAt + HEAVY_CANNON_IMPACT_MS + 1);
    assert.equal(impacts, 1);
    assert.equal(ringWaves.length - waves, 2);
    waves = ringWaves.length;
    spawnHeavyCannonShell(0, 0, 60, 0, false, null, { startedAt, dodged: true });
    updateHeavyCannonShells(startedAt + HEAVY_CANNON_IMPACT_MS + 1);
    assert.equal(ringWaves.length, waves);
});

test('喀秋莎的主目标和溅射目标分三轮扣血，整数尾差守恒', () => {
    const { me, foe, home } = setupMatch();
    const katyusha = place('ru_katyusha', me, home);
    const target = place('infantry', foe, state.tileMap.get('2,0'));
    const splash = place('infantry', foe, state.tileMap.get('2,1'));
    katyusha._calcFloat = () => 1;
    const rocketCount = katyushaRockets.length;
    engine.attackUnit(katyusha, target);
    const newRockets = katyushaRockets.slice(rocketCount);
    assert.equal(new Set(newRockets.map(rocket => rocket.startTime + rocket.duration)).size, 3);
    assert.deepEqual(getKatyushaDamageShares(50), [17, 16, 17]);
    for (const unit of [target, splash]) {
        const { startedAt, before, shares } = unit._katyushaHealth;
        assert.equal(before - unit.hp, shares.reduce((a, b) => a + b, 0));
        assert.ok(Math.max(...shares) - Math.min(...shares) <= 1);
        const [first, second, last] = KATYUSHA_IMPACT_TIMES;
        assert.equal(getKatyushaPresentedHealth(unit, startedAt + first - 1), before);
        assert.equal(getKatyushaPresentedHealth(unit, startedAt + first + 1), before - shares[0]);
        assert.equal(getKatyushaPresentedHealth(unit, startedAt + second + 1), before - shares[0] - shares[1]);
        assert.equal(getKatyushaPresentedHealth(unit, startedAt + last + 1), null);
    }
});

test('喀秋莎每轮分别判定主目标和溅射目标的震慑，并可压至混乱', () => {
    const { me, foe, home } = setupMatch();
    me.flagPreset = 'img/flags/soviet-union.svg';
    state.factionRuleMode = 'culture';
    const katyusha = place('ru_katyusha', me, home);
    const target = place('infantry', foe, state.tileMap.get('2,0'));
    const splash = place('infantry', foe, state.tileMap.get('2,1'));
    target.morale = 3;
    splash.morale = 3;
    katyusha._calcFloat = () => 1;
    const rolls = [];
    state.rng.chance = chance => { rolls.push(chance); return true; };
    engine.attackUnit(katyusha, target);
    assert.equal(rolls.filter(chance => chance === 0.20).length, 3);
    assert.equal(rolls.filter(chance => chance === 0.10).length, 3);
    assert.equal(target.morale, 0);
    assert.equal(splash.morale, 0);
    state.turnCounter = target._katyushaMoraleUntilTurn;
    assert.equal(target.morale, 3);
});

test('喀秋莎前轮先消耗护盾，血条和伤害数字按实际命中轮次呈现', () => {
    const { me, foe, home } = setupMatch();
    const katyusha = place('ru_katyusha', me, home);
    const target = place('infantry', foe, state.tileMap.get('2,0'));
    katyusha._calcFloat = () => 1;
    target._shield = 20;
    engine.attackUnit(katyusha, target);
    const { shares, before } = target._katyushaHealth;
    assert.equal(shares[0], 0);
    assert.ok(shares[1] > 0 && shares[2] > shares[1]);
    assert.equal(shares.reduce((total, damage) => total + damage, 0), before - target.hp);
    assert.equal(target._shield, 0);
});

test('法国巨炮无法直接炮击或反击邻格，只有邻格敌人时不自动开火', async () => {
    const { me, foe, home } = setupMatch();
    state.turnOrder = ['player2', 'player1', 'neutral'];
    state.currentCamp = foe;
    const cannon = place('fr_heavy_cannon', me, home);
    cannon._heavyCannonDeployed = true;
    const neighbor = place('infantry', foe, state.tileMap.get('1,0'));
    await engine.advanceAutomatedTurn();
    assert.equal(neighbor.hp, neighbor.maxHp);
    assert.equal(cannon._heavyCannonAutoFiredThisTurn, false);
    assert.equal(cannon.calculateCounterDamage(neighbor).dmg, 0);
    const distant = place('infantry', foe, state.tileMap.get('2,0'));
    assert.equal(cannon.calculateCounterDamage(distant).dmg, 0);
    engine.attackUnit(cannon, neighbor);
    assert.equal(neighbor.hp, neighbor.maxHp);
    assert.ok(cannon.canAct);
});

test('法国巨炮回合初以地块视野选靶，空城炮击写入攻城回合', async () => {
    const { me, foe, enemyCity } = setupMatch();
    me.flagPreset = 'img/flags/svg/fr.svg';
    state.factionRuleMode = 'culture';
    state.skirmishFog = true;
    state.weather = 'fog';
    const cannon = place('fr_heavy_cannon', me, state.tileMap.get('3,0'));
    cannon._heavyCannonDeployed = true;
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

test('陆战队在己方已启用港口按工业海权优惠价补员，每回合限一次', () => {
    const { me, foe } = setupMatch();
    me.flagPreset = 'img/flags/svg/us.svg';
    state.factionRuleMode = 'culture';
    const port = state.tileMap.get('0,1');
    Object.assign(port, { camp: foe, isPort: true, surface: SURFACE_KIND.SHALLOW_WATER, _portOperationalAtRound: 1 });
    const marine = place('us_marine', me, port);
    marine.hp = 45;
    state.playerGold.player1 = 15;
    engine.reinforceUnit(marine);
    assert.equal(marine.hp, 45, '敌方港口不能补员');
    port.camp = me;
    engine.reinforceUnit(marine);
    assert.equal(marine.hp, 45, '尚未启用的己方港口不能补员');
    state.turnCounter = state.turnOrder.length;
    engine.reinforceUnit(marine);
    assert.equal(marine.hp, 135);
    assert.equal(state.playerGold.player1, 10);
    assert.equal(port._reinforcedThisTurn, true);
    engine.reinforceUnit(marine);
    assert.equal(marine.hp, 135);
    assert.equal(state.playerGold.player1, 10);
});

test('陆战队普攻、反击、攻城均发射机枪弹流，击破城防后仍可进驻', () => {
    const { me, foe, home, enemyCity } = setupMatch();
    const marine = place('us_marine', me, home);
    const target = place('infantry', foe, state.tileMap.get('1,0'));
    let shots = droneProjectiles.length;
    engine.attackUnit(marine, target);
    assert.equal(droneProjectiles.length - shots, 5, '主动攻击');

    state.currentCamp = foe;
    target.canAct = true;
    shots = droneProjectiles.length;
    engine.attackUnit(target, marine);
    assert.equal(droneProjectiles.length - shots, 5, '陆战队反击');

    home.unit = null;
    marine.tile = state.tileMap.get('9,0');
    marine.tile.unit = marine;
    marine.canAct = true;
    state.currentCamp = me;
    enemyCity.hp = 1;
    shots = droneProjectiles.length;
    assert.equal(attackCityTile(marine, enemyCity), true);
    assert.equal(droneProjectiles.length - shots, 5, '攻城');
    assert.equal(enemyCity.unit, marine);
    assert.equal(enemyCity.camp, me);
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
