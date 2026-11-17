import { isBloodMoonHealSuppressed } from './noctis.js';
import { isPortOperationalFor } from './naval.js';

export function canReinforceAtTile(unit, state) {
    const tile = unit?.tile;
    if (!tile) return false;
    if (tile.isPort) return unit.type === 'us_marine' && isPortOperationalFor(tile, unit.camp, state);
    return tile.isCity ? tile.camp === unit.camp : !!tile.isVillage;
}

export const REINFORCE_COST_DISCOUNT = 0.75;

/** 补员 / 港口维修金币计算（-25% 单价后四舍五入，最低 1 金）。 */
export function computeHealGoldCost(unitCost, healAmt, maxHp, costScale = 1) {
    if (!maxHp || healAmt <= 0) return 0;
    return Math.max(1, Math.round(Number(unitCost || 0) * (healAmt / maxHp) * REINFORCE_COST_DISCOUNT * costScale));
}

export function isHealingBlocked(unit, state, { allowReinforce = false, bypassAntiHeal = false } = {}) {
    return (unit.commander === 'martyr' && unit._martyrPrimed)
        || (!bypassAntiHeal && (
            (!allowReinforce && unit.config?.permanentAntiHeal)
            || isBloodMoonHealSuppressed(unit, state)
        ));
}
