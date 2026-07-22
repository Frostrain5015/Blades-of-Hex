// rules/citySiege.js — 城市HP、驻军防御转化与围城占领判定的单一规则入口。
// 大型城市：由中心格 + radius 定义的正六边形城郭，全城共享一个血池。
// 血池只存于中心格（isCity），城内其余地块（isUrban）持镜像 hp/maxHp，
// 以便渲染、快照、联机序列化等直接读取 tile.hp 而无需感知血池结构。

import { deepFreeze } from './freeze.js';
import { canAttack } from './diplomacy.js';

export const CITY_SIEGE_CONFIG = deepFreeze({
    // 独立结构伤害不读取驻军防御，直接用可见血池承担耐久差异，
    // 不在伤害管线中引入隐藏的结构承伤系数。
    baseMaxHp: 250,
    maxHpPerRadius: 200,
    regenPctPerRound: 0.10,
    maxDefensePct: 0.20,
    // 炮兵/军舰的火炮攻城修正：规则系数，与海陆互攻减半（naval.js 的
    // getCrossDomainDamageBonus）同层相加，不是相乘。军舰基础型号两者相加抵消，
    // 回到基准攻城效率；支援型巡洋舰的专精攻陆加成再叠加后可超出基准（见
    // getCannonSiegeDamageBonus 的调用方 _resolveGroundNavalSiegeDamage）。
    cannonSiegeDamageBonus: 0.50
});

/** 城市血池上限：半径0=250，每向外扩大一圈 +200（半径1=450、半径2=650）。 */
export function getCityMaxHp(radius = 0) {
    const r = Math.max(0, Math.round(Number(radius) || 0));
    return CITY_SIEGE_CONFIG.baseMaxHp + CITY_SIEGE_CONFIG.maxHpPerRadius * r;
}

/** 攻城时享受 cannonSiegeDamageBonus 的火炮类攻击者：炮兵、军舰（巡洋舰）。 */
export const CANNON_SIEGE_ATTACKER_TYPES = Object.freeze(new Set(['archer', 'warship']));

/** 火炮攻城修正：与 getCrossDomainDamageBonus 同为可加算的规则系数，由调用方相加后统一乘算。 */
export function getCannonSiegeDamageBonus(attacker) {
    return CANNON_SIEGE_ATTACKER_TYPES.has(attacker?.type) ? CITY_SIEGE_CONFIG.cannonSiegeDamageBonus : 0;
}

/** 由城市总格数反推正六边形圈数（旧档随意涂抹的 footprint → 最近似半径）。 */
export function getCityRadiusFromTileCount(count) {
    const n = Math.max(1, Math.round(Number(count) || 1));
    let radius = 0;
    // 半径 r 的正六边形城市群总格数 = 1 + 3r(r+1)
    while (1 + 3 * radius * (radius + 1) < n) radius++;
    return radius;
}

/** 驻军防御加成：满血 +maxDefensePct，按当前HP百分比线性衰减（半血即减半）。 */
export function getCityDefenseBonus(tile) {
    const maxHp = Number(tile?.maxHp) || 0;
    if (maxHp <= 0) return 0;
    const hp = Math.max(0, Number(tile?.hp) || 0);
    return CITY_SIEGE_CONFIG.maxDefensePct * Math.max(0, Math.min(1, hp / maxHp));
}

/** 城市"脱战"一整轮后的自动回复量。 */
export function getCityRegenAmount(tile) {
    const maxHp = Number(tile?.maxHp) || 0;
    return Math.round(maxHp * CITY_SIEGE_CONFIG.regenPctPerRound);
}

/** HP=0 即视为瘫痪：机场指令与招募不可用，金币收入不受影响。 */
export function isCityDisabled(tile) {
    return !!tile?.isCity && (Number(tile.hp) || 0) <= 0;
}

/** 解析地块所属城市的血池宿主（中心格）；footprint 格经 urbanCenterKey 回溯。 */
export function getCityPoolTile(tile, tileMap) {
    if (!tile) return null;
    if (tile.isCity) return tile;
    if (tile.isUrban && tile.urbanCenterKey && tileMap?.get) {
        const centre = tileMap.get(tile.urbanCenterKey);
        if (centre?.isCity) return centre;
    }
    return null;
}

/** 把中心格血池的 hp/maxHp 镜像到全城所有城内格（中心格自身除外）。 */
export function syncCityHpMirrors(poolTile, tileMap) {
    if (!poolTile?.isCity || !tileMap) return;
    const centreKey = `${poolTile.q},${poolTile.r}`;
    const tiles = tileMap instanceof Map ? tileMap.values() : Object.values(tileMap);
    for (const tile of tiles) {
        if (!tile || tile === poolTile) continue;
        if (tile.isUrban && tile.urbanCenterKey === centreKey) {
            tile.hp = poolTile.hp;
            tile.maxHp = poolTile.maxHp;
        }
    }
}

/** 从任意城内格对共享血池扣血并同步镜像；返回血池剩余HP。 */
export function damageCityPool(anyCityTile, damage, tileMap) {
    const pool = getCityPoolTile(anyCityTile, tileMap) || (anyCityTile?.isCity ? anyCityTile : null);
    if (!pool) return 0;
    pool.hp = Math.max(0, (Number(pool.hp) || 0) - Math.max(0, Math.round(Number(damage) || 0)));
    syncCityHpMirrors(pool, tileMap);
    return pool.hp;
}

/**
 * 城市结构伤害：城市本体没有防御乘区，只读取攻击方火力、攻城增伤与本次独立浮动。
 * 驻军的兵种/地形/单位防御不应渗入此结果。
 */
export function calculateCityStructureDamage(attackPower, damageBonus, floatMultiplier) {
    const power = Math.max(0, Number(attackPower) || 0);
    const offenseMultiplier = Math.max(0, 1 + (Number(damageBonus) || 0));
    const roll = Math.max(0, Number(floatMultiplier) || 0);
    return Math.max(1, Math.round(power * offenseMultiplier * roll));
}

/**
 * 城外单位攻击城内驻军时，驻军与城市共享这次打击。
 * 同一城市 footprint 内部发生的战斗不重复伤害本城；无城市血池或已破城时也不触发。
 */
export function shouldDamageCityAlongsideGarrison(attackerTile, targetTile, tileMap) {
    const targetPool = getCityPoolTile(targetTile, tileMap);
    if (!targetPool || (Number(targetPool.hp) || 0) <= 0) return false;
    const attackerPool = getCityPoolTile(attackerTile, tileMap);
    return attackerPool !== targetPool;
}

/** 城墙未破且无驻军时，敌方/中立单位完全不能进入或合并落地；城郭每格都适用。 */
export function isCitySiegeBlocked(tile, moverCamp, state) {
    if (!tile?.isCity && !tile?.isUrban) return false;
    if (tile.unit) return false;
    const pool = getCityPoolTile(tile, state?.tileMap) || tile;
    if ((Number(pool.hp) || 0) <= 0) return false;
    return canAttack(state, moverCamp, tile.camp);
}

/**
 * 该单位是否可以把这个空城地块当作攻城目标。
 * 潜艇无法攻击陆地；航母的舰载机走独立的空军式伤害管线（读将领/上校加成，
 * 不经过 getEffectiveAttack），在 attackCityTile 内走专属分支结算，不接入
 * 这条通用地面/海军攻城公式。
 */
export function isSiegeableCityTile(unit, tile, state) {
    if (unit?.type === 'submarine') return false;
    return isCitySiegeBlocked(tile, unit?.camp, state);
}
