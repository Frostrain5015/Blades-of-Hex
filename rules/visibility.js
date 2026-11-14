// rules/visibility.js — 潜行单位（1阶以上潜艇、中共游击纵队）统一可见性与反潜侦测规则。

import { campToKey } from './camps.js';
import { isFriendly } from './diplomacy.js';
import { hexDistance } from './hex.js';
import { getRoundIndex } from './turns.js';
import { hasFullAiIntelligence } from '../ai/difficulty.js';

export const STEALTH_VISIBILITY_RULES = Object.freeze({
    guerrillaRevealRadius: 1,
    submarineDetectorRadius: 2
});

function getUnitRankValue(unit) {
    return Number(unit?._rank ?? unit?.rank) || 0;
}

export function isSubmarineDetector(unit) {
    if (!unit || unit.hp <= 0) return false;
    return unit.type === 'gb_battleship'
        || unit.type === 'shoreBattery'
        || (unit.type === 'destroyer' && unit.specializationKey === 'antiSubDestroyer')
        || Number(unit.getSpecializationAbility?.('submarineDetectionRadius') || 0) > 0;
}

export function getSubmarineDetectorRadius(unit) {
    if (!isSubmarineDetector(unit)) return 0;
    const specRadius = Number(unit.getSpecializationAbility?.('submarineDetectionRadius') || 0);
    return specRadius > 0 ? specRadius : STEALTH_VISIBILITY_RULES.submarineDetectorRadius;
}

export function hasSubmarineDetectorInRange(submarine, detectingCamp, state) {
    const key = campToKey(detectingCamp);
    if (!submarine?.tile || key === 'neutral') return false;
    return (state?.tiles || []).some(tile => {
        const detector = tile.unit;
        const radius = getSubmarineDetectorRadius(detector);
        if (radius <= 0) return false;
        const matchesDetector = isFriendly(state, detector.camp, detectingCamp);
        return matchesDetector && hexDistance(tile, submarine.tile) <= radius;
    });
}

function hasFactionReveal(unit, viewerCamp, state) {
    const key = campToKey(viewerCamp);
    if (!key || key === 'neutral') return false;
    const round = getRoundIndex(state) || 0;
    const subExpires = state?.submarineReveals?.[key]?.[String(unit?.id)];
    if (Number.isFinite(subExpires) && subExpires > round) return true;
    const unitExpires = state?.unitReveals?.[key]?.[String(unit?.id)];
    return Number.isFinite(unitExpires) && unitExpires > round;
}

export function isGuerrillaExposedByVillage(unit) {
    if (!unit || unit.type !== 'cpc_guerrilla' || unit.hp <= 0) return false;
    const tile = unit.tile;
    if (!tile?.isVillage) return false;
    const tileKey = `${tile.q},${tile.r}`;
    if (unit._exposedVillageKey === tileKey) return true;
    return campToKey(tile.camp) !== campToKey(unit.camp);
}

export function hasHostileUnitNear(unit, state, radius = STEALTH_VISIBILITY_RULES.guerrillaRevealRadius, viewerCamp = null) {
    if (!unit?.tile || !state?.tiles) return false;
    if (viewerCamp && campToKey(viewerCamp) === campToKey(unit.camp)) viewerCamp = null;
    for (const tile of state.tiles) {
        const other = tile?.unit;
        if (!other || other.hp <= 0 || other === unit || other._isAirTransient) continue;
        if (isFriendly(state, other.camp, unit.camp)) continue;
        if (viewerCamp && !isFriendly(state, other.camp, viewerCamp)) continue;
        if (hexDistance(tile, unit.tile) <= radius) return true;
    }
    return false;
}

export function isStealthSubmarine(unit) {
    return Boolean(unit && unit.type === 'submarine' && unit.hp > 0 && getUnitRankValue(unit) >= 1);
}

export function isStealthGuerrilla(unit) {
    return Boolean(unit && unit.type === 'cpc_guerrilla' && unit.hp > 0);
}

export function isStealthUnit(unit) {
    return isStealthGuerrilla(unit) || isStealthSubmarine(unit);
}

/**
 * 统一可见性裁决：
 * - 己方及同盟始终可见；
 * - 1阶以上潜艇：潜航状态下不可见；主动攻击后暴露1回合；处于任意己方反潜单位2格侦测内（含皇家战列舰/反潜驱逐舰/岸防炮）、占港短暂暴露或受反潜点亮时显现；
 * - 游击纵队：仅在敌军已抵近至1格内、占领非己方所属村庄时对非己方显形；Imperator 难度 AI 例外可见。
 */
export function isUnitVisibleToCamp(unit, viewerCamp, state, options = {}) {
    if (!unit || unit.hp <= 0) return false;
    if (!viewerCamp) return !isStealthUnit(unit);
    if (isFriendly(state, unit.camp, viewerCamp)) return true;

    if (unit.type === 'cpc_guerrilla') {
        if (!options.ignoreAiBypass) {
            const viewerKey = campToKey(viewerCamp);
            const viewerFaction = state?.factions?.[viewerKey];
            if ((viewerFaction?.controller === 'ai' && hasFullAiIntelligence(state, viewerKey))
                || (viewerFaction?.isAI && viewerFaction.aiDifficulty === 'imperator')) {
                return true;
            }
        }
        if (isGuerrillaExposedByVillage(unit)) return true;
        if (hasHostileUnitNear(unit, state, STEALTH_VISIBILITY_RULES.guerrillaRevealRadius, viewerCamp)) return true;
        if (hasFactionReveal(unit, viewerCamp, state)) return true;
        return false;
    }

    if (unit.type === 'submarine') {
        if (getUnitRankValue(unit) < 1) return true;
        if (unit._submarineAttackExposed === true) return true;
        const round = getRoundIndex(state) || 0;
        if (unit.tile?.isPort && Number(unit._submarinePortRevealUntilRound) > round) return true;
        if (hasFactionReveal(unit, viewerCamp, state)) return true;
        return hasSubmarineDetectorInRange(unit, viewerCamp, state);
    }

    return true;
}

export function isSubmarineTargetableBy(submarine, detectingCamp, state) {
    if (submarine?.type !== 'submarine') return true;
    return isUnitVisibleToCamp(submarine, detectingCamp, state);
}

export function markSubmarineAttackExposed(unit, state) {
    if (!unit || unit.type !== 'submarine') return;
    unit._submarineAttackExposed = true;
    unit._submarineLastAttackRound = getRoundIndex(state) || 0;
    unit._submarineDamagedWhileExposed = false;
}

export function markSubmarineDamagedWhileExposed(unit) {
    if (!unit || unit.type !== 'submarine') return;
    if (unit._submarineAttackExposed === true) {
        unit._submarineDamagedWhileExposed = true;
    }
}

export function resolveSubmarineTurnEndStealth(state, camp) {
    const campKey = campToKey(camp);
    const currentRound = getRoundIndex(state) || 0;
    const submerged = [];
    for (const tile of state?.tiles || []) {
        const unit = tile?.unit;
        if (!unit || unit.type !== 'submarine' || unit.hp <= 0) continue;
        if (campToKey(unit.camp) !== campKey) continue;
        if (unit._submarineAttackExposed !== true) continue;

        const lastAttackRound = Number.isFinite(unit._submarineLastAttackRound)
            ? unit._submarineLastAttackRound
            : -1;
        const attackedThisTurn = lastAttackRound >= currentRound;
        const damagedWhileExposed = unit._submarineDamagedWhileExposed === true;

        if (!attackedThisTurn && !damagedWhileExposed) {
            unit._submarineAttackExposed = false;
            unit._submarineDamagedWhileExposed = false;
            submerged.push(unit);
        } else if (!attackedThisTurn && damagedWhileExposed) {
            // 本回合因此前受击无法立即下潜，清空本轮受击标记，若接下来整轮无受击且未再出手则可于下回合末下潜
            unit._submarineDamagedWhileExposed = false;
        }
    }
    return submerged;
}
