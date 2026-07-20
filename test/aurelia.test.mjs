import assert from 'node:assert/strict';
import { test } from 'node:test';

const context = {};
globalThis.document = {
    getElementById() {
        return { getContext: () => context };
    }
};
globalThis.localStorage = { getItem: () => null, setItem: () => {} };

const [unitModule, tileModule, stateModule, aureliaRules, factionSynergyRules] = await Promise.all([
    import('../js/Unit.js'),
    import('../engine/HexTile.js'),
    import('../engine/matchState.js'),
    import('../rules/aurelia.js'),
    import('../rules/factionSynergies.js')
]);

const { Unit, setGameStateRef, setLogMessageRef, setIsNetworkGameRef } = unitModule;
const { EngineHexTile } = tileModule;
const { createMatchState, restoreMatchState, serializeMatchState } = stateModule;
const {
    AURELIA_OATH_EFFECT,
    canTriggerAureliaRescue,
    getAureliaOathRemainingRounds,
    hasAureliaOathPassive,
    hasAureliaOathEffect
} = aureliaRules;
const {
    AURELIA_FACTION_SYNERGY,
    FELLOW_ROBE_FACTION_SYNERGY,
    getActiveFactionSynergies,
    getActiveSpecialFactionSynergies,
    getCommanderFactionSynergy,
    getFactionSynergy,
    getFellowRobeDefenseBonus,
    hasFellowRobeSynergy
} = factionSynergyRules;

function createTile(q, r) {
    return new EngineHexTile(q, r);
}

function setupAureliaState() {
    const state = createMatchState();
    const tiles = [createTile(0, 0), createTile(1, 0), createTile(2, 0)];
    state.tiles = tiles;
    state.tileMap = new Map(tiles.map(tile => [`${tile.q},${tile.r}`, tile]));
    state.damageTexts = [];
    state.healTexts = [];
    setGameStateRef(state);
    setLogMessageRef(() => {});
    setIsNetworkGameRef(() => false);
    return { state, tiles };
}

test('阵营协同注册表统一提供成员、将领卡标识与可替换 Hero 徽记', () => {
    const synergy = getFactionSynergy('aurelia');
    assert.equal(synergy, AURELIA_FACTION_SYNERGY);
    assert.equal(getCommanderFactionSynergy('ironGuard'), synergy);
    assert.equal(getCommanderFactionSynergy('nonexistentCommander'), null);
    assert.equal(synergy.marker.symbol, '⚜️');
    assert.equal(synergy.hero.emblem.kind, 'text');
    assert.equal(synergy.hero.emblem.value, '⚜️');
    assert.equal(synergy.hero.kicker, '阵营协同');
    assert.equal(synergy.hero.title, '同一个誓言');
    assert.equal(synergy.hero.followup.kind, 'rescue-link');
});

test('混编双将未激活特殊协同时获得【与子同袍】防御加成', () => {
    const { state, tiles } = setupAureliaState();
    const defender = new Unit('infantry', state.factions.player1, tiles[0], false, 751, 'ironGuard');
    const fellow = new Unit('infantry', state.factions.player1, tiles[1], false, 752, 'necromancer');
    const ordinary = new Unit('infantry', state.factions.player1, tiles[2], false, 753, null);

    assert.equal(getFactionSynergy('fellow-robe'), FELLOW_ROBE_FACTION_SYNERGY);
    assert.equal(FELLOW_ROBE_FACTION_SYNERGY.effect.name, '与子同袍');
    assert.equal(FELLOW_ROBE_FACTION_SYNERGY.effect.defenseBonusPct, 0.10);
    assert.equal(hasFellowRobeSynergy(state, defender.camp), true);
    assert.equal(getFellowRobeDefenseBonus(defender, state), 0.10);
    assert.equal(getFellowRobeDefenseBonus(fellow, state), 0.10);
    assert.equal(getFellowRobeDefenseBonus(ordinary, state), 0);
    assert.deepEqual(getActiveSpecialFactionSynergies(state, defender.camp), []);
    assert.deepEqual(getActiveFactionSynergies(state, defender.camp), [FELLOW_ROBE_FACTION_SYNERGY]);
});

test('【与子同袍】只强化将领且会被任意特殊阵营协同取代', () => {
    const { state, tiles } = setupAureliaState();
    const defender = new Unit('infantry', state.factions.player1, tiles[0], false, 761, 'ironGuard');
    const aureliaFellow = new Unit('infantry', state.factions.player1, tiles[1], false, 762, 'minister');
    const outsider = new Unit('infantry', state.factions.player1, tiles[2], false, 763, 'necromancer');

    assert.equal(hasFellowRobeSynergy(state, defender.camp), false);
    assert.equal(getFellowRobeDefenseBonus(defender, state), 0);
    assert.equal(getFellowRobeDefenseBonus(aureliaFellow, state), 0);
    assert.equal(getFellowRobeDefenseBonus(outsider, state), 0);
    assert.deepEqual(getActiveSpecialFactionSynergies(state, defender.camp), [AURELIA_FACTION_SYNERGY]);
    assert.deepEqual(getActiveFactionSynergies(state, defender.camp), [AURELIA_FACTION_SYNERGY]);
});

test('【与子同袍】的10%防御实际进入统一伤害结算', () => {
    const { state, tiles } = setupAureliaState();
    const defender = new Unit('infantry', state.factions.player1, tiles[0], false, 771, 'ironGuard');
    const fellow = new Unit('infantry', state.factions.player1, tiles[1], false, 772, 'necromancer');
    const attacker = new Unit('infantry', state.factions.player2, tiles[2], false, 773, null);

    state.rng.setState(20260719);
    const protectedDamage = attacker.calculateDamage(defender).dmg;
    fellow.hp = 0;
    state.rng.setState(20260719);
    const normalDamage = attacker.calculateDamage(defender).dmg;

    assert.ok(protectedDamage < normalDamage);
});

test('同阵营两名奥雷利亚将领激活一次性致命救援，并获得两回合加护', () => {
    const { state, tiles } = setupAureliaState();
    const rescued = new Unit('infantry', state.factions.player1, tiles[0], false, 701, 'ironGuard');
    const rescuer = new Unit('infantry', state.factions.player1, tiles[1], false, 702, 'centurion');
    const attacker = new Unit('infantry', state.factions.player2, tiles[2], false, 703, null);
    const rescuerHpBefore = rescuer.hp;
    const attackBefore = rescuer.getEffectiveAttack();
    // 表现层的临时位移不得污染广播锚点，飞线必须落在双方棋子的固定落格中心。
    rescued.getVisualPos = () => ({ x: 991, y: 992 });
    rescuer.getVisualPos = () => ({ x: 993, y: 994 });

    assert.equal(hasAureliaOathPassive(rescued, state), true);
    assert.equal(canTriggerAureliaRescue(rescued, state), true);
    assert.equal(rescued.applyDamage(9999, { source: 'melee', attacker }), false);
    assert.equal(rescued.hp, Math.round(rescued.maxHp * 0.4));
    assert.equal(rescuer.hp, Math.round(rescuerHpBefore * 0.6));
    assert.equal(state._aureliaOathUsed.player1, true);
    assert.equal(canTriggerAureliaRescue(rescued, state), false);
    assert.equal(getAureliaOathRemainingRounds(rescued, state), 2);
    assert.equal(hasAureliaOathEffect(rescuer, state), true);
    assert.equal(rescuer.getEffectiveAttack(), Math.round(attackBefore * (1 + AURELIA_OATH_EFFECT.attackBonusPct)));
    assert.equal(state._pendingAureliaOathEvents.length, 1);
    assert.equal(state._pendingAureliaOathEvents[0].rescuerUnitId, rescuer.id);
    assert.equal(state._pendingAureliaOathEvents[0].rescuedUnitId, rescued.id);
    assert.equal(state._pendingAureliaOathEvents[0].rescuerX, rescuer.tile.x);
    assert.equal(state._pendingAureliaOathEvents[0].rescuerY, rescuer.tile.y);
    assert.equal(state._pendingAureliaOathEvents[0].rescuedX, rescued.tile.x);
    assert.equal(state._pendingAureliaOathEvents[0].rescuedY, rescued.tile.y);
    assert.equal(state._pendingAureliaOathEvents[0].rescuerHpBefore
        - state._pendingAureliaOathEvents[0].rescuerHpAfter, Math.round(rescuerHpBefore * 0.4));
    assert.equal(state._pendingAureliaOathEvents[0].rescuedHpBefore, 0);
    assert.equal(state._pendingAureliaOathEvents[0].rescuedHpAfter
        - state._pendingAureliaOathEvents[0].rescuedHpBefore, rescued.hp);

    state.turnCounter = state.turnOrder.length * 2;
    assert.equal(hasAureliaOathEffect(rescued, state), false);
    assert.equal(rescuer.getEffectiveAttack(), attackBefore);
});

test('不同阵营奥雷利亚将领不能互相激活协同', () => {
    const { state, tiles } = setupAureliaState();
    const left = new Unit('infantry', state.factions.player1, tiles[0], false, 711, 'minister');
    new Unit('infantry', state.factions.player2, tiles[1], false, 712, 'advisor');

    assert.equal(hasAureliaOathPassive(left, state), false);
    assert.equal(canTriggerAureliaRescue(left, state), false);
});

test('空袭、中毒、亡魂诅咒与地雷造成致命伤害时均可触发救援', () => {
    const scenarios = [
        { label: '空袭', options: { source: 'ranged', attacker: null } },
        { label: '中毒', options: { source: 'true', attacker: null } },
        { label: '亡魂诅咒', options: { source: 'true', withAttacker: true } },
        { label: '地雷', options: { source: 'effect', attacker: null, skipAura: true } }
    ];

    for (let index = 0; index < scenarios.length; index++) {
        const { label, options } = scenarios[index];
        const { state, tiles } = setupAureliaState();
        const rescued = new Unit('infantry', state.factions.player1, tiles[0], false, 730 + index * 3, 'ironGuard');
        const rescuer = new Unit('infantry', state.factions.player1, tiles[1], false, 731 + index * 3, 'centurion');
        const attacker = options.withAttacker
            ? new Unit('infantry', state.factions.player2, tiles[2], false, 732 + index * 3, null)
            : null;
        const damageOptions = { ...options, attacker };
        delete damageOptions.withAttacker;

        assert.equal(rescued.applyDamage(9999, damageOptions), false, `${label}不应直接杀死被救援者`);
        assert.equal(rescued.hp, Math.round(rescued.maxHp * 0.4), `${label}后应抬升至40%最大生命`);
        assert.equal(rescuer.hp, Math.round(rescuer.maxHp * 0.6), `${label}后救援者应献出40%当前生命`);
        assert.equal(state._aureliaOathUsed.player1, true, `${label}后应标记本局已使用`);
        assert.equal(state._pendingAureliaOathEvents.length, 1, `${label}后应产生一次广播事件`);
    }
});

test('奥雷利亚使用记录与加护到期回合可通过快照恢复', () => {
    const { state, tiles } = setupAureliaState();
    const rescued = new Unit('infantry', state.factions.player1, tiles[0], false, 721, 'berserker');
    const rescuer = new Unit('infantry', state.factions.player1, tiles[1], false, 722, 'advisor');
    const attacker = new Unit('infantry', state.factions.player2, tiles[2], false, 723, null);
    rescued.applyDamage(9999, { source: 'ranged', attacker });

    const snapshot = serializeMatchState(state);
    const restored = createMatchState();
    restoreMatchState(restored, snapshot, {
        HexTileClass: EngineHexTile,
        UnitClass: Unit,
        computeCampBorders: () => [],
        computeDistrictBorders: () => []
    });
    setGameStateRef(restored);

    assert.equal(restored._aureliaOathUsed.player1, true);
    assert.equal(restored.tileMap.get('0,0').unit._aureliaOathUntilRound, 2);
    assert.equal(restored.tileMap.get('1,0').unit._aureliaOathUntilRound, 2);
    assert.equal(hasAureliaOathEffect(restored.tileMap.get('1,0').unit, restored), true);
    assert.equal(rescuer._aureliaOathUntilRound, 2);
});
