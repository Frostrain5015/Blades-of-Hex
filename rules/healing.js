import { isBloodMoonHealSuppressed } from './noctis.js';

export function isHealingBlocked(unit, state, { allowReinforce = false, bypassAntiHeal = false } = {}) {
    return (unit.commander === 'martyr' && unit._martyrPrimed)
        || (!bypassAntiHeal && (
            (!allowReinforce && unit.config?.permanentAntiHeal)
            || isBloodMoonHealSuppressed(unit, state)
        ));
}
