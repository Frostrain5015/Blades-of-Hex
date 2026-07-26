// AI 调度器 — 加载人格文件，管理执行与延迟
// 玩家侧人格按难度分档：Optio(Basic) / Legatus(Pro) / Imperator(Max)；中立方为 Corporal。

import { gameState, clearselection, notify, logMessage } from './state.js';
import {
    getMovableTiles, getAttackableTiles, moveUnit, attackUnit, attackCityTile, recruitUnit, reinforceUnit,
    executeTacticalCard, executeEngineerTrench, executeEngineerFlak, executeEngineerBunkerConstruction,
    executeDroneDeploy, executeDroneSuicide,
    executeFieldConstruction, executeAirfieldConstruction, executeFieldRepair, executeAirCommand,
    recalcAllFlankingMorale, drawCard, recordAuxiliaryAction
} from './gameLogic.js';
import { HEX_NEIGHBORS, hexDistance, UNIT_CONFIG, TACTICAL_CARD_CONFIG, CARD_SYSTEM_CONFIG, COLONEL_CARD_GOLD, FORTIFICATION_CONFIG } from './config.js';
import { ENGINEER_BUNKER_GOLD_COST } from '../commander/engineer.js';
import { hasSameTypeBuildingWithin } from '../rules/construction.js';
import { isNetworkGame } from './network.js';
import { getCommander } from './commanderInterface.js';
import { spawnCommanderSkillEffect } from './effects.js';
import { updateFogOfWar, updateAllFogOfWar, isTileVisible } from './fogOfWar.js';
// 人格脚本位于可见目录 ai/（勿用隐藏目录：静态白名单、资源清单与部署工具都会跳过点开头路径）
// 中立守备队人格。它与玩家侧三档不是同一条尺度：目标是守住阵地而不是赢下战争。
import * as corporalPersonality from '../ai/corporal.js';
// 三个玩家侧人格按难度分档，各自是独立的规划器而不是同一份代码的开关组合。
// 共享的只有 ai/doctrine.js 里的规则事实（克制表、跨域伤害、占城资格……）。
import * as optioPersonality from '../ai/optio.js';
import * as legatusPersonality from '../ai/legatus.js';
import * as imperatorPersonality from '../ai/imperator.js';
import { canCaptureCityByCombat, scoreCommanderCarrierCandidate } from '../ai/doctrine.js';
import {
    estimateAiTurnWatchdogMs,
    getEmergencyRecruitReserve,
    shouldSkipReplannedMovement
} from '../ai/strategy.js';

const PERSONALITY_BY_DIFFICULTY = Object.freeze({
    easy: optioPersonality,
    medium: legatusPersonality,
    hard: imperatorPersonality
});

/** 按难度档解析玩家侧人格脚本；未知档位退回入门档。 */
export function resolveAiPersonality(difficultyProfile) {
    return PERSONALITY_BY_DIFFICULTY[difficultyProfile?.id] || optioPersonality;
}
import { canAttack, isHostile } from '../rules/diplomacy.js';
import { campToKey } from '../rules/camps.js';
import { prioritizeNavalRecruitment } from '../rules/aiRecruitment.js';
import { areCommanderMechanicsSuppressed } from '../rules/movement.js';
import { canRecruitTypeAtSelectedSite } from './recruitmentUi.js';
import { chooseDefaultSpecialization } from '../rules/units.js';
import {
    canBuildFieldFortification,
    canFieldRepair,
    constructionCost,
    isOrdinaryGroundBuilder
} from '../rules/construction.js';
import { AIR_COMMAND_CONFIG, getAirCommandAvailability, getAirCommandRange } from '../rules/airCommands.js';
import { isSubmarineTargetableBy } from '../rules/naval.js';
import { getStandardMap } from '../rules/standardMaps.js';
import { resolveAiDifficultyProfile } from '../ai/difficulty.js';
import { getRoundIndex } from '../rules/turns.js';
import { waitForFactionSynergyPresentations } from './factionSynergyPresentation.js';

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
let _turnPresentationScale = 1;

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

async function delay(ms) {
    const scaled = Math.max(0, Math.round(ms * _runtimeOptions.delayScale * _turnPresentationScale));
    if (scaled > 0) await new Promise(resolve => setTimeout(resolve, scaled));
    // Hero 可能由攻击内部的延迟结算触发；每个动作真正落子前再次检查全局演出栅栏。
    await waitForFactionSynergyPresentations();
}

/**
 * 浏览器回合看门狗：按军团规模预留演出时间，不再用固定 18 秒截断大军团的后半套动作。
 * 纯计算公式放在 ai/strategy.js，方便无浏览器环境做回归测试。
 */
export function getOpponentTurnWatchdogMs(aiCamp) {
    const profile = resolveAiDifficultyProfile(gameState, aiCamp);
    const actionableUnits = gameState.tiles.filter(tile =>
        tile.unit?.camp === aiCamp && tile.unit.hp > 0 && tile.unit.canAct).length;
    const occupiedCommandSlots = gameState.tiles.filter(tile =>
        tile.unit?.camp === aiCamp && tile.unit.commander && tile.unit.hp > 0).length;
    return estimateAiTurnWatchdogMs({
        actionableUnits,
        replanPasses: profile.replanPasses,
        presentationDelayMs: AI_DELAY * Math.max(0.4, Math.min(1, 10 / Math.max(10, actionableUnits))),
        extraActions: 4 + occupiedCommandSlots
    });
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

function estimateVisibleThreatAt(site, aiCamp, forecast) {
    if (!site) return 0;
    let threat = 0;
    for (const tile of gameState.tiles) {
        const unit = tile.unit;
        if (!unit || !isHostile(gameState, aiCamp, unit.camp)) continue;
        if (gameState.skirmishFog && !isTileVisible(tile, aiCamp, gameState)) continue;
        const range = Math.max(1, Number(unit.config?.range || 1));
        const reach = range + (forecast ? Math.max(0, Number(unit.config?.speed || 0)) : 2);
        const distance = hexDistance(tile, site);
        if (distance > reach + 2) continue;
        threat = Math.max(threat, (reach + 2 - distance) / Math.max(1, reach + 2));
    }
    return Math.max(0, Math.min(1, threat));
}

function resolveEmergencyRecruitReserve(aiCamp, difficultyProfile) {
    if (!difficultyProfile.emergencyBudget) return 0;
    const standardMap = getStandardMap(gameState.isThreePlayer ? 3 : 2, gameState.standardMapId);
    const homeDistricts = new Set((standardMap?.board?.cities || [])
        .filter(city => city.camp === campToKey(aiCamp))
        .map(city => city.districtId));
    const capital = gameState.tiles.find(tile =>
        tile.isCity && tile.camp === aiCamp && homeDistricts.has(tile.districtId));
    const ownPorts = gameState.tiles.filter(tile => tile.isPort && tile.camp === aiCamp);
    const ownUnits = gameState.tiles.filter(tile => tile.unit?.camp === aiCamp && tile.unit.hp > 0);
    const rivalUnits = gameState.tiles.filter(tile => tile.unit?.hp > 0
        && isHostile(gameState, aiCamp, tile.unit.camp)
        && (!gameState.skirmishFog || isTileVisible(tile, aiCamp, gameState)));
    return getEmergencyRecruitReserve({
        enabled: true,
        ownUnitCount: ownUnits.length,
        rivalUnitCount: rivalUnits.length,
        hasEmptyCity: gameState.tiles.some(tile => tile.isCity && tile.camp === aiCamp && !tile.unit),
        hasEmptyPort: ownPorts.some(port => !port.unit),
        oceanMap: standardMap?.familyId === 'uncharted-passage',
        capitalThreat: estimateVisibleThreatAt(capital, aiCamp, difficultyProfile.threatForecast),
        portThreat: Math.max(0, ...ownPorts.map(port =>
            estimateVisibleThreatAt(port, aiCamp, difficultyProfile.threatForecast))),
        minimumLandCost: UNIT_CONFIG.infantry.cost,
        minimumNavalCost: UNIT_CONFIG.submarine.cost
    });
}

function aiPlanningSignature(aiCamp) {
    const units = gameState.tiles
        .filter(tile => tile.unit)
        .map(tile => `${tile.unit.id}:${tile.q},${tile.r}:${Math.round(tile.unit.hp)}:${tile.unit.canAct ? 1 : 0}`)
        .sort();
    const cities = gameState.tiles
        .filter(tile => tile.isCity)
        .map(tile => `${tile.q},${tile.r}:${tile.camp?.id || 'none'}:${Math.round(tile.hp || 0)}`)
        .sort();
    const campKey = campToKey(aiCamp);
    return `${gameState.playerGold[campKey] || 0}|${gameState.playerUsesThisTurn[campKey] || 0}|${units.join(';')}|${cities.join(';')}`;
}

async function runV2Infrastructure(aiCamp, difficultyProfile = resolveAiDifficultyProfile(gameState, aiCamp)) {
    const campKey = campToKey(aiCamp);
    const emergencyReserve = resolveEmergencyRecruitReserve(aiCamp, difficultyProfile);
    const canSpend = cost => (gameState.playerGold[campKey] || 0) - cost >= emergencyReserve;
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
        if (repairTarget && (gameState.playerGold[campKey] || 0) >= 3 && canSpend(3)) {
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
        if (bombing.available && bombingTarget && bombingScore >= 3
            && canSpend(AIR_COMMAND_CONFIG.bombing.cost)) {
            await runObservedAction({ type: 'airCommand', airKind: 'bombing', tileQ: city.q, tileR: city.r, targetQ: bombingTarget.q, targetR: bombingTarget.r }, aiCamp, () => {
                executeAirCommand('bombing', city, bombingTarget);
            });
            await delay(AI_DELAY * 0.5);
            continue;
        }
        const strafe = getAirCommandAvailability('strafe', city, gameState);
        if (strafe.available && enemies.length && canSpend(AIR_COMMAND_CONFIG.strafe.cost)) {
            enemies.sort((a, b) => (a.unit.hp / a.unit.maxHp) - (b.unit.hp / b.unit.maxHp));
            await runObservedAction({ type: 'airCommand', airKind: 'strafe', tileQ: city.q, tileR: city.r, targetId: enemies[0].unit?.id, targetQ: enemies[0].q, targetR: enemies[0].r }, aiCamp, () => {
                executeAirCommand('strafe', city, enemies[0]);
            });
            await delay(AI_DELAY * 0.5);
            continue;
        }
        const recon = getAirCommandAvailability('recon', city, gameState);
        if (recon.available && canSpend(AIR_COMMAND_CONFIG.recon.cost)) {
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
            && candidate && (gameState.playerGold[campKey] || 0) >= airfieldReserve
            && canSpend(constructionCost('airfield', candidate.unit, candidate))) {
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
    if (builder && canSpend(constructionCost(fortificationKind, builder))) {
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
        && !hasSameTypeBuildingWithin(gameState, tile, 'mgNest')
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
        // 交战资格与敌意是两回事：isHostile 只认 relation==='enemy'，
        // 而中立方与玩家的 relation 就是字面上的 'neutral'——够不上「敌对」，
        // 但引擎允许互相攻击（canAttack 同时接受 enemy 与 neutral）。
        // 中立人格必须按这条判定选目标，否则它会把引擎给出的合法目标全部滤掉。
        canAttackFaction: (left, right) => canAttack(gameState, left, right),
        recruitTypesForCity: (city, baseTypes) => difficultyProfile.counterRecruitment
            ? prioritizeNavalRecruitment(
                city,
                baseTypes,
                gameState.tiles,
                aiCamp,
                (left, right) => isHostile(gameState, left, right)
            )
            : baseTypes,
        canRecruitTypeAtSite: (type, site) =>
            canRecruitTypeAtSelectedSite(type, site, gameState, aiCamp),
        difficultyProfile,
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
    const standardMap = getStandardMap(gameState.isThreePlayer ? 3 : 2, gameState.standardMapId);
    const availableUnits = gameState.tiles
        .map(tile => tile.unit)
        .filter(unit => unit && unit.camp === aiCamp
            && !(unit.isCommanderUnit ?? Boolean(unit.commander))
            && unit.tile && unit.hp > 0);

    for (const { commanderId } of commanders) {
        if (availableUnits.length === 0) break;
        availableUnits.sort((left, right) =>
            scoreCommanderCarrierCandidate(right, commanderId, standardMap)
            - scoreCommanderCarrierCandidate(left, commanderId, standardMap));
        const [carrier] = availableUnits.splice(0, 1);
        await executeAction({ type: 'deployCommander', unitId: carrier.id, commanderId }, aiCamp);
    }
}

async function executeAction(action, aiCamp) {
    if (gameState.gameOver) return false;
    if (!gameState.aiActing || gameState.currentCamp !== aiCamp) return false;

    const label = `${action.type}${action.unitId ? ' ' + action.unitId : ''}`;
    try {
        const result = await runObservedAction(action, aiCamp, () => withTimeout(
            _executeActionInner(action, aiCamp),
            _runtimeOptions.actionTimeoutMs,
            label
        ));
        await waitForFactionSynergyPresentations();
        return result;
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

    const campKey = campToKey(aiCamp);

    // 自动攻击辅助：从可攻击目标中选最优，返回是否执行了攻击。
    // 中立方曾在这里额外要求目标落在行政区 {3,4,5} 内，那既写死了地图又把
    // 水面目标全部排除（水格没有 districtId），是岸防炮对敌舰不开火的成因之一。
    // 交战资格由外交表和引擎射程决定，与目标脚下那一格属于谁无关。
    //
    // 判据用 canAttack 而不是 isHostile：getAttackableTiles 本身就是按 canAttack
    // 过滤出来的，再用更严的 isHostile 筛一遍，等于主动放弃一次已经到嘴边的合法攻击
    // ——中立与玩家的 relation 是 'neutral'，isHostile 恒假，双方擦肩而过谁也不开枪。
    async function _autoAttack(unit) {
        if (!unit.canAct || !unit.tile || unit.hp <= 0) return false;
        const atkTiles = getAttackableTiles(unit);
        const targets = atkTiles.filter(t => t.unit && canAttack(gameState, aiCamp, t.unit.camp));
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
            // 中立航母的移动不再由引擎拦死：是否离港是 Corporal 人格在规划层的决策
            // （重罚离港、贴脸才规避），执行层只校验落点合法性。
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
        case 'droneDeploy': {
            const unit = resolveUnit(action.unitId);
            const targetTile = resolveTile(action.tileQ, action.tileR);
            if (!unit || !targetTile || targetTile.unit || unit.commander !== 'tianyan') return;
            await delay(AI_DELAY * 0.5);
            executeDroneDeploy(unit, targetTile);
            break;
        }
        case 'droneSuicide': {
            const unit = resolveUnit(action.unitId);
            const targetUnit = resolveUnit(action.targetId);
            if (!unit || !targetUnit || !unit._isDrone || !targetUnit.tile) return;
            await delay(AI_DELAY * 0.5);
            executeDroneSuicide(unit, targetUnit.tile);
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
// 中立 AI 回合（Corporal 守备队人格）
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
        const actions = corporalPersonality.planActions(gameState, helpers, aiCamp);

        // 回合首次行动前延迟 2s
        if (actions.length > 0) { await delay(AI_DELAY); }

        for (let i = 0; i < actions.length; i++) {
            if (gameState.gameOver || gameState.currentCamp !== aiCamp || !gameState.aiActing) break;
            await executeAction(actions[i], aiCamp);
        }

        // 兜底：只补一座空城，且必须是中立自己的城。
        // 这里过去写死了行政区 {3,4,5}，在无主航路上从未命中（中立城在 5~10 区）；
        // 现在按实际归属判定。同时刻意保持每回合一座的节流——中立能无限回填守军，
        // 会把「拿下中立城」变成让所有玩家一起难受的消耗战。
        const [emptyCity] = gameState.tiles.filter(t => t.isCity && !t.unit && t.camp === aiCamp);
        if (emptyCity && !gameState.gameOver && gameState.currentCamp === aiCamp && gameState.aiActing) {
            const unitType = helpers.recruitTypesForCity(emptyCity, ['infantry'])
                .find(type => gameState.playerGold.neutral >= UNIT_CONFIG[type].cost);
            if (unitType) {
                await executeAction(
                    { type: 'recruit', unitType, tileQ: emptyCity.q, tileR: emptyCity.r }, aiCamp);
            }
        }
    } finally {
        gameState.aiActing = false;
    }
}

// ═══════════════════════════════════════════
// 对手 AI 回合（按难度档分派人格脚本）
// ═══════════════════════════════════════════

export async function processOpponentTurn(aiCamp) {
    if (gameState.gameOver) return;
    if (campToKey(aiCamp) === 'neutral') return; // 中立用 Claude

    gameState.aiActing = true;
    const difficultyProfile = resolveAiDifficultyProfile(gameState, aiCamp);
    const actionableAtStart = gameState.tiles.filter(tile =>
        tile.unit?.camp === aiCamp && tile.unit.hp > 0 && tile.unit.canAct).length;
    const previousPresentationScale = _turnPresentationScale;
    // 小规模战斗保留原有节奏；大军团缩短每步演出，避免“看动画”吞掉整个回合预算。
    _turnPresentationScale = Math.max(0.4, Math.min(1, 10 / Math.max(10, actionableAtStart)));
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
        const personality = resolveAiPersonality(difficultyProfile);
        const replanPasses = Math.max(1, Number(difficultyProfile.replanPasses) || 1);
        const movedUnitIds = new Set();
        const forceMarchedUnitIds = new Set();
        for (let pass = 0; pass < replanPasses; pass++) {
            const before = aiPlanningSignature(aiCamp);
            const actions = personality.planActions(gameState, helpers, aiCamp);
            if (actions.length === 0) break;

            // 只在回合第一次行动前保留思考停顿；后续重规划表现为连续指挥。
            if (pass === 0) await delay(AI_DELAY);
            for (const action of actions) {
                if (gameState.gameOver || gameState.currentCamp !== aiCamp || !gameState.aiActing) break;
                if (shouldSkipReplannedMovement(
                    action, pass, movedUnitIds, forceMarchedUnitIds
                )) continue;
                const executed = await executeAction(action, aiCamp);
                if (!executed) continue;
                if (action.type === 'tacticalCard' && action.cardId === 'forceMarch' && action.targetId) {
                    forceMarchedUnitIds.add(action.targetId);
                } else if (action.type === 'move' && action.unitId) {
                    movedUnitIds.add(action.unitId);
                    forceMarchedUnitIds.delete(action.unitId);
                }
            }
            if (aiPlanningSignature(aiCamp) === before) break;
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
        // 舰队负责制海，占城只能靠陆战队（引擎里只有突击类攻击会推进到城市格）。
        // 港口兜底招募必须封顶，否则金币会全部变成占不了城的舰船——回归局里
        // 蓝军堆出 19 艘驱逐舰，可进城的单位只有 2 个，终局仍是 2 城平局。
        const livingOwnUnits = gameState.tiles
            .map(tile => tile.unit)
            .filter(unit => unit?.camp === aiCamp && unit.hp > 0);
        const assaultCapableCount = livingOwnUnits
            .filter(unit => canCaptureCityByCombat(unit)).length;
        const navalCount = livingOwnUnits
            .filter(unit => unit.config?.movementDomain === 'naval').length;
        const fleetSaturated = navalCount >= Math.max(4, assaultCapableCount * 2)
            || assaultCapableCount < 3;
        // 陆战图（非无主航路）海军没有占城价值：只在敌方已有可见海军时才反制性招募，
        // 否则港口兜底会把金币变成观光的潜艇（回归局：王冠环岛连招 6 潜艇颗粒无收）。
        const landMap = getStandardMap(gameState.isThreePlayer ? 3 : 2, gameState.standardMapId)
            ?.familyId !== 'uncharted-passage';
        const hostileNavy = landMap && gameState.tiles.some(tile =>
            tile.unit && isHostile(gameState, aiCamp, tile.unit.camp)
            && tile.unit.config?.movementDomain === 'naval'
            && (!gameState.skirmishFog || isTileVisible(tile, aiCamp, gameState)));
        const portFallbackBlocked = fleetSaturated || (landMap && !hostileNavy);
        for (const port of portFallbackBlocked ? [] : emptyPorts) {
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
        _turnPresentationScale = previousPresentationScale;
        gameState.aiActing = false;
    }
}

// ═══════════════════════════════════════════
// AI 将领自动选择（PVE 模式用）
// ═══════════════════════════════════════════

export function aiSelectCommander(pool) {
    return imperatorPersonality.selectCommander(pool);
}

export function aiSelectCommanderPair(pool) {
    return imperatorPersonality.selectCommanderPair(pool);
}
