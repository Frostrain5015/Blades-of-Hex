import { CAMP, CAMP_DATA, campToKey } from './camps.js';

export const RELATIONS = Object.freeze(['ally', 'neutral', 'enemy']);

export const RELATION_META = Object.freeze({
    self: Object.freeze({ label: '自身', color: '#4caf50' }),
    ally: Object.freeze({ label: '联盟', color: '#42a5f5' }),
    neutral: Object.freeze({ label: '中立', color: '#fbc02d' }),
    enemy: Object.freeze({ label: '敌对', color: '#ef5350' }),
    unknown: Object.freeze({ label: '未知', color: '#9e9e9e' })
});

export const FACTION_KEYS = Object.freeze(['player1', 'player2', 'player3', 'neutral']);

export function normalizeCampKey(campOrKey) {
    if (typeof campOrKey === 'string') {
        if (campOrKey === 'p1') return 'player1';
        if (campOrKey === 'p2') return 'player2';
        if (campOrKey === 'p3') return 'player3';
        return FACTION_KEYS.includes(campOrKey) ? campOrKey : null;
    }
    if (!campOrKey) return null;
    return campToKey(campOrKey);
}

export function campFromKey(key) {
    if (key === 'player1') return CAMP.player1;
    if (key === 'player2') return CAMP.player2;
    if (key === 'player3') return CAMP.player3;
    return CAMP.neutral;
}

export function createDefaultFactions(overrides = []) {
    const byId = new Map(Array.isArray(overrides) ? overrides.map(item => [item?.id, item]) : []);
    return Object.fromEntries(FACTION_KEYS.map(id => {
        const base = CAMP_DATA[id];
        const override = byId.get(id) || {};
        return [id, {
            id,
            name: typeof override.name === 'string' && override.name.trim() ? override.name.trim() : base.name,
            color: typeof override.color === 'string' && override.color ? override.color : base.color,
            controller: ['human', 'ai', 'scripted'].includes(override.controller) ? override.controller : (id === 'player1' ? 'human' : 'ai'),
            participatesInTurns: override.participatesInTurns !== false,
            active: override.active !== false
        }];
    }));
}

export function createDefaultDiplomacy(raw = {}) {
    const result = {};
    for (const left of FACTION_KEYS) {
        result[left] = {};
        for (const right of FACTION_KEYS) {
            if (left === right) continue;
            const configured = raw?.[left]?.[right] ?? raw?.[right]?.[left];
            result[left][right] = RELATIONS.includes(configured)
                ? configured
                : (left === 'neutral' || right === 'neutral' ? 'neutral' : 'enemy');
        }
    }
    return result;
}

export function getFaction(state, campOrKey) {
    const key = normalizeCampKey(campOrKey);
    if (!key) return null;
    return state?.factions?.[key] || createDefaultFactions()[key];
}

export function getRelation(state, campA, campB) {
    const a = normalizeCampKey(campA);
    const b = normalizeCampKey(campB);
    if (!a || !b) return 'unknown';
    if (a === b) return 'self';
    const value = state?.diplomacy?.[a]?.[b];
    if (RELATIONS.includes(value)) return value;
    return a === 'neutral' || b === 'neutral' ? 'neutral' : 'enemy';
}

export function setRelation(state, campA, campB, relation) {
    const a = normalizeCampKey(campA);
    const b = normalizeCampKey(campB);
    if (!a || !b || a === b || !RELATIONS.includes(relation)) return null;
    if (!state.diplomacy) state.diplomacy = createDefaultDiplomacy();
    if (!state.diplomacy[a]) state.diplomacy[a] = {};
    if (!state.diplomacy[b]) state.diplomacy[b] = {};
    const previous = getRelation(state, a, b);
    state.diplomacy[a][b] = relation;
    state.diplomacy[b][a] = relation;
    return { camp: a, targetCamp: b, previous, relation };
}

export function isFriendly(state, campA, campB) {
    const relation = getRelation(state, campA, campB);
    return relation === 'self' || relation === 'ally';
}

export function isHostile(state, campA, campB) {
    return getRelation(state, campA, campB) === 'enemy';
}

export function canAttack(state, campA, campB) {
    const relation = getRelation(state, campA, campB);
    return relation === 'enemy' || relation === 'neutral';
}

export function canAssist(state, campA, campB) {
    return isFriendly(state, campA, campB);
}

export function getViewingCampKey(state) {
    return normalizeCampKey(state?.localPlayerCampKey) || 'player1';
}

export function getRelationToViewer(state, targetCamp) {
    return getRelation(state, getViewingCampKey(state), targetCamp);
}
