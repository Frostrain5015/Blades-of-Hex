import test from 'node:test';
import assert from 'node:assert/strict';

import {
    applyPositionalMoralePenalty,
    clearPositionalMoralePenalty,
    expireMoraleModifiers,
    getBaseMorale,
    raiseBaseMorale
} from '../rules/morale.js';

function unitWithTrackedMorale(initial = 2) {
    let morale = initial;
    return {
        _flankingMoraleBase: null,
        _flankingMoralePenalty: 0,
        _flankingMoraleActivePenalty: 0,
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
    applyPositionalMoralePenalty(unit, 1);
    assert.equal(unit.morale, 1);
    assert.equal(unit._flankingMoraleBase, 2);
    applyPositionalMoralePenalty(unit, 1);
    assert.equal(unit.morale, 1, '同一夹击态势重算不得重复扣点');
});

test('surrounding subtracts two points relative to base morale', () => {
    const unit = unitWithTrackedMorale(3);
    applyPositionalMoralePenalty(unit, 2);
    assert.equal(unit.morale, 1);
    applyPositionalMoralePenalty(unit, 1);
    assert.equal(unit.morale, 2, '包围转夹击后按-1重新派生而非固定封顶');
});

test('士气在解除夹击后立即恢复', () => {
    const unit = unitWithTrackedMorale(2);
    applyPositionalMoralePenalty(unit, 1);
    assert.equal(unit.morale, 1);
    applyPositionalMoralePenalty(unit, 0);
    assert.equal(unit.morale, 2);
    assert.equal(unit._flankingMoraleBase, null);
    assert.equal(unit._flankingMoraleActivePenalty, 0);
});

test('external morale penalty survives after positional recovery', () => {
    const unit = unitWithTrackedMorale(2);
    applyPositionalMoralePenalty(unit, 1);
    unit.morale = 0;
    assert.equal(unit.morale, 0);
    applyPositionalMoralePenalty(unit, 0);
    assert.equal(unit.morale, 0, '攻心等外部处罚不能被阵型恢复错误治愈');
});

test('morale immunity clears positional penalty immediately', () => {
    const unit = unitWithTrackedMorale(2);
    applyPositionalMoralePenalty(unit, 2);
    clearPositionalMoralePenalty(unit);
    assert.equal(unit.morale, 2);
    assert.equal(unit._flankingMoraleBase, null);
    assert.equal(unit._flankingMoralePenalty, 0);
});

test('士气奖励写入基础值，夹击期间也照常到期', () => {
    const unit = unitWithTrackedMorale(2);
    applyPositionalMoralePenalty(unit, 1);
    assert.equal(raiseBaseMorale(unit, 6), true);
    assert.equal(getBaseMorale(unit), 3);
    assert.equal(unit.morale, 2);
    assert.equal(expireMoraleModifiers(unit, 6), true);
    assert.equal(unit.morale, 1);
    applyPositionalMoralePenalty(unit, 0);
    assert.equal(unit.morale, 2);
});

const { wireHeadlessEngine } = await import('../core/headless.js');
wireHeadlessEngine();
const { configureStandardMatch } = await import('../engine/matchState.js');
const { gameState } = await import('../js/state.js');
const { initMap, moveUnit, recalcAllFlankingMorale, advanceAutomatedTurn } = await import('../js/gameLogic.js');
const { Unit } = await import('../js/Unit.js');
const { iconEffects } = await import('../js/effects.js');

function setupFlanking() {
    configureStandardMatch(gameState, { playerCount: 2 });
    gameState.standardMapId = 'crown-ring';
    gameState.skirmishFog = false;
    gameState.gameOver = false;
    gameState.turnOrder = ['player1', 'player2', 'neutral'];
    gameState.turnCounter = 0;
    gameState.currentCamp = gameState.factions.player1;
    initMap();
    for (const tile of gameState.tiles) tile.unit = null;
    const at = (q, r) => {
        const tile = gameState.tileMap.get(`${q},${r}`);
        tile.terrain = 'plains';
        return tile;
    };
    const target = new Unit('infantry', gameState.factions.player1, at(0, 1));
    return { at, target };
}

test('移动到正对邻格形成夹击，移开后立即恢复；中立守军也参与', async () => {
    const { at, target } = setupFlanking();
    const attacker = new Unit('cavalry', gameState.factions.player2, at(-2, 1));
    new Unit('infantry', gameState.factions.neutral, at(1, 1));
    gameState.currentCamp = attacker.camp;
    recalcAllFlankingMorale();
    assert.equal(target.morale, 2);
    moveUnit(attacker, at(-1, 1));
    assert.equal(attacker.tile, at(-1, 1));
    assert.equal(target.morale, 1);
    assert.ok(iconEffects.some(effect => effect.kind === 'morale' && effect.unitId === target.id));
    for (let seat = 0; seat < 3; seat++) await advanceAutomatedTurn();
    assert.equal(gameState.currentCamp, attacker.camp);
    assert.equal(target.morale, 1, '阵型持续期间，经过回合仍保持惩罚');
    moveUnit(attacker, at(-2, 1));
    assert.equal(attacker.tile, at(-2, 1));
    assert.equal(target.morale, 2);
    assert.ok(!iconEffects.some(effect => effect.kind === 'morale' && effect.unitId === target.id));
});

test('回合初一侧夹击单位毒发阵亡，本次回合结算内解除惩罚', async () => {
    const { at, target } = setupFlanking();
    const attacker = new Unit('infantry', gameState.factions.player2, at(-1, 1));
    new Unit('infantry', gameState.factions.player2, at(1, 1));
    attacker.hp = 1;
    attacker._poison = { remainingTicks: 2, sourceCampKey: 'player1', lastResolvedTurnCounter: null };
    recalcAllFlankingMorale();
    assert.equal(target.morale, 1);
    await advanceAutomatedTurn();
    assert.equal(at(-1, 1).unit, null);
    assert.equal(target.morale, 2);
});
