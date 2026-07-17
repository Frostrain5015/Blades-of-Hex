// 战争迷雾引擎 —— 视野计算、状态管理、过渡动画
import { hexDistance, getRoundIndex } from './config.js';
import { COMMANDER_CONFIG } from '../rules/commanders.js';
import { SKIRMISH_VISION } from '../rules/constants.js';
import { getRelation } from '../rules/diplomacy.js';
import { isMechanicEnabled } from '../rules/mechanics.js';
import { campToKey } from '../rules/camps.js';
import { getFactionKeys } from '../rules/diplomacy.js';
import { areCommanderMechanicsSuppressed } from '../rules/movement.js';

// 视野范围：各兵种能看到的格子数（规则键：GAME_RULES.skirmishVision）
export const UNIT_VISION = SKIRMISH_VISION.unitVision;

// 己方城市提供相邻6格视野
export const CITY_VISION_RANGE = SKIRMISH_VISION.cityVisionRange;

// 迷雾过渡动画时长 (ms)
const FOG_TRANSITION_MS = 500;

// camp → playerGold key 映射
const _campKey = (camp) =>
    campToKey(camp);

// ---- 核心：计算一个阵营当前能看到的所有地块 ----
function _getEffectiveVision(unit, gs) {
    let range;
    if (unit.type === 'archer') {
        range = unit.config.range;
        if (isMechanicEnabled(gs, 'weatherEffects') && gs.weather === 'fog') range -= 1;
        let bonus = 0;
        if (unit.tile.terrain === 'mountain') bonus = 1;
        if (gs.weather === 'wind') bonus = Math.max(bonus, 1);
        range = Math.max(1, Math.min(4, range + bonus));
    } else {
        range = UNIT_VISION[unit.type] || 1;
    }
    // 轻骑兵等专精的遭遇战视野加成
    range += unit.getSpecializationAbility?.('skirmishVisionBonus') || 0;
    if (unit.commander === 'tianyan' && !areCommanderMechanicsSuppressed(unit)) range += COMMANDER_CONFIG.tianyan.balance.visionBonus;
    return Math.max(1, Math.min(5, range));
}

export function computeVisionForCamp(camp, tiles, tileMap, gameState) {
    const visible = new Set();
    const gs = gameState;

    for (const tile of tiles) {
        if (tile.unit && tile.unit.camp === camp) {
            const range = _getEffectiveVision(tile.unit, gs);
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

    // 亡灵法师亡魂标记：为本阵营持续提供视野，范围=原单位视野（即便被敌方占据也可见）
    if (gs && gs._soulMarks && gs._soulMarks.length) {
        const myKey = _campKey(camp);
        for (const mark of gs._soulMarks) {
            if (mark.campKey !== myKey) continue;
            const mt = tileMap.get(`${mark.q},${mark.r}`);
            if (!mt) continue;
            const range = UNIT_VISION[mark.origType] || 1;
            for (const t of tiles) {
                if (hexDistance(mt, t) <= range) visible.add(`${t.q},${t.r}`);
            }
        }
    }

    return visible;
}

// ---- 更新迷雾状态（回合开始/行动后调用）----

let _onTilesRevealed = null;
/**
 * 设置地块揭示回调。每次 updateFogOfWar 发现新可见地块时触发，
 * 供战役触发器系统消费。
 * @param {function} cb - (campKey: string, tiles: {q:number,r:number}[]) => void
 */
export function setOnTilesRevealed(cb) { _onTilesRevealed = cb; }

export function updateFogOfWar(gameState, camp) {
    if (!gameState.skirmishFog || !isMechanicEnabled(gameState, 'fogOfWar')) return;
    const key = _campKey(camp);
    if (key === 'neutral') return;

    // 保存更新前的可见集合用于过渡动画
    const prevVisible = gameState.visibleTiles[key];
    gameState._prevVisibleTiles[key] = new Set(prevVisible);
    gameState._fogTransitionStart = performance.now();

    const newVisible = computeVisionForCamp(camp, gameState.tiles, gameState.tileMap, gameState);

    // 侦察揭示格也纳入 visibleTiles，参与过渡动画追踪，避免每步闪烁
    const reveals = gameState.scoutReveals[key];
    for (const [coord, expires] of reveals) {
        if (expires > getRoundIndex(gameState)) {
            newVisible.add(coord);
        }
    }

    // 计算新揭示的地块（用于战役触发器条件）
    const newlyRevealed = [];
    if (_onTilesRevealed && prevVisible) {
        for (const coord of newVisible) {
            if (!prevVisible.has(coord)) {
                const [q, r] = coord.split(',').map(Number);
                if (Number.isInteger(q) && Number.isInteger(r)) newlyRevealed.push({ q, r });
            }
        }
    }

    // 将新看到的加入已探索集合
    const explored = gameState.exploredTiles[key];
    for (const k of newVisible) explored.add(k);

    gameState.visibleTiles[key] = newVisible;

    // 触发揭示回调（在 visibleTiles 写入后，保证触发器读取到最新状态）
    if (_onTilesRevealed && newlyRevealed.length > 0) {
        _onTilesRevealed(key, newlyRevealed);
    }
}

export function updateAllFogOfWar(gameState) {
    if (!gameState?.skirmishFog || !isMechanicEnabled(gameState, 'fogOfWar')) return false;
    let updated = false;
    for (const key of getFactionKeys(gameState)) {
        const faction = gameState.factions?.[key];
        if (key === 'neutral' || faction?.active === false) continue;
        updateFogOfWar(gameState, faction || key);
        updated = true;
    }
    return updated;
}

function activePresentationHold(gameState, camp, now) {
    const key = _campKey(camp);
    const holds = gameState?._fogPresentationHolds;
    const hold = holds?.[key];
    if (!hold) return null;
    if (now < hold.until) return hold;
    delete holds[key];
    // Start the ordinary fog fade when the moving badge reaches its logical
    // destination, not when the move command mutates simulation state.
    gameState._prevVisibleTiles[key] = new Set(hold.visible);
    gameState._fogTransitionStart = hold.until;
    return null;
}

/** Keep newly revealed battlefield information covered during move animation. */
export function beginFogPresentationHold(gameState, camp, durationMs) {
    if (!gameState?.skirmishFog || !isMechanicEnabled(gameState, 'fogOfWar')) return false;
    const duration = Math.max(0, Number(durationMs) || 0);
    if (duration <= 0) return false;
    const key = _campKey(camp);
    if (key === 'neutral') return false;
    const visible = new Set();
    const explored = new Set();
    for (const tile of gameState.tiles || []) {
        const coord = `${tile.q},${tile.r}`;
        if (isTileVisible(tile, camp, gameState)) visible.add(coord);
        else if (isTileExplored(tile, camp, gameState)) explored.add(coord);
    }
    gameState._fogPresentationHolds ||= {};
    gameState._fogPresentationHolds[key] = {
        visible,
        explored,
        until: performance.now() + duration
    };
    return true;
}

export function hasActiveFogPresentationHold(gameState, camp, now = performance.now()) {
    return Boolean(activePresentationHold(gameState, camp, now));
}

// ---- 侦察揭示 ----
export function applyScoutReveal(gameState, camp, q, r, radius = 1, durationRounds = 1) {
    if (!gameState.skirmishFog) return;
    const key = _campKey(camp);
    if (key === 'neutral') return;
    const expiresAt = getRoundIndex(gameState) + Math.max(1, Math.trunc(durationRounds));
    const reveals = [];
    const safeRadius = Math.max(0, Math.trunc(radius));
    for (let dq = -safeRadius; dq <= safeRadius; dq++) {
        for (let dr = -safeRadius; dr <= safeRadius; dr++) {
            if ((Math.abs(dq) + Math.abs(dr) + Math.abs(dq + dr)) / 2 <= safeRadius) reveals.push([dq, dr]);
        }
    }
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
        if (expires <= getRoundIndex(gameState)) reveals.delete(coord);
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
    if (!gameState.skirmishFog || !isMechanicEnabled(gameState, 'fogOfWar')) return true;
    const key = _campKey(camp);
    if (key === 'neutral') return true;
    if (gameState.visibleTiles[key].has(`${tile.q},${tile.r}`)) return true;
    if (isMechanicEnabled(gameState, 'alliedVision')) {
        const coord = `${tile.q},${tile.r}`;
        for (const allyKey of getFactionKeys(gameState)) {
            if (allyKey !== key && getRelation(gameState, key, allyKey) === 'ally' && gameState.visibleTiles?.[allyKey]?.has(coord)) return true;
        }
    }
    // 侦察揭示的地块也视为可见
    if (isScoutRevealed(tile, camp, gameState)) return true;
    return false;
}

export function isTileExplored(tile, camp, gameState) {
    if (!gameState.skirmishFog || !isMechanicEnabled(gameState, 'fogOfWar')) return true;
    const key = _campKey(camp);
    if (key === 'neutral') return true;
    const coord = `${tile.q},${tile.r}`;
    if (gameState.exploredTiles[key].has(coord)) return true;
    if (isMechanicEnabled(gameState, 'alliedVision')) {
        for (const allyKey of getFactionKeys(gameState)) {
            if (allyKey !== key && getRelation(gameState, key, allyKey) === 'ally' && gameState.exploredTiles?.[allyKey]?.has(coord)) return true;
        }
    }
    return false;
}

export function revealFogTiles(gameState, camp, tiles, durationRounds = null) {
    const key = _campKey(camp);
    if (key === 'neutral') return 0;
    gameState.scoutReveals ||= {};
    gameState.scoutReveals[key] ||= new Map();
    const rounds = Number(durationRounds);
    const expiresAt = durationRounds == null
        ? Number.MAX_SAFE_INTEGER
        : getRoundIndex(gameState) + Math.max(1, Math.round(Number.isFinite(rounds) ? rounds : 1));
    let changed = 0;
    for (const tile of tiles || []) {
        if (!Number.isInteger(tile?.q) || !Number.isInteger(tile?.r)) continue;
        const coord = `${tile.q},${tile.r}`;
        const previous = gameState.scoutReveals[key].get(coord);
        if (previous !== undefined && previous >= expiresAt) continue;
        gameState.scoutReveals[key].set(coord, expiresAt);
        changed++;
    }
    if (changed && gameState.skirmishFog) updateFogOfWar(gameState, camp);
    return changed;
}

export function getTileVisibilityState(tile, camp, gameState) {
    if (!gameState.skirmishFog) return 'visible';
    if (isTileVisible(tile, camp, gameState)) return 'visible';
    if (isTileExplored(tile, camp, gameState)) return 'explored';
    return 'unexplored';
}

export function getPresentedTileVisibilityState(tile, camp, gameState, now = performance.now()) {
    if (!gameState?.skirmishFog) return 'visible';
    const hold = activePresentationHold(gameState, camp, now);
    if (!hold) return getTileVisibilityState(tile, camp, gameState);
    const coord = `${tile.q},${tile.r}`;
    if (hold.visible.has(coord)) return 'visible';
    if (hold.explored.has(coord)) return 'explored';
    return 'unexplored';
}

export function getTileVisibilityStateByCoord(q, r, camp, gs) {
    if (!gs || !gs.skirmishFog) return 'visible';
    const tile = { q, r };
    if (isTileVisible(tile, camp, gs)) return 'visible';
    if (isTileExplored(tile, camp, gs)) return 'explored';
    return 'unexplored';
}

// ---- 过渡动画：获取地块当前遮罩透明度 ----
// 返回值: { alpha: 0~1, state: 'visible'|'explored'|'unexplored' }
export function getFogAlpha(tile, camp, gameState, now) {
    if (!gameState.skirmishFog) return { alpha: 0, state: 'visible' };

    const key = _campKey(camp);
    if (key === 'neutral') return { alpha: 0, state: 'visible' };

    const coord = `${tile.q},${tile.r}`;
    const hold = activePresentationHold(gameState, camp, now);
    // A stationary friendly unit guarantees visibility. During a movement
    // hold the logical destination remains covered; its moving badge is drawn
    // separately above the fog layer.
    if (tile.unit && tile.unit.camp === camp && (!hold || hold.visible.has(coord))) {
        return { alpha: 0, state: 'visible' };
    }

    const curState = hold
        ? (hold.visible.has(coord) ? 'visible' : hold.explored.has(coord) ? 'explored' : 'unexplored')
        : getTileVisibilityState(tile, camp, gameState);
    const wasVisible = hold
        ? hold.visible.has(coord)
        : gameState._prevVisibleTiles[key].has(coord);
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
