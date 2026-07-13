import { CAMP, CAMP_DATA, campToKey, getPaletteEntry, getTileColor } from './camps.js';

export const RELATIONS = Object.freeze(['ally', 'neutral', 'enemy']);

export const RELATION_META = Object.freeze({
    self: Object.freeze({ label: '自身', color: '#4caf50' }),
    ally: Object.freeze({ label: '联盟', color: '#42a5f5' }),
    neutral: Object.freeze({ label: '中立', color: '#fbc02d' }),
    enemy: Object.freeze({ label: '敌对', color: '#ef5350' }),
    unknown: Object.freeze({ label: '未知', color: '#9e9e9e' })
});

// 遭遇战/联机仍使用这些传统槽位；战役配置可以在其外声明任意合法 id。
export const FACTION_KEYS = Object.freeze(['player1', 'player2', 'player3', 'neutral']);
const DYNAMIC_FACTION_COLORS = Object.freeze([
    '#e05050', '#5090e0', '#5cbf5c', '#f09a40', '#edd43c', '#40b8b8', '#b070e0', '#9b6b4f'
]);

function fallbackFaction(id, index = 0) {
    const base = CAMP_DATA[id];
    return {
        id,
        name: base?.name || id,
        color: base?.color || DYNAMIC_FACTION_COLORS[index % DYNAMIC_FACTION_COLORS.length],
        flag: base?.flag || '⚑',
        controller: id === 'player1' ? 'human' : id === 'neutral' ? 'scripted' : 'ai',
        participatesInTurns: id !== 'neutral',
        active: id !== 'neutral'
    };
}

function factionIdsFrom(source) {
    if (Array.isArray(source)) return source.map(item => item?.id).filter(id => typeof id === 'string' && id);
    if (source?.factions && typeof source.factions === 'object') return Object.keys(source.factions);
    if (source && typeof source === 'object') return Object.keys(source);
    return [...FACTION_KEYS];
}

export function getFactionKeys(state) {
    const keys = factionIdsFrom(state);
    return keys.length ? keys : [...FACTION_KEYS];
}

export function normalizeCampKey(campOrKey, state = null) {
    let key = '';
    if (typeof campOrKey === 'string') key = campOrKey;
    else if (campOrKey) key = campToKey(campOrKey);
    if (key === 'p1') key = 'player1';
    if (key === 'p2') key = 'player2';
    if (key === 'p3') key = 'player3';
    if (!key) return null;
    return getFactionKeys(state).includes(key) ? key : null;
}

export function campFromKey(key, state = null) {
    if (state?.factions?.[key]) return state.factions[key];
    if (key === 'player1') return CAMP.player1;
    if (key === 'player2') return CAMP.player2;
    if (key === 'player3') return CAMP.player3;
    return CAMP.neutral;
}

export function createDefaultFactions(overrides = []) {
    const source = Array.isArray(overrides) ? overrides.filter(item => item?.id) : [];
    const ids = source.length ? source.map(item => item.id) : [...FACTION_KEYS];
    // 中立是棋盘的安全回退阵营；即使不在作者列表中也保留运行时对象，但不参与回合。
    if (!ids.includes('neutral')) ids.push('neutral');
    const byId = new Map(source.map(item => [item.id, item]));
    return Object.fromEntries(ids.map((id, index) => {
        const base = fallbackFaction(id, index);
        const override = byId.get(id) || {};
        const palette = getPaletteEntry(override.color) || getPaletteEntry(base.color);
        return [id, {
            ...base,
            name: typeof override.name === 'string' && override.name.trim() ? override.name.trim() : base.name,
            colorId: palette?.id || null,
            color: getTileColor(override.color, base.color),
            flag: typeof override.flag === 'string' && override.flag ? override.flag : base.flag,
            flagUrl: typeof override.flagUrl === 'string' && override.flagUrl ? override.flagUrl : null,
            flagAlt: typeof override.flagAlt === 'string' && override.flagAlt ? override.flagAlt : '',
            controller: ['human', 'ai', 'scripted'].includes(override.controller) ? override.controller : base.controller,
            participatesInTurns: typeof override.participatesInTurns === 'boolean' ? override.participatesInTurns : base.participatesInTurns,
            active: typeof override.active === 'boolean' ? override.active : base.active
        }];
    }));
}

export function createDefaultDiplomacy(raw = {}, factions = null) {
    const keys = factionIdsFrom(factions);
    const result = {};
    for (const left of keys) {
        result[left] = {};
        for (const right of keys) {
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
    const key = normalizeCampKey(campOrKey, state);
    if (!key) return null;
    return state?.factions?.[key] || createDefaultFactions()[key] || null;
}

export function getRelation(state, campA, campB) {
    const a = normalizeCampKey(campA, state);
    const b = normalizeCampKey(campB, state);
    if (!a || !b) return 'unknown';
    if (a === b) return 'self';
    const value = state?.diplomacy?.[a]?.[b];
    if (RELATIONS.includes(value)) return value;
    return a === 'neutral' || b === 'neutral' ? 'neutral' : 'enemy';
}

export function setRelation(state, campA, campB, relation) {
    const a = normalizeCampKey(campA, state);
    const b = normalizeCampKey(campB, state);
    if (!a || !b || a === b || !RELATIONS.includes(relation)) return null;
    if (!state.diplomacy) state.diplomacy = createDefaultDiplomacy({}, state);
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
    return normalizeCampKey(state?.localPlayerCampKey, state) || getFactionKeys(state)[0] || 'player1';
}

export function getRelationToViewer(state, targetCamp) {
    return getRelation(state, getViewingCampKey(state), targetCamp);
}
