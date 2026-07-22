// test/cards.test.mjs — 特殊卡行为标记（CARD_FLAGS）集中化的等价性回归。
// 锁定：迁移到 getCardMeta 后，delayed/noDiscard/noCopy 三类集合与旧硬编码列表完全一致。
import { test } from 'node:test';
import assert from 'node:assert/strict';

const context = {};
globalThis.document = { getElementById() { return { getContext: () => context }; } };
globalThis.localStorage = { getItem: () => null, setItem: () => {} };

const [{ getCardMeta, CARD_FLAGS, TACTICAL_CARD_CONFIG, TACTICAL_CARD_DATA }, stateModule, unitModule, tileModule] =
    await Promise.all([
        import('../rules/cards.js'),
        import('../engine/matchState.js'),
        import('../js/Unit.js'),
        import('../engine/HexTile.js')
    ]);
const { createMatchState } = stateModule;
const { Unit, setGameStateRef, setLogMessageRef } = unitModule;
const { EngineHexTile } = tileModule;

function shieldSetup() {
    const state = createMatchState();
    const tiles = Array.from({ length: 4 }, (_, i) => new EngineHexTile(i, 0));
    state.tiles = tiles;
    state.tileMap = new Map(tiles.map(t => [`${t.q},${t.r}`, t]));
    state.damageTexts = []; state.healTexts = []; state.goldTexts = [];
    setGameStateRef(state);
    setLogMessageRef(() => {});
    return { state, tiles };
}

// 旧硬编码列表（迁移前 gameLogic 中的字符串判定），作为回归基准：
const OLD_DELAYED = ['lightning', 'airstrike', 'mgNest', 'shield', 'orbitalStrike'];
const OLD_NO_DISCARD = ['commanderDeploy', 'orbitalStrike'];
const OLD_NO_COPY = ['commanderDeploy', 'diveStrafe', 'carpetBomb', 'airlift', 'orbitalStrike'];

const ALL_IDS = new Set([
    ...Object.keys(CARD_FLAGS),
    ...OLD_DELAYED, ...OLD_NO_DISCARD, ...OLD_NO_COPY
]);

test('CARD_FLAGS.delayed 与旧 isDelayedCard 列表一致', () => {
    for (const id of ALL_IDS) {
        assert.equal(Boolean(getCardMeta(id).delayed), OLD_DELAYED.includes(id), `delayed 不一致: ${id}`);
    }
});

test('CARD_FLAGS.noDiscard 与旧免弃牌列表一致', () => {
    for (const id of ALL_IDS) {
        assert.equal(Boolean(getCardMeta(id).noDiscard), OLD_NO_DISCARD.includes(id), `noDiscard 不一致: ${id}`);
    }
});

test('CARD_FLAGS.noCopy 覆盖旧连横排除列表', () => {
    // 旧列表全部仍不可复制
    for (const id of OLD_NO_COPY) {
        assert.equal(getCardMeta(id).noCopy, true, `${id} 应不可复制`);
    }
    // 天衡【日月天衡】已从王牌【借日】迁移为充能制被动，borrowDay 不再是卡牌。
    assert.deepEqual(getCardMeta('borrowDay'), {}, 'borrowDay 已非卡牌，无标记');
});

test('getCardMeta 对普通卡返回空标记（不误伤）', () => {
    for (const id of ['heal', 'poison', 'scout', 'forceMarch', 'landmine']) {
        const m = getCardMeta(id);
        assert.equal(Boolean(m.delayed), false);
        assert.equal(Boolean(m.noDiscard), false);
        assert.equal(Boolean(m.noCopy), false);
    }
});

test('getCardMeta 对未知卡返回稳定空对象', () => {
    assert.deepEqual(getCardMeta('__nope__'), {});
});

// ===== 护盾卡：固定 60 点、永久有效 =====
test('护盾卡数值为固定 60 点，且无时长（永久）', () => {
    assert.equal(TACTICAL_CARD_DATA.shield.balance.shield, 60);
    assert.equal(TACTICAL_CARD_DATA.shield.balance.duration, undefined, '不再有时长');
    assert.equal(TACTICAL_CARD_DATA.shield.balance.shieldMaxHpPct, undefined, '非百分比');
});

test('护盾卡 execute: 施加固定 60 点护盾，_shieldTurns=0 永久', () => {
    const { state, tiles } = shieldSetup();
    const unit = new Unit('infantry', state.factions.player1, tiles[0], false, 1);
    const expected = TACTICAL_CARD_DATA.shield.balance.shield; // 60
    const result = TACTICAL_CARD_CONFIG.shield.execute(tiles[0], state, {});
    assert.equal(result.shieldAmount, expected);
    assert.equal(unit._shield, expected, '护盾为固定 60 点');
    assert.equal(unit._shieldMax, expected, '护盾峰值记录');
    assert.equal(unit._shieldTurns, 0, '永久有效（无回合计时）');
});

test('护盾卡：护盾先于生命吸收伤害，打光后才见血', () => {
    const { state, tiles } = shieldSetup();
    const unit = new Unit('infantry', state.factions.player1, tiles[0], false, 1);
    TACTICAL_CARD_CONFIG.shield.execute(tiles[0], state, {});
    const shield = unit._shield; // 59
    const hpBefore = unit.hp;
    unit.applyDamage(shield - 9, { source: 'melee', attacker: null });
    assert.equal(unit._shield, 9, '护盾吸收');
    assert.equal(unit.hp, hpBefore, '生命未损');
    unit.applyDamage(20, { source: 'melee', attacker: null });
    assert.equal(unit._shield, 0, '护盾打光');
    assert.equal(unit.hp, hpBefore - 11, '溢出部分见血');
});
