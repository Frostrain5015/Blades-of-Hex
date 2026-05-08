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
                if (unit.canAct && unit.tile && unit.hp > 0) {
                    const atkTiles = getAttackableTiles(unit);
                    const MY_DISTRICTS = new Set([3, 4, 5]);
                    const inTurf = atkTiles.filter(t => MY_DISTRICTS.has(t.districtId));
                    if (inTurf.length > 0 && unit.remainingMP === 0) {
                        await delay(AI_DELAY);
                        gameState.selectedUnit = unit;
                        gameState.attackableTiles = atkTiles;
                        attackUnit(unit, inTurf[0].unit);
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
    } finally {
        gameState.aiActing = false;
    }
}
