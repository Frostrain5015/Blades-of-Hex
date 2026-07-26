// rules/laserTower.js — 激光塔【集束激光】齐射规则。
// 每阵营回合开始时，本方每座激光塔自动攻击射程 3 内的所有合法敌对目标；
// 命中目标越多单发伤害越高（20 + 6×(N−1)，单发上限 50），固定伤害无浮动。
// 纯规则层：不访问 DOM，迷雾可见性由调用方注入（与 AI helpers 同一形态）。

import { campToKey } from './camps.js';
import { hexDistance } from './hex.js';
import { canAttack } from './diplomacy.js';
import { canUnitTargetUnit } from './naval.js';
import { COMBAT_BALANCE } from './constants.js';

export const LASER_TOWER_BALANCE = COMBAT_BALANCE.laserTower;

/** 单发伤害：N 个目标时 20 + 6×(N−1)，封顶 maxDamage。 */
export function laserTowerShotDamage(targetCount, balance = LASER_TOWER_BALANCE) {
    if (targetCount <= 0) return 0;
    return Math.min(balance.maxDamage, balance.baseDamage + balance.perExtraTarget * (targetCount - 1));
}

/**
 * 结算本方全部激光塔的回合开始齐射，返回广播/表现载荷。
 * @param {object} gameState
 * @param {string} campKey 回合开始方阵营键
 * @param {object} [options]
 * @param {function} [options.isTileVisible] 遭遇战迷雾判定 (tile, camp, state) => boolean
 * @returns {{ volleys: Array<{towerId:number,q:number,r:number,x:number,y:number,
 *   hits:Array<{unitId:number,q:number,r:number,x:number,y:number,dmg:number,killed:boolean}>}> }}
 */
export function resolveLaserTowerVolley(gameState, campKey, options = {}) {
    const result = { volleys: [] };
    if (!gameState?.tiles || !campKey) return result;
    const balance = LASER_TOWER_BALANCE;

    const towers = gameState.tiles
        .map(tile => tile.unit)
        .filter(unit => unit && unit.hp > 0 && unit.type === 'laserTower'
            && campToKey(unit.camp) === campKey
            && !unit._constructionScaffold && !unit._engineerScaffold);
    if (towers.length === 0) return result;

    for (const tower of towers) {
        const towerTile = tower.tile;
        if (!towerTile) continue;
        const range = tower.getEffectiveRange?.() ?? tower.config?.range ?? 3;
        const targets = [];
        for (const tile of gameState.tiles) {
            const target = tile.unit;
            if (!target || target.hp <= 0) continue;
            if (hexDistance(towerTile, tile) > range) continue;
            if (!canAttack(gameState, tower.camp, target.camp)) continue;
            if (!canUnitTargetUnit(tower, target)) continue;
            if (gameState.skirmishFog && typeof options.isTileVisible === 'function'
                && !options.isTileVisible(tile, tower.camp, gameState)) continue;
            targets.push({ unit: target, tile });
        }
        if (targets.length === 0) continue;

        const dmg = laserTowerShotDamage(targets.length, balance);
        const hits = [];
        for (const { unit, tile } of targets) {
            const hpBefore = unit.hp;
            unit.applyDamage(dmg, { source: 'ranged', attacker: tower });
            const dealt = Math.max(0, hpBefore - Math.max(0, unit.hp));
            if (dealt <= 0) continue;
            hits.push({
                unitId: unit.id, q: tile.q, r: tile.r, x: tile.x, y: tile.y,
                dmg: dealt, killed: unit.hp <= 0
            });
        }
        if (hits.length === 0) continue;
        result.volleys.push({ towerId: tower.id, q: towerTile.q, r: towerTile.r, x: towerTile.x, y: towerTile.y, hits });
    }
    return result;
}
