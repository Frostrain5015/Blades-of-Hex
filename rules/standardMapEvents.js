import { campToKey } from './camps.js';

/**
 * Applies a standard-map capture reward without depending on rendering or DOM state.
 * Returns the transferred units so clients may choose how to present the event.
 */
export function applyStandardMapCaptureReward(state, map, cityTile, previousCamp, newCamp) {
    const reward = map?.captureReward;
    if (reward?.type !== 'neutralForcesTransfer') return [];
    if (cityTile?.q !== reward.cityQ || cityTile?.r !== reward.cityR) return [];
    if (campToKey(previousCamp) !== reward.sourceCamp || campToKey(newCamp) === reward.sourceCamp) return [];

    const transferred = [];
    for (const tile of state?.tiles || []) {
        const unit = tile?.unit;
        if (!unit || unit.hp <= 0 || campToKey(unit.camp) !== reward.sourceCamp) continue;
        unit.camp = newCamp;
        transferred.push(unit);
    }
    return transferred;
}

/** Keeps the map's prize carrier bound to the faction controlling its anchor district. */
export function syncStandardMapCarrierControl(state, map, districtId, newCamp) {
    const control = map?.carrierControl;
    if (!control || control.districtId !== districtId || !newCamp) return [];

    const transferred = [];
    for (const tile of state?.tiles || []) {
        const unit = tile?.unit;
        if (!unit || unit.hp <= 0 || unit.type !== 'carrier' || unit.camp === newCamp) continue;
        unit.camp = newCamp;
        transferred.push(unit);
    }
    return transferred;
}

/** The neutral AI may use the carrier's weapons, but cannot sail the map prize away. */
export function shouldHoldNeutralCarrierPosition(unit, aiCamp, map) {
    return map?.carrierControl?.holdPositionWhileNeutral === true
        && unit?.type === 'carrier'
        && campToKey(aiCamp) === 'neutral'
        && campToKey(unit.camp) === 'neutral';
}
