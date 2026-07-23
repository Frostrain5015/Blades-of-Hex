import test from 'node:test';
import assert from 'node:assert/strict';

import {
    AI_DIFFICULTY_PROFILES,
    getAiDifficultyProfile,
    normalizeAiDifficulty,
    resolveAiDifficultyProfile,
    resolveAiIncomeMultiplier
} from '../ai/difficulty.js';
import { chooseDefaultSpecialization, UNIT_CONFIG } from '../rules/units.js';
import { createMatchState, serializeMatchState } from '../engine/matchState.js';
import { scoreTacticalRoleMatchup } from '../ai/grok.js';

test('AI 三档难度只按决策能力递增，不包含经济倍率', () => {
    assert.equal(normalizeAiDifficulty(1), 'easy');
    assert.equal(normalizeAiDifficulty(1.5), 'medium');
    assert.equal(normalizeAiDifficulty(2), 'hard');
    assert.equal(getAiDifficultyProfile('困难').id, 'hard');

    const { easy, medium, hard } = AI_DIFFICULTY_PROFILES;
    assert.ok(easy.decisionNoise > medium.decisionNoise);
    assert.ok(medium.decisionNoise > hard.decisionNoise);
    assert.equal(easy.coordinatedFocus, false);
    assert.equal(medium.coordinatedFocus, true);
    assert.equal(hard.threatForecast, true);
    assert.equal('economyMultiplier' in hard, false);
});

test('可按阵营解析非对称自对局难度', () => {
    const state = {
        aiDifficulty: 1,
        aiDifficultyByCamp: {
            player1: 'easy',
            player2: 'medium',
            player3: 'hard'
        }
    };
    assert.equal(resolveAiDifficultyProfile(state, { id: 'player1' }).id, 'easy');
    assert.equal(resolveAiDifficultyProfile(state, { id: 'player2' }).id, 'medium');
    assert.equal(resolveAiDifficultyProfile(state, { id: 'player3' }).id, 'hard');
});

test('标准 PVE 困难档不获得收入加成，战役倍率保持兼容', () => {
    const pve = {
        gameMode: 'pve',
        campaignMode: false,
        aiDifficulty: 2,
        factions: { player2: { controller: 'ai' } }
    };
    assert.equal(resolveAiIncomeMultiplier(pve, 'player2'), 1);
    assert.equal(resolveAiIncomeMultiplier({ ...pve, campaignMode: true }, 'player2'), 2);
});

test('难度标识和按阵营配置进入对局快照', () => {
    const state = createMatchState();
    state.aiDifficulty = 2;
    state.aiDifficultyId = 'hard';
    state.aiDifficultyByCamp = { player1: 'easy', player2: 'medium', player3: 'hard' };
    const snapshot = serializeMatchState(state);
    assert.equal(snapshot.aiDifficultyId, 'hard');
    assert.deepEqual(snapshot.aiDifficultyByCamp, state.aiDifficultyByCamp);
});

test('困难 AI 在敌军集群出现时让炮兵专精为火箭炮', () => {
    const mine = { id: 'player1' };
    const enemy = { id: 'player2' };
    const archer = {
        type: 'archer',
        camp: mine,
        config: UNIT_CONFIG.archer,
        tile: { q: 0, r: 0 }
    };
    const hostileUnits = [
        { type: 'infantry', camp: enemy, config: UNIT_CONFIG.infantry, tile: { q: 3, r: 0 } },
        { type: 'infantry', camp: enemy, config: UNIT_CONFIG.infantry, tile: { q: 4, r: 0 } },
        { type: 'cavalry', camp: enemy, config: UNIT_CONFIG.cavalry, tile: { q: 3, r: 1 } }
    ];
    const state = {
        tiles: [
            { unit: archer },
            ...hostileUnits.map(unit => ({ unit }))
        ]
    };
    assert.equal(
        chooseDefaultSpecialization(archer, state, { intelligence: 'hard' }),
        'rocketArtillery'
    );
    assert.equal(
        chooseDefaultSpecialization(archer, state, { intelligence: 'easy' }),
        'fieldGun'
    );
});

test('困难 AI 为驱逐舰选择反潜专精', () => {
    const mine = { id: 'player1' };
    const enemy = { id: 'player2' };
    const destroyer = {
        type: 'destroyer',
        camp: mine,
        config: UNIT_CONFIG.destroyer,
        tile: { q: 0, r: 0 }
    };
    const submarine = {
        type: 'submarine',
        camp: enemy,
        config: UNIT_CONFIG.submarine,
        tile: { q: 2, r: 0 }
    };
    assert.equal(
        chooseDefaultSpecialization(
            destroyer,
            { tiles: [{ unit: destroyer }, { unit: submarine }] },
            { intelligence: 'hard' }
        ),
        'antiSubDestroyer'
    );
});

test('困难战术角色优先伏击高价值舰并切远程脆皮', () => {
    const submarine = { type: 'submarine' };
    assert.ok(
        scoreTacticalRoleMatchup(submarine, { type: 'carrier' })
        > scoreTacticalRoleMatchup(submarine, { type: 'warship' })
    );
    assert.ok(scoreTacticalRoleMatchup(submarine, { type: 'destroyer' }) < 0);
    assert.ok(scoreTacticalRoleMatchup(
        { type: 'destroyer', specializationKey: 'antiSubDestroyer' },
        { type: 'submarine' }
    ) >= 180);
    assert.ok(scoreTacticalRoleMatchup(
        { type: 'cavalry' },
        { type: 'archer' }
    ) >= 100);
});
