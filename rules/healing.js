import { isBloodMoonHealSuppressed } from './noctis.js';
import { isPortOperationalFor } from './naval.js';

export function canReinforceAtTile(unit, state) {
    const tile = unit?.tile;
    if (!tile) return false;
    if (tile.isPort) return unit.type === 'us_marine' && isPortOperationalFor(tile, unit.camp, state);
    return tile.isCity ? tile.camp === unit.camp : !!tile.isVillage;
}

export function isHealingBlocked(unit, state, { allowReinforce = false, bypassAntiHeal = false } = {}) {
    return (unit.commander === 'martyr' && unit._martyrPrimed)
        || (!bypassAntiHeal && (
            (!allowReinforce && unit.config?.permanentAntiHeal)
            || isBloodMoonHealSuppressed(unit, state)
        ));
}
