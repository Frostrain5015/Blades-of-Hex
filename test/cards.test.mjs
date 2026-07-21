// test/cards.test.mjs — 特殊卡行为标记（CARD_FLAGS）集中化的等价性回归。
// 锁定：迁移到 getCardMeta 后，delayed/noDiscard/noCopy 三类集合与旧硬编码列表完全一致。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getCardMeta, CARD_FLAGS } from '../rules/cards.js';

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

test('CARD_FLAGS.noCopy 覆盖旧连横排除列表（并新增 borrowDay）', () => {
    // 旧列表全部仍不可复制
    for (const id of OLD_NO_COPY) {
        assert.equal(getCardMeta(id).noCopy, true, `${id} 应不可复制`);
    }
    // 新增天衡王牌【借日】不可复制
    assert.equal(getCardMeta('borrowDay').noCopy, true);
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
