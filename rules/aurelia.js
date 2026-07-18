// rules/aurelia.js — 奥雷利亚王国阵营协同规则。
// 这里只保存成员身份、平衡参数与无副作用的判定；实际扣血/抬血由 Unit 统一伤害入口结算。

import { campToKey } from './camps.js';
import { getRoundIndex } from './turns.js';
import {
    AURELIA_COMMANDER_IDS,
    AURELIA_FACTION_SYNERGY,
    getCommanderFactionSynergy
} from './factionSynergies.js';

export { AURELIA_COMMANDER_IDS };

export const AURELIA_FACTION_PASSIVE = Object.freeze({
    name: AURELIA_FACTION_SYNERGY.hero.title,
    icon: AURELIA_FACTION_SYNERGY.marker.symbol,
    type: '阵营协同被动',
    rescueCurrentHpCostPct: 0.40,
    rescuedMaxHpPct: 0.40,
    usesPerMatch: 1
});

export const AURELIA_OATH_EFFECT = Object.freeze({
    name: '鸢尾花的加护',
    icon: '⚜️',
    durationRounds: 2,
    attackBonusPct: 0.30,
    color: '#e7bf69'
});

export function isAureliaCommanderId(commanderId) {
    return getCommanderFactionSynergy(commanderId)?.id === AURELIA_FACTION_SYNERGY.id;
}

export function isAureliaCommanderUnit(unit) {
    return Boolean(unit?.isCommanderUnit && isAureliaCommanderId(unit.commander));
}

export function getAureliaCampKey(unit) {
    return unit?.camp ? campToKey(unit.camp) : null;
}

export function getLivingAureliaCommanders(gameState, camp) {
    if (!gameState?.tiles || !camp) return [];
    const campKey = campToKey(camp);
    return gameState.tiles
        .map(tile => tile.unit)
        .filter(unit => unit && unit.hp > 0
            && campToKey(unit.camp) === campKey
            && isAureliaCommanderUnit(unit));
}

export function hasAureliaOathPassive(unit, gameState) {
    return isAureliaCommanderUnit(unit)
        && getLivingAureliaCommanders(gameState, unit.camp).length >= 2;
}

export function hasUsedAureliaOath(unit, gameState) {
    const campKey = getAureliaCampKey(unit);
    return Boolean(campKey && gameState?._aureliaOathUsed?.[campKey]);
}

export function canTriggerAureliaRescue(unit, gameState) {
    return hasAureliaOathPassive(unit, gameState) && !hasUsedAureliaOath(unit, gameState);
}

export function chooseAureliaRescuer(rescuedUnit, gameState) {
    if (!rescuedUnit) return null;
    const candidates = getLivingAureliaCommanders(gameState, rescuedUnit.camp)
        .filter(unit => unit !== rescuedUnit);
    candidates.sort((left, right) => {
        const leftRatio = left.hp / Math.max(1, left.maxHp);
        const rightRatio = right.hp / Math.max(1, right.maxHp);
        if (rightRatio !== leftRatio) return rightRatio - leftRatio;
        if (right.hp !== left.hp) return right.hp - left.hp;
        return String(left.id).localeCompare(String(right.id));
    });
    return candidates[0] || null;
}

export function getAureliaOathRemainingRounds(unit, gameState) {
    if (!unit || !gameState) return 0;
    const expiresAt = Number(unit._aureliaOathUntilRound) || 0;
    return Math.max(0, expiresAt - getRoundIndex(gameState));
}

export function hasAureliaOathEffect(unit, gameState) {
    return getAureliaOathRemainingRounds(unit, gameState) > 0;
}
