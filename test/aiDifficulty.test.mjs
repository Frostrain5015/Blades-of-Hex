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
import { getStandardMap } from '../rules/standardMaps.js';
import { createMatchState, serializeMatchState } from '../engine/matchState.js';
import { Unit, setGameStateRef, setIsNetworkGameRef } from '../js/Unit.js';
import {
    getStrategicCityDistrictProfile,
    hasMinisterYieldCooldownElapsed,
    isImmediateBacktrack,
    readStrategicObjectiveCommitment,
    scoreCommanderCarrierCandidate,
    scoreTacticalRoleMatchup,
    shouldKeepAstrologerRear,
    shouldPlanActiveSkill,
    shouldYieldMinisterCity,
    canCaptureCityByCombat,
    crossDomainDamageBonus,
    estimateSiegeDamage,
    poisonPressure,
    shouldReserveFinalSiegeBlow,
    shouldSpendBerserkerBlood
} from '../ai/doctrine.js';

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

test('困难 AI 从地图定义识别本方、敌方与中立城区，不依赖写死编号', () => {
    const crownProfile = getStrategicCityDistrictProfile(
        getStandardMap(3, 'crown-ring'),
        'player2',
        ['player1', 'player3']
    );
    assert.deepEqual([...crownProfile.myHomeDistricts].sort((a, b) => a - b), [3, 4]);
    assert.deepEqual([...crownProfile.neutralDistricts], [5]);
    assert.ok(!crownProfile.neutralDistricts.has(3));
    assert.ok(!crownProfile.neutralDistricts.has(4));

    const passageProfile = getStrategicCityDistrictProfile(
        getStandardMap(3, 'uncharted-passage'),
        'player3',
        ['player1', 'player2']
    );
    assert.deepEqual([...passageProfile.myHomeDistricts], [5]);
    assert.ok(!passageProfile.neutralDistricts.has(5));
    assert.deepEqual(
        [...passageProfile.neutralDistricts].sort((a, b) => a - b),
        [4, 6, 7, 8, 9, 10]
    );
    assert.deepEqual(
        [...passageProfile.enemyHomeDistricts].sort((a, b) => a - b),
        [1, 2]
    );
});

test('困难 AI 在短战役窗口内坚持同一目标，阶段变化或到期后重新评估', () => {
    const commitment = {
        phase: 'neutral',
        q: 6,
        r: 3,
        expiresRound: 8
    };
    assert.deepEqual(
        readStrategicObjectiveCommitment(commitment, 'neutral', 6),
        { q: 6, r: 3 }
    );
    assert.equal(readStrategicObjectiveCommitment(commitment, 'enemy', 6), null);
    assert.equal(readStrategicObjectiveCommitment(commitment, 'neutral', 9), null);
});

test('困难 AI 识别近期原路折返，但允许较旧路线重新使用', () => {
    const movementEntry = { q: -3, r: 1, round: 6 };
    const priorTile = { q: -3, r: 1 };
    assert.equal(isImmediateBacktrack(movementEntry, priorTile, 7), true);
    assert.equal(isImmediateBacktrack(movementEntry, { q: -2, r: 1 }, 7), false);
    assert.equal(isImmediateBacktrack(movementEntry, priorTile, 9), false);
});

test('无主航路优先把将领部署到高属性海军旗舰', () => {
    const makeUnit = (type, hp, attack, movementDomain = 'land', isCity = false) => ({
        type,
        hp,
        maxHp: hp,
        config: { hp, attack, movementDomain },
        tile: { q: 0, r: 0, isCity },
        getEffectiveAttack: () => attack
    });
    const passage = { familyId: 'uncharted-passage' };
    const island = { familyId: 'crown-ring' };
    const cavalry = makeUnit('cavalry', 100, 60);
    const cityInfantry = makeUnit('infantry', 180, 40, 'land', true);
    const destroyer = makeUnit('destroyer', 140, 40, 'naval');
    const warship = makeUnit('warship', 180, 55, 'naval');
    const carrier = makeUnit('carrier', 250, 45, 'naval');

    assert.ok(
        scoreCommanderCarrierCandidate(warship, 'centurion', passage)
        > scoreCommanderCarrierCandidate(cavalry, 'centurion', passage)
    );
    assert.ok(
        scoreCommanderCarrierCandidate(carrier, 'colonel', passage)
        > scoreCommanderCarrierCandidate(warship, 'colonel', passage)
    );
    assert.ok(
        scoreCommanderCarrierCandidate(warship, 'centurion', passage)
        > scoreCommanderCarrierCandidate(destroyer, 'centurion', passage)
    );
    assert.equal(
        scoreCommanderCarrierCandidate(warship, 'centurion', passage)
        - scoreCommanderCarrierCandidate(warship, 'centurion', island),
        210
    );
    assert.ok(
        scoreCommanderCarrierCandidate(cityInfantry, 'necromancer', passage)
        > scoreCommanderCarrierCandidate(warship, 'necromancer', passage)
    );
    assert.ok(
        scoreCommanderCarrierCandidate(cityInfantry, 'minister', passage)
        > scoreCommanderCarrierCandidate(carrier, 'minister', passage)
    );
});

test('后方型将领只在明确条件下离开安全位', () => {
    assert.equal(shouldYieldMinisterCity({
        gold: 20,
        hasOtherEmptyCity: true,
        cityThreatened: true,
        ownForceCount: 2
    }), false);
    assert.equal(shouldYieldMinisterCity({
        gold: 7,
        hasOtherEmptyCity: false,
        cityThreatened: true,
        ownForceCount: 2
    }), false);
    assert.equal(shouldYieldMinisterCity({
        gold: 12,
        hasOtherEmptyCity: false,
        cityThreatened: false,
        ownForceCount: 12,
        ownedCityCount: 1
    }), false);
    assert.equal(shouldYieldMinisterCity({
        gold: 12,
        hasOtherEmptyCity: false,
        cityThreatened: true,
        ownForceCount: 12,
        ownedCityCount: 1
    }), true);
    assert.equal(hasMinisterYieldCooldownElapsed(18, 18), false);
    assert.equal(hasMinisterYieldCooldownElapsed(20, 18), false);
    assert.equal(hasMinisterYieldCooldownElapsed(21, 18), true);

    assert.equal(shouldKeepAstrologerRear({
        hpRatio: 1,
        nearbyEnemyCount: 1,
        nearbyAllyCount: 4,
        forceAdvantage: 6
    }), true);
    assert.equal(shouldKeepAstrologerRear({
        hpRatio: 1,
        nearbyEnemyCount: 0,
        nearbyAllyCount: 3,
        forceAdvantage: 4,
        hasSecureForwardBase: true
    }), false);
    assert.equal(shouldKeepAstrologerRear({
        hpRatio: 0.6,
        nearbyEnemyCount: 0,
        nearbyAllyCount: 3,
        forceAdvantage: 4,
        hasSecureForwardBase: true
    }), true);
    assert.equal(shouldKeepAstrologerRear({
        hpRatio: 1,
        nearbyEnemyCount: 0,
        nearbyAllyCount: 3,
        forceAdvantage: 4,
        hasSecureForwardBase: false
    }), true);
});

test('只有突击类单位能通过战斗进驻城市', () => {
    // 远程/海军把城防打空却进不去，这条判定是夺城结算的前提。
    assert.equal(canCaptureCityByCombat({ type: 'infantry' }), true);
    assert.equal(canCaptureCityByCombat({ type: 'cavalry' }), true);
    assert.equal(canCaptureCityByCombat({ type: 'archer' }), false);
    assert.equal(canCaptureCityByCombat({ type: 'warship' }), false);
    assert.equal(canCaptureCityByCombat({ type: 'destroyer' }), false);
    assert.equal(canCaptureCityByCombat({ type: 'submarine' }), false);
    assert.equal(canCaptureCityByCombat({ type: 'carrier' }), false);
    assert.equal(canCaptureCityByCombat({ type: 'shoreBattery' }), false);
    assert.equal(canCaptureCityByCombat({ type: 'cavalry', _isDrone: true }), false);
});

test('跨域伤害修正对齐 rules/naval', () => {
    const land = { surface: 'land' };
    const sea = { surface: 'deepWater' };
    // 岸防炮对舰 +30%、对陆 −60%
    assert.equal(crossDomainDamageBonus({ type: 'shoreBattery' }, sea, { type: 'destroyer' }), 0.30);
    assert.equal(crossDomainDamageBonus({ type: 'shoreBattery' }, land, { type: 'infantry' }), -0.60);
    // 舰船打陆、陆军打舰各 −50%
    assert.equal(crossDomainDamageBonus({ type: 'warship' }, land, { type: 'infantry' }), -0.50);
    assert.equal(crossDomainDamageBonus({ type: 'archer' }, sea, { type: 'warship' }), -0.50);
    // 同域交战无修正
    assert.equal(crossDomainDamageBonus({ type: 'warship' }, sea, { type: 'submarine' }), 0);
    assert.equal(crossDomainDamageBonus({ type: 'infantry' }, land, { type: 'cavalry' }), 0);
});

test('攻城估伤含火炮 +50% 与跨域修正', () => {
    const cityTile = { surface: 'land' };
    const archer = { type: 'archer', config: { attack: 100 } };
    const infantry = { type: 'infantry', config: { attack: 100 } };
    // 炮兵攻城 ×1.5；巡洋舰 +50% 与打陆 −50% 抵消回基准
    assert.equal(estimateSiegeDamage(archer, cityTile), 150);
    assert.equal(estimateSiegeDamage(infantry, cityTile), 100);
    assert.equal(estimateSiegeDamage({ type: 'warship', config: { attack: 100 } }, cityTile), 100);
});

test('破城最后一击留给能进驻的近战单位', () => {
    // 近战一击能破 → 预留，远程不许插队
    assert.equal(shouldReserveFinalSiegeBlow(60, [80, 30]), true);
    // 近战都破不掉 → 放行远程继续磨城防
    assert.equal(shouldReserveFinalSiegeBlow(200, [80, 30]), false);
    assert.equal(shouldReserveFinalSiegeBlow(200, []), false);
    // 城防已归零 → 城市随时可进驻，不再需要攻城
    assert.equal(shouldReserveFinalSiegeBlow(0, []), true);
});

test('投毒压力按剩余跳数累计', () => {
    assert.equal(poisonPressure({ maxHp: 200, _poison: { remainingTicks: 3 } }), 90);
    assert.equal(poisonPressure({ maxHp: 200, _poison: { remainingTicks: 1 } }), 30);
    assert.equal(poisonPressure({ maxHp: 200 }), 0);
});

test('狂战士泣血只在能兑现时发动', () => {
    // 自伤 30% 当前生命换一次增伤，残血时永远不划算
    assert.equal(shouldSpendBerserkerBlood({ hpRatio: 0.30, convertsToKill: true }), false);
    // 这一击因此形成击杀 → 值得
    assert.equal(shouldSpendBerserkerBlood({ hpRatio: 0.80, convertsToKill: true }), true);
    // 只是普通目标 → 不烧血
    assert.equal(shouldSpendBerserkerBlood({ hpRatio: 0.90, convertsToKill: false }), false);
    // 高价值目标且状态健康 → 允许
    assert.equal(shouldSpendBerserkerBlood({ hpRatio: 0.90, highValueTarget: true }), true);
    // 高价值但兵力劣势 → 保命优先
    assert.equal(shouldSpendBerserkerBlood({ hpRatio: 0.90, highValueTarget: true, outnumbered: true }), false);
});
