// AI 调度器 — 加载人格文件，管理执行与延迟
// 支持多 AI 人格：Claude（中立防御型）、Grok（玩家对手进攻型）

import { gameState, clearselection, notify, logMessage } from './state.js';
import {
    getMovableTiles, getAttackableTiles, moveUnit, attackUnit, recruitUnit,
    executeTacticalCard, recalcAllFlankingMorale
} from './gameLogic.js';
import { CAMP, HEX_NEIGHBORS, hexDistance, UNIT_CONFIG, TACTICAL_CARD_CONFIG } from './config.js';
import { isNetworkGame, sendMessage } from './network.js';
import { getCommander } from './commanderInterface.js';
import { spawnCommanderSkillEffect } from './effects.js';
import * as claudePersonality from '../.ai/claude.js';
import * as grokPersonality from '../.ai/grok.js';

const AI_DELAY = 2000;
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

// 创建 helpers（每次执行时刷新 weather 等动态值）
function makeHelpers() {
    return { getMovableTiles, getAttackableTiles, hexDistance, HEX_NEIGHBORS, CAMP, UNIT_CONFIG, weather: gameState.weather };
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

        const COUNTER = { infantry: { archer: 0.75, cavalry: 1.25 }, archer: { cavalry: 0.75, infantry: 1.25 }, cavalry: { infantry: 0.75, archer: 1.25 } };
        const TERRAIN_DEF = { plains: 0, forest: 0.10, mountain: 0.20 };
        let best = targets[0];
        let bestScore = -Infinity;
        for (const t of targets) {
            const target = t.unit;
            const c = (COUNTER[unit.type] && COUNTER[unit.type][target.type]) || 1;
            const tDef = TERRAIN_DEF[target.tile.terrain] || 0;
            const cityDef = (target.type === 'infantry' && target.tile.isCity) ? 0.20 : 0;
            const unitDef = target.config.defense || 0;
            const estDmg = unit.getEffectiveAttack() * Math.max(0.1, 1 + c - 1 - tDef - cityDef - unitDef);
            let score = 0;
            if (estDmg >= target.hp) score += 200;
            score += (1 - target.hp / target.maxHp) * 60;
            if (c >= 1.25) score += 30;
            if (target.hp <= 25) score += 40;
            if (score > bestScore) { bestScore = score; best = t; }
        }
        await delay(AI_DELAY);
        gameState.selectedUnit = unit;
        gameState.attackableTiles = atkTiles;
        attackUnit(unit, best.unit);
        return true;
    }

    switch (action.type) {
        case 'attack': {
            const unit = resolveUnit(action.unitId);
            const target = resolveUnit(action.targetId);
            if (!unit || !target || !unit.canAct || !unit.tile || !target.tile) return;
            gameState.selectedUnit = unit;
            gameState.attackableTiles = getAttackableTiles(unit);
            if (gameState.attackableTiles.includes(target.tile)) {
                await delay(AI_DELAY);
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
            gameState.selectedUnit = unit;
            gameState.movableTiles = getMovableTiles(unit);
            if (gameState.movableTiles.includes(targetTile)) {
                await delay(AI_DELAY);
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
            unit.hp += cmdCfg.hpBonus || 0;
            unit.maxHp += cmdCfg.hpBonus || 0;
            unit.displayHp = unit.hp;
            unit._atkBonus = (unit._atkBonus || 0) + (cmdCfg.atkBonus || 0);
            unit.remainingMP += cmdCfg.spdBonus || 0;
            unit.displaySpeed += cmdCfg.spdBonus || 0;
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
        case 'tacticalCard': {
            const target = resolveUnit(action.targetId);
            if (!target || !target.tile) return;
            const cardId = action.cardId;
            if (!cardId) return;
            // 校验冷却和金币
            const cards = gameState.tacticalCards[campKey] || {};
            if ((cards[cardId] || 0) > 0) return;
            const cfg = TACTICAL_CARD_CONFIG[cardId];
            if (!cfg) return;
            if (gameState.playerGold[campKey] < cfg.cost) return;
            // 执行战术卡
            gameState.currentCamp = aiCamp; // 确保 executeTacticalCard 识别正确阵营
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
    try {
        logMessage('AI正在行动...');
        if (isNetworkGame()) sendMessage({ type: 'toast', text: 'AI正在行动...', toastType: 'info' });

        const helpers = makeHelpers();
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
    try {
        logMessage('AI对手正在行动...');
        if (isNetworkGame()) sendMessage({ type: 'toast', text: 'AI对手正在行动...', toastType: 'info' });

        const helpers = makeHelpers();
        const actions = grokPersonality.planActions(gameState, helpers, aiCamp);

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
