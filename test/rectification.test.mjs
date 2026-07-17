// 联机整流回归测试：水雷协议合法性、地雷类型判定、联机自动专精防御闸。
import assert from 'node:assert/strict';
import { test } from 'node:test';

const context = {};
globalThis.document = {
    getElementById() {
        return { getContext: () => context };
    }
};
globalThis.localStorage = { getItem: () => null, setItem: () => {} };

const [{ Unit, setGameStateRef, setLogMessageRef, setIsNetworkGameRef }, { EngineHexTile }, { createMatchState }] = await Promise.all([
    import('../js/Unit.js'),
    import('../engine/HexTile.js'),
    import('../engine/matchState.js')
]);
const [{ isValidSnapshot }, { TACTICAL_CARD_CONFIG }, { SURFACE_KIND }] = await Promise.all([
    import('../protocol/messages.js'),
    import('../rules/cards.js'),
    import('../rules/surfaces.js')
]);

function tile(q, r, surface = 'land', extra = {}) {
    const result = new EngineHexTile(q, r);
    result.surface = surface;
    if (surface !== 'land') result.camp = null;
    Object.assign(result, extra);
    return result;
}

function setupState(tiles) {
    const state = createMatchState();
    state.tiles = tiles;
    state.tileMap = new Map(tiles.map(value => [`${value.q},${value.r}`, value]));
    state.damageTexts = [];
    state.healTexts = [];
    setGameStateRef(state);
    setLogMessageRef(() => {});
    setIsNetworkGameRef(() => false);
    return state;
}

function snapshotWithTiles(tiles) {
    return {
        factions: { player1: { id: 'player1' } },
        currentCampKey: 'player1',
        tiles,
        turnOrder: ['player1'],
        roleAssignments: { player1: 'player1' },
        playerGold: { player1: 4 },
        turnCounter: 0
    };
}

test('协议接受水面布雷快照，但仍拒绝水面城市', () => {
    const land = { id: 1, q: 0, r: 0, s: 0, campKey: 'player1' };
    const minedWater = {
        id: 2, q: 1, r: 0, s: -1, surface: SURFACE_KIND.SHALLOW_WATER,
        campKey: null, minePlanted: true, mineCampKey: 'player1', mineType: 'water'
    };
    assert.equal(isValidSnapshot(snapshotWithTiles([land, minedWater])), true, '水雷不能再被判为非法快照');
    assert.equal(
        isValidSnapshot(snapshotWithTiles([land, { ...minedWater, minePlanted: false, isCity: true }])),
        false,
        '水面城市仍然非法'
    );
});

test('地雷卡在浅水/深水放置时标记为水雷，在陆地为地雷', () => {
    const helpers = { getMyCamp: () => ({ id: 'player1' }) };
    for (const [surface, expected] of [['shallowWater', 'water'], ['deepWater', 'water'], ['land', 'land']]) {
        const target = tile(0, 0, surface);
        const result = TACTICAL_CARD_CONFIG.landmine.execute(target, {}, helpers);
        assert.equal(target._minePlanted, true);
        assert.equal(target._mineType, expected, `${surface} 应产生 ${expected} 型雷`);
        assert.equal(result.mineType, expected);
    }
});

test('联机对局中玩家阵营升阶不再自动选择专精；本地 AI 与中立不受影响', () => {
    // createMatchState 默认 player2.controller === 'ai'（本地 PVE 语义）
    const state = setupState([tile(0, 0), tile(1, 0), tile(2, 0)]);
    assert.equal(state.factions.player2.controller, 'ai');

    // 本地（非联机）：AI 阵营自动选择专精
    setIsNetworkGameRef(() => false);
    const localAiUnit = new Unit('infantry', state.factions.player2, state.tileMap.get('0,0'));
    localAiUnit.addXP(999);
    assert.ok(localAiUnit._rank >= 1);
    assert.equal(localAiUnit.pendingSpecialization, false, '本地 AI 应自动选择专精');
    assert.ok(localAiUnit.specializationKey);

    // 联机：即使 controller 被旧快照污染为 'ai'，玩家阵营也不得自动选择
    setIsNetworkGameRef(() => true);
    const networkUnit = new Unit('infantry', state.factions.player2, state.tileMap.get('1,0'));
    networkUnit.addXP(999);
    assert.ok(networkUnit._rank >= 1);
    assert.equal(networkUnit.specializationKey, null, '联机玩家阵营不得被自动选择专精');
    assert.equal(networkUnit.pendingSpecialization, true, '应保持待专精等待玩家 UI 选择');

    // 联机中的中立阵营仍然自动选择
    const neutralUnit = new Unit('infantry', state.factions.neutral, state.tileMap.get('2,0'));
    neutralUnit.addXP(999);
    assert.ok(neutralUnit._rank >= 1);
    assert.equal(neutralUnit.pendingSpecialization, false, '中立阵营在联机中仍自动选择');

    setIsNetworkGameRef(() => false);
});
