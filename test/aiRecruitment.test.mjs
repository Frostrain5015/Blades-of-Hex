import test from 'node:test';
import assert from 'node:assert/strict';

import { prioritizeNavalRecruitment } from '../rules/aiRecruitment.js';

const red = { id: 'red' };
const blue = { id: 'blue' };
const allied = { id: 'allied' };
const hostile = (left, right) => left === red && right === blue;
const ship = camp => ({ unit: { type: 'warship', camp } });

test('AI keeps ordinary and uncontested port recruitment on its land strategy', () => {
    const landOrder = ['infantry', 'archer'];
    assert.deepEqual(prioritizeNavalRecruitment({ isPort: false }, landOrder, [ship(blue)], red, hostile), landOrder);
    assert.deepEqual(prioritizeNavalRecruitment({ isPort: true }, landOrder, [ship(allied)], red, hostile), landOrder);
    assert.deepEqual(prioritizeNavalRecruitment({ isPort: true }, landOrder, [ship(red), ship(blue)], red, hostile), landOrder);
});

test('AI port prepends one warship when a hostile fleet has numerical advantage', () => {
    const result = prioritizeNavalRecruitment(
        { isPort: true },
        ['infantry', 'warship', 'archer'],
        [ship(blue), ship(blue), ship(red), { unit: { type: 'infantry', camp: blue } }],
        red,
        hostile
    );
    assert.deepEqual(result, ['warship', 'infantry', 'archer']);
});
