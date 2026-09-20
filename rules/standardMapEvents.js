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
