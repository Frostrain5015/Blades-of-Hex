// AI 调度器 — 加载人格文件，管理执行与延迟
// 支持多 AI 人格：Claude（中立防御型）、Grok（玩家对手进攻型）

import { gameState, clearselection, notify, logMessage } from './state.js';
import {
    getMovableTiles, getAttackableTiles, moveUnit, attackUnit, recruitUnit,
    executeTacticalCard, executeEngineerTrench, executeEngineerFlak, executeEngineerBunkerConstruction, recalcAllFlankingMorale, drawCard
} from './gameLogic.js';
import { CAMP, HEX_NEIGHBORS, hexDistance, UNIT_CONFIG, TACTICAL_CARD_CONFIG, CARD_SYSTEM_CONFIG, COLONEL_CARD_GOLD, FORTIFICATION_CONFIG } from './config.js';
import { ENGINEER_BUNKER_GOLD_COST } from '../commander/engineer.js';
import { isNetworkGame, sendMessage } from './network.js';
import { getCommander } from './commanderInterface.js';
import { spawnCommanderSkillEffect } from './effects.js';
import { updateFogOfWar, isTileVisible } from './fogOfWar.js';
import * as claudePersonality from '../.ai/claude.js';
import * as grokPersonality from '../.ai/grok.js';

const AI_DELAY = 1500;
const ACTION_TIMEOUT = 8000; // 单次行动超时：8秒

function delay(ms) {
    return new Promise(r => setTimeout(r, ms));
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

function planEngineerAction(aiCamp) {
    const campKey = aiCamp === CAMP.neutral ? 'neutral' : aiCamp === CAMP.player1 ? 'player1' : 'player2';
    const engineer = gameState.tiles.reduce((found, tile) => found || (
        tile.unit && tile.unit.commander === 'engineer' && tile.unit.camp === aiCamp && tile.unit.canAct && !tile.unit._engineerConstruction
            ? tile.unit : null
    ), null);
    if (!engineer || !engineer.tile) return null;

    const hostileTiles = gameState.tiles.filter(tile => tile.unit && tile.unit.camp !== aiCamp);
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
function makeHelpers() {
    return { getMovableTiles, getAttackableTiles, hexDistance, HEX_NEIGHBORS, CAMP, UNIT_CONFIG, weather: gameState.weather, isTileVisible: (tile, camp) => isTileVisible(tile, camp, gameState), CARD_SYSTEM_CONFIG, COLONEL_CARD_GOLD };
}

async function executeAction(action, aiCamp) {
    if (gameState.gameOver) return;
    if (!gameState.aiActing || gameState.currentCamp !== aiCamp) return;

    const label = `${action.type}${action.unitId ? ' ' + action.unitId : ''}`;
    try {
        await withTimeout(_executeActionInner(action, aiCamp), ACTION_TIMEOUT, label);
    } catch (e) {
        if (e && e.message && e.message.startsWith('AI_ACTION_TIMEOUT')) {
            console.warn(`AI action timed out: ${label}`);
        } else {
            console.warn(`AI action failed: ${label}`, e);
        }
    } finally {
        clearselection();
        gameState.selectedCityTile = null;
    }
}

async function _executeActionInner(action, aiCamp) {
    if (gameState.gameOver) return;

    const isNeutral = aiCamp === CAMP.neutral;
    const campKey = isNeutral ? 'neutral' : (aiCamp === CAMP.player1 ? 'player1' : 'player2');

    // 自动攻击辅助：从可攻击目标中选最优，返回是否执行了攻击
    async function _autoAttack(unit) {
        if (!unit.canAct || !unit.tile || unit.hp <= 0) return false;
        const atkTiles = getAttackableTiles(unit);
        let targets;
        if (isNeutral) {
            const MY_DISTRICTS = new Set([3, 4, 5]);
            targets = atkTiles.filter(t => t.unit && t.unit.camp !== CAMP.neutral && MY_DISTRICTS.has(t.districtId));
            if (targets.length === 0) {
                targets = atkTiles.filter(t => t.unit && t.unit.camp !== CAMP.neutral);
            }
        } else {
            const enemyCamp = aiCamp === CAMP.player1 ? CAMP.player2 : CAMP.player1;
            targets = atkTiles.filter(t => t.unit && (t.unit.camp === enemyCamp || t.unit.camp === CAMP.neutral));
        }
        if (targets.length === 0) return false;

        const COUNTER = {
            infantry: { archer: 0.75, cavalry: 1.25, mgNest: 0.75, drone: 1 },
            archer: { cavalry: 0.75, infantry: 1.25, mgNest: 1.25, drone: 1 },
            cavalry: { infantry: 0.75, archer: 1.25, mgNest: 0.75, drone: 1 },
            mgNest: { infantry: 1.25, archer: 0.75, cavalry: 1.25, drone: 1 },
            drone: { infantry: 1.25, archer: 1, cavalry: 1, mgNest: 1, drone: 1 }
        };
        const TERRAIN_DEF = { plains: 0, forest: 0.10, mountain: 0.20 };
        let best = targets[0];
        let bestScore = -Infinity;
        for (const t of targets) {
            const target = t.unit;
            const c = (COUNTER[unit.type] && COUNTER[unit.type][target.type]) || 1;
            const tDef = (TERRAIN_DEF[target.tile.terrain] || 0)
                + (FORTIFICATION_CONFIG[target.tile.fortification]?.defenseBonus || 0);
            const cityDef = (target.type === 'infantry' && target.tile.isCity) ? 0.05 : 0;
            const unitDef = target.config.defense || 0;
            const moraleFloat = unit.morale === 3 ? 1.07 : unit.morale === 1 ? 0.95 : unit.morale === 0 ? 0.90 : 1.0;
            const counterFloat = c > 1 ? 1.10 : c < 1 ? 0.93 : 1.0; // 克制仅影响暴击浮动
            const estDmg = unit.getEffectiveAttack() * moraleFloat * counterFloat * Math.max(0.3, 1 - tDef - cityDef - unitDef);
            let score = 0;
            if (estDmg >= target.hp) score += 200;
            score += (1 - target.hp / target.maxHp) * 60;
            if (c >= 1.25) score += 30;
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
        case 'move': {
            const unit = resolveUnit(action.unitId);
            const targetTile = resolveTile(action.tileQ, action.tileR);
            if (!unit || !targetTile || !unit.canAct || !unit.tile || targetTile.unit) return;
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
            if (!cityTile || !cityTile.isCity || cityTile.unit) return;
            const gold = gameState.playerGold[campKey];
            if (gold < UNIT_CONFIG[action.unitType].cost) return;
            gameState.selectedCityTile = cityTile;
            await delay(AI_DELAY);
            recruitUnit(action.unitType);
            break;
        }
        case 'deployCommander': {
            const unit = resolveUnit(action.unitId);
            if (!unit || !unit.tile || unit.commander) return;
            const myCamp = aiCamp;
            const cmdKey = myCamp === CAMP.player1 ? gameState.commanderP1 : gameState.commanderP2;
            if (!cmdKey) return;
            const cmdCfg = getCommander(cmdKey);
            if (!cmdCfg) return;
            // 直接应用将领效果（绕过 UI 流程）
            unit.commander = cmdKey;
            unit._cmdrAssignedAt = performance.now();
            const hpFlat = Math.round(unit.config.hp * (cmdCfg.hpBonusPct || 0));
            const atkFlat = Math.round(unit.config.attack * (cmdCfg.atkBonusPct || 0));
            unit.hp += hpFlat;
            unit.maxHp += hpFlat;
            unit.displayHp = unit.hp;
            unit._atkBonus = (unit._atkBonus || 0) + atkFlat;
            unit.remainingMP += cmdCfg.spdBonus || 0;
            unit.displaySpeed += cmdCfg.spdBonus || 0;
            if (cmdCfg.onDeploy) {
                cmdCfg.onDeploy(unit, gameState, { getCommander });
            }
            if (myCamp === CAMP.player1) {
                gameState.commanderP1Deployed = true;
            } else {
                gameState.commanderP2Deployed = true;
            }
            logMessage(`${myCamp.name} AI【${cmdCfg.name}】部署到${unit.config.name}兵`);
            spawnCommanderSkillEffect(unit.tile.x, unit.tile.y);
            await delay(AI_DELAY);
            break;
        }
        case 'activateSkill': {
            const unit = resolveUnit(action.unitId);
            if (!unit || !unit.tile || !unit.commander || !unit.canAct) return;
            const cmdCfg = getCommander(unit.commander);
            if (!cmdCfg || !cmdCfg.activeSkill) return;
            if (unit.activeSkillCD > 0 || unit.activeSkillDur > 0) return;
            const skill = cmdCfg.activeSkill;
            skill.onActivate(unit, {
                gameState, logMessage, spawnFx: spawnCommanderSkillEffect
            });
            unit.activeSkillDur = skill.duration;
            unit.activeSkillCD = skill.cooldown;
            recalcAllFlankingMorale();
            logMessage(`${aiCamp.name} AI【${cmdCfg.name}】激活主动技能【${skill.name}】`);
            spawnCommanderSkillEffect(unit.tile.x, unit.tile.y);
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
            const target = resolveUnit(action.targetId);
            if (!target || !target.tile) return;
            const cardId = action.cardId;
            if (!cardId) return;
            const hand = gameState.playerHands[campKey] || [];
            if (!hand.includes(cardId)) return;
            if (gameState.playerUsesThisTurn[campKey] >= CARD_SYSTEM_CONFIG.maxUsesPerTurn) return;
            gameState.currentCamp = aiCamp;
            try {
                executeTacticalCard(cardId, target.tile);
            } finally {
                gameState.currentCamp = aiCamp;
            }
            await delay(AI_DELAY);
            break;
        }
    }
}

// ═══════════════════════════════════════════
// 中立 AI 回合（Claude 防御型人格）
// ═══════════════════════════════════════════

export async function processNeutralTurn() {
    if (gameState.gameOver) return;

    gameState.aiActing = true;
    const aiCamp = CAMP.neutral;
    // 遭遇战迷雾：AI 也需要更新视野
    if (gameState.skirmishFog) updateFogOfWar(gameState, aiCamp);
    try {

        const helpers = makeHelpers();
        const actions = claudePersonality.planActions(gameState, helpers);
        const engineerAction = planEngineerAction(aiCamp);
        if (engineerAction) actions.unshift(engineerAction);

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
            t.camp === CAMP.neutral
        );
        for (const city of emptyCities) {
            if (gameState.gameOver || gameState.currentCamp !== aiCamp || !gameState.aiActing) break;
            if (gameState.playerGold.neutral >= UNIT_CONFIG.infantry.cost) {
                await executeAction({ type: 'recruit', unitType: 'infantry', tileQ: city.q, tileR: city.r }, aiCamp);
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
    if (aiCamp === CAMP.neutral) return; // 中立用 Claude

    gameState.aiActing = true;
    // 遭遇战迷雾：AI 也需要更新视野
    if (gameState.skirmishFog) updateFogOfWar(gameState, aiCamp);
    try {

        const helpers = makeHelpers();
        const actions = grokPersonality.planActions(gameState, helpers, aiCamp);
        const engineerAction = planEngineerAction(aiCamp);
        if (engineerAction) actions.unshift(engineerAction);

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
        const campKey = aiCamp === CAMP.player1 ? 'player1' : 'player2';
        for (const city of emptyCities) {
            if (gameState.gameOver || gameState.currentCamp !== aiCamp || !gameState.aiActing) break;
            if (gameState.playerGold[campKey] >= UNIT_CONFIG.infantry.cost) {
                await executeAction({ type: 'recruit', unitType: 'infantry', tileQ: city.q, tileR: city.r }, aiCamp);
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
