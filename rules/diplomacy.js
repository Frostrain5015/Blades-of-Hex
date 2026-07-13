import {
    CAMP,
    CAMP_DATA,
    DEFAULT_SEAT_COLOR_IDS,
    isPlayerFactionColor,
    campToKey,
    getFactionColorName,
    getPaletteEntry,
    getTileColor
} from './camps.js';

export const RELATIONS = Object.freeze(['ally', 'neutral', 'enemy']);

export const RELATION_META = Object.freeze({
    self: Object.freeze({ label: '自身', color: '#4caf50' }),
    ally: Object.freeze({ label: '联盟', color: '#42a5f5' }),
    neutral: Object.freeze({ label: '中立', color: '#fbc02d' }),
    enemy: Object.freeze({ label: '敌对', color: '#ef5350' }),
    unknown: Object.freeze({ label: '未知', color: '#9e9e9e' })
});

// playerN 是稳定席位 ID，不再隐含红/蓝/绿或行动顺序；战役可声明任意阵营 ID。
export const PLAYER_SEAT_KEYS = Object.freeze(['player1', 'player2', 'player3']);
export const FACTION_KEYS = Object.freeze([...PLAYER_SEAT_KEYS, 'neutral']);
const DYNAMIC_FACTION_COLORS = Object.freeze([
    '#e05050', '#5090e0', '#5cbf5c', '#f09a40', '#edd43c', '#40b8b8', '#b070e0', '#9b6b4f'
]);

function fallbackFaction(id, index = 0) {
    const base = CAMP_DATA[id];
    const defaultColorId = id === 'neutral' ? 'gray' : null;
    const palette = getPaletteEntry(defaultColorId);
    return {
        id,
        name: base?.name || id,
        colorId: palette?.id || null,
        color: palette?.tile || base?.color || DYNAMIC_FACTION_COLORS[index % DYNAMIC_FACTION_COLORS.length],
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
    if (key === 'p1') key = 'player1';
    if (key === 'p2') key = 'player2';
    if (key === 'p3') key = 'player3';
    if (key === 'neu') key = 'neutral';
    if (state?.factions?.[key]) return state.factions[key];
    if (key === 'player1') return CAMP.player1;
    if (key === 'player2') return CAMP.player2;
    if (key === 'player3') return CAMP.player3;
    return CAMP.neutral;
}

/** 创建标准对局阵营。席位、颜色、控制器是三组独立数据。 */
export function createStandardFactions({ playerCount = 2, colors = {}, controllers = {} } = {}) {
    const count = Math.max(2, Math.min(3, Number(playerCount) || 2));
    const overrides = PLAYER_SEAT_KEYS.map((id, index) => {
        const requestedColorId = getPaletteEntry(colors[id])?.id;
        const colorId = isPlayerFactionColor(requestedColorId)
            ? requestedColorId
            : DEFAULT_SEAT_COLOR_IDS[index];
        return {
            id,
            name: getFactionColorName(colorId, `第${index + 1}阵营`),
            color: colorId,
            controller: controllers[id] || (id === 'player1' ? 'human' : 'ai'),
            participatesInTurns: index < count,
            active: index < count
        };
    });
    overrides.push({
        id: 'neutral',
        name: '中立',
        color: 'gray',
        controller: 'ai',
        participatesInTurns: true,
        active: true
    });
    return createDefaultFactions(overrides);
}

/** 更新阵营外观颜色；不改变阵营 ID、控制者、外交或回合位置。 */
export function setFactionColor(state, factionKey, colorValue) {
    const faction = state?.factions?.[factionKey];
    const palette = getPaletteEntry(colorValue);
    if (!faction || !palette || factionKey === 'neutral') return false;
    faction.colorId = palette.id;
    faction.color = palette.tile;
    faction.name = getFactionColorName(palette.id, faction.name);
    return true;
}

/** 普通玩家对局的受限入口；深灰和白不能被玩家席位选择。 */
export function setPlayerFactionColor(state, factionKey, colorValue) {
    if (!isPlayerFactionColor(colorValue)) return false;
    return setFactionColor(state, factionKey, colorValue);
}

/** 网络角色是连接席位；映射后的值才是规则层阵营 ID。 */
export function getRoleFactionKey(state, role) {
    if (typeof role !== 'string' || !role) return null;
    const mapped = state?.roleAssignments?.[role];
    if (mapped && state?.factions?.[mapped]) return mapped;
    return state?.factions?.[role] ? role : null;
}

export function getRoleCamp(state, role) {
    const key = getRoleFactionKey(state, role);
    return key ? campFromKey(key, state) : null;
}

export function getFactionRole(state, factionKey) {
    for (const [role, key] of Object.entries(state?.roleAssignments || {})) {
        if (key === factionKey) return role;
    }
    return PLAYER_SEAT_KEYS.includes(factionKey) ? factionKey : null;
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
