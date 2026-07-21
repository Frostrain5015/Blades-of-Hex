// rules/noctis.js — 诺克提斯共和国阵营协同【血月之夜】规则。
// 血月是一种由诺克提斯召唤的「特殊天气」：靠本阵营的暴击伤害攒够【血潮】才降临，
// 持续 2 回合，期间接管两条规则——
//   永夜（禁疗）：本阵营的敌方单位一切回复无效；
//   月蚀（放血，不分阵营）：全场生命 ≤50% 的单位每整轮流失「已损失生命 ⅓」真伤。
// 本模块只保存平衡参数与无副作用判定 + 计量/放血结算；天气切换与每轮调用在 gameLogic。

import { campToKey } from './camps.js';
import { isHostile, campFromKey } from './diplomacy.js';
import { NOCTIS_FACTION_SYNERGY, getCommanderFactionSynergy } from './factionSynergies.js';

export const NOCTIS_COMMANDER_IDS = NOCTIS_FACTION_SYNERGY.commanderIds;

// 天气系统中的血月标识（与 rain/fog/wind/clear 并列）。
export const BLOOD_MOON_WEATHER = 'bloodMoon';

/**
 * 平衡参数（唯一数值源，描述由此派生）：
 *   bleedThresholdPct —— 生命 ≤ 此比例·maxHp 才进入放血；
 *   bleedLostHpPct    —— 每整轮流失「已损失生命」的比例（⅓，随失血几何加速）；
 *   durationRounds    —— 血月天气持续回合数；
 *   bloodTideThreshold—— 累计多少「暴击伤害」（浮动超 1.00 的部分）召唤一次血月。
 */
export const NOCTIS_BLOODMOON_BALANCE = Object.freeze({
    bleedThresholdPct: 0.5,
    bleedLostHpPct: 1 / 3,
    durationRounds: 2,
    bloodTideThreshold: 120
});

export function isNoctisCommanderId(commanderId) {
    return getCommanderFactionSynergy(commanderId)?.id === NOCTIS_FACTION_SYNERGY.id;
}

export function isNoctisCommanderUnit(unit) {
    return Boolean(unit?.isCommanderUnit && isNoctisCommanderId(unit.commander));
}

export function getLivingNoctisCommanders(gameState, campOrKey) {
    if (!gameState?.tiles || !campOrKey) return [];
    const campKey = typeof campOrKey === 'string' ? campOrKey : campToKey(campOrKey);
    return gameState.tiles
        .map(tile => tile.unit)
        .filter(unit => unit && unit.hp > 0
            && campToKey(unit.camp) === campKey
            && isNoctisCommanderUnit(unit));
}

/** ≥2 名诺克提斯将领存活即协同激活（无身份去重）。 */
export function hasNoctisSynergyActive(gameState, campOrKey) {
    return getLivingNoctisCommanders(gameState, campOrKey).length >= 2;
}

/** 当前所有「协同激活」的诺克提斯阵营 key（兼容多阵营/3p）。 */
export function getActiveNoctisCampKeys(gameState) {
    if (!gameState?.factions) return [];
    return Object.keys(gameState.factions)
        .filter(key => key !== 'neutral' && hasNoctisSynergyActive(gameState, key));
}

// ==== 血潮计量（触发门槛）================================================
// 前端只显示「血月充能 xx%」= charge / bloodTideThreshold；不暴露浮动/暴击机制。

/** 单次命中的「暴击伤害」= 浮动倍率超过 1.00 的那部分（floatMult≤1 记 0）。 */
export function computeCritExcess(dealt, floatMult) {
    const d = Number(dealt) || 0;
    const f = Number(floatMult) || 0;
    if (d <= 0 || f <= 1) return 0;
    return Math.max(0, Math.round(d * (f - 1) / f));
}

function ensureBloodTide(gameState, campKey) {
    if (!gameState._noctisBloodTide) gameState._noctisBloodTide = {};
    const tide = gameState._noctisBloodTide[campKey] ||= { charge: 0, moonsPending: 0 };
    if (tide.charge == null) tide.charge = 0;
    if (tide.moonsPending == null) tide.moonsPending = 0;
    return tide;
}

/**
 * 记入血潮并结算跨过的阈值：每满一个阈值 moonsPending+1（下一段天气窗降临血月）。
 * 仅在该阵营 ≥2 将领存活时累积。返回本次新增的待召唤次数。
 */
export function accrueBloodTide(gameState, campKey, amount) {
    const add = Math.max(0, Math.round(Number(amount) || 0));
    if (!gameState || !campKey || add <= 0) return 0;
    if (!hasNoctisSynergyActive(gameState, campKey)) return 0;
    const tide = ensureBloodTide(gameState, campKey);
    tide.charge += add;
    const { bloodTideThreshold } = NOCTIS_BLOODMOON_BALANCE;
    let summoned = 0;
    while (tide.charge >= bloodTideThreshold) {
        tide.charge -= bloodTideThreshold;
        tide.moonsPending += 1;
        summoned += 1;
    }
    return summoned;
}

/**
 * 从一次战斗命中记入血潮：攻击方为「协同激活的诺克提斯阵营」且目标敌对时，
 * 按该命中的暴击伤害（浮动超 1.00 部分）累计。真伤（floatMult=1）天然记 0。
 */
export function accrueBloodTideFromHit(gameState, { attacker, target, dealt, floatMult } = {}) {
    if (!gameState || !attacker?.camp || !target?.camp) return 0;
    const campKey = campToKey(attacker.camp);
    if (!hasNoctisSynergyActive(gameState, campKey)) return 0;
    if (!isHostile(gameState, attacker.camp, target.camp)) return 0;
    const excess = computeCritExcess(dealt, floatMult);
    return excess > 0 ? accrueBloodTide(gameState, campKey, excess) : 0;
}

/** HUD 充能进度（0~1，封顶 1）。前端据此显示「血月充能 xx%」。 */
export function getBloodMoonChargeRatio(gameState, campOrKey) {
    const campKey = typeof campOrKey === 'string' ? campOrKey : campToKey(campOrKey);
    const tide = gameState?._noctisBloodTide?.[campKey];
    if (!tide) return 0;
    const { bloodTideThreshold } = NOCTIS_BLOODMOON_BALANCE;
    if (tide.moonsPending > 0) return 1;
    return Math.max(0, Math.min(1, tide.charge / bloodTideThreshold));
}

/** 是否有任一诺克提斯阵营蓄满、等待降临血月。 */
export function anyBloodMoonPending(gameState) {
    const tides = gameState?._noctisBloodTide;
    if (!tides) return false;
    return getActiveNoctisCampKeys(gameState).some(key => (tides[key]?.moonsPending || 0) > 0);
}

/**
 * 消费一次待召唤（在天气窗开启时调用）：任一激活阵营有待召唤则各扣 1，
 * 返回 true 表示本段天气窗应设为血月。
 */
export function consumeBloodMoonSummon(gameState) {
    const tides = gameState?._noctisBloodTide;
    if (!tides) return false;
    let consumed = false;
    for (const key of getActiveNoctisCampKeys(gameState)) {
        const tide = tides[key];
        if (tide && tide.moonsPending > 0) {
            tide.moonsPending -= 1;
            consumed = true;
        }
    }
    return consumed;
}

// ==== 血月天气效果 =======================================================

export function isBloodMoonWeatherActive(gameState) {
    return gameState?.weather === BLOOD_MOON_WEATHER;
}

/**
 * 永夜·禁疗：血月期间，若 unit 与任一「协同激活的诺克提斯阵营」敌对，则其回复无效。
 * 己方不禁疗（这正是「养过半血线自救」博弈的前提）。
 */
export function isBloodMoonHealSuppressed(unit, gameState) {
    if (!unit?.camp || !gameState || !isBloodMoonWeatherActive(gameState)) return false;
    for (const key of getActiveNoctisCampKeys(gameState)) {
        const noctisCamp = campFromKey(key, gameState);
        if (noctisCamp && isHostile(gameState, noctisCamp, unit.camp)) return true;
    }
    return false;
}

/**
 * 月蚀·放血（不分阵营）：血月期间每整轮调用一次。对全场生命 ≤50%·maxHp 的所有
 * 单位（含诺克提斯自己、含将领——决策：将领不豁免）造成「已损失生命 × ⅓」真伤。
 * 返回被放血单位清单供广播/表现。真伤不归属击杀者，避免连锁。
 */
export function resolveBloodMoonBleed(gameState) {
    if (!gameState?.tiles || !isBloodMoonWeatherActive(gameState)) return [];
    const { bleedThresholdPct, bleedLostHpPct } = NOCTIS_BLOODMOON_BALANCE;
    const hits = [];
    for (const tile of gameState.tiles) {
        const unit = tile.unit;
        if (!unit || unit.hp <= 0) continue;
        if (unit.hp > unit.maxHp * bleedThresholdPct) continue; // 中高血量不受影响
        const lost = Math.max(0, unit.maxHp - unit.hp);
        const dmg = Math.round(lost * bleedLostHpPct);
        if (dmg <= 0) continue;
        const hpBefore = unit.hp;
        unit.applyDamage(dmg, { source: 'true', attacker: null });
        const dealt = Math.max(0, hpBefore - Math.max(0, unit.hp));
        if (dealt <= 0) continue;
        hits.push({ unitId: unit.id, q: tile?.q, r: tile?.r, dmg: dealt, killed: unit.hp <= 0 });
    }
    return hits;
}
