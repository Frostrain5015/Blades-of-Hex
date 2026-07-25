// rules/tianheng.js — 天衡联邦阵营协同【日月天衡】规则。
// 日月天衡是一个充能制被动技能：每回合末回收本阵营单位的剩余行动力作为充能，
// 充满 100 点后自动释放——全体获得 40 点护盾、士气提升 2 回合、暴击率提升 30% 持续 2 回合、
// 遭遇战全图视野 1 回合。不再是一局一张的主动卡牌。
// （释放效果原为「回满生命」，现改为统一 40 点护盾，与士气/暴击同为 2 回合的加护窗口。）
// 阈值原为 200（按 ~7~8 回合触发一次的节奏定为阶段性大招）；平衡调整后减半为 100，
// 触发节奏约 3.5~4 回合一次，从终局大招转为常规循环。回收的是「闲置」行动力，
// 原地攻击不清空 remainingMP，防守阵地战每回合能攒近乎整份army移动力（中等规模army约 22~30/回合）。

import { campToKey } from './camps.js';
import { getRoundIndex } from './turns.js';
import { TIANHENG_FACTION_SYNERGY, getCommanderFactionSynergy } from './factionSynergies.js';

export const TIANHENG_COMMANDER_IDS = TIANHENG_FACTION_SYNERGY.commanderIds;

/** 日月天衡充能阈值。 */
export const SUN_MOON_CHARGE_THRESHOLD = 100;

/** 日月天衡释放后的加护：暴击率提升 + 持续回合数（与士气提升、护盾同为 2 回合）。 */
export const SUN_MOON_OATH_DURATION_ROUNDS = 2;
export const SUN_MOON_OATH_CRIT_BONUS = 0.30;

/** 日月天衡释放时为全体单位施加的护盾值（取代原「回满生命」）。 */
export const SUN_MOON_SHIELD_AMOUNT = 40;

/**
 * HUD 用效果描述（暴击加护）。暴击率通过操纵浮动倍率区间上下限实现，
 * 前端仍以「暴击率提升」直观呈现。
 */
export const SUN_MOON_OATH_EFFECT = Object.freeze({
    name: '日月天衡',
    icon: '⚖️',
    type: '阵营协同',
    critRateBonus: SUN_MOON_OATH_CRIT_BONUS,
    durationRounds: SUN_MOON_OATH_DURATION_ROUNDS,
    color: '#8ab8d9'
});

export function isTianhengCommanderId(commanderId) {
    return getCommanderFactionSynergy(commanderId)?.id === TIANHENG_FACTION_SYNERGY.id;
}

export function isTianhengCommanderUnit(unit) {
    return Boolean(unit?.isCommanderUnit && isTianhengCommanderId(unit.commander));
}

export function getLivingTianhengCommanders(gameState, campOrKey) {
    if (!gameState?.tiles || !campOrKey) return [];
    const campKey = typeof campOrKey === 'string' ? campOrKey : campToKey(campOrKey);
    return gameState.tiles
        .map(tile => tile.unit)
        .filter(unit => unit && unit.hp > 0
            && campToKey(unit.camp) === campKey
            && isTianhengCommanderUnit(unit));
}

/** ≥2 名天衡将领存活即协同激活。 */
export function hasTianhengSynergyActive(gameState, campOrKey) {
    return getLivingTianhengCommanders(gameState, campOrKey).length >= 2;
}

/** 某阵营的全部存活单位（含将领与普通兵）。 */
export function getLivingCampUnits(gameState, campOrKey) {
    if (!gameState?.tiles || !campOrKey) return [];
    const campKey = typeof campOrKey === 'string' ? campOrKey : campToKey(campOrKey);
    return gameState.tiles
        .map(tile => tile.unit)
        .filter(unit => unit && unit.hp > 0 && campToKey(unit.camp) === campKey);
}

/** 回合结束时可回收的真实闲置行动力；必须在全场单位行动力重置前读取。 */
export function getUnusedMovementCharge(gameState, campOrKey) {
    return getLivingCampUnits(gameState, campOrKey).reduce(
        (total, unit) => total + Math.max(0, Number(unit.remainingMP) || 0),
        0
    );
}

/**
 * 日月天衡结算：本阵营全体存活单位——
 *   ① 获得 40 点护盾（叠加现有护盾），持续2回合；
 *   ② 士气提升至昂扬（3），持续2回合；
 *   ③ 暴击率提升 30%，持续2回合（在伤害管线内上移浮动区间实现）；
 *   ④ 遭遇战模式下获得1回合全图视野。
 * 返回受影响的 unitId 列表。
 */
export function resolveBorrowDay(gameState, campOrKey) {
    if (!gameState) return [];
    const campKey = typeof campOrKey === 'string' ? campOrKey : campToKey(campOrKey);
    const units = getLivingCampUnits(gameState, campKey);
    const oathUntil = getRoundIndex(gameState) + SUN_MOON_OATH_DURATION_ROUNDS;

    for (const unit of units) {
        // 原「回满生命」改为统一施加 40 点护盾（与士气/暴击同为 2 回合窗口）。
        // 若单位已有永久护盾（_shield>0 且 _shieldTurns=0，如护盾卡），保持永久，
        // 避免把永久护盾错误地压成 2 回合计时（护盾为单一血池，倒计时会整体清零）。
        const hadPermanentShield = (unit._shield || 0) > 0 && (unit._shieldTurns || 0) === 0;
        unit._shield = (unit._shield || 0) + SUN_MOON_SHIELD_AMOUNT;
        unit._shieldMax = Math.max(unit._shieldMax || 0, unit._shield);
        unit._shieldTurns = hadPermanentShield
            ? 0
            : Math.max(unit._shieldTurns || 0, SUN_MOON_OATH_DURATION_ROUNDS);
        unit.morale = 3;
        unit.moraleBoostUntil = getRoundIndex(gameState) + 2;
        unit._sunMoonOathUntilRound = oathUntil;
    }

    if (gameState.skirmishFog) {
        if (!gameState.scoutReveals[campKey]) gameState.scoutReveals[campKey] = new Map();
        const reveals = gameState.scoutReveals[campKey];
        const expiresAt = getRoundIndex(gameState) + 1;
        for (const tile of gameState.tiles || []) {
            const coord = `${tile.q},${tile.r}`;
            const prev = reveals.get(coord);
            if (prev === undefined || prev < expiresAt) {
                reveals.set(coord, expiresAt);
            }
        }
    }

    return units.map(u => u.id);
}

// ==== 充能系统 ========================================================

/**
 * 记入剩余行动力充能。超过阈值时自动释放日月天衡并扣除阈值。
 * @returns 触发时返回 affected unitId 数组；未触发返回空数组。
 */
export function accrueSunMoonCharge(gameState, campKey, amount) {
    const add = Math.max(0, Math.round(Number(amount) || 0));
    if (!gameState || !campKey || add <= 0) return [];
    if (!hasTianhengSynergyActive(gameState, campKey)) return [];
    if (!gameState._sunMoonCharge) gameState._sunMoonCharge = {};
    const charge = (gameState._sunMoonCharge[campKey] || 0) + add;
    gameState._sunMoonCharge[campKey] = charge;

    if (charge >= SUN_MOON_CHARGE_THRESHOLD) {
        gameState._sunMoonCharge[campKey] = charge - SUN_MOON_CHARGE_THRESHOLD;
        return resolveBorrowDay(gameState, campKey);
    }
    return [];
}

/** HUD 充能进度（0~1）。 */
export function getSunMoonChargeRatio(gameState, campOrKey) {
    const campKey = typeof campOrKey === 'string' ? campOrKey : campToKey(campOrKey);
    const charge = gameState?._sunMoonCharge?.[campKey] || 0;
    return Math.max(0, Math.min(1, charge / SUN_MOON_CHARGE_THRESHOLD));
}

// ==== 暴击加护（释放后持续 2 回合）====================================

/** 单位身上日月天衡暴击加护的剩余回合数（0 表示未生效）。 */
export function getSunMoonOathRemainingRounds(unit, gameState) {
    if (!unit || !gameState) return 0;
    const expiresAt = Number(unit._sunMoonOathUntilRound) || 0;
    return Math.max(0, expiresAt - getRoundIndex(gameState));
}

/** 单位当前是否处于日月天衡暴击加护下。 */
export function hasSunMoonOathEffect(unit, gameState) {
    return getSunMoonOathRemainingRounds(unit, gameState) > 0;
}

/** 伤害管线读取的暴击率加成：加护期内为 SUN_MOON_OATH_CRIT_BONUS，否则 0。 */
export function getSunMoonOathCritBonus(unit, gameState) {
    return hasSunMoonOathEffect(unit, gameState) ? SUN_MOON_OATH_CRIT_BONUS : 0;
}

// ==== 旧版兼容（已废弃） ===============================================
export function hasBorrowDayPaybackPending() { return false; }
export function applyBorrowDayPayback() { return []; }
