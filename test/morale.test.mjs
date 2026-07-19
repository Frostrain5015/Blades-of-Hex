import test from 'node:test';
import assert from 'node:assert/strict';

import {
    applyPositionalMoralePenalty,
    clearPositionalMoralePenalty,
    POSITIONAL_MORALE_RECOVERY_ROUNDS
} from '../rules/morale.js';

function unitWithTrackedMorale(initial = 2) {
    let morale = initial;
    return {
        _flankingMoraleBase: null,
        _flankingMoralePenalty: 0,
        _flankingMoraleActivePenalty: 0,
        _flankingMoraleRecoveryUntil: 0,
        _applyingFlankingMorale: false,
        get morale() { return morale; },
        set morale(value) {
            const normalized = Math.max(0, Math.min(3, Math.round(Number(value) || 0)));
            morale = normalized;
            if (!this._applyingFlankingMorale && Number.isFinite(this._flankingMoraleBase)) {
                this._flankingMoraleBase = normalized;
                morale = Math.max(0, normalized - (this._flankingMoralePenalty || 0));
            }
        }
    };
}

test('flanking subtracts one morale point without repeating on recalculation', () => {
    const unit = unitWithTrackedMorale(2);
    applyPositionalMoralePenalty(unit, 1, 4);
    assert.equal(unit.morale, 1);
    assert.equal(unit._flankingMoraleBase, 2);
    applyPositionalMoralePenalty(unit, 1, 4);
    assert.equal(unit.morale, 1, '同一夹击态势重算不得重复扣点');
});

test('surrounding subtracts two points relative to base morale', () => {
    const unit = unitWithTrackedMorale(3);
    applyPositionalMoralePenalty(unit, 2, 2);
    assert.equal(unit.morale, 1);
    applyPositionalMoralePenalty(unit, 1, 2);
    assert.equal(unit.morale, 2, '包围转夹击后按-1重新派生而非固定封顶');
});

test('removed formation keeps morale penalty for three rounds before recovery', () => {
    const unit = unitWithTrackedMorale(2);
    applyPositionalMoralePenalty(unit, 1, 5);
    applyPositionalMoralePenalty(unit, 0, 5);
    assert.equal(unit._flankingMoraleRecoveryUntil, 5 + POSITIONAL_MORALE_RECOVERY_ROUNDS);
    assert.equal(unit.morale, 1);
    applyPositionalMoralePenalty(unit, 0, 7);
    assert.equal(unit.morale, 1);
    applyPositionalMoralePenalty(unit, 0, 8);
    assert.equal(unit.morale, 2);
    assert.equal(unit._flankingMoraleBase, null);
});

test('external morale penalty survives after positional recovery', () => {
    const unit = unitWithTrackedMorale(2);
    applyPositionalMoralePenalty(unit, 1, 1);
    unit.morale = 0;
    assert.equal(unit.morale, 0);
    applyPositionalMoralePenalty(unit, 0, 1);
    applyPositionalMoralePenalty(unit, 0, 4);
    assert.equal(unit.morale, 0, '攻心等外部处罚不能被阵型恢复错误治愈');
});

test('morale immunity clears positional penalty immediately', () => {
    const unit = unitWithTrackedMorale(2);
    applyPositionalMoralePenalty(unit, 2, 3);
    clearPositionalMoralePenalty(unit);
    assert.equal(unit.morale, 2);
    assert.equal(unit._flankingMoraleBase, null);
    assert.equal(unit._flankingMoralePenalty, 0);
});
