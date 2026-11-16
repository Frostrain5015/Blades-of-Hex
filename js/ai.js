// AI 调度器 — 加载人格文件，管理执行与延迟
// 玩家侧人格按难度分档：Optio(Basic) / Legatus(Pro) / Imperator(Max)；中立方为 Corporal。

import { gameState, clearselection, notify, logMessage } from './state.js';
import {
    getMovableTiles, getAttackableTiles, moveUnit, attackUnit, attackCityTile, recruitUnit, reinforceUnit, repairShipAtPort,
    executeTacticalCard, executeEngineerTrench, executeEngineerFlak, executeEngineerBunkerConstruction,
    executeDroneDeploy, executeDroneSuicide,
    executeFieldConstruction, executeAirfieldConstruction, executeFieldRepair, executeAirCommand, executeBanzaiCharge, executeGuerrillaConcealment, executeHeavyCannonStance, executeRiverGateSwitch,
    recalcAllFlankingMorale, drawCard, recordAuxiliaryAction, canReachCityAfterBreach, estimateAirCommandDamage
} from './gameLogic.js';
import { getRiverGate, getRiverGateOpenLane, canSwitchRiverGate, chooseRiverGateLane } from '../rules/riverGate.js';
import { HEX_NEIGHBORS, hexDistance, UNIT_CONFIG, TACTICAL_CARD_CONFIG, CARD_SYSTEM_CONFIG, COLONEL_CARD_GOLD } from './config.js';
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
import { planFollowupAttack, planOpenCityCaptures } from '../ai/core/planner.js';
import { TIER_CAPABILITIES } from '../ai/core/weights.js';
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
import { getCulturalRecruitmentCandidate, prioritizeNavalRecruitment } from '../rules/aiRecruitment.js';
import { areCommanderMechanicsSuppressed } from '../rules/movement.js';
import { canRecruitTypeAtSelectedSite } from './recruitmentUi.js';
import { chooseDefaultSpecialization, countLivingUnitsOfType, getUnitBaseType } from '../rules/units.js';
import { isUnitVisibleToCamp } from '../rules/visibility.js';
import { getActiveCultureId, getBanzaiBonusDamage, getCulturalReinforceCostScale, getFireSeaState, getGuerrillaConcealmentReason, getHeavyCannonStanceBlock, getHistoricalCost, getHistoricalRecruitCost, isHeavyCannonDeployed } from '../rules/cultures.js';
import { isCityDisabled } from '../rules/citySiege.js';
import { getBanzaiChargePath } from '../rules/targeting.js';
import {
    canBuildFieldFortification,
    canFieldRepair,
    constructionCost,
    isOrdinaryGroundBuilder
} from '../rules/construction.js';
import { canAirCommandAirdropAt, canTargetWithSingleAirCommand, getAirCommandAvailability, getAirCommandCost, getAirCommandRange } from '../rules/airCommands.js';
import { isSubmarineTargetableBy } from '../rules/naval.js';
import { canReinforceAtTile } from '../rules/healing.js';
import { isLandTile } from '../rules/surfaces.js';
import { getStandardMap } from '../rules/standardMaps.js';
import { hasFullAiIntelligence, resolveAiDifficultyProfile } from '../ai/difficulty.js';
import { getRoundIndex } from '../rules/turns.js';
import { waitForFactionSynergyPresentations } from './factionSynergyPresentation.js';
import { withMatchAction } from './matchRecorder.js';

const AI_DELAY = 1500;
const ACTION_TIMEOUT = 8000; // 单次行动超时：8秒
const AI_TARGETING = Object.freeze({ forAiAction: true });

function isKnownToAi(tile, camp) {
    return !gameState.skirmishFog || hasFullAiIntelligence(gameState, camp)
        || isTileVisible(tile, camp, gameState);
}

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
    const readyAirfields = gameState.tiles.filter(tile => tile.camp === aiCamp
        && tile.installation?.type === 'airfield' && tile.installation.status === 'ready').length;
    return estimateAiTurnWatchdogMs({
        actionableUnits,
        replanPasses: profile.replanPasses,
        presentationDelayMs: AI_DELAY * Math.max(0.4, Math.min(1, 10 / Math.max(10, actionableUnits))),
        extraActions: 4 + occupiedCommandSlots + readyAirfields
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
        if (!isKnownToAi(tile, aiCamp) || !isUnitVisibleToCamp(unit, aiCamp, gameState)) continue;
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
        && isKnownToAi(tile, aiCamp)
        && isUnitVisibleToCamp(tile.unit, aiCamp, gameState));
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

function reserveForMissingCulturalUnit(camp) {
    const type = getCulturalRecruitmentCandidate(gameState, camp);
    if (!type || countLivingUnitsOfType(gameState, camp, type) > 0) return 0;
    const fields = gameState.tiles.filter(tile => tile.camp === camp && !tile.unit && (tile.isCity || tile.isPort));
    if (!fields.some(tile => !isCityDisabled(tile) && canRecruitTypeAtSelectedSite(type, tile, gameState, camp))) return 0;
    if (getUnitBaseType(type) === 'archer' && !gameState.tiles.some(({ unit }) => unit?.camp === camp
        && unit.hp > 0 && unit.commander !== 'minister' && canCaptureCityByCombat(unit))) return 0;
    return getHistoricalRecruitCost(UNIT_CONFIG[type].cost, gameState, camp, type);
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

function pickAirReconTarget(airfield, aiCamp, knownTile) {
    const range = getAirCommandRange(airfield);
    const cities = gameState.tiles.filter(tile => tile.isCity && canAttack(gameState, aiCamp, tile.camp)
        && hexDistance(airfield, tile) <= range + 2);
    const unexplored = gameState.exploredTiles?.[campToKey(aiCamp)];
    const unknownLand = gameState.tiles.filter(tile => isLandTile(tile) && !knownTile(tile)
        && !unexplored?.has(`${tile.q},${tile.r}`)
        && cities.some(city => hexDistance(city, tile) <= 2));
    let best = null;
    let bestScore = 0;
    for (const tile of gameState.tiles) {
        const distance = hexDistance(airfield, tile);
        if (distance > range || !cities.some(city => hexDistance(city, tile) <= 2)) continue;
        const coverage = unknownLand.reduce((sum, unknown) => {
            const offset = hexDistance(tile, unknown);
            return sum + (offset <= 2 ? 3 - offset : 0);
        }, 0);
        const score = coverage - distance / (range + 1);
        if (score > bestScore) {
            best = tile;
            bestScore = score;
        }
    }
    return best;
}

async function runV2Infrastructure(aiCamp, difficultyProfile, stukaSorties) {
    const campKey = campToKey(aiCamp);
    const emergencyReserve = Math.max(resolveEmergencyRecruitReserve(aiCamp, difficultyProfile), reserveForMissingCulturalUnit(aiCamp));
    const canSpend = cost => (gameState.playerGold[campKey] || 0) - cost >= emergencyReserve;
    const culture = getActiveCultureId(gameState, aiCamp);
    const airPriority = culture === 'de' || difficultyProfile.infrastructureLevel > 0;
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
        if (repairTarget && canSpend(constructionCost('fieldRepair', engineer, null, gameState))) {
            await runObservedAction({ type: 'fieldRepair', unitId: engineer.id, targetId: repairTarget.id }, aiCamp, () => {
                executeFieldRepair(engineer, repairTarget);
            });
            await delay(AI_DELAY * 0.4);
        }
    }

    await runAiAirCommands(aiCamp, difficultyProfile, stukaSorties);
    const knownTile = tile => isKnownToAi(tile, aiCamp);
    const ownedCities = gameState.tiles.filter(tile => tile.isCity && tile.camp === aiCamp);
    if (ownedCities.length && !ownedCities.some(tile => tile.installation)) {
        const front = gameState.tiles.filter(tile => tile.isCity && isHostile(gameState, aiCamp, tile.camp) && knownTile(tile));
        const frontDistance = city => Math.min(Infinity, ...front.map(tile => hexDistance(city, tile)));
        const candidate = culture === 'de'
            ? [...ownedCities].sort((a, b) => frontDistance(a) - frontDistance(b))[0]
            : ownedCities[0];
        const airfieldReserve = culture === 'de' ? 12 : difficultyProfile.infrastructureLevel >= 2 ? 18 : 24;
        if (airPriority
            && candidate && (gameState.playerGold[campKey] || 0) >= airfieldReserve
            && canSpend(constructionCost('airfield', candidate.unit, candidate, gameState))) {
            await runObservedAction({ type: 'buildAirfield', tileQ: candidate.q, tileR: candidate.r }, aiCamp, () => {
                executeAirfieldConstruction(candidate);
            });
        }
    }

    const gate = getRiverGate(gameState);
    const gateTile = gate ? resolveTile(gate.q, gate.r) : null;
    if (difficultyProfile.infrastructureLevel > 0 && gateTile && canSwitchRiverGate(gameState, gateTile)) {
        const preferredLane = chooseRiverGateLane(gameState, aiCamp, { isTileKnown: knownTile });
        if (preferredLane && preferredLane !== getRiverGateOpenLane(gameState)) {
            await runObservedAction({ type: 'riverGateSwitch', tileQ: gate.q, tileR: gate.r }, aiCamp, () => {
                executeRiverGateSwitch(gateTile);
            });
        }
    }
}

async function runAiAirCommands(aiCamp, difficultyProfile, stukaSorties, afterGround = false) {
    if (gameState.gameOver || gameState.currentCamp !== aiCamp || !gameState.aiActing) return false;
    const campKey = campToKey(aiCamp);
    const germanAir = getActiveCultureId(gameState, aiCamp) === 'de';
    if (!germanAir && difficultyProfile.infrastructureLevel === 0) return false;
    const emergencyReserve = resolveEmergencyRecruitReserve(aiCamp, difficultyProfile);
    const culturalReserve = reserveForMissingCulturalUnit(aiCamp);
    const reserve = Math.max(emergencyReserve, culturalReserve);
    const knownTile = tile => isKnownToAi(tile, aiCamp);
    const ownedCities = gameState.tiles.filter(tile => tile.isCity && tile.camp === aiCamp);
    const threatensCity = tile => canCaptureCityByCombat(tile.unit)
        && ownedCities.some(city => hexDistance(city, tile) <= 2
            && (!city.unit || city.hp < city.maxHp / 2 || city.unit.hp < city.unit.maxHp / 2));
    const airPhase = afterGround ? 'followup' : 'opening';
    let fired = false;
    for (const city of ownedCities.filter(tile => tile.installation?.status === 'ready')) {
        if (gameState.gameOver || gameState.currentCamp !== aiCamp || !gameState.aiActing) break;
        const available = (kind, urgentDefense = false) => {
            const gold = gameState.playerGold[campKey] || 0;
            const cost = getAirCommandCost(kind, city, gameState);
            const effectiveReserve = urgentDefense && gold < emergencyReserve && culturalReserve === 0 ? 0 : reserve;
            return getAirCommandAvailability(kind, city, gameState).available && gold - cost >= effectiveReserve;
        };
        const launch = async (kind, target) => {
            const launched = await runObservedAction({
                type: 'airCommand', airKind: kind, airPhase, tileQ: city.q, tileR: city.r,
                targetId: target.unit?.id, targetQ: target.q, targetR: target.r
            }, aiCamp, () => executeAirCommand(kind, city, target, { aiPhase: airPhase }));
            if (launched && kind !== 'recon') fired = true;
            if (launched) await delay(AI_DELAY * 0.5);
            return launched;
        };
        const range = getAirCommandRange(city);
        const airdropCity = available('airdrop')
            ? gameState.tiles.find(tile => tile.isCity && canAttack(gameState, aiCamp, tile.camp)
                && hexDistance(city, tile) <= range && knownTile(tile) && canAirCommandAirdropAt(tile))
            : null;
        if (airdropCity && await launch('airdrop', airdropCity)) continue;

        const knownEnemies = gameState.tiles.filter(tile => tile.unit?.hp > 0 && knownTile(tile)
            && (campKey === 'neutral' ? canAttack(gameState, aiCamp, tile.unit.camp)
                : isHostile(gameState, aiCamp, tile.unit.camp))
            && isUnitVisibleToCamp(tile.unit, aiCamp, gameState)
            && isSubmarineTargetableBy(tile.unit, aiCamp, gameState));
        const knownAirDefenses = new Map([...gameState.tileMap].filter(([, tile]) => knownTile(tile)
            && (!tile.unit || isUnitVisibleToCamp(tile.unit, aiCamp, gameState))));
        const enemySet = new Set(knownEnemies);
        const enemies = knownEnemies.filter(tile => hexDistance(city, tile) <= range);
        const canHit = tile => tile.unit?.hp > 0 && canTargetWithSingleAirCommand(tile, aiCamp, gameState, true);
        const lethal = (kind, tile, multiplier) => estimateAirCommandDamage(kind, city, tile.unit, multiplier, knownAirDefenses)
            >= tile.unit.hp + tile.unit.activeShield;

        if (germanAir) {
            const allies = gameState.tiles.filter(tile => tile.unit?.camp === aiCamp && tile.unit.hp > 0);
            while ((stukaSorties.get(city) || 0) < 2 && (available('stukaDiveBomb') || available('stukaDiveBomb', true))) {
                const targets = enemies.filter(canHit).map(tile => {
                    const kill = lethal('stukaDiveBomb', tile);
                    const closeSupport = allies.filter(ally => hexDistance(ally, tile) <= Math.max(2, ally.unit.config.range)).length;
                    const urgent = threatensCity(tile);
                    const worthwhile = available('stukaDiveBomb', urgent)
                        && (kill || (!getFireSeaState(tile.unit) && (afterGround || urgent || closeSupport > 0)));
                    return { tile, worthwhile, score: Number(kill) * 10 + Number(urgent) * 3
                        + closeSupport * 2 + Number(!!tile.unit.commander) * 2 + Number(tile.isCity) };
                }).filter(target => target.worthwhile).sort((a, b) => b.score - a.score);
                if (!targets.length || !await launch('stukaDiveBomb', targets[0].tile)) break;
                stukaSorties.set(city, (stukaSorties.get(city) || 0) + 1);
            }
        }

        const strafing = (available('strafe') || available('strafe', true))
            ? enemies.filter(canHit).map(tile => ({
                tile, kill: lethal('strafe', tile), urgent: threatensCity(tile)
            })).filter(target => (target.kill && available('strafe', target.urgent))
                || (target.urgent && available('strafe', true))).sort((a, b) => Number(b.kill) - Number(a.kill)
                || Number(b.urgent) - Number(a.urgent) || Number(!!b.tile.unit.commander) - Number(!!a.tile.unit.commander)
                || a.tile.unit.hp - b.tile.unit.hp)[0]
            : null;
        let bombing = null;
        if (available('bombing') || available('bombing', true)) {
            for (const tile of gameState.tiles) {
                if (hexDistance(city, tile) > range || !knownTile(tile)) continue;
                const targets = [tile, ...HEX_NEIGHBORS.map(([dq, dr]) => resolveTile(tile.q + dq, tile.r + dr))]
                    .filter(candidate => enemySet.has(candidate) && canHit(candidate));
                const urgentTargets = targets.filter(threatensCity).length;
                if (!available('bombing', urgentTargets > 0)) continue;
                const kills = targets.filter(target => lethal('bombing', target, target === tile ? 1 : 0.5)).length;
                const areaScore = targets.length
                    + (targets.length >= 2 ? urgentTargets * 0.75 : 0)
                    + Number(tile.isCity && tile.camp !== aiCamp);
                if (kills === 0 && (targets.length < 2 || areaScore < 3)) continue;
                const score = kills * 3 + areaScore;
                if (!bombing || score > bombing.score) bombing = { tile, score, kills };
            }
        }
        if (strafing?.kill && (!bombing || bombing.kills < 2)) {
            await launch('strafe', strafing.tile);
        } else if (bombing) {
            await launch('bombing', bombing.tile);
        } else if (strafing) {
            await launch('strafe', strafing.tile);
        } else if (!afterGround && !hasFullAiIntelligence(gameState, aiCamp)
            && !knownEnemies.some(tile => tile.unit && threatensCity(tile)) && available('recon')) {
            const target = pickAirReconTarget(city, aiCamp, knownTile);
            if (target) await launch('recon', target);
        }
    }
    return fired;
}

async function positionFrenchCannons(camp, { afterGround = false } = {}) {
    if (getActiveCultureId(gameState, camp) !== 'fr') return;
    const ministerReturn = gameState._aiCoreMemory?.[campToKey(camp)]?.ministerReturn;
    const visibleEnemy = unit => unit?.hp > 0 && canAttack(gameState, camp, unit.camp)
        && isUnitVisibleToCamp(unit, camp, gameState) && isSubmarineTargetableBy(unit, camp, gameState);
    for (const tile of gameState.tiles) {
        const unit = tile.unit;
        if (unit?.camp !== camp || getHeavyCannonStanceBlock(unit, gameState)) continue;
        const deployed = isHeavyCannonDeployed(unit);
        if (afterGround && deployed) continue;
        if (ministerReturn?.unitId === unit.id) {
            if (deployed) await runObservedAction({ type: 'heavyCannonStance', unitId: unit.id }, camp, () => executeHeavyCannonStance(unit));
            continue;
        }
        if (!deployed && tile.isCity && unit.commander === 'minister' && !afterGround) continue;
        const hasFiringArc = getAttackableTiles(unit, { forAiAction: true, previewHeavyCannon: true }).some(
            target => isKnownToAi(target, camp) && (!target.unit || visibleEnemy(target.unit)));
        const adjacent = HEX_NEIGHBORS.map(([dq, dr]) => gameState.tileMap.get(`${tile.q + dq},${tile.r + dr}`))
            .filter(Boolean);
        const exposed = adjacent.some(candidate => isKnownToAi(candidate, camp) && visibleEnemy(candidate.unit))
            && !adjacent.some(candidate => candidate.unit?.camp === camp && candidate.unit.hp > 0
                && canCaptureCityByCombat(candidate.unit));
        if (deployed === (hasFiringArc && !exposed)) continue;
        await runObservedAction({ type: 'heavyCannonStance', unitId: unit.id }, camp, () => executeHeavyCannonStance(unit));
    }
}

async function runAiFieldFortifications(aiCamp, difficultyProfile) {
    const campKey = campToKey(aiCamp);
    const gold = gameState.playerGold[campKey] || 0;
    const reserve = Math.max(resolveEmergencyRecruitReserve(aiCamp, difficultyProfile), reserveForMissingCulturalUnit(aiCamp));
    const fogSafeTile = tile => isKnownToAi(tile, aiCamp);
    // 敌方存在可见空袭平台（航母/无人机/已建成机场）时优先高射机枪，否则战壕。
    const hostileAir = gameState.tiles.some(tile => fogSafeTile(tile)
        && ((tile.unit && isHostile(gameState, aiCamp, tile.unit.camp) && isUnitVisibleToCamp(tile.unit, aiCamp, gameState) && (tile.unit.type === 'carrier' || tile.unit._isDrone))
            || (tile.isCity && isHostile(gameState, aiCamp, tile.camp) && tile.installation?.status === 'ready')));
    // 只在战略位置（城市/村庄）或敌军兵临 2 格内时修工事，并保留基础金币，避免每回合白耗单位行动。
    const fortificationKind = hostileAir ? 'flak' : 'trench';
    gameState._aiFortificationsBuilt ||= {};
    const fortificationsBuilt = gameState._aiFortificationsBuilt[campKey] || 0;
    const stronghold = getActiveCultureId(gameState, aiCamp) === 'kmt';
    const builder = (stronghold || difficultyProfile.infrastructureLevel >= 2)
        && fortificationsBuilt < (stronghold ? 4 : 2)
        && gold >= 6
        ? gameState.tiles.map(tile => tile.unit).find(unit => unit?.camp === aiCamp
            && unit.canAct && !unit.isNewRecruit && isOrdinaryGroundBuilder(unit)
            && (unit.tile.isCity || unit.tile.isVillage)
            && gameState.tiles.some(tile => tile.unit && isHostile(gameState, aiCamp, tile.unit.camp)
                && fogSafeTile(tile) && isUnitVisibleToCamp(tile.unit, aiCamp, gameState)
                && hexDistance(unit.tile, tile) <= (unit.tile.isCity ? 3 : 2))
            && canBuildFieldFortification(unit, fortificationKind, gameState))
        : null;
    if (builder && gold - constructionCost(fortificationKind, builder, builder.tile, gameState) >= reserve) {
        const built = await runObservedAction(
            { type: 'buildFortification', unitId: builder.id, fortificationKind },
            aiCamp,
            () => executeFieldConstruction(builder, fortificationKind)
        );
        if (built) gameState._aiFortificationsBuilt[campKey] = fortificationsBuilt + 1;
    }
}

function planEngineerAction(aiCamp) {
    const campKey = campToKey(aiCamp);
    const engineer = gameState.tiles.reduce((found, tile) => found || (
        tile.unit && tile.unit.commander === 'engineer' && !areCommanderMechanicsSuppressed(tile.unit) && tile.unit.camp === aiCamp && tile.unit.canAct && !tile.unit._engineerConstruction
            ? tile.unit : null
    ), null);
    if (!engineer || !engineer.tile) return null;

    const hostileTiles = gameState.tiles.filter(tile => tile.unit && isHostile(gameState, aiCamp, tile.unit.camp) && isKnownToAi(tile, aiCamp) && isUnitVisibleToCamp(tile.unit, aiCamp, gameState));
    const isThreatened = hostileTiles.some(tile => hexDistance(engineer.tile, tile) <= 2);
    if (!engineer.tile.fortification && (engineer.tile.isCity || engineer.tile.isVillage || isThreatened)) {
        // 附近以远程/空军威胁为主 → 架高射机枪；否则挖战壕（定向选择）
        const rangedThreatNearby = hostileTiles.some(tile =>
            hexDistance(engineer.tile, tile) <= 2
            && (getUnitBaseType(tile.unit) === 'archer' || getUnitBaseType(tile.unit) === 'mgNest' || tile.unit._isDrone));
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
        canReachCityAfterBreach,
        getAttackableTiles: unit => getAttackableTiles(unit, AI_TARGETING),
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
                gameState.tiles.filter(tile => tile.unit?.camp === aiCamp || (isKnownToAi(tile, aiCamp) && (!tile.unit || isUnitVisibleToCamp(tile.unit, aiCamp, gameState)))),
                aiCamp,
                (left, right) => isHostile(gameState, left, right)
            )
            : baseTypes,
        canRecruitTypeAtSite: (type, site) =>
            !isCityDisabled(site) && canRecruitTypeAtSelectedSite(type, site, gameState, aiCamp),
        difficultyProfile,
        isTileVisible: (tile, camp) => isTileVisible(tile, camp, gameState),
        isUnitVisibleToCamp: (unit, camp) => isUnitVisibleToCamp(unit, camp, gameState),
        getCulturalReinforceCostScale: (tile, camp) => getCulturalReinforceCostScale(gameState, tile, camp),
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
        clearselection({ preserveInspection: true });
    }
}

async function _executeActionInner(action, aiCamp) {
    if (gameState.gameOver) return false;

    const campKey = campToKey(aiCamp);

    // 中立守军只执行事先规划的防御攻击，调防或击杀后不自动追击。
    async function _autoAttack(unit) {
        if (campKey === 'neutral' || !unit.canAct || !unit.tile || unit.hp <= 0) return false;
        const profile = resolveAiDifficultyProfile(gameState, aiCamp);
        const followup = planFollowupAttack(gameState, makeHelpers(aiCamp, profile), aiCamp,
            TIER_CAPABILITIES[profile.id], unit.id);
        if (!followup) return false;
        if (followup.type === 'siegeCityAttack') {
            const city = resolveTile(followup.tileQ, followup.tileR);
            if (!city || city.unit || !getAttackableTiles(unit, AI_TARGETING).includes(city)) return false;
            await delay(AI_DELAY);
            return attackCityTile(unit, city, AI_TARGETING);
        }
        const target = resolveUnit(followup.targetId);
        if (!target?.tile || !getAttackableTiles(unit, AI_TARGETING).includes(target.tile)) return false;
        await delay(AI_DELAY);
        if (unit.type === 'cpc_guerrilla' && !getGuerrillaConcealmentReason(unit, gameState)) {
            executeGuerrillaConcealment(unit);
        }
        attackUnit(unit, target, followup.holdPosition ? { ...AI_TARGETING, holdPosition: true } : AI_TARGETING);
        return true;
    }

    switch (action.type) {
        case 'attack': {
            const unit = resolveUnit(action.unitId);
            const target = resolveUnit(action.targetId);
            if (!unit || !target || !unit.canAct || !unit.tile || !target.tile) return;
            const aiAtkTiles = getAttackableTiles(unit, AI_TARGETING);
            if (aiAtkTiles.includes(target.tile)) {
                let attackOptions = AI_TARGETING;
                if (campKey !== 'neutral') {
                    const profile = resolveAiDifficultyProfile(gameState, aiCamp);
                    const planned = planFollowupAttack(gameState, makeHelpers(aiCamp, profile), aiCamp,
                        TIER_CAPABILITIES[profile.id], unit.id, target.id);
                    if (!planned) return false;
                    if (planned.holdPosition) attackOptions = { ...AI_TARGETING, holdPosition: true };
                }
                await delay(AI_DELAY);
                if (unit.type === 'cpc_guerrilla' && !getGuerrillaConcealmentReason(unit, gameState)) {
                    executeGuerrillaConcealment(unit);
                }
                attackUnit(unit, target, attackOptions);
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
            const aiSiegeTiles = getAttackableTiles(unit, AI_TARGETING);
            if (aiSiegeTiles.includes(targetTile)) {
                await delay(AI_DELAY);
                attackCityTile(unit, targetTile, AI_TARGETING);
            }
            break;
        }
        case 'heavyCannonStance': {
            const unit = resolveUnit(action.unitId);
            return isHeavyCannonDeployed(unit) && executeHeavyCannonStance(unit);
        }
        case 'move': {
            const unit = resolveUnit(action.unitId);
            const targetTile = resolveTile(action.tileQ, action.tileR);
            if (!unit || !targetTile || !unit.canAct || !unit.tile || (targetTile.unit && isUnitVisibleToCamp(targetTile.unit, aiCamp, gameState))) return;
            if (action.captureCity && (!targetTile.isCity || targetTile.hp > 0
                || !canAttack(gameState, aiCamp, targetTile.camp))) return false;
            // 中立航母的移动不再由引擎拦死：是否离港是 Corporal 人格在规划层的决策
            // （重罚离港、贴脸才规避），执行层只校验落点合法性。
            const aiMoveTiles = getMovableTiles(unit);
            if (aiMoveTiles.includes(targetTile)) {
                await delay(AI_DELAY);
                gameState.movableTiles = aiMoveTiles;
                moveUnit(unit, targetTile);
                if (unit.tile !== targetTile) return false;
                if (action.returnToCity && unit.commander === 'minister') {
                    const memory = ((gameState._aiCoreMemory ||= {})[campKey] ||= {});
                    memory.ministerReturn = {
                        unitId: unit.id, cityQ: action.returnToCity.q, cityR: action.returnToCity.r,
                        vacatedRound: action.returnToCity.round
                    };
                    memory.ministerLastVacatedRound = action.returnToCity.round;
                }
                // 移动后尝试自动攻击
                if (action.autoAttack !== false && unit.canAct && unit.tile && unit.hp > 0) {
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
            const recruitCost = getHistoricalRecruitCost(UNIT_CONFIG[action.unitType].cost, gameState, aiCamp, action.unitType);
            if (gold < recruitCost) return;
            gameState.selectedCityTile = cityTile;
            await delay(AI_DELAY);
            recruitUnit(action.unitType);
            break;
        }
        case 'reinforce': {
            const unit = resolveUnit(action.unitId);
            if (!canReinforceAtTile(unit, gameState) || unit.hp >= unit.maxHp) return;
            if (unit.tile._reinforcedThisTurn) return;
            await delay(AI_DELAY * 0.5);
            reinforceUnit(unit);
            break;
        }
        case 'repairShip': {
            const unit = resolveUnit(action.unitId);
            if (!unit || unit.camp !== aiCamp) return false;
            const before = unit.hp;
            repairShipAtPort(unit);
            return unit.hp > before;
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
            withMatchAction('activateSkill', () => {
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
                (gameState._aiSkillPlanned ||= new Set()).add(unit.id);
                recalcAllFlankingMorale();
                logMessage(`${aiCamp.name} AI【${cmdCfg.name}】激活主动技能【${skill.name}】`);
                spawnCommanderSkillEffect(unit.tile.x, unit.tile.y);
                recordAuxiliaryAction('activateSkill', {
                    unitId: unit.id,
                    commanderId: unit.commander,
                    skillName: skill.name
                }, aiCamp);
            });
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
        case 'banzaiCharge': {
            const unit = resolveUnit(action.unitId);
            const targetTile = resolveTile(action.targetQ, action.targetR);
            if (!unit || !targetTile || unit.type !== 'jp_samurai' || !unit.canAct || !targetTile.unit) return;
            await delay(AI_DELAY);
            if (!executeBanzaiCharge(unit, targetTile)) return false;
            if (unit._banzaiFollowupTurn === gameState.turnCounter && unit.canAct && unit.hp > 0) {
                const followup = gameState.tiles.filter(tile => {
                    const enemy = tile.unit;
                    return enemy && enemy.hp + (enemy.activeShield || 0)
                        <= unit.getEffectiveAttack() + getBanzaiBonusDamage(enemy)
                        && isKnownToAi(tile, aiCamp) && getBanzaiChargePath(unit, tile, gameState);
                }).sort((a, b) => a.unit.hp - b.unit.hp)[0];
                if (followup) {
                    await delay(AI_DELAY);
                    executeBanzaiCharge(unit, followup);
                }
            }
            return true;
        }
        case 'drawCard': {
            const base = CARD_SYSTEM_CONFIG.drawCost * (1 + (gameState.playerDrawsThisTurn[campKey] || 0));
            if (gameState.playerGold[campKey] < getHistoricalCost(base, gameState, aiCamp)) return;
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

        const helpers = makeHelpers(aiCamp);
        const actions = corporalPersonality.planActions(gameState, helpers, aiCamp);

        // 回合首次行动前延迟 2s
        if (actions.length > 0) { await delay(AI_DELAY); }

        for (let i = 0; i < actions.length; i++) {
            if (gameState.gameOver || gameState.currentCamp !== aiCamp || !gameState.aiActing) break;
            await executeAction(actions[i], aiCamp);
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

        const stukaSorties = new Map();
        await runV2Infrastructure(aiCamp, difficultyProfile, stukaSorties);

        // 单将领与双将领模式都应在 AI 规划行动前优先挂将；此前这一入口被误限在
        // doubleCommanderMode，导致普通 PVE 虽已给 AI 选将，却整局不部署。
        await deployAvailableCommanders(aiCamp);
        await positionFrenchCannons(aiCamp);

        const helpers = makeHelpers(aiCamp, difficultyProfile);
        const personality = resolveAiPersonality(difficultyProfile);
        const replanPasses = Math.max(1, Number(difficultyProfile.replanPasses) || 1);
        const movedUnitIds = new Set();
        const forceMarchedUnitIds = new Set();
        gameState._aiSkillPlanned = new Set();
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

        if (await runAiAirCommands(aiCamp, difficultyProfile, stukaSorties, true) && !gameState.gameOver) {
            const captures = planOpenCityCaptures(gameState, helpers, aiCamp, TIER_CAPABILITIES[difficultyProfile.id]);
            for (const action of captures) {
                if (gameState.gameOver || gameState.currentCamp !== aiCamp || !gameState.aiActing) break;
                await executeAction(action, aiCamp);
            }
        }
        await positionFrenchCannons(aiCamp, { afterGround: true });

        // 最终兜底：补满己方所有空城
        const returnPlan = gameState._aiCoreMemory?.[campToKey(aiCamp)]?.ministerReturn;
        const emptyCities = gameState.tiles.filter(t =>
            t.isCity && !t.unit && t.camp === aiCamp
            && !(returnPlan && returnPlan.vacatedRound < getRoundIndex(gameState) + 1
                && returnPlan.cityQ === t.q && returnPlan.cityR === t.r)
        );
        const emptyPorts = gameState.tiles.filter(t => t.isPort && !t.unit && t.camp === aiCamp);
        const campKey = campToKey(aiCamp);
        for (const city of emptyCities.slice(0, difficultyProfile.fallbackRecruitLimit)) {
            if (gameState.gameOver || gameState.currentCamp !== aiCamp || !gameState.aiActing) break;
            if (isCityDisabled(city)) continue;
            const unique = getCulturalRecruitmentCandidate(gameState, aiCamp);
            const canSpareAssault = gameState.tiles.some(({ unit }) => unit?.camp === aiCamp && unit.hp > 0
                && unit.commander !== 'minister' && canCaptureCityByCombat(unit));
            const prioritizeUnique = unique && (getUnitBaseType(unique) !== 'archer' || canSpareAssault)
                && canRecruitTypeAtSelectedSite(unique, city, gameState, aiCamp);
            const budget = gameState.playerGold[campKey];
            const uniqueCost = prioritizeUnique ? getHistoricalRecruitCost(UNIT_CONFIG[unique].cost, gameState, aiCamp, unique) : Infinity;
            if (prioritizeUnique && budget < uniqueCost && canSpareAssault && countLivingUnitsOfType(gameState, aiCamp, unique) === 0
                && estimateVisibleThreatAt(city, aiCamp, difficultyProfile.threatForecast) < 0.45) continue;
            const unitType = budget >= uniqueCost ? unique : helpers.recruitTypesForCity(city, ['infantry'])
                .find(type => budget >= getHistoricalRecruitCost(UNIT_CONFIG[type].cost, gameState, aiCamp, type));
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
            && isKnownToAi(tile, aiCamp)
            && isUnitVisibleToCamp(tile.unit, aiCamp, gameState));
        const portFallbackBlocked = fleetSaturated
            || (landMap && getActiveCultureId(gameState, aiCamp) !== 'us' && (!hostileNavy || navalCount >= 1));
        for (const port of emptyPorts) {
            if (gameState.gameOver || gameState.currentCamp !== aiCamp || !gameState.aiActing) break;
            if (landMap && gameState.tiles.some(tile => tile.unit && isHostile(gameState, aiCamp, tile.unit.camp)
                && tile.unit.config?.movementDomain === 'naval' && hexDistance(tile, port) <= 2)) continue;
            const hostileTypes = new Set(gameState.tiles
                .filter(tile => tile.unit && isHostile(gameState, aiCamp, tile.unit.camp)
                    && isKnownToAi(tile, aiCamp) && isUnitVisibleToCamp(tile.unit, aiCamp, gameState))
                .map(tile => getUnitBaseType(tile.unit)));
            let navalOrder = hostileTypes.has('submarine')
                ? ['destroyer', 'submarine', 'warship']
                : hostileTypes.has('warship')
                    ? ['submarine', 'destroyer', 'warship']
                    : hostileTypes.has('destroyer')
                        ? ['warship', 'destroyer', 'submarine']
                        : ['destroyer', 'submarine', 'warship'];
            if (portFallbackBlocked) navalOrder = [];
            const unique = getCulturalRecruitmentCandidate(gameState, aiCamp);
            if (unique && canRecruitTypeAtSelectedSite(unique, port, gameState, aiCamp)) {
                const uniqueCost = getHistoricalRecruitCost(UNIT_CONFIG[unique].cost, gameState, aiCamp, unique);
                if (gameState.playerGold[campKey] < uniqueCost && countLivingUnitsOfType(gameState, aiCamp, unique) === 0
                    && estimateVisibleThreatAt(port, aiCamp, difficultyProfile.threatForecast) < 0.40) continue;
                navalOrder.unshift(unique);
            }
            const unitType = navalOrder.find(type => {
                const c = getHistoricalRecruitCost(UNIT_CONFIG[type].cost, gameState, aiCamp, type);
                return gameState.playerGold[campKey] >= c && canRecruitTypeAtSelectedSite(type, port, gameState, aiCamp);
            });
            if (unitType) {
                await executeAction({ type: 'recruit', unitType, tileQ: port.q, tileR: port.r }, aiCamp);
            }
        }
        if (!gameState.gameOver && gameState.currentCamp === aiCamp && gameState.aiActing) {
            await runAiFieldFortifications(aiCamp, difficultyProfile);
            if (getActiveCultureId(gameState, aiCamp) === 'cpc') {
                for (const tile of gameState.tiles) {
                    const unit = tile.unit;
                    if (unit?.type !== 'cpc_guerrilla' || unit.camp !== aiCamp || unit.hp <= 0
                        || getGuerrillaConcealmentReason(unit, gameState)) continue;
                    const canSetAmbush = gameState.tiles.some(target => target.unit?.hp > 0
                        && hexDistance(tile, target) <= 3 && canAttack(gameState, aiCamp, target.unit.camp)
                        && isKnownToAi(target, aiCamp) && isUnitVisibleToCamp(target.unit, aiCamp, gameState));
                    if (canSetAmbush) await runObservedAction({ type: 'guerrillaConcealment', unitId: unit.id }, aiCamp,
                        () => executeGuerrillaConcealment(unit));
                }
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
