import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
    NEUTRAL_ECONOMY_RATE,
    applyNeutralEconomyRate,
    calcIncome
} from '../rules/constants.js';

test('中立经济门控只折算中立，其余阵营原样入账', () => {
    for (const gross of [0, 1, 4, 9, 15, 37]) {
        assert.equal(applyNeutralEconomyRate('player1', gross), gross);
        assert.equal(applyNeutralEconomyRate('player2', gross), gross);
        assert.equal(applyNeutralEconomyRate('player3', gross), gross);
    }
    assert.equal(applyNeutralEconomyRate('neutral', 15), 3);
    assert.equal(applyNeutralEconomyRate('neutral', 20), 4);
});

test('折算按 NEUTRAL_ECONOMY_RATE 下取整，且不会产生负收入', () => {
    assert.equal(NEUTRAL_ECONOMY_RATE, 0.20);
    assert.equal(applyNeutralEconomyRate('neutral', 4), 0);
    assert.equal(applyNeutralEconomyRate('neutral', 5), 1);
    assert.equal(applyNeutralEconomyRate('neutral', 0), 0);
    assert.equal(applyNeutralEconomyRate('neutral', -10), 0);
    assert.equal(applyNeutralEconomyRate('neutral', undefined), 0);
});

// 这是门控最容易被改坏的地方：村庄单笔只有 $1，一旦有人把折算下放到
// 每一笔收入上，floor(1 * 0.2) 会把村庄那一份整个抹成 0，中立会悄悄
// 少掉一大块收入而没有任何报错。必须先合计再折算。
test('城市与村庄必须合计后只折算一次，逐项折算会抹平村庄收入', () => {
    const cityGross = calcIncome(3);          // 王冠环岛中立 3 城 = 9
    const villageGross = 6;                   // 3/4/5 区共 6 村，每村 $1
    const gross = cityGross + villageGross;   // 15

    const pooled = applyNeutralEconomyRate('neutral', gross);
    const perItem = applyNeutralEconomyRate('neutral', cityGross)
        + Array.from({ length: villageGross }, () => applyNeutralEconomyRate('neutral', 1))
            .reduce((sum, value) => sum + value, 0);

    assert.equal(pooled, 3);
    assert.equal(perItem, 1);
    assert.ok(pooled > perItem, '合计折算必须严格优于逐项折算，否则村庄收入被静默清零');
});
