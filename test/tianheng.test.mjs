// test/tianheng.test.mjs — 天衡【借日】规则层：激活、释放（全军回满可行动）、岁耗偿还。
import assert from 'node:assert/strict';
import { test } from 'node:test';

const context = {};
globalThis.document = { getElementById() { return { getContext: () => context }; } };
globalThis.localStorage = { getItem: () => null, setItem: () => {} };

const [tianhengRules, stateModule, unitModule, tileModule] = await Promise.all([
    import('../rules/tianheng.js'),
    import('../engine/matchState.js'),
    import('../js/Unit.js'),
    import('../engine/HexTile.js')
]);

const {
    hasTianhengSynergyActive, getLivingCampUnits,
    resolveBorrowDay, hasBorrowDayPaybackPending, applyBorrowDayPayback,
    BORROW_DAY_CARD_ID
} = tianhengRules;

const { createMatchState } = stateModule;
const { Unit, setGameStateRef, setLogMessageRef } = unitModule;
const { EngineHexTile } = tileModule;

function setup(tileCount = 8) {
    const state = createMatchState();
    const tiles = Array.from({ length: tileCount }, (_, i) => new EngineHexTile(i, 0));
    state.tiles = tiles;
    state.tileMap = new Map(tiles.map(t => [`${t.q},${t.r}`, t]));
    state.damageTexts = []; state.healTexts = []; state.goldTexts = [];
    setGameStateRef(state);
    setLogMessageRef(() => {});
    return { state, tiles };
}

function spawnTianhengPair(state, tiles) {
    const astro = new Unit('infantry', state.factions.player1, tiles[1], false, 301, 'astrologer');
    const staller = new Unit('infantry', state.factions.player1, tiles[2], false, 302, 'staller');
    return { astro, staller };
}

test('借日卡 id', () => {
    assert.equal(BORROW_DAY_CARD_ID, 'borrowDay');
});

test('≥2 天衡将领 → 激活；仅 1 名 → 不激活', () => {
    const { state, tiles } = setup();
    const astro = new Unit('infantry', state.factions.player1, tiles[1], false, 301, 'astrologer');
    assert.equal(hasTianhengSynergyActive(state, state.factions.player1), false);
    new Unit('infantry', state.factions.player1, tiles[2], false, 302, 'staller');
    assert.equal(hasTianhengSynergyActive(state, state.factions.player1), true);
    astro.hp = 0;
    assert.equal(hasTianhengSynergyActive(state, state.factions.player1), false);
});

test('resolveBorrowDay: 全军回满行动力、可再行动、解除本回合禁锢', () => {
    const { state, tiles } = setup();
    spawnTianhengPair(state, tiles);
    const soldier = new Unit('infantry', state.factions.player1, tiles[3], false, 310);
    // 模拟已行动完毕的状态
    for (const u of getLivingCampUnits(state, 'player1')) {
        u.canAct = false; u.remainingMP = 0; u.displaySpeed = 0;
    }
    soldier._imprisoned = true;

    const affected = resolveBorrowDay(state, 'player1');
    assert.equal(affected.length, 3); // 2 将领 + 1 士兵
    for (const u of getLivingCampUnits(state, 'player1')) {
        assert.equal(u.canAct, true, '回满可行动');
        assert.ok(u.remainingMP > 0, '行动力回满');
        assert.equal(u._imprisoned, false, '解除本回合禁锢');
    }
    assert.equal(hasBorrowDayPaybackPending(state, 'player1'), true, '置岁耗偿还标记');
});

test('借日只作用释放方阵营，不影响敌方', () => {
    const { state, tiles } = setup();
    spawnTianhengPair(state, tiles);
    const enemy = new Unit('infantry', state.factions.player2, tiles[5], false, 500);
    enemy.canAct = false; enemy.remainingMP = 0;
    resolveBorrowDay(state, 'player1');
    assert.equal(enemy.canAct, false, '敌方不受借日影响');
});

test('applyBorrowDayPayback: 下一整回合全体禁锢，之后清标记', () => {
    const { state, tiles } = setup();
    spawnTianhengPair(state, tiles);
    resolveBorrowDay(state, 'player1');
    assert.equal(hasBorrowDayPaybackPending(state, 'player1'), true);

    const affected = applyBorrowDayPayback(state, 'player1');
    assert.equal(affected.length, 2);
    for (const u of getLivingCampUnits(state, 'player1')) {
        assert.equal(u.canAct, false, '偿还回合全体不可行动');
        assert.equal(u.remainingMP, 0);
        assert.equal(u._imprisoned, true);
    }
    // 标记清除，不再重复偿还
    assert.equal(hasBorrowDayPaybackPending(state, 'player1'), false);
    assert.deepEqual(applyBorrowDayPayback(state, 'player1'), []);
});
