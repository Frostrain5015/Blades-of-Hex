// rules/tianheng.js — 天衡联邦阵营协同【日月天衡】规则。
// 日月天衡是一张一局仅一张的主动王牌：释放后本阵营全体单位立即恢复全部生命值、
// 行动力回满可再行动、士气提升持续2回合，且在遭遇战模式下获得1回合全图视野。
// 不再有岁耗负数代价。
//
// 设计对照参考：极昼意象——太阳永不落下，全员沐浴烈日之力。

import { campToKey } from './camps.js';
import { getRoundIndex } from './turns.js';
import { TIANHENG_FACTION_SYNERGY, getCommanderFactionSynergy } from './factionSynergies.js';

export const TIANHENG_COMMANDER_IDS = TIANHENG_FACTION_SYNERGY.commanderIds;
export const BORROW_DAY_CARD_ID = 'borrowDay';

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

/** 某阵营的全部存活单位（作用对象＝全体单位，含将领与普通兵）。 */
export function getLivingCampUnits(gameState, campOrKey) {
    if (!gameState?.tiles || !campOrKey) return [];
    const campKey = typeof campOrKey === 'string' ? campOrKey : campToKey(campOrKey);
    return gameState.tiles
        .map(tile => tile.unit)
        .filter(unit => unit && unit.hp > 0 && campToKey(unit.camp) === campKey);
}

function fullMP(unit) {
    return unit.getEffectiveSpeed?.() ?? unit.config?.speed ?? 0;
}

/**
 * 日月天衡结算：本阵营全体存活单位——
 *   ① 立即恢复全部生命值；
 *   ② 行动力回满、重新可行动、解除本回合已有的禁锢/锁；
 *   ③ 士气提升至昂扬（3），持续2回合；
 *   ④ 遭遇战模式下获得1回合全图视野（scoutReveal）。
 * 不再有岁耗代价。
 * 返回受影响的 unitId 列表（供表现/广播）。
 */
export function resolveBorrowDay(gameState, campOrKey) {
    if (!gameState) return [];
    const campKey = typeof campOrKey === 'string' ? campOrKey : campToKey(campOrKey);
    const units = getLivingCampUnits(gameState, campKey);

    for (const unit of units) {
        // ① 回满生命
        unit.hp = unit.maxHp;
        if (unit._shield != null) unit._shield = unit._shieldMax || unit.maxHp;

        // ② 行动刷新
        unit._imprisoned = false;
        unit.canAct = true;
        unit.remainingMP = fullMP(unit);
        unit.displaySpeed = unit.remainingMP;
        unit.movedThisTurn = false;
        unit.moveDistance = 0;
        unit.counterAttackCount = 0;
        unit._timesAttackedThisTurn = 0;
        unit._specializationAttackSpent = false;

        // ③ 士气提升至昂扬（3），持续2回合
        unit.morale = 3;
        unit.moraleBoostUntil = getRoundIndex(gameState) + 2;
    }

    // ④ 遭遇战模式：1回合全图视野（scoutReveal由渲染层自动消费，无需立即刷新迷雾）
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

/**
 * 旧版岁耗检测 — 纯纯正正返回 false。
 */
export function hasBorrowDayPaybackPending() {
    return false;
}

/**
 * 旧版岁耗偿还 — 啥也不干。
 */
export function applyBorrowDayPayback() {
    return [];
}
