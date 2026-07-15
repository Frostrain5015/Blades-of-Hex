import { campToKey } from './camps.js';

function uniqueKeys(keys) {
    return [...new Set(keys.filter(Boolean))];
}

/** Return the stable IDs of active, non-neutral player factions in turn order. */
export function getActivePlayerKeys(state) {
    const configuredOrder = Array.isArray(state?.turnOrder) ? state.turnOrder : [];
    const factionKeys = Object.keys(state?.factions || {});
    return uniqueKeys([...configuredOrder, ...factionKeys])
        .map(key => campToKey(key))
        .filter(key => key !== 'neutral' && state?.factions?.[key]?.active !== false);
}

/** Return players still in the match after optionally excluding the current loser. */
export function getSurvivingPlayerKeys(state, excludedCamp = null) {
    const excludedKey = excludedCamp ? campToKey(excludedCamp) : null;
    const surrenderedKeys = new Set((state?.surrenderedCamps || []).map(campToKey));
    return getActivePlayerKeys(state).filter(key => key !== excludedKey && !surrenderedKeys.has(key));
}

export function hasFactionSurrendered(state, camp) {
    const key = campToKey(camp);
    return (state?.surrenderedCamps || []).some(item => campToKey(item) === key);
}
