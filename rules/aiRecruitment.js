/**
 * Put a warship first only when an authored port faces a real hostile fleet
 * advantage. This keeps ordinary coastal garrisons on their land strategy and
 * gives every AI personality the same movement-domain-aware response.
 */
import { getUnitBaseType } from './units.js';

export function prioritizeNavalRecruitment(city, baseTypes, tiles, aiCamp, isHostileFaction) {
    const fallback = [...new Set(Array.isArray(baseTypes) ? baseTypes : [])];
    if (!city?.isPort || typeof isHostileFaction !== 'function') return fallback;

    let friendlyWarships = 0;
    let hostileWarships = 0;
    for (const tile of Array.isArray(tiles) ? tiles : []) {
        if (getUnitBaseType(tile?.unit) !== 'warship') continue;
        if (tile.unit.camp === aiCamp) friendlyWarships++;
        else if (isHostileFaction(aiCamp, tile.unit.camp)) hostileWarships++;
    }
    return hostileWarships > friendlyWarships
        ? ['warship', ...fallback.filter(type => type !== 'warship')]
        : fallback;
}
