// AI 调度器 — 加载人格文件，管理执行与延迟

import { gameState, clearselection, notify, logMessage } from './state.js';
import {
    getMovableTiles, getAttackableTiles, moveUnit, attackUnit, recruitUnit
} from './gameLogic.js';
import { CAMP, HEX_NEIGHBORS, hexDistance, UNIT_CONFIG } from './config.js';
import { isNetworkGame, sendMessage } from './network.js';
import * as personality from '../.ai/claude.js';

const AI_DELAY = 2500;
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

const helpers = { getMovableTiles, getAttackableTiles, hexDistance, HEX_NEIGHBORS, CAMP, UNIT_CONFIG, weather: gameState.weather };

function resolveUnit(id) {
    for (const tile of gameState.tiles) {
        if (tile.unit && tile.unit.id === id) return tile.unit;
    }
    return null;
}

function resolveTile(q, r) {
    return gameState.tileMap.get(`${q},${r}`);
}

async function executeAction(action) {
    if (gameState.gameOver) return;
    if (!gameState.aiActing || gameState.currentCamp !== CAMP.neutral) return;

    const label = `${action.type}${action.unitId ? ' ' + action.unitId : ''}`;
    try {
        await withTimeout(_executeActionInner(action), ACTION_TIMEOUT, label);
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

async function _executeActionInner(action) {
    if (gameState.gameOver) return;

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
                if (unit.canAct && unit.tile && unit.hp > 0 && unit.remainingMP === 0) {
                    const atkTiles = getAttackableTiles(unit);
                    const MY_DISTRICTS = new Set([3, 4, 5]);
                    let inTurf = atkTiles.filter(t => t.unit && t.unit.camp !== CAMP.neutral && MY_DISTRICTS.has(t.districtId));
                    if (inTurf.length === 0) {
                        inTurf = atkTiles.filter(t => t.unit && t.unit.camp !== CAMP.neutral);
                    }
                    if (inTurf.length > 0) {
                        // 选最优目标：斩杀 > 残血 > 顺克
                        const COUNTER = { infantry: { archer: 0.75, cavalry: 1.25 }, archer: { cavalry: 0.75, infantry: 1.25 }, cavalry: { infantry: 0.75, archer: 1.25 } };
                        const TERRAIN_DEF = { plains: 0, forest: 0.10, mountain: 0.20 };
                        let best = inTurf[0];
                        let bestScore = -Infinity;
                        for (const t of inTurf) {
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
                    }
                }
            }
            break;
        }
        case 'recruit': {
            const cityTile = resolveTile(action.tileQ, action.tileR);
            if (!cityTile || !cityTile.isCity || cityTile.unit) return;
            const gold = gameState.playerGold.neutral;
            if (gold < UNIT_CONFIG[action.unitType].cost) return;
            gameState.selectedCityTile = cityTile;
            await delay(AI_DELAY);
            recruitUnit(action.unitType);
            break;
        }
    }
}

export async function processNeutralTurn() {
    if (gameState.gameOver) return;

    gameState.aiActing = true;
    try {
        notify('AI正在行动...', 'info');
        logMessage('AI正在行动...');
        if (isNetworkGame()) sendMessage({ type: 'toast', text: 'AI正在行动...', toastType: 'info' });

        const actions = personality.planActions(gameState, helpers);

        for (let i = 0; i < actions.length; i++) {
            if (gameState.gameOver || gameState.currentCamp !== CAMP.neutral || !gameState.aiActing) break;
            await executeAction(actions[i]);
        }

        // ── 最终兜底：补满所有空城，强制步兵驻守 ──
        const MY_DISTRICTS = new Set([3, 4, 5]);
        const emptyCities = gameState.tiles.filter(t =>
            t.isCity && !t.unit &&
            MY_DISTRICTS.has(t.districtId) &&
            t.camp === CAMP.neutral
        );
        for (const city of emptyCities) {
            if (gameState.gameOver || gameState.currentCamp !== CAMP.neutral || !gameState.aiActing) break;
            if (gameState.playerGold.neutral >= UNIT_CONFIG.infantry.cost) {
                await executeAction({ type: 'recruit', unitType: 'infantry', tileQ: city.q, tileR: city.r });
            }
        }
    } finally {
        gameState.aiActing = false;
    }
}
