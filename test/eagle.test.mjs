import assert from 'node:assert/strict';
import { test } from 'node:test';

const context = {};
globalThis.document = {
    getElementById() {
        return { getContext: () => context };
    }
};
globalThis.localStorage = { getItem: () => null, setItem: () => {} };

const [unitModule, tileModule, stateModule, eagleRules, factionSynergyRules, cardsRules, constantsRules] = await Promise.all([
    import('../js/Unit.js'),
    import('../engine/HexTile.js'),
    import('../engine/matchState.js'),
    import('../rules/eagle.js'),
    import('../rules/factionSynergies.js'),
    import('../rules/cards.js'),
    import('../rules/constants.js')
]);

const { Unit, setGameStateRef, setLogMessageRef, setIsNetworkGameRef } = unitModule;
const { EngineHexTile } = tileModule;
const { createMatchState, restoreMatchState, serializeMatchState } = stateModule;
const {
    EAGLE_FACTION_PASSIVE,
    EAGLE_SYNERGY_BALANCE,
    EAGLE_ORBITAL_STRIKE_CARD_ID,
    accrueEagleDamageTaken,
    accrueEagleSynergyDamage,
    getEagleSynergyMeter,
    hasEagleSynergyActive,
    isEagleAirAttacker,
    isEagleFortressAttacker,
    resolveEagleDamageCreditCampKey,
    resolveEagleDamageTakenCampKey
} = eagleRules;
const {
    EAGLE_FACTION_SYNERGY,
    FELLOW_ROBE_FACTION_SYNERGY,
    getActiveFactionSynergies,
    getCommanderFactionSynergy,
    getFactionSynergy
} = factionSynergyRules;
const { TACTICAL_CARD_CONFIG, TACTICAL_CARD_DATA, ORBITAL_STRIKE_TICK_DELAYS_MS } = cardsRules;
const { DECK_COMPOSITION, COMBAT_BALANCE } = constantsRules;

function createTile(q, r) {
    return new EngineHexTile(q, r);
}

function setupEagleState(tileCount = 4) {
    const state = createMatchState();
    const tiles = Array.from({ length: tileCount }, (_, index) => createTile(index, 0));
    state.tiles = tiles;
    state.tileMap = new Map(tiles.map(tile => [`${tile.q},${tile.r}`, tile]));
    state.damageTexts = [];
    state.healTexts = [];
    state.goldTexts = [];
    setGameStateRef(state);
    setLogMessageRef(() => {});
    setIsNetworkGameRef(() => false);
    return { state, tiles };
}

function spawnEaglePair(state, tiles) {
    const colonel = new Unit('infantry', state.factions.player1, tiles[0], false, 801, 'colonel');
    const tianyan = new Unit('infantry', state.factions.player1, tiles[1], false, 802, 'tianyan');
    return { colonel, tianyan };
}

test('天鹰特遣队注册表：成员、Hero 标题与后半段类型', () => {
    const synergy = getFactionSynergy('eagle');
    assert.equal(synergy, EAGLE_FACTION_SYNERGY);
    assert.deepEqual([...synergy.commanderIds], ['colonel', 'engineer', 'tianyan']);
    assert.equal(getCommanderFactionSynergy('colonel'), synergy);
    assert.equal(getCommanderFactionSynergy('engineer'), synergy);
    assert.equal(getCommanderFactionSynergy('tianyan'), synergy);
    assert.notEqual(getCommanderFactionSynergy('ironGuard'), synergy);
    // 选将卡片左上角徽标：_buildFactionSynergyCardMarker 按注册表渲染，三人都应拿到完整 marker 配置
    for (const commanderId of synergy.commanderIds) {
        const marker = getCommanderFactionSynergy(commanderId)?.marker;
        assert.ok(marker?.symbol && marker.label && marker.color && marker.borderColor && marker.background,
            `${commanderId} 缺少选将卡片徽标配置`);
    }
    assert.equal(synergy.marker.symbol, '🦅');
    assert.equal(synergy.hero.title, '天基支援协议');
    assert.equal(synergy.hero.followup.kind, 'orbital-supply');
    assert.equal(EAGLE_FACTION_PASSIVE.name, '天基支援协议');
    assert.ok(EAGLE_FACTION_PASSIVE.description.includes('轨道补给'));
    assert.ok(EAGLE_FACTION_PASSIVE.description.includes('天基打击授权'));
    assert.ok(EAGLE_FACTION_PASSIVE.description.includes(`${EAGLE_SYNERGY_BALANCE.damageThreshold}`));
    assert.ok(EAGLE_FACTION_PASSIVE.description.includes(`${EAGLE_SYNERGY_BALANCE.takenThreshold}`));
});

test('两名存活天鹰将领才激活协同，且激活后取代【与子同袍】', () => {
    const { state, tiles } = setupEagleState();
    const { colonel, tianyan } = spawnEaglePair(state, tiles);

    assert.equal(hasEagleSynergyActive(state, state.factions.player1), true);
    assert.deepEqual(getActiveFactionSynergies(state, state.factions.player1), [EAGLE_FACTION_SYNERGY]);

    tianyan.hp = 0;
    assert.equal(hasEagleSynergyActive(state, state.factions.player1), false);
    tianyan.hp = 1;

    // 分属不同阵营的两名天鹰将领不能互相激活
    const { state: state2, tiles: tiles2 } = setupEagleState();
    new Unit('infantry', state2.factions.player1, tiles2[0], false, 811, 'colonel');
    new Unit('infantry', state2.factions.player2, tiles2[1], false, 812, 'engineer');
    assert.equal(hasEagleSynergyActive(state2, state2.factions.player1), false);
    assert.equal(hasEagleSynergyActive(state2, state2.factions.player2), false);
    assert.notDeepEqual(getActiveFactionSynergies(state2, state2.factions.player1), [EAGLE_FACTION_SYNERGY]);
    assert.equal(colonel.hp > 0, true);
});

test('空军与要塞来源分类：航母/无人机归空军，驻军归要塞，普通步兵不计', () => {
    const { state, tiles } = setupEagleState();
    spawnEaglePair(state, tiles);
    const plainInfantry = new Unit('infantry', state.factions.player1, tiles[3], false, 822);

    assert.equal(isEagleAirAttacker({ type: 'carrier' }), true);
    assert.equal(isEagleAirAttacker({ _isDrone: true }), true);
    assert.equal(isEagleAirAttacker(plainInfantry), false);
    assert.equal(isEagleFortressAttacker({ type: 'carrier' }), false);
    assert.equal(isEagleFortressAttacker(plainInfantry), false);
    // 据守城市/工事的单位归要塞口径；无人机显式排除
    tiles[3].isCity = true;
    assert.equal(isEagleFortressAttacker(plainInfantry), true);
    assert.equal(isEagleFortressAttacker({ _isDrone: true, tile: tiles[3] }), false);
});

test('轨道补给：跨阈值拨付金币并合并大额伤害的多段触发', () => {
    const { state, tiles } = setupEagleState();
    spawnEaglePair(state, tiles);
    const goldBefore = state.playerGold.player1 || 0;

    assert.equal(accrueEagleSynergyDamage(state, 'player1', 399), null);
    assert.equal(state._pendingEagleSynergyEvents.length, 0);

    const first = accrueEagleSynergyDamage(state, 'player1', 1);
    assert.equal(first.kind, 'supply');
    assert.equal(first.goldAwarded, EAGLE_SYNERGY_BALANCE.goldPerTrigger);
    assert.equal(first.firstTrigger, true);
    assert.equal(first.presentationEventId, 'eagleSupply:player1:1');
    assert.equal(state.playerGold.player1, goldBefore + EAGLE_SYNERGY_BALANCE.goldPerTrigger);
    assert.equal(state._pendingEagleSynergyEvents.length, 1);

    // 单次大额伤害跨过多个阈值时合并为一个事件
    const merged = accrueEagleSynergyDamage(state, 'player1', EAGLE_SYNERGY_BALANCE.damageThreshold * 2);
    assert.equal(merged.crossings, 2);
    assert.equal(merged.goldAwarded, EAGLE_SYNERGY_BALANCE.goldPerTrigger * 2);

    const meter = getEagleSynergyMeter(state, 'player1');
    assert.equal(meter.total, EAGLE_SYNERGY_BALANCE.damageThreshold * 3);
    assert.equal(meter.triggers, 3);
    assert.equal(meter.progress, 0);
    assert.equal(meter.goldPaid, EAGLE_SYNERGY_BALANCE.goldPerTrigger * 3);

    // deferred（延迟结算路径）只记账、不进待广播队列
    accrueEagleSynergyDamage(state, 'player1', EAGLE_SYNERGY_BALANCE.damageThreshold, { deferred: true });
    assert.equal(state._pendingEagleSynergyEvents.length, 2);
});

test('天基打击授权：受创跨阈值发放对策卡，未达阈值不发放', () => {
    const { state, tiles } = setupEagleState();
    spawnEaglePair(state, tiles);
    const hand = state.playerHands.player1;
    const handBefore = hand.length;

    assert.equal(accrueEagleDamageTaken(state, 'player1', EAGLE_SYNERGY_BALANCE.takenThreshold - 1), null);
    assert.equal(hand.length, handBefore);

    const grant = accrueEagleDamageTaken(state, 'player1', 1);
    assert.equal(grant.kind, 'orbitalGrant');
    assert.equal(grant.cardsGranted, 1);
    assert.equal(grant.presentationEventId, 'eagleGrant:player1:1');
    assert.equal(hand.length, handBefore + 1);
    assert.equal(hand[hand.length - 1], EAGLE_ORBITAL_STRIKE_CARD_ID);

    const meter = getEagleSynergyMeter(state, 'player1');
    assert.equal(meter.taken, EAGLE_SYNERGY_BALANCE.takenThreshold);
    assert.equal(meter.takenTriggers, 1);
    assert.equal(meter.takenProgress, 0);
});

test('受到侧分类：只统计敌来源伤害，无攻击者来源不计', () => {
    const { state, tiles } = setupEagleState();
    spawnEaglePair(state, tiles);
    const friendly = new Unit('infantry', state.factions.player1, tiles[2], false, 831);
    const hostile = new Unit('infantry', state.factions.player2, tiles[3], false, 832);
    const victim = new Unit('infantry', state.factions.player1, tiles[2], false, 833);

    assert.equal(resolveEagleDamageTakenCampKey({ target: victim, attacker: hostile, gameState: state }), 'player1');
    assert.equal(resolveEagleDamageTakenCampKey({ target: victim, attacker: friendly, gameState: state }), null);
    assert.equal(resolveEagleDamageTakenCampKey({ target: victim, attacker: null, gameState: state }), null);
    assert.equal(resolveEagleDamageTakenCampKey({ target: victim, airForceCampKey: 'player2', gameState: state }), 'player1');
    assert.equal(resolveEagleDamageTakenCampKey({ target: victim, airForceCampKey: 'player1', gameState: state }), null);
    assert.equal(resolveEagleDamageTakenCampKey({ target: hostile, attacker: victim, gameState: state }), null);
    assert.equal(friendly.camp, victim.camp);
});

test('统一伤害入口：造成/受到双侧打点并按剩余生命+护盾截断', () => {
    const { state, tiles } = setupEagleState();
    spawnEaglePair(state, tiles);
    // 要塞攻击者：据守城市地块的步兵
    tiles[2].isCity = true;
    const garrison = new Unit('infantry', state.factions.player1, tiles[2], false, 841);
    const victim = new Unit('infantry', state.factions.player2, tiles[3], false, 842);
    victim.hp = 10;
    victim._shield = 30;

    victim.applyDamage(100, { source: 'ranged', attacker: garrison });
    // 截断：10 生命 + 30 护盾 = 40，而非 100
    assert.equal(getEagleSynergyMeter(state, 'player1').total, 40);
    // 敌方阵营未激活协同，受到侧不计
    assert.equal(getEagleSynergyMeter(state, 'player2').taken, 0);

    // 受到侧：天鹰阵营单位被敌方攻击计入受创
    const { state: state2, tiles: tiles2 } = setupEagleState();
    spawnEaglePair(state2, tiles2);
    const eagleVictim = new Unit('infantry', state2.factions.player1, tiles2[2], false, 843);
    const enemy = new Unit('infantry', state2.factions.player2, tiles2[3], false, 844);
    eagleVictim.applyDamage(50, { source: 'melee', attacker: enemy });
    assert.equal(getEagleSynergyMeter(state2, 'player1').taken, 50);
    // 普通步兵造成的伤害不计入战功（仅空军/要塞口径）
    assert.equal(getEagleSynergyMeter(state2, 'player2').total, 0);
    assert.equal(state2._pendingEagleSynergyEvents.length, 0);
});

test('延迟结算路径（eagleAirForceCampKey）只记账不进待广播队列', () => {
    const { state, tiles } = setupEagleState();
    spawnEaglePair(state, tiles);
    const victim = new Unit('infantry', state.factions.player2, tiles[2], false, 851);
    // 计量按剩余生命+护盾截断，抬高生命以确保足额计入
    victim.maxHp = 1000;
    victim.hp = 1000;
    victim.applyDamage(EAGLE_SYNERGY_BALANCE.damageThreshold, { source: 'ranged', attacker: null, eagleAirForceCampKey: 'player1' });
    assert.equal(getEagleSynergyMeter(state, 'player1').triggers, 1);
    assert.equal(state._pendingEagleSynergyEvents.length, 0);
});

test('天基打击卡：注册、不入抽牌堆、四段结算节拍', () => {
    const cfg = TACTICAL_CARD_CONFIG[EAGLE_ORBITAL_STRIKE_CARD_ID];
    assert.ok(cfg, '天基打击应注册在标准对策卡配置中');
    assert.equal(cfg.targeting, 'anyTileGlobal');
    assert.ok(!DECK_COMPOSITION.includes(EAGLE_ORBITAL_STRIKE_CARD_ID), '天基打击不进抽牌堆');
    const tickRatios = TACTICAL_CARD_DATA.orbitalStrike.balance.tickRatios;
    assert.equal(ORBITAL_STRIKE_TICK_DELAYS_MS.length, tickRatios.length);
    assert.ok(Math.abs(tickRatios.reduce((a, b) => a + b, 0) - 1) < 1e-9);
});

test('天基打击走标准四乘区管线：浮动顶格、受防御影响、伤害确定', () => {
    const { state, tiles } = setupEagleState(8);
    const targetTile = tiles[4];
    const splash = tiles[3]; // (3,0) 是 (4,0) 的轴邻格
    const defender = new Unit('infantry', state.factions.player2, targetTile, false, 861);
    const splashDefender = new Unit('infantry', state.factions.player2, splash, false, 862);
    const helpers = { getMyCamp: () => state.factions.player1 };

    const hpBefore = defender.hp;
    const splashHpBefore = splashDefender.hp;
    const result = TACTICAL_CARD_CONFIG.orbitalStrike.execute(targetTile, state, helpers);
    assert.equal(result.orbitalStrike, true);
    assert.equal(result.results.length, 2);

    const centerResult = result.results.find(r => r.q === targetTile.q && r.r === targetTile.r);
    const splashResult = result.results.find(r => r.q === splash.q && r.r === splash.r);
    // ①基础火力 × ③浮动顶格(1.35) × ④防御：中心必为暴击，且中心高于溅射
    assert.equal(centerResult.isCrit, true);
    const maxFloat = COMBAT_BALANCE.float.attack.max;
    assert.ok(centerResult.dmg <= Math.round(TACTICAL_CARD_DATA.orbitalStrike.balance.centerAttack * maxFloat));
    assert.ok(centerResult.dmg > TACTICAL_CARD_DATA.orbitalStrike.balance.centerAttack * 0.5);
    assert.ok(centerResult.dmg > splashResult.dmg);
    // 分段：四段之和等于总伤，末段为主伤害
    assert.equal(centerResult.ticks.length, 4);
    assert.equal(centerResult.ticks.reduce((a, b) => a + b, 0), centerResult.dmg);
    assert.ok(centerResult.ticks[3] > centerResult.ticks[0]);
    // 预演扣血：与空袭卡同口径，execute 内直接扣减待调用方回滚
    assert.equal(defender.hp, Math.max(0, hpBefore - centerResult.dmg));
    assert.equal(splashDefender.hp, Math.max(0, splashHpBefore - splashResult.dmg));

    // 确定性：恢复后重算结果一致（远端重放与本地一致的前提）
    defender.hp = hpBefore;
    splashDefender.hp = splashHpBefore;
    const rerun = TACTICAL_CARD_CONFIG.orbitalStrike.execute(targetTile, state, helpers);
    assert.equal(rerun.results.find(r => r.q === targetTile.q).dmg, centerResult.dmg);
});

test('计量表（含受创）可通过快照恢复', () => {
    const { state, tiles } = setupEagleState();
    spawnEaglePair(state, tiles);
    accrueEagleSynergyDamage(state, 'player1', 450);
    accrueEagleDamageTaken(state, 'player1', 900);

    const snapshot = serializeMatchState(state);
    const restored = createMatchState();
    restoreMatchState(restored, snapshot, {
        HexTileClass: EngineHexTile,
        UnitClass: Unit,
        computeCampBorders: () => [],
        computeDistrictBorders: () => []
    });
    setGameStateRef(restored);

    const meter = getEagleSynergyMeter(restored, 'player1');
    assert.equal(meter.total, 450);
    assert.equal(meter.triggers, 1);
    assert.equal(meter.progress, 50);
    assert.equal(meter.taken, 900);
    assert.equal(meter.takenTriggers, 1);
    assert.equal(meter.takenProgress, 100);
});
