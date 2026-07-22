// rules/tianheng.js — 天衡联邦阵营协同【日月天衡】规则。
// 日月天衡是一个充能制被动技能：每回合末回收本阵营单位的剩余行动力作为充能，
// 充满 180 点后自动释放——全体回满生命、士气提升持续2回合、遭遇战全图视野1回合。
// 不再是一局一张的主动卡牌。
// 阈值取 180：回收的是「闲置」行动力，原地攻击不清空 remainingMP，防守阵地战每回合
// 能攒近乎整份army移动力（中等规模army约 22~30/回合）；60 时「全军回满+士气拉满2回合
// +全图视野」约 1.5~2 回合即满，过廉。按 ~7 回合触发一次的节奏(6~8 回合区间)定为 180，
// 使其成为阶段性大招而非常规循环。实际节奏随army规模/打法浮动，可据实战再调。

import { campToKey } from './camps.js';
import { getRoundIndex } from './turns.js';
import { TIANHENG_FACTION_SYNERGY, getCommanderFactionSynergy } from './factionSynergies.js';

export const TIANHENG_COMMANDER_IDS = TIANHENG_FACTION_SYNERGY.commanderIds;

/** 日月天衡充能阈值。 */
export const SUN_MOON_CHARGE_THRESHOLD = 180;

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

/**
 * 日月天衡结算：本阵营全体存活单位——
 *   ① 立即恢复全部生命值；
 *   ② 士气提升至昂扬（3），持续2回合；
 *   ③ 遭遇战模式下获得1回合全图视野。
 * 返回受影响的 unitId 列表。
 */
export function resolveBorrowDay(gameState, campOrKey) {
    if (!gameState) return [];
    const campKey = typeof campOrKey === 'string' ? campOrKey : campToKey(campOrKey);
    const units = getLivingCampUnits(gameState, campKey);

    for (const unit of units) {
        unit.hp = unit.maxHp;
        unit.morale = 3;
        unit.moraleBoostUntil = getRoundIndex(gameState) + 2;
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

// ==== 旧版兼容（已废弃） ===============================================
export function hasBorrowDayPaybackPending() { return false; }
export function applyBorrowDayPayback() { return []; }
