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
        // 城防联动单位（如离岛岸防炮）只随所属城市易主，不参与中央夺城的全图易帜。
        if (unit._followsCity) continue;
        unit.camp = newCamp;
        transferred.push(unit);
    }
    return transferred;
}

/**
 * 城防联动：绑定了 _followsCity 的驻防单位（如离岛岸防炮）随该城易主。
 * 任意阵营占领该城均触发，返回被转移的单位列表供调用方播报。
 */
export function syncCityLinkedGarrisons(state, cityTile, newCamp) {
    if (!cityTile || !newCamp) return [];
    const transferred = [];
    for (const tile of state?.tiles || []) {
        const unit = tile?.unit;
        if (!unit || unit.hp <= 0 || !unit._followsCity) continue;
        if (unit._followsCity.q !== cityTile.q || unit._followsCity.r !== cityTile.r) continue;
        if (unit.camp === newCamp) continue;
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
