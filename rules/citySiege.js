// rules/citySiege.js — 城市HP、驻军防御转化与围城占领判定的单一规则入口。

import { deepFreeze } from './freeze.js';
import { canAttack } from './diplomacy.js';

export const CITY_SIEGE_CONFIG = deepFreeze({
    maxHp: 200,
    regenPctPerRound: 0.10,
    defensePctPer100Hp: 0.10
});

/** 驻军单位从城市当前HP换算出的防御力加成；用当前HP而非满血，城墙被磨过就少加。 */
export function getCityDefenseBonus(tile) {
    const hp = Math.max(0, Number(tile?.hp) || 0);
    return (hp / 100) * CITY_SIEGE_CONFIG.defensePctPer100Hp;
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

/** 城墙未破且无驻军时，敌方/中立单位完全不能进入或合并落地。 */
export function isCitySiegeBlocked(tile, moverCamp, state) {
    if (!tile?.isCity || tile.unit || (Number(tile.hp) || 0) <= 0) return false;
    return canAttack(state, moverCamp, tile.camp);
}

/**
 * 该单位是否可以把这个空城地块当作攻城目标。
 * 潜艇无法攻击陆地；航母的舰载机走独立的空军式伤害管线（读将领/上校加成，
 * 不经过 getEffectiveAttack），不接入这条通用地面/海军攻城公式。
 */
export function isSiegeableCityTile(unit, tile, state) {
    if (unit?.type === 'submarine' || unit?.type === 'carrier') return false;
    return isCitySiegeBlocked(tile, unit?.camp, state);
}
