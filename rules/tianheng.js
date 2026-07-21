// rules/tianheng.js — 天衡联邦阵营协同【借日】规则。
// 借日是一张一局仅一张的主动王牌：释放后本阵营全体单位行动力回满、可再行动
//（全军第二轮）；代价是下一整回合本阵营全体禁锢（岁耗偿还）。
// 本模块只保存无副作用判定 + 纯结算（操作传入的 gameState/单位），不访问 DOM。

import { campToKey } from './camps.js';
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

/** 某阵营的全部存活单位（借日作用对象＝全体单位，含将领与普通兵）。 */
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
 * 借日结算（决策 ⑤⑥⑦）：本阵营全体存活单位行动力回满、重新可行动、解除本回合
 * 已有的禁锢/锁（完整刷新）；并置岁耗偿还标记，供下一整回合全体禁锢。
 * 返回受影响的 unitId 列表（供表现/广播）。
 */
export function resolveBorrowDay(gameState, campOrKey) {
    if (!gameState) return [];
    const campKey = typeof campOrKey === 'string' ? campOrKey : campToKey(campOrKey);
    const units = getLivingCampUnits(gameState, campKey);
    for (const unit of units) {
        unit._imprisoned = false;            // 决策⑦：解除本回合已有禁锢
        unit.canAct = true;
        unit.remainingMP = fullMP(unit);
        unit.displaySpeed = unit.remainingMP;
        unit.movedThisTurn = false;
        unit.moveDistance = 0;
        unit.counterAttackCount = 0;
        unit._timesAttackedThisTurn = 0;
        unit._specializationAttackSpent = false;
    }
    if (!gameState._borrowDayImprison) gameState._borrowDayImprison = {};
    gameState._borrowDayImprison[campKey] = true; // 岁耗：下一整回合偿还
    return units.map(u => u.id);
}

/** 是否有待偿还的岁耗（下一整回合该阵营全体禁锢）。 */
export function hasBorrowDayPaybackPending(gameState, campOrKey) {
    const campKey = typeof campOrKey === 'string' ? campOrKey : campToKey(campOrKey);
    return Boolean(gameState?._borrowDayImprison?.[campKey]);
}

/**
 * 岁耗偿还（决策⑤：完整不可行动）：在该阵营「下一整回合」的回合刷新时调用一次。
 * 全体存活单位 canAct=false、行动力清零、上禁锢；随后清除标记（只偿还一个整回合）。
 * 返回受影响的 unitId 列表。
 */
export function applyBorrowDayPayback(gameState, campOrKey) {
    if (!gameState) return [];
    const campKey = typeof campOrKey === 'string' ? campOrKey : campToKey(campOrKey);
    if (!gameState._borrowDayImprison?.[campKey]) return [];
    const units = getLivingCampUnits(gameState, campKey);
    for (const unit of units) {
        unit.canAct = false;
        unit.remainingMP = 0;
        unit.displaySpeed = 0;
        unit._imprisoned = true; // 🔒 显示 + 与刷新逻辑一致
    }
    delete gameState._borrowDayImprison[campKey];
    return units.map(u => u.id);
}
