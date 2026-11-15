import { campToKey } from './camps.js';
import { UNDERGROUND_INTELLIGENCE, isCampCulture } from './cultures.js';
import { getRoundIndex } from './turns.js';

function siteOwner(state, tile) {
    if (tile.isCity) return campToKey(tile.camp);
    const district = tile.villageDistrictId ?? tile.districtId;
    return campToKey(state.tiles.find(city => city.isCity && city.districtId === district)?.camp);
}

export function getUndergroundIntelligenceStatus(state, tile, camp) {
    if (!state?.skirmishFog || !isCampCulture(state, camp, 'cpc') || !(tile?.isCity || tile?.isVillage)) return null;
    const key = campToKey(camp);
    const occupied = tile.unit?.hp > 0 && campToKey(tile.unit.camp) === key;
    const controlled = siteOwner(state, tile) === key && (tile.isCity || !tile.unit || occupied);
    if (occupied || controlled) return { active: true };
    const entry = state.undergroundIntelligence?.[key]?.[`${tile.q},${tile.r}`];
    const roundsRemaining = (entry?.untilRound || 0) - getRoundIndex(state);
    return roundsRemaining > 0 ? { active: false, roundsRemaining } : null;
}

export function syncUndergroundIntelligence(state, camp) {
    if (!state.skirmishFog || !isCampCulture(state, camp, 'cpc')) return;
    const key = campToKey(camp);
    const round = getRoundIndex(state);
    const records = (state.undergroundIntelligence ||= {});
    const sites = (records[key] ||= {});
    for (const tile of state.tiles) {
        if (!tile.isCity && !tile.isVillage) continue;
        const coord = `${tile.q},${tile.r}`;
        if (siteOwner(state, tile) === key) {
            delete sites[coord];
            continue;
        }
        const occupied = tile.unit?.hp > 0 && campToKey(tile.unit.camp) === key;
        if (occupied) sites[coord] = { occupied: true };
        else if (sites[coord]?.occupied) sites[coord] = { untilRound: round + UNDERGROUND_INTELLIGENCE.duration };
        else if (sites[coord]?.untilRound <= round) delete sites[coord];
    }
}
