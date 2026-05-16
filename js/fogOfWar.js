// 战争迷雾引擎 —— 视野计算、状态管理、过渡动画
import { hexDistance, CAMP } from './config.js';

// 视野范围：各兵种能看到的格子数
export const UNIT_VISION = {
    infantry: 1,
    cavalry: 2,
    archer: 2,
    mgNest: 2,
};

// 己方城市提供相邻6格视野
export const CITY_VISION_RANGE = 1;

// 迷雾过渡动画时长 (ms)
const FOG_TRANSITION_MS = 500;

// camp → playerGold key 映射
const _campKey = (camp) =>
    camp === CAMP.player1 ? 'player1' :
    camp === CAMP.player2 ? 'player2' :
    camp === CAMP.player3 ? 'player3' : 'neutral';

// ---- 核心：计算一个阵营当前能看到的所有地块 ----
export function computeVisionForCamp(camp, tiles, tileMap) {
    const visible = new Set();

    for (const tile of tiles) {
        if (tile.unit && tile.unit.camp === camp) {
            const range = UNIT_VISION[tile.unit.type] || 1;
            for (const t of tiles) {
                if (hexDistance(tile, t) <= range) {
                    visible.add(`${t.q},${t.r}`);
                }
            }
        }
        if (tile.isCity && tile.camp === camp) {
            for (const t of tiles) {
                if (hexDistance(tile, t) <= CITY_VISION_RANGE) {
                    visible.add(`${t.q},${t.r}`);
                }
            }
        }
        // 村庄仅能看到自身一格，被敌方占据后视野消失
        if (tile.isVillage) {
            const cityTile = tiles.find(t => t.isCity && t.districtId === tile.villageDistrictId);
            const villageCamp = cityTile ? cityTile.camp : null;
            if (villageCamp === camp && (!tile.unit || tile.unit.camp === camp)) {
                visible.add(`${tile.q},${tile.r}`);
            }
        }
    }

    return visible;
}

// ---- 更新迷雾状态（回合开始/行动后调用）----
export function updateFogOfWar(gameState, camp) {
    if (!gameState.skirmishFog) { console.log('[FOG DEBUG] updateFogOfWar: SKIPPED (skirmishFog=false) for camp=' + (camp && camp.name)); return; }
    const key = _campKey(camp);
    if (key === 'neutral') { console.log('[FOG DEBUG] updateFogOfWar: SKIPPED (neutral)'); return; }

    // 保存更新前的可见集合用于过渡动画
    const prevVisible = gameState.visibleTiles[key];
    gameState._prevVisibleTiles[key] = new Set(prevVisible);
    gameState._fogTransitionStart = performance.now();

    const newVisible = computeVisionForCamp(camp, gameState.tiles, gameState.tileMap);

    // 侦察揭示格也纳入 visibleTiles，参与过渡动画追踪，避免每步闪烁
    const reveals = gameState.scoutReveals[key];
    for (const [coord, expires] of reveals) {
        if (expires > gameState.turnCounter) {
            newVisible.add(coord);
        }
    }

    // 将新看到的加入已探索集合
    const explored = gameState.exploredTiles[key];
    for (const k of newVisible) explored.add(k);

    gameState.visibleTiles[key] = newVisible;
}

// ---- 侦察揭示 ----
export function applyScoutReveal(gameState, camp, q, r) {
    if (!gameState.skirmishFog) return;
    const key = _campKey(camp);
    if (key === 'neutral') return;
    const expiresAt = gameState.turnCounter + 1; // 持续到下回合结束
    // 揭示目标及周围6格
    const reveals = [[0,0], [1,0], [1,-1], [0,-1], [-1,0], [-1,1], [0,1]];
    for (const [dq, dr] of reveals) {
        const coord = `${q + dq},${r + dr}`;
        // 仅记录当前回合数更高的过期时间（重复侦察刷新持续时间）
        const prev = gameState.scoutReveals[key].get(coord);
        if (prev === undefined || prev < expiresAt) {
            gameState.scoutReveals[key].set(coord, expiresAt);
        }
    }
}

export function expireScoutReveals(gameState, camp) {
    if (!gameState.skirmishFog) return;
    const key = _campKey(camp);
    if (key === 'neutral') return;
    const reveals = gameState.scoutReveals[key];
    for (const [coord, expires] of reveals) {
        if (expires <= gameState.turnCounter) reveals.delete(coord);
    }
}

function isScoutRevealed(tile, camp, gameState) {
    if (!gameState.skirmishFog) return false;
    const key = _campKey(camp);
    if (key === 'neutral') return false;
    return gameState.scoutReveals[key].has(`${tile.q},${tile.r}`);
}

// ---- 查询辅助 ----
export function isTileVisible(tile, camp, gameState) {
    if (!gameState.skirmishFog) return true;
    const key = _campKey(camp);
    if (key === 'neutral') return true;
    if (gameState.visibleTiles[key].has(`${tile.q},${tile.r}`)) return true;
    // 侦察揭示的地块也视为可见
    if (isScoutRevealed(tile, camp, gameState)) return true;
    return false;
}

export function isTileExplored(tile, camp, gameState) {
    if (!gameState.skirmishFog) return true;
    const key = _campKey(camp);
    if (key === 'neutral') return true;
    return gameState.exploredTiles[key].has(`${tile.q},${tile.r}`);
}

export function getTileVisibilityState(tile, camp, gameState) {
    if (!gameState.skirmishFog) return 'visible';
    if (isTileVisible(tile, camp, gameState)) return 'visible';
    if (isTileExplored(tile, camp, gameState)) return 'explored';
    return 'unexplored';
}

export function getTileVisibilityStateByCoord(q, r, camp, gs) {
    if (!gs || !gs.skirmishFog) return 'visible';
    const key = _campKey(camp);
    if (key === 'neutral') return 'visible';
    const coord = `${q},${r}`;
    if (gs.visibleTiles[key].has(coord)) return 'visible';
    // also check scout reveals
    if (gs.scoutReveals && gs.scoutReveals[key]) {
        for (const [sc, expires] of gs.scoutReveals[key]) {
            if (sc === coord && Date.now() < expires) return 'visible';
        }
    }
    if (gs.exploredTiles[key].has(coord)) return 'explored';
    return 'unexplored';
}

// ---- 过渡动画：获取地块当前遮罩透明度 ----
// 返回值: { alpha: 0~1, state: 'visible'|'explored'|'unexplored' }
export function getFogAlpha(tile, camp, gameState, now) {
    if (!gameState.skirmishFog) return { alpha: 0, state: 'visible' };

    const key = _campKey(camp);
    if (key === 'neutral') return { alpha: 0, state: 'visible' };

    // 己方部队所在格永远可见，避免部队走入迷雾时被过渡遮罩短暂盖住
    if (tile.unit && tile.unit.camp === camp) return { alpha: 0, state: 'visible' };

    const curState = getTileVisibilityState(tile, camp, gameState);
    const coord = `${tile.q},${tile.r}`;
    const wasVisible = gameState._prevVisibleTiles[key].has(coord);
    const isVisible = curState === 'visible';
    const isExplored = curState === 'explored';

    // 计算过渡进度
    const elapsed = now - (gameState._fogTransitionStart || 0);
    const t = Math.min(1, elapsed / FOG_TRANSITION_MS);

    if (isVisible) {
        if (wasVisible) {
            // 一直可见 → 无遮罩
            return { alpha: 0, state: 'visible' };
        }
        // 新揭示（unexplored/explored → visible）：遮罩淡出
        return { alpha: 1.0 * (1 - t), state: 'visible' };
    }

    if (isExplored) {
        if (wasVisible) {
            // 刚离开视野（visible → explored）：半透明遮罩淡入
            return { alpha: 0.35 * t, state: 'explored' };
        }
        // 一直处于 explored 或从 unexplored 进入 explored
        return { alpha: 0.35, state: 'explored' };
    }

    // unexplored
    return { alpha: 1.0, state: 'unexplored' };
}

// 获取之前是否可见（用于部队淡出动画判断）
export function wasTileVisible(tile, camp, gameState) {
    if (!gameState.skirmishFog) return true;
    const key = _campKey(camp);
    if (key === 'neutral') return true;
    return gameState._prevVisibleTiles[key].has(`${tile.q},${tile.r}`);
}
