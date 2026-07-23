// AI 调度器 — 加载人格文件，管理执行与延迟
// 支持多 AI 人格：Claude（中立防御型）、Grok（玩家对手进攻型）

import { gameState, clearselection, notify, logMessage } from './state.js';
import {
    getMovableTiles, getAttackableTiles, moveUnit, attackUnit, attackCityTile, recruitUnit, reinforceUnit,
    executeTacticalCard, executeEngineerTrench, executeEngineerFlak, executeEngineerBunkerConstruction,
    executeFieldConstruction, executeAirfieldConstruction, executeFieldRepair, executeAirCommand,
    recalcAllFlankingMorale, drawCard, recordAuxiliaryAction
} from './gameLogic.js';
import { HEX_NEIGHBORS, hexDistance, UNIT_CONFIG, TACTICAL_CARD_CONFIG, CARD_SYSTEM_CONFIG, COLONEL_CARD_GOLD, FORTIFICATION_CONFIG } from './config.js';
import { ENGINEER_BUNKER_GOLD_COST } from '../commander/engineer.js';
import { isNetworkGame } from './network.js';
import { getCommander } from './commanderInterface.js';
import { spawnCommanderSkillEffect } from './effects.js';
import { updateFogOfWar, updateAllFogOfWar, isTileVisible } from './fogOfWar.js';
// 人格脚本位于可见目录 ai/（勿用隐藏目录：静态白名单、资源清单与部署工具都会跳过点开头路径）
import * as claudePersonality from '../ai/claude.js';
import * as grokPersonality from '../ai/grok.js';
import { canAttack, isHostile } from '../rules/diplomacy.js';
import { campToKey } from '../rules/camps.js';
import { prioritizeNavalRecruitment } from '../rules/aiRecruitment.js';
import { areCommanderMechanicsSuppressed } from '../rules/movement.js';
import { canRecruitTypeAtSelectedSite } from './recruitmentUi.js';
import { chooseDefaultSpecialization } from '../rules/units.js';
import { canBuildFieldFortification, canFieldRepair, isOrdinaryGroundBuilder } from '../rules/construction.js';
import { AIR_COMMAND_CONFIG, getAirCommandAvailability, getAirCommandRange } from '../rules/airCommands.js';
import { isSubmarineTargetableBy } from '../rules/naval.js';
import { getStandardMap } from '../rules/standardMaps.js';
import { shouldHoldNeutralCarrierPosition } from '../rules/standardMapEvents.js';
import { resolveAiDifficultyProfile } from '../ai/difficulty.js';
import { getRoundIndex } from '../rules/turns.js';

const AI_DELAY = 1500;
const ACTION_TIMEOUT = 8000; // 单次行动超时：8秒

// 自动化对局复用与浏览器完全相同的 AI 执行链，只关闭展示等待并挂接观测器。
// 默认值保持现有游戏体验不变；调用方应使用返回的 restore 函数恢复现场。
let _runtimeOptions = {
    delayScale: 1,
    actionTimeoutMs: ACTION_TIMEOUT,
    onAction: null
};
let _observedActionSequence = 0;

export function configureAiRuntime(options = {}) {
    const previous = { ..._runtimeOptions };
    _runtimeOptions = {
        delayScale: Number.isFinite(options.delayScale) ? Math.max(0, options.delayScale) : previous.delayScale,
        actionTimeoutMs: Number.isFinite(options.actionTimeoutMs)
            ? Math.max(1, options.actionTimeoutMs)
            : previous.actionTimeoutMs,
        onAction: typeof options.onAction === 'function' ? options.onAction : null
    };
    return () => { _runtimeOptions = previous; };
}

function delay(ms) {
    const scaled = Math.max(0, Math.round(ms * _runtimeOptions.delayScale));
    return scaled > 0 ? new Promise(r => setTimeout(r, scaled)) : Promise.resolve();
}

function notifyActionObserver(event) {
    if (!_runtimeOptions.onAction) return;
    try {
        _runtimeOptions.onAction({ ...event, gameState });
    } catch (error) {
        console.warn('AI action observer failed:', error);
    }
}

async function runObservedAction(action, aiCamp, operation) {
    const sequence = ++_observedActionSequence;
    const campKey = campToKey(aiCamp);
    notifyActionObserver({ phase: 'before', sequence, campKey, action });
    let status = 'executed';
    let error = null;
    try {
        const result = await operation();
        if (result === false) status = 'skipped';
        return result;
    } catch (caught) {
        status = 'error';
        error = caught;
        throw caught;
    } finally {
        notifyActionObserver({
            phase: 'after', sequence, campKey, action, status,
            error: error ? String(error?.stack || error?.message || error) : null
        });
    }
}

function withTimeout(promise, ms, label) {
    return Promise.race([
        promise,
        new Promise((_, reject) => setTimeout(() => reject(new Error(`AI_ACTION_TIMEOUT: ${label}`)), ms))
    ]);
}

function resolveUnit(id) {
    for (const tile of gameState.tiles) {
        if (tile.unit && tile.unit.id === id) return tile.unit;
    }
    return null;
}

function resolveTile(q, r) {
    return gameState.tileMap.get(`${q},${r}`);
}

async function runV2Infrastructure(aiCamp, difficultyProfile = resolveAiDifficultyProfile(gameState, aiCamp)) {
    const campKey = campToKey(aiCamp);
    for (const tile of gameState.tiles) {
        const unit = tile.unit;
        if (!unit || unit.camp !== aiCamp || !unit.pendingSpecialization) continue;
        const choice = chooseDefaultSpecialization(unit, gameState, {
            intelligence: difficultyProfile.id
        });
        if (choice) {
            await runObservedAction({ type: 'chooseSpecialization', unitId: unit.id, specializationKey: choice }, aiCamp, () => {
                if (!unit.chooseSpecialization(choice)) return false;
                logMessage(`${aiCamp.name}${unit.config.name}选择了专精`);
                recordAuxiliaryAction('chooseSpecialization', {
                    unitId: unit.id,
                    type: unit.type,
                    rank: unit._rank,
                    specializationKey: choice
                }, aiCamp);
                return true;
            });
        }
    }

    const engineer = difficultyProfile.infrastructureLevel > 0
        ? gameState.tiles.find(tile => tile.unit?.camp === aiCamp
            && tile.unit.commander === 'engineer' && tile.unit.canAct)?.unit
        : null;
    if (engineer) {
        const repairTarget = gameState.tiles
            .map(tile => tile.unit)
            .find(unit => unit && canFieldRepair(engineer, unit, gameState));
        if (repairTarget && (gameState.playerGold[campKey] || 0) >= 3) {
            await runObservedAction({ type: 'fieldRepair', unitId: engineer.id, targetId: repairTarget.id }, aiCamp, () => {
                executeFieldRepair(engineer, repairTarget);
            });
            await delay(AI_DELAY * 0.4);
        }
    }

    // AI 与玩家共用同一信息权限：迷雾下只评估可见地块，潜航潜艇不可作为目标。
    const fogSafeTile = tile => !gameState.skirmishFog || isTileVisible(tile, aiCamp, gameState);
    for (const city of difficultyProfile.infrastructureLevel > 0
        ? gameState.tiles.filter(tile => tile.isCity && tile.camp === aiCamp && tile.installation?.status === 'ready')
        : []) {
        const enemies = gameState.tiles.filter(tile => tile.unit && isHostile(gameState, aiCamp, tile.unit.camp)
            && hexDistance(city, tile) <= getAirCommandRange(city)
            && fogSafeTile(tile)
            && (tile.unit.type !== 'submarine' || isSubmarineTargetableBy(tile.unit, aiCamp, gameState)));
        const bombing = getAirCommandAvailability('bombing', city, gameState);
        let bombingTarget = null;
        let bombingScore = 0;
        for (const tile of gameState.tiles) {
            if (hexDistance(city, tile) > getAirCommandRange(city) || !fogSafeTile(tile)) continue;
            const score = [tile, ...HEX_NEIGHBORS.map(([dq, dr]) => resolveTile(tile.q + dq, tile.r + dr)).filter(Boolean)]
                .filter(candidate => candidate.unit && isHostile(gameState, aiCamp, candidate.unit.camp) && fogSafeTile(candidate)).length
                + (tile.isCity && tile.camp !== aiCamp ? 1 : 0);
            if (score > bombingScore) { bombingScore = score; bombingTarget = tile; }
        }
        if (bombing.available && bombingTarget && bombingScore >= 3) {
            await runObservedAction({ type: 'airCommand', airKind: 'bombing', tileQ: city.q, tileR: city.r, targetQ: bombingTarget.q, targetR: bombingTarget.r }, aiCamp, () => {
                executeAirCommand('bombing', city, bombingTarget);
            });
            await delay(AI_DELAY * 0.5);
            continue;
        }
        const strafe = getAirCommandAvailability('strafe', city, gameState);
        if (strafe.available && enemies.length) {
            enemies.sort((a, b) => (a.unit.hp / a.unit.maxHp) - (b.unit.hp / b.unit.maxHp));
            await runObservedAction({ type: 'airCommand', airKind: 'strafe', tileQ: city.q, tileR: city.r, targetId: enemies[0].unit?.id, targetQ: enemies[0].q, targetR: enemies[0].r }, aiCamp, () => {
                executeAirCommand('strafe', city, enemies[0]);
            });
            await delay(AI_DELAY * 0.5);
            continue;
        }
        const recon = getAirCommandAvailability('recon', city, gameState);
        if (recon.available) {
            const unexplored = gameState.tiles.find(tile => hexDistance(city, tile) <= getAirCommandRange(city)
                && !gameState.exploredTiles?.[campKey]?.has?.(`${tile.q},${tile.r}`));
            if (unexplored) {
                await runObservedAction({ type: 'airCommand', airKind: 'recon', tileQ: city.q, tileR: city.r, targetQ: unexplored.q, targetR: unexplored.r }, aiCamp, () => {
                    executeAirCommand('recon', city, unexplored);
                });
            }
        }
    }

    const ownedCities = gameState.tiles.filter(tile => tile.isCity && tile.camp === aiCamp);
    if (ownedCities.length && !ownedCities.some(tile => tile.installation)) {
        const candidate = ownedCities.find(tile => !tile.installation);
        const airfieldReserve = difficultyProfile.infrastructureLevel >= 2 ? 18 : 24;
        if (difficultyProfile.infrastructureLevel > 0
            && candidate && (gameState.playerGold[campKey] || 0) >= airfieldReserve) {
            await runObservedAction({ type: 'buildAirfield', tileQ: candidate.q, tileR: candidate.r }, aiCamp, () => {
                executeAirfieldConstruction(candidate);
            });
        }
    }

    // 敌方存在可见空袭平台（航母/无人机/已建成机场）时优先高射机枪，否则战壕。
    const hostileAir = gameState.tiles.some(tile => fogSafeTile(tile)
        && ((tile.unit && isHostile(gameState, aiCamp, tile.unit.camp) && (tile.unit.type === 'carrier' || tile.unit._isDrone))
            || (tile.isCity && isHostile(gameState, aiCamp, tile.camp) && tile.installation?.status === 'ready')));
    // 只在战略位置（城市/村庄）或敌军兵临 2 格内时修工事，并保留基础金币，避免每回合白耗单位行动。
    const fortificationKind = hostileAir ? 'flak' : 'trench';
    gameState._aiFortificationsBuilt ||= {};
    const fortificationsBuilt = gameState._aiFortificationsBuilt[campKey] || 0;
    const builder = difficultyProfile.infrastructureLevel >= 2
        && fortificationsBuilt < 2
        && (gameState.playerGold[campKey] || 0) >= 6
        ? gameState.tiles.map(tile => tile.unit).find(unit => unit?.camp === aiCamp
            && unit.canAct && !unit.isNewRecruit && isOrdinaryGroundBuilder(unit)
            && (unit.tile.isCity || unit.tile.isVillage)
            && gameState.tiles.some(tile => tile.unit && isHostile(gameState, aiCamp, tile.unit.camp)
                && fogSafeTile(tile)
                && hexDistance(unit.tile, tile) <= (unit.tile.isCity ? 3 : 2))
            && canBuildFieldFortification(unit, fortificationKind, gameState))
        : null;
    if (builder) {
        await runObservedAction({ type: 'buildFortification', unitId: builder.id, fortificationKind }, aiCamp, () => {
            executeFieldConstruction(builder, fortificationKind);
        });
        gameState._aiFortificationsBuilt[campKey] = fortificationsBuilt + 1;
    }
}

function planEngineerAction(aiCamp) {
    const campKey = campToKey(aiCamp);
    const engineer = gameState.tiles.reduce((found, tile) => found || (
        tile.unit && tile.unit.commander === 'engineer' && !areCommanderMechanicsSuppressed(tile.unit) && tile.unit.camp === aiCamp && tile.unit.canAct && !tile.unit._engineerConstruction
            ? tile.unit : null
    ), null);
    if (!engineer || !engineer.tile) return null;

    const hostileTiles = gameState.tiles.filter(tile => tile.unit && isHostile(gameState, aiCamp, tile.unit.camp));
    const isThreatened = hostileTiles.some(tile => hexDistance(engineer.tile, tile) <= 2);
    if (!engineer.tile.fortification && (engineer.tile.isCity || engineer.tile.isVillage || isThreatened)) {
        // 附近以远程/空军威胁为主 → 架高射机枪；否则挖战壕（定向选择）
        const rangedThreatNearby = hostileTiles.some(tile =>
            hexDistance(engineer.tile, tile) <= 2
            && (tile.unit.type === 'archer' || tile.unit.type === 'mgNest' || tile.unit._isDrone));
        const airThreatOnBoard = hostileTiles.some(tile => tile.unit.commander === 'colonel' || tile.unit._isDrone);
        if (rangedThreatNearby || airThreatOnBoard) {
            return { type: 'engineerFlak', unitId: engineer.id };
        }
        return { type: 'engineerTrench', unitId: engineer.id };
    }

    if ((engineer._engineerBunkerCD || 0) > 0) return null;
    if ((gameState.playerGold[campKey] || 0) < ENGINEER_BUNKER_GOLD_COST || hostileTiles.length === 0) return null;
    const candidates = gameState.tiles.filter(tile =>
        !tile.unit && !tile.isCity && !tile.isVillage
        && hexDistance(engineer.tile, tile) <= 1
        && (!gameState.skirmishFog || isTileVisible(tile, aiCamp, gameState))
    );
    if (candidates.length === 0) return null;

    candidates.sort((left, right) => {
        const leftDistance = Math.min(...hostileTiles.map(hostile => hexDistance(left, hostile)));
        const rightDistance = Math.min(...hostileTiles.map(hostile => hexDistance(right, hostile)));
        return leftDistance - rightDistance;
    });
    const target = candidates[0];
    return { type: 'engineerBunker', unitId: engineer.id, tileQ: target.q, tileR: target.r };
}

// 创建 helpers（每次执行时刷新 weather 等动态值）
function makeHelpers(aiCamp, difficultyProfile = resolveAiDifficultyProfile(gameState, aiCamp)) {
    return {
        getMovableTiles,
        getAttackableTiles,
        hexDistance,
        HEX_NEIGHBORS,
        CAMP: gameState.factions,
        UNIT_CONFIG,
        weather: gameState.weather,
        isHostileFaction: (left, right) => isHostile(gameState, left, right),
        recruitTypesForCity: (city, baseTypes) => difficultyProfile.counterRecruitment
            ? prioritizeNavalRecruitment(
                city,
                baseTypes,
                gameState.tiles,
                aiCamp,
                (left, right) => isHostile(gameState, left, right)
            )
            : baseTypes,
        isTileVisible: (tile, camp) => isTileVisible(tile, camp, gameState),
        CARD_SYSTEM_CONFIG,
        COLONEL_CARD_GOLD
    };
}

async function deployAvailableCommanders(aiCamp) {
    const prefix = campToKey(aiCamp) === 'player1' ? 'commanderP1' : campToKey(aiCamp) === 'player2' ? 'commanderP2' : 'commanderP3';
    const commanders = [
        { commanderId: gameState[prefix], deployedKey: `${prefix}Deployed` },
        { commanderId: gameState[`${prefix}Secondary`], deployedKey: `${prefix}SecondaryDeployed` }
    ].filter(({ commanderId, deployedKey }) => commanderId && !gameState[deployedKey]);
    const availableUnits = gameState.tiles
        .map(tile => tile.unit)
        .filter(unit => unit && unit.camp === aiCamp && !(unit.isCommanderUnit ?? Boolean(unit.commander)) && unit.tile && unit.hp > 0)
        .sort((left, right) => right.getEffectiveAttack() - left.getEffectiveAttack());

    for (let i = 0; i < commanders.length && i < availableUnits.length; i++) {
        await executeAction({ type: 'deployCommander', unitId: availableUnits[i].id, commanderId: commanders[i].commanderId }, aiCamp);
    }
}

async function executeAction(action, aiCamp) {
    if (gameState.gameOver) return false;
    if (!gameState.aiActing || gameState.currentCamp !== aiCamp) return false;

    const label = `${action.type}${action.unitId ? ' ' + action.unitId : ''}`;
    try {
        return await runObservedAction(action, aiCamp, () => withTimeout(
            _executeActionInner(action, aiCamp),
            _runtimeOptions.actionTimeoutMs,
            label
        ));
    } catch (e) {
        if (e && e.message && e.message.startsWith('AI_ACTION_TIMEOUT')) {
            console.warn(`AI action timed out: ${label}`);
        } else {
            console.warn(`AI action failed: ${label}`, e);
        }
        return false;
    } finally {
        clearselection();
        gameState.selectedCityTile = null;
    }
}

async function _executeActionInner(action, aiCamp) {
    if (gameState.gameOver) return false;

    const isNeutral = campToKey(aiCamp) === 'neutral';
    const campKey = campToKey(aiCamp);

    // 自动攻击辅助：从可攻击目标中选最优，返回是否执行了攻击
    async function _autoAttack(unit) {
        if (!unit.canAct || !unit.tile || unit.hp <= 0) return false;
        const atkTiles = getAttackableTiles(unit);
        let targets;
        if (isNeutral) {
            const MY_DISTRICTS = new Set([3, 4, 5]);
            targets = atkTiles.filter(t => t.unit && isHostile(gameState, aiCamp, t.unit.camp) && MY_DISTRICTS.has(t.districtId));
            if (targets.length === 0) {
                targets = atkTiles.filter(t => t.unit && isHostile(gameState, aiCamp, t.unit.camp));
            }
        } else {
            targets = atkTiles.filter(t => t.unit && isHostile(gameState, aiCamp, t.unit.camp));
        }
        if (targets.length === 0) return false;

        const COUNTER = {
            infantry: { archer: 0.75, cavalry: 1.25, mgNest: 0.75, drone: 1 },
            archer: { cavalry: 0.75, infantry: 1.25, mgNest: 1.25, drone: 1 },
            cavalry: { infantry: 0.75, archer: 1.25, mgNest: 0.75, drone: 1 },
            mgNest: { infantry: 1.25, archer: 0.75, cavalry: 1.25, drone: 1 },
            drone: { infantry: 1.25, archer: 1, cavalry: 1, mgNest: 1, drone: 1 }
        };
        // 数值对齐 rules/：地形防御 forest/mountain 均 0.05，步兵守城 +0.10（雨天再 +0.10），克制 ±0.20，士气浮动 ±7.5%
        const TERRAIN_DEF = { plains: 0, forest: 0.05, mountain: 0.05 };
        let best = targets[0];
        let bestScore = -Infinity;
        for (const t of targets) {
            const target = t.unit;
            const c = (COUNTER[unit.type] && COUNTER[unit.type][target.type]) || 1;
            const tDef = (TERRAIN_DEF[target.tile.terrain] || 0)
                + (FORTIFICATION_CONFIG[target.tile.fortification]?.defenseBonus || 0);
            const cityDef = (target.type === 'infantry' && (target.tile.isCity || target.tile.isUrban))
                ? (gameState.weather === 'rain' ? 0.20 : 0.10) : 0;
            const unitDef = target.config.defense || 0;
            // 士气攻击加成已含在 getEffectiveAttack 内，不再单独估算
            const counterFloat = c > 1 ? 1.20 : c < 1 ? 0.80 : 1.0;
            const estDmg = unit.getEffectiveAttack() * counterFloat * Math.max(0.3, 1 - tDef - cityDef - unitDef);
            let score = 0;
            if (estDmg >= target.hp + (target._shield || 0)) score += 200;
            score += (1 - target.hp / target.maxHp) * 60;
            if (c > 1) score += 30;
            if (target.hp <= 25) score += 40;
            if (score > bestScore) { bestScore = score; best = t; }
        }
        await delay(AI_DELAY);
        gameState.attackableTiles = atkTiles;
        attackUnit(unit, best.unit);
        return true;
    }

    switch (action.type) {
        case 'attack': {
            const unit = resolveUnit(action.unitId);
            const target = resolveUnit(action.targetId);
            if (!unit || !target || !unit.canAct || !unit.tile || !target.tile) return;
            const aiAtkTiles = getAttackableTiles(unit);
            if (aiAtkTiles.includes(target.tile)) {
                await delay(AI_DELAY);
                gameState.attackableTiles = aiAtkTiles;
                attackUnit(unit, target);
                // 百夫长乘胜 / 击杀后再行动：循环追击直到无法行动（最多3次防死循环）
                for (let chain = 0; chain < 3 && unit.canAct && unit.tile && unit.hp > 0; chain++) {
                    if (!(await _autoAttack(unit))) break;
                }
            }
            break;
        }
        case 'siegeCityAttack': {
            const unit = resolveUnit(action.unitId);
            const targetTile = resolveTile(action.tileQ, action.tileR);
            if (!unit || !targetTile || !unit.canAct || !unit.tile || targetTile.unit) return;
            const aiSiegeTiles = getAttackableTiles(unit);
            if (aiSiegeTiles.includes(targetTile)) {
                await delay(AI_DELAY);
                gameState.attackableTiles = aiSiegeTiles;
                attackCityTile(unit, targetTile);
            }
            break;
        }
        case 'move': {
            const unit = resolveUnit(action.unitId);
            const targetTile = resolveTile(action.tileQ, action.tileR);
            if (!unit || !targetTile || !unit.canAct || !unit.tile || targetTile.unit) return;
            const standardMap = getStandardMap(gameState.isThreePlayer ? 3 : 2, gameState.standardMapId);
            if (shouldHoldNeutralCarrierPosition(unit, aiCamp, standardMap)) return;
            const aiMoveTiles = getMovableTiles(unit);
            if (aiMoveTiles.includes(targetTile)) {
                await delay(AI_DELAY);
                gameState.movableTiles = aiMoveTiles;
                moveUnit(unit, targetTile);
                // 移动后尝试自动攻击
                if (unit.canAct && unit.tile && unit.hp > 0) {
                    await _autoAttack(unit);
                    // 百夫长乘胜：攻击后再追击
                    for (let chain = 0; chain < 2 && unit.canAct && unit.tile && unit.hp > 0; chain++) {
                        if (!(await _autoAttack(unit))) break;
                    }
                }
            }
            break;
        }
        case 'recruit': {
            const cityTile = resolveTile(action.tileQ, action.tileR);
            if (!cityTile || !canRecruitTypeAtSelectedSite(action.unitType, cityTile, gameState, aiCamp)) return;
            const gold = gameState.playerGold[campKey];
            if (gold < UNIT_CONFIG[action.unitType].cost) return;
            gameState.selectedCityTile = cityTile;
            await delay(AI_DELAY);
            recruitUnit(action.unitType);
            break;
        }
        case 'reinforce': {
            const unit = resolveUnit(action.unitId);
            if (!unit || !unit.tile || unit.hp >= unit.maxHp) return;
            if (!unit.tile.isCity && !unit.tile.isVillage) return;
            if (unit.tile._reinforcedThisTurn) return;
            await delay(AI_DELAY * 0.5);
            reinforceUnit(unit);
            break;
        }
        case 'deployCommander': {
            const unit = resolveUnit(action.unitId);
            if (!unit || !unit.tile || (unit.isCommanderUnit ?? Boolean(unit.commander))) return;
            const myCamp = aiCamp;
            const prefix = campToKey(myCamp) === 'player1' ? 'commanderP1' : campToKey(myCamp) === 'player2' ? 'commanderP2' : 'commanderP3';
            const cmdKey = action.commanderId || gameState[prefix];
            if (!cmdKey) return;
            // 与玩家一致：走【部署将领】对策卡完整流程（校验/消耗/用卡计数/烧牌动画），
            // 不再绕过流程直接赋值。手牌中无对应部署卡（异常状态）时放弃而不是强挂。
            const hand = gameState.playerHands[campKey] || [];
            const hasDeployCard = hand.some(c => c === 'commanderDeploy'
                || (typeof c === 'object' && c.id === 'commanderDeploy' && (!c.commanderId || c.commanderId === cmdKey)));
            if (!hasDeployCard) {
                console.warn(`AI 部署将领失败：${campKey} 手牌中没有【部署将领】（${cmdKey}）`);
                return;
            }
            await delay(AI_DELAY * 0.5);
            gameState.currentCamp = aiCamp;
            try {
                executeTacticalCard('commanderDeploy', unit.tile);
            } finally {
                gameState.currentCamp = aiCamp;
            }
            await delay(AI_DELAY);
            break;
        }
        case 'activateSkill': {
            const unit = resolveUnit(action.unitId);
            if (!unit || !unit.tile || !unit.commander || areCommanderMechanicsSuppressed(unit) || !unit.canAct) return;
            const cmdCfg = getCommander(unit.commander);
            if (!cmdCfg || !cmdCfg.activeSkill) return;
            if (unit.activeSkillCD > 0 || unit.activeSkillDur > 0) return;
            const skill = cmdCfg.activeSkill;
            skill.onActivate(unit, {
                gameState, logMessage, spawnFx: spawnCommanderSkillEffect
            });
            if (unit.commander === 'astrologer') {
                const targetWeather = ['clear', 'rain', 'fog', 'wind'].includes(action.targetWeather)
                    ? action.targetWeather
                    : 'clear';
                gameState.weather = targetWeather;
                gameState._starlightResume = true;
                gameState.weatherLockUntil = getRoundIndex(gameState) + Math.max(1, Number(skill.duration || 2));
                unit._pendingWeatherChoice = false;
                updateAllFogOfWar(gameState);
                logMessage(`占星者【星移】：AI 将天气强制为${targetWeather}并锁定${skill.duration}回合`);
            }
            unit.activeSkillDur = skill.duration;
            unit.activeSkillCD = skill.cooldown;
            recalcAllFlankingMorale();
            logMessage(`${aiCamp.name} AI【${cmdCfg.name}】激活主动技能【${skill.name}】`);
            spawnCommanderSkillEffect(unit.tile.x, unit.tile.y);
            recordAuxiliaryAction('activateSkill', {
                unitId: unit.id,
                commanderId: unit.commander,
                skillName: skill.name
            }, aiCamp);
            await delay(AI_DELAY);
            break;
        }
        case 'engineerTrench': {
            const unit = resolveUnit(action.unitId);
            if (!unit || unit.commander !== 'engineer' || !unit.canAct) return;
            executeEngineerTrench(unit);
            await delay(AI_DELAY);
            break;
        }
        case 'engineerFlak': {
            const unit = resolveUnit(action.unitId);
            if (!unit || unit.commander !== 'engineer' || !unit.canAct) return;
            executeEngineerFlak(unit);
            await delay(AI_DELAY);
            break;
        }
        case 'engineerBunker': {
            const unit = resolveUnit(action.unitId);
            const targetTile = resolveTile(action.tileQ, action.tileR);
            if (!unit || !targetTile || unit.commander !== 'engineer' || !unit.canAct) return;
            executeEngineerBunkerConstruction(unit, targetTile);
            await delay(AI_DELAY);
            break;
        }
        case 'drawCard': {
            if (gameState.playerGold[campKey] < CARD_SYSTEM_CONFIG.drawCost) return;
            if (gameState.playerDrawsThisTurn[campKey] >= CARD_SYSTEM_CONFIG.maxDrawsPerTurn) return;
            if (gameState.playerHands[campKey].length >= CARD_SYSTEM_CONFIG.maxHandSize) return;
            gameState.currentCamp = aiCamp;
            try { drawCard(aiCamp); } finally { gameState.currentCamp = aiCamp; }
            await delay(AI_DELAY * 0.5);
            break;
        }
        case 'tacticalCard': {
            const targetUnit = resolveUnit(action.targetId);
            const targetTile = targetUnit?.tile || gameState.tiles.find(tile => tile.id === action.targetId);
            if (!targetTile) return;
            const cardId = action.cardId;
            if (!cardId) return;
            const hand = gameState.playerHands[campKey] || [];
            if (!hand.some(c => c === cardId || (typeof c === 'object' && c.id === cardId))) return;
            if (gameState.playerUsesThisTurn[campKey] >= CARD_SYSTEM_CONFIG.maxUsesPerTurn) return;
            gameState.currentCamp = aiCamp;
            try {
                executeTacticalCard(cardId, targetTile);
            } finally {
                gameState.currentCamp = aiCamp;
            }
            await delay(AI_DELAY);
            break;
        }
    }
    return true;
}

// ═══════════════════════════════════════════
// 中立 AI 回合（Claude 防御型人格）
// ═══════════════════════════════════════════

export async function processNeutralTurn() {
    if (gameState.gameOver) return;

    gameState.aiActing = true;
    const aiCamp = gameState.factions.neutral;
    // 遭遇战迷雾：AI 也需要更新视野
    if (gameState.skirmishFog) updateFogOfWar(gameState, aiCamp);
    try {

        await runV2Infrastructure(aiCamp);

        const helpers = makeHelpers(aiCamp);
        const actions = claudePersonality.planActions(gameState, helpers);

        // 回合首次行动前延迟 2s
        if (actions.length > 0) { await delay(AI_DELAY); }

        for (let i = 0; i < actions.length; i++) {
            if (gameState.gameOver || gameState.currentCamp !== aiCamp || !gameState.aiActing) break;
            await executeAction(actions[i], aiCamp);
        }

        // 最终兜底：补满所有空城，强制步兵驻守
        const MY_DISTRICTS = new Set([3, 4, 5]);
        const emptyCities = gameState.tiles.filter(t =>
            t.isCity && !t.unit &&
            MY_DISTRICTS.has(t.districtId) &&
            t.camp === aiCamp
        );
        for (const city of emptyCities) {
            if (gameState.gameOver || gameState.currentCamp !== aiCamp || !gameState.aiActing) break;
            const unitType = helpers.recruitTypesForCity(city, ['infantry'])
                .find(type => gameState.playerGold.neutral >= UNIT_CONFIG[type].cost);
            if (unitType) {
                await executeAction({ type: 'recruit', unitType, tileQ: city.q, tileR: city.r }, aiCamp);
            }
        }
    } finally {
        gameState.aiActing = false;
    }
}

// ═══════════════════════════════════════════
// 对手 AI 回合（Grok 进攻型人格）
// ═══════════════════════════════════════════

export async function processOpponentTurn(aiCamp) {
    if (gameState.gameOver) return;
    if (campToKey(aiCamp) === 'neutral') return; // 中立用 Claude

    gameState.aiActing = true;
    const difficultyProfile = resolveAiDifficultyProfile(gameState, aiCamp);
    // 遭遇战迷雾：AI 也需要更新视野
    if (gameState.skirmishFog) {
        updateFogOfWar(gameState, aiCamp);
    }
    try {

        await runV2Infrastructure(aiCamp, difficultyProfile);

        // 单将领与双将领模式都应在 AI 规划行动前优先挂将；此前这一入口被误限在
        // doubleCommanderMode，导致普通 PVE 虽已给 AI 选将，却整局不部署。
        await deployAvailableCommanders(aiCamp);

        const helpers = makeHelpers(aiCamp, difficultyProfile);
        const actions = grokPersonality.planActions(gameState, helpers, aiCamp, difficultyProfile);

        // 回合首次行动前延迟 2s
        if (actions.length > 0) { await delay(AI_DELAY); }

        for (let i = 0; i < actions.length; i++) {
            if (gameState.gameOver || gameState.currentCamp !== aiCamp || !gameState.aiActing) break;
            await executeAction(actions[i], aiCamp);
        }

        // 最终兜底：补满己方所有空城
        const emptyCities = gameState.tiles.filter(t =>
            t.isCity && !t.unit && t.camp === aiCamp
        );
        const emptyPorts = gameState.tiles.filter(t => t.isPort && !t.unit && t.camp === aiCamp);
        const campKey = campToKey(aiCamp);
        for (const city of emptyCities.slice(0, difficultyProfile.fallbackRecruitLimit)) {
            if (gameState.gameOver || gameState.currentCamp !== aiCamp || !gameState.aiActing) break;
            const unitType = helpers.recruitTypesForCity(city, ['infantry'])
                .find(type => gameState.playerGold[campKey] >= UNIT_CONFIG[type].cost);
            if (unitType) {
                await executeAction({ type: 'recruit', unitType, tileQ: city.q, tileR: city.r }, aiCamp);
            }
        }
        for (const port of emptyPorts) {
            if (gameState.gameOver || gameState.currentCamp !== aiCamp || !gameState.aiActing) break;
            const hostileTypes = new Set(gameState.tiles
                .map(tile => tile.unit)
                .filter(unit => unit && isHostile(gameState, aiCamp, unit.camp))
                .map(unit => unit.type));
            const navalOrder = hostileTypes.has('submarine')
                ? ['destroyer', 'submarine', 'warship']
                : hostileTypes.has('warship')
                    ? ['submarine', 'destroyer', 'warship']
                    : hostileTypes.has('destroyer')
                        ? ['warship', 'destroyer', 'submarine']
                        : ['destroyer', 'submarine', 'warship'];
            const unitType = navalOrder.find(type => gameState.playerGold[campKey] >= UNIT_CONFIG[type].cost
                && canRecruitTypeAtSelectedSite(type, port, gameState, aiCamp));
            if (unitType) {
                await executeAction({ type: 'recruit', unitType, tileQ: port.q, tileR: port.r }, aiCamp);
            }
        }
    } finally {
        gameState.aiActing = false;
    }
}

// ═══════════════════════════════════════════
// AI 将领自动选择（PVE 模式用）
// ═══════════════════════════════════════════

export function aiSelectCommander(pool) {
    return grokPersonality.selectCommander(pool);
}

export function aiSelectCommanderPair(pool) {
    return grokPersonality.selectCommanderPair(pool);
}
