export const MECHANIC_DEFINITIONS = Object.freeze({
    tacticalCards: Object.freeze({ label: '对策卡', defaultEnabled: true }),
    recruitment: Object.freeze({ label: '招募单位', defaultEnabled: true }),
    reinforcement: Object.freeze({ label: '补员', defaultEnabled: true }),
    commanderSkills: Object.freeze({ label: '将领主动技', defaultEnabled: true }),
    airCommands: Object.freeze({ label: '空军指令与舰载机', defaultEnabled: true }),
    weatherEffects: Object.freeze({ label: '天气规则效果', defaultEnabled: true }),
    morale: Object.freeze({ label: '士气系统', defaultEnabled: true }),
    fortifications: Object.freeze({ label: '工事系统', defaultEnabled: true }),
    fogOfWar: Object.freeze({ label: '战争迷雾', defaultEnabled: true })
    ,alliedVision: Object.freeze({ label: '联盟共享视野', defaultEnabled: false })
});

export const MECHANIC_KEYS = Object.freeze(Object.keys(MECHANIC_DEFINITIONS));

export function createDefaultMechanics(overrides = {}) {
    return Object.fromEntries(MECHANIC_KEYS.map(key => [
        key,
        typeof overrides?.[key] === 'boolean' ? overrides[key] : MECHANIC_DEFINITIONS[key].defaultEnabled
    ]));
}

export function isMechanicEnabled(state, key) {
    if (!MECHANIC_KEYS.includes(key)) return false;
    return state?.mechanics?.[key] !== false;
}

export function setMechanicEnabled(state, key, enabled) {
    if (!MECHANIC_KEYS.includes(key)) return false;
    if (!state.mechanics) state.mechanics = createDefaultMechanics();
    state.mechanics[key] = enabled !== false;
    return true;
}
