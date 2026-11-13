// 村庄的驻军可以截走产出。无人驻守时，产出归行政区中心城市。
export function collectIncomeVillages(state, camp) {
    const citiesByDistrict = new Map();
    for (const tile of state.tiles) {
        if (tile.isCity && !citiesByDistrict.has(tile.districtId)) {
            citiesByDistrict.set(tile.districtId, tile);
        }
    }
    const villages = [];
    for (const [key, village] of state.villageTiles) {
        const tile = state.tileMap.get(key);
        if (!tile) continue;
        const city = citiesByDistrict.get(village.districtId);
        const owner = tile.unit ? tile.unit.camp : city ? city.camp : state.factions?.neutral;
        if (owner === camp) villages.push(tile);
    }
    return villages;
}
