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
import { Unit, setGameStateRef, setIsNetworkGameRef } from '../js/Unit.js';
import { scoreTacticalRoleMatchup, shouldPlanActiveSkill } from '../ai/grok.js';

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

test('真实升级链按各阵营 AI 难度选择专精，不被通用默认值抢占', () => {
    const mine = { id: 'player1', controller: 'ai' };
    const enemy = { id: 'player2', controller: 'ai' };
    const makeTile = (q, r) => ({
        q, r, x: q * 10, y: r * 10,
        surface: 'land',
        terrain: 'plains',
        unit: null
    });
    const runRankUp = difficulty => {
        const ownTile = makeTile(0, 0);
        const archer = new Unit('archer', mine, ownTile, false);
        ownTile.unit = archer;
        const hostileTiles = [
            makeTile(3, 0),
            makeTile(4, 0),
            makeTile(3, 1)
        ];
        hostileTiles.forEach((tile, index) => {
            tile.unit = {
                id: 900 + index,
                type: index === 2 ? 'cavalry' : 'infantry',
                camp: enemy,
                config: index === 2 ? UNIT_CONFIG.cavalry : UNIT_CONFIG.infantry,
                tile
            };
        });
        const state = {
            factions: { player1: mine, player2: enemy },
            aiDifficultyByCamp: { player1: difficulty },
            tiles: [ownTile, ...hostileTiles]
        };
        setGameStateRef(state);
        setIsNetworkGameRef(() => false);
        archer.addXP(5);
        return archer.specializationKey;
    };

    assert.equal(runRankUp('easy'), 'fieldGun');
    assert.equal(runRankUp('hard'), 'rocketArtillery');
});

test('增益型主动技能只在可立即攻击时规划，且不会覆盖待消费增益', () => {
    const base = {
        canAct: true,
        activeSkillCD: 0,
        activeSkillDur: 0,
        hp: 100
    };
    assert.equal(shouldPlanActiveSkill(
        { ...base, commander: 'berserker', _berserkerQixue: false },
        { hasAttackTarget: true }
    ), true);
    assert.equal(shouldPlanActiveSkill(
        { ...base, commander: 'berserker', _berserkerQixue: false },
        { hasAttackTarget: false }
    ), false);
    assert.equal(shouldPlanActiveSkill(
        { ...base, commander: 'berserker', _berserkerQixue: true },
        { hasAttackTarget: true }
    ), false);
    assert.equal(shouldPlanActiveSkill(
        { ...base, commander: 'paladin', _faith: 1, _smiteReady: false },
        { hasAttackTarget: true }
    ), true);
    assert.equal(shouldPlanActiveSkill(
        { ...base, commander: 'paladin', _faith: 0, _smiteReady: false },
        { hasAttackTarget: true }
    ), false);
    assert.equal(shouldPlanActiveSkill(
        { ...base, commander: 'paladin', _faith: 2, _smiteReady: true },
        { hasAttackTarget: true }
    ), false);
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
