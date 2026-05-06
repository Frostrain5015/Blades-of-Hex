// AI 调度器 — 加载人格文件，管理执行与延迟

import { gameState, clearselection, notify } from './state.js';
import {
    getMovableTiles, getAttackableTiles, moveUnit, attackUnit, recruitUnit
} from './gameLogic.js';
import { CAMP, HEX_NEIGHBORS, hexDistance, UNIT_CONFIG } from './config.js';
import * as personality from '../.ai/claude.js';

const AI_DELAY = 2500;

function delay(ms) {
    return new Promise(r => setTimeout(r, ms));
}

const helpers = { getMovableTiles, getAttackableTiles, hexDistance, HEX_NEIGHBORS, CAMP, UNIT_CONFIG };

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
            clearselection();
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
                // 移动后补刀：检查是否有境内可攻击目标
                if (unit.canAct && unit.tile && unit.hp > 0) {
                    const atkTiles = getAttackableTiles(unit);
                    // 小克只攻击境内敌人
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
            clearselection();
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
            gameState.selectedCityTile = null;
            break;
        }
    }
}

export async function processNeutralTurn() {
    if (gameState.gameOver) return;

    notify('AI正在行动...', 'info');
    gameState.aiActing = true;

    const actions = personality.planActions(gameState, helpers);

    for (let i = 0; i < actions.length; i++) {
        if (gameState.gameOver) break;
        await executeAction(actions[i]);
    }

    await delay(500);
    notify('AI行动完毕 即将切换回合...', 'info');
    await delay(3000);
    gameState.aiActing = false;
}
