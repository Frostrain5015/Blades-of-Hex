// 关卡配置 Schema —— 战役编辑器与运行时之间的唯一数据契约。
// 一个 level 配置（下称 config）是纯 JSON 可序列化对象：编辑器产出它，
// scenarioFromConfig 把它包装成通用控制器认识的 scenario 接口来运行。
// 枚举尽量从规则层派生，保证与游戏本体同步（单一数据源）。
import { UNIT_CONFIG } from '../../rules/units.js';
import { COMMANDER_CONFIG } from '../../rules/commanders.js';
import { TERRAIN_CONFIG, FORTIFICATION_CONFIG, WEATHER_CONFIG } from '../../rules/terrain.js';
import { TACTICAL_CARD_CONFIG } from '../../rules/cards.js';
import { MECHANIC_DEFINITIONS, MECHANIC_KEYS, createDefaultMechanics } from '../../rules/mechanics.js';

export const SCHEMA_VERSION = 2;
export const RELATION_KEYS = Object.freeze(['ally', 'neutral', 'enemy']);
export const OBJECTIVE_STATUS_KEYS = Object.freeze(['hidden', 'active', 'completed', 'failed']);
export const VARIABLE_TYPES = Object.freeze(['number', 'boolean', 'string']);
export const VARIABLE_SCOPES = Object.freeze(['level', 'campaign']);
export { MECHANIC_KEYS };
export const MECHANIC_LABELS = Object.freeze(Object.fromEntries(MECHANIC_KEYS.map(key => [key, MECHANIC_DEFINITIONS[key].label])));

// ── 枚举（派生自规则层，附中文标签供编辑器下拉）───────────────────
export const CAMP_KEYS = Object.freeze(['player1', 'player2', 'player3', 'neutral']);
export const CAMP_LABELS = Object.freeze({
    player1: '红军', player2: '蓝军', player3: '绿军', neutral: '中立'
});

export const UNIT_TYPES = Object.freeze(Object.keys(UNIT_CONFIG));
export const UNIT_LABELS = Object.freeze(
    Object.fromEntries(UNIT_TYPES.map(t => [t, UNIT_CONFIG[t].name]))
);

export const COMMANDER_IDS = Object.freeze(Object.keys(COMMANDER_CONFIG));
export const COMMANDER_LABELS = Object.freeze(
    Object.fromEntries(COMMANDER_IDS.map(id => [id, COMMANDER_CONFIG[id].definition.name]))
);

export const TERRAIN_KEYS = Object.freeze(Object.keys(TERRAIN_CONFIG)); // plains/forest/mountain
export const TERRAIN_LABELS = Object.freeze(
    Object.fromEntries(TERRAIN_KEYS.map(t => [t, TERRAIN_CONFIG[t].name]))
);

export const FORTIFICATION_KEYS = Object.freeze(Object.keys(FORTIFICATION_CONFIG)); // trench/flak
export const FORTIFICATION_LABELS = Object.freeze(
    Object.fromEntries(FORTIFICATION_KEYS.map(f => [f, FORTIFICATION_CONFIG[f].name]))
);

export const WEATHER_KEYS = Object.freeze(['cycle', ...Object.keys(WEATHER_CONFIG)]); // cycle/clear/rain/fog/wind
export const WEATHER_LABELS = Object.freeze(
    Object.fromEntries(WEATHER_KEYS.map(w => [w, w === 'cycle' ? '标准循环' : WEATHER_CONFIG[w]?.name || w]))
);

export const CARD_IDS = Object.freeze(Object.keys(TACTICAL_CARD_CONFIG));
export const CARD_LABELS = Object.freeze(
    Object.fromEntries(CARD_IDS.map(id => [id, TACTICAL_CARD_CONFIG[id].name]))
);

// 棋盘半径限制：与设计文档一致（R=3~5），另留 2~6 的编辑余量。
export const BOARD_RADIUS_MIN = 2;
export const BOARD_RADIUS_MAX = 7;
export const BOARD_RADIUS_DEFAULT = 4;

// ── 触发器条件/动作词汇表（编辑器据此渲染下拉；运行时据此解释）──────────
// 事件已取消显式配置：所有触发器每次事件后都会尝试求值，由条件决定是否触发。
// 条件：布尔判定。
// 每条条件形如 { kind, ...字段 }；kind 必须与 triggers.js 的 evalCondition 分支一致。
export const TRIGGER_CONDITIONS = Object.freeze([
    { kind: 'any', label: '满足任一（OR）', arg: 'conditionGroup' },
    { kind: 'compare', label: '比较数值/变量', arg: 'compare' },
    { kind: 'eventCardIs',  label: '事件卡牌是',   arg: 'card' },
    { kind: 'eventNextIs',  label: '按钮跳转值为', arg: 'text', note: '配合「点击按钮」事件，匹配 step.next 的 __ 值' },
    { kind: 'unitAlive',    label: '单位存活',     arg: 'unitRef' },
    { kind: 'unitDead',     label: '单位阵亡',     arg: 'unitRef' },
    { kind: 'cityOwnedBy',  label: '城市归属于',   arg: 'cityOwner' },
    { kind: 'turnAtLeast',  label: '回合数≥',      arg: 'number' },
    { kind: 'flagSet',      label: '标记已置位',   arg: 'text' },
    { kind: 'flagUnset',    label: '标记未置位',   arg: 'text' }
    ,{ kind: 'unitExists', label: '单位存在/存活', arg: 'unitExists' }
    ,{ kind: 'unitHpCompare', label: '单位生命比较', arg: 'unitHpCompare' }
    ,{ kind: 'factionUnitCount', label: '阵营单位数量', arg: 'campCompare' }
    ,{ kind: 'tileOwnedBy', label: '地块归属于', arg: 'cityOwner' }
    ,{ kind: 'relationIs', label: '外交关系为', arg: 'relation' }
    ,{ kind: 'weatherIs', label: '当前天气为', arg: 'weather' }
    ,{ kind: 'objectiveStatusIs', label: '目标状态为', arg: 'objectiveStatus' }
    ,{ kind: 'interactionStateIs', label: '调查点状态为', arg: 'interactionState' }
    ,{ kind: 'groupState', label: '单位组状态为', arg: 'groupState' }
    ,{ kind: 'unitsInArea', label: '区域内单位数量', arg: 'areaCount' }
    ,{ kind: 'eventInteractionIs', label: '事件调查点是', arg: 'interaction' }
    ,{ kind: 'eventSignalIs', label: '事件信号是', arg: 'text' }
    ,{ kind: 'mechanicEnabled', label: '机制已启用/禁用', arg: 'mechanicBoolean' }
]);

// 动作：对关卡状态/UI 的副作用。每条形如 { kind, ...字段 }；kind 必须与
// triggers.js 的 runAction 分支一致。
export const TRIGGER_ACTIONS = Object.freeze([
    { kind: 'showStep',      label: '显示步骤',     arg: 'step' },
    { kind: 'setObjective',  label: '切换主目标',   arg: 'objective' },
    { kind: 'setOptional',   label: '标记支线完成', arg: 'optional' },
    { kind: 'spawnUnits',    label: '生成单位',     arg: 'spawnGroup' },
    { kind: 'setFlag',       label: '置位标记',     arg: 'text' },
    { kind: 'clearFlag',     label: '清除标记',     arg: 'text' },
    { kind: 'setPhase',      label: '设置关卡阶段', arg: 'text' },
    { kind: 'hideGuidance',  label: '隐藏引导对白', arg: 'none' },
    { kind: 'unlockInput',   label: '解除输入锁',   arg: 'none', note: '关闭严格引导，玩家自由操作' },
    { kind: 'log',           label: '写战报',       arg: 'text' },
    { kind: 'win',           label: '判定胜利',     arg: 'none' },
    { kind: 'fail',          label: '判定失败',     arg: 'text' },
    { kind: 'delay',         label: '延迟后执行',   arg: 'delayGroup', note: '毫秒后执行一组子动作（演出用）' }
    ,{ kind: 'setVariable', label: '修改变量', arg: 'variableOperation' }
    ,{ kind: 'setTriggerEnabled', label: '启用/禁用触发器', arg: 'triggerEnabled' }
    ,{ kind: 'emitSignal', label: '发送信号', arg: 'text' }
    ,{ kind: 'setObjectiveStatus', label: '设置目标状态', arg: 'objectiveStatus' }
    ,{ kind: 'changeGold', label: '修改金币', arg: 'campOperation' }
    ,{ kind: 'changeUnitHp', label: '修改单位生命', arg: 'unitOperation' }
    ,{ kind: 'changeUnitFaction', label: '改变单位阵营', arg: 'unitCamp' }
    ,{ kind: 'setUnitState', label: '设置单位状态', arg: 'unitState' }
    ,{ kind: 'setUnitDefeatRule', label: '设置单位战败规则', arg: 'unitDefeatRule' }
    ,{ kind: 'setDiplomacy', label: '改变外交关系', arg: 'relation' }
    ,{ kind: 'setWeather', label: '改变天气', arg: 'weather' }
    ,{ kind: 'setInteractionState', label: '设置调查点状态', arg: 'interactionState' }
    ,{ kind: 'removeUnits', label: '移除/处决单位', arg: 'unitRemove' }
    ,{ kind: 'endScenario', label: '结束关卡', arg: 'scenarioResult' }
    ,{ kind: 'setMechanicEnabled', label: '启用/禁用机制', arg: 'mechanicBoolean' }
]);

// ── 默认空关卡 ───────────────────────────────────────────────
export function createDefaultLevel() {
    return {
        schemaVersion: SCHEMA_VERSION,
        id: 'new-level',
        title: '新关卡',
        chronicleId: 'blood-iris',
        seed: 0x1234,
        turnLimit: 0,               // 0 = 不限回合
        intro: { campaignTitle: '将星列传', chapterTitle: '', scenarioSubtitle: '新关卡' },
        weather: 'clear',
        localPlayerCamp: 'player1',
        factions: [{ id: 'player1', name: '红军', color: '#e05050', controller: 'human', participatesInTurns: true, active: true }],
        diplomacy: {},
        mechanics: createDefaultMechanics(),
        aiOpponentCamp: 'player2',
        aiDifficulty: 1.0,
        gold: { player1: 6 },
        commanders: {},
        hands: { player1: [] },
        // 阵营不是逐格独立属性：每个 districtId 的阵营由该区划内的城市（颜色来源）单向决定，
        // 与 gameLogic.updateDistrictColor 的运行时规则一致——城市变色，全区划跟着变色。
        // 因此棋盘只需描述「区划范围」(districts) 与「区划颜色来源」(cities.camp)，
        // 不存在独立的逐格阵营覆盖表。
        board: {
            radius: BOARD_RADIUS_DEFAULT,
            cities: [
                { q: 0, r: 0, districtId: 5, camp: 'neutral' }   // 城市即该区划的颜色来源
            ],
            terrain: [],            // [{ q, r, type }]  非 plains 的地块
            villages: [],           // [{ q, r, districtId }]
            fortifications: [],     // [{ q, r, type }]  trench/flak
            districts: []           // [{ q, r, districtId }] 覆盖 Voronoi 归属，用于手绘不规则边界
        },
        units: [],                  // [{ id, type, camp, q, r, commander, hpPct, morale, canAct }]
        unitGroups: [],             // [{ id, unitIds:[] }]
        areas: [],                  // [{ id, tiles:[{q,r}] }]
        interactables: [],          // [{ id, q, r, label, enabled, once, icon? }]
        variables: [],              // [{ id, scope:'level'|'campaign', type, initial }]
        // 剧情步骤（简化模型）：只有台词/旁白两种，按钮统一为「下一步」。
        //   { mode: 'narrator'|'character', text, speaker?: {name, portrait},
        //     next?: stepId|'__自定义__'|null,  // 有值→显示「下一步」；null→等待触发器推进
        //     target?: unitId|{q,r},            // 可选：目标环
        //     allow?: { units:[], tiles:[{q,r}], cards:[], actions:[], hint } } // 可选：输入白名单
        steps: {},
        objectives: {},             // { objId: { title, detail, active, main } }
        initialStep: '',
        triggers: [],               // [{ id, when:[], do:[], once, enabled }]
        result: {
            winText: '任务完成。',
            loseText: '任务失败，重新整顿部队。',
            eliminateEnemy: true,
            starRules: []           // [{ when:[], label }] 每满足一条 +1 星（基础 1 星，上限 3）
        }
    };
}

// ── 归一化：把外部/旧配置补齐到当前 schema，容错缺字段 ─────────────
export function normalizeLevel(raw) {
    const def = createDefaultLevel();
    if (!raw || typeof raw !== 'object') return def;
    const merged = { ...def, ...raw };
    merged.schemaVersion = SCHEMA_VERSION;
    merged.intro = { ...def.intro, ...(raw.intro || {}) };
    merged.gold = { ...def.gold, ...(raw.gold || {}) };
    merged.commanders = { ...def.commanders, ...(raw.commanders || {}) };
    merged.hands = { ...def.hands, ...(raw.hands || {}) };
    merged.localPlayerCamp = CAMP_KEYS.includes(raw.localPlayerCamp) ? raw.localPlayerCamp : def.localPlayerCamp;
    merged.factions = Array.isArray(raw.factions) ? raw.factions.map(item => ({ ...item })) : def.factions.map(item => ({ ...item }));
    merged.diplomacy = raw.diplomacy && typeof raw.diplomacy === 'object' ? structuredClone(raw.diplomacy) : structuredClone(def.diplomacy);
    merged.mechanics = createDefaultMechanics(raw.mechanics || {});
    merged.board = { ...def.board, ...(raw.board || {}) };
    for (const key of ['cities', 'terrain', 'villages', 'fortifications', 'districts']) {
        merged.board[key] = Array.isArray(merged.board[key]) ? merged.board[key] : [];
    }
    merged.units = Array.isArray(raw.units) ? raw.units : [];
    merged.unitGroups = Array.isArray(raw.unitGroups) ? raw.unitGroups : [];
    merged.areas = Array.isArray(raw.areas) ? raw.areas : [];
    merged.interactables = Array.isArray(raw.interactables) ? raw.interactables : [];
    merged.variables = Array.isArray(raw.variables) ? raw.variables : [];
    merged.steps = raw.steps && typeof raw.steps === 'object' ? raw.steps : {};
    merged.objectives = raw.objectives && typeof raw.objectives === 'object' ? raw.objectives : {};
    merged.triggers = Array.isArray(raw.triggers) ? raw.triggers : [];
    merged.result = { ...def.result, ...(raw.result || {}) };
    merged.result.starRules = Array.isArray(merged.result.starRules) ? merged.result.starRules : [];
    return merged;
}

// ── 校验：返回 { errors:[], warnings:[] }，编辑器据此提示、运行时据此拦截 ─
export function validateLevel(config) {
    const errors = [];
    const warnings = [];
    const c = config || {};

    if (!c.id || !/^[a-z0-9-]+$/i.test(c.id)) errors.push('关卡 id 缺失或含非法字符（仅允许字母/数字/连字符）。');
    if (!c.title) warnings.push('关卡缺少标题。');

    const radius = c.board?.radius ?? BOARD_RADIUS_DEFAULT;
    if (radius < BOARD_RADIUS_MIN || radius > BOARD_RADIUS_MAX) {
        errors.push(`棋盘半径 ${radius} 超出允许范围 ${BOARD_RADIUS_MIN}~${BOARD_RADIUS_MAX}。`);
    }
    const inBoard = (q, r) => Math.max(Math.abs(q), Math.abs(r), Math.abs(q + r)) <= radius;

    const cities = c.board?.cities || [];
    if (cities.length === 0) warnings.push('棋盘没有任何城市，玩家可能无法获得收入或胜负判定。');
    const districtCityCount = new Map();
    for (const city of cities) {
        if (!inBoard(city.q, city.r)) errors.push(`城市 (${city.q},${city.r}) 落在棋盘之外。`);
        districtCityCount.set(city.districtId, (districtCityCount.get(city.districtId) || 0) + 1);
    }
    // 阵营由区划内唯一的城市（颜色来源）派生，一个 districtId 不能有两座颜色来源冲突的城市。
    for (const [districtId, count] of districtCityCount) {
        if (count > 1) errors.push(`行政区 ${districtId} 有 ${count} 座城市，颜色来源不唯一。`);
    }
    for (const entry of (c.board?.districts || [])) {
        if (!districtCityCount.has(entry.districtId)) {
            warnings.push(`区划范围 (${entry.q},${entry.r}) 指定为行政区 ${entry.districtId}，但该行政区没有城市作为颜色来源，将显示为中立。`);
        }
    }

    const seen = new Set();
    const unitIds = new Set();
    for (const u of (c.units || [])) {
        if (!UNIT_TYPES.includes(u.type)) errors.push(`单位使用了未知兵种「${u.type}」。`);
        if (!CAMP_KEYS.includes(u.camp)) errors.push(`单位阵营「${u.camp}」非法。`);
        if (!inBoard(u.q, u.r)) errors.push(`单位 (${u.q},${u.r}) 落在棋盘之外。`);
        const key = `${u.q},${u.r}`;
        if (seen.has(key)) errors.push(`坐标 (${key}) 上有多个单位重叠。`);
        seen.add(key);
        if (!u.id) errors.push(`坐标 (${key}) 的单位缺少 id。`);
        else if (unitIds.has(u.id)) errors.push(`单位 id「${u.id}」重复。`);
        else unitIds.add(u.id);
        if (u.commander && !COMMANDER_IDS.includes(u.commander)) errors.push(`单位绑定了未知将领「${u.commander}」。`);
        if (u.id && u.id.startsWith('__')) warnings.push(`单位 id「${u.id}」以 __ 开头，可能与内部保留冲突。`);
    }

    if (!CAMP_KEYS.includes(c.localPlayerCamp)) errors.push(`本地玩家阵营「${c.localPlayerCamp}」非法。`);
    const factionIds = new Set();
    for (const faction of (c.factions || [])) {
        if (!CAMP_KEYS.includes(faction.id)) errors.push(`阵营定义 id「${faction.id}」非法。`);
        if (factionIds.has(faction.id)) errors.push(`阵营定义「${faction.id}」重复。`);
        factionIds.add(faction.id);
        if (!faction.name) warnings.push(`阵营「${faction.id}」没有显示名。`);
        if (!/^#[0-9a-f]{6}$/i.test(faction.color || '')) errors.push(`阵营「${faction.id}」颜色必须是 #RRGGBB。`);
    }
    for (const left of CAMP_KEYS) for (const [right, relation] of Object.entries(c.diplomacy?.[left] || {})) {
        if (!CAMP_KEYS.includes(right) || left === right) errors.push(`外交关系「${left}→${right}」引用非法。`);
        if (!RELATION_KEYS.includes(relation)) errors.push(`外交关系「${left}→${right}」值「${relation}」非法。`);
        const reverse = c.diplomacy?.[right]?.[left];
        if (reverse && reverse !== relation) errors.push(`外交关系「${left}↔${right}」不对称。`);
    }

    const groupIds = new Set();
    for (const group of (c.unitGroups || [])) {
        if (!group.id || groupIds.has(group.id)) errors.push(`单位组 id「${group.id || '空'}」缺失或重复。`);
        groupIds.add(group.id);
        for (const id of (group.unitIds || [])) if (!unitIds.has(id)) errors.push(`单位组「${group.id}」引用不存在的单位「${id}」。`);
    }
    const areaIds = new Set();
    for (const area of (c.areas || [])) {
        if (!area.id || areaIds.has(area.id)) errors.push(`区域 id「${area.id || '空'}」缺失或重复。`);
        areaIds.add(area.id);
        if (!Array.isArray(area.tiles) || area.tiles.length === 0) warnings.push(`区域「${area.id}」没有地块。`);
        for (const tile of (area.tiles || [])) if (!inBoard(tile.q, tile.r)) errors.push(`区域「${area.id}」包含棋盘外坐标 (${tile.q},${tile.r})。`);
    }
    const interactionIds = new Set();
    for (const item of (c.interactables || [])) {
        if (!item.id || interactionIds.has(item.id)) errors.push(`调查点 id「${item.id || '空'}」缺失或重复。`);
        interactionIds.add(item.id);
        if (!inBoard(item.q, item.r)) errors.push(`调查点「${item.id}」位于棋盘外。`);
        if (!item.label) warnings.push(`调查点「${item.id}」没有显示文案。`);
    }
    const variableIds = new Set();
    for (const variable of (c.variables || [])) {
        if (!variable.id || variableIds.has(variable.id)) errors.push(`变量 id「${variable.id || '空'}」缺失或重复。`);
        variableIds.add(variable.id);
        if (!VARIABLE_TYPES.includes(variable.type)) errors.push(`变量「${variable.id}」类型非法。`);
        if (!VARIABLE_SCOPES.includes(variable.scope)) errors.push(`变量「${variable.id}」作用域非法。`);
    }

    if (c.initialStep && !c.steps?.[c.initialStep]) {
        errors.push(`initialStep「${c.initialStep}」在 steps 中不存在。`);
    }
    for (const [stepId, step] of Object.entries(c.steps || {})) {
        if (step.mode === 'character' && !step.speaker?.name) {
            warnings.push(`台词步骤「${stepId}」缺少说话人。`);
        }
        if (step.next && !step.next.startsWith('__') && !c.steps[step.next]) {
            errors.push(`步骤「${stepId}」的 next「${step.next}」不存在（自定义跳转请用 __ 前缀）。`);
        }
    }
    const activeMainCount = Object.values(c.objectives || {}).filter(o => o.main && o.active !== false).length;
    if (activeMainCount === 0 && Object.keys(c.objectives || {}).length > 0) {
        warnings.push('没有设置任何主要目标，玩家将无法通过目标完成获得胜利。');
    }

    const triggerIds = new Set((c.triggers || []).map(t => t.id).filter(Boolean));
    const objectiveIds = new Set(Object.keys(c.objectives || {}));
    const validateCondition = (condition, path) => {
        if (!condition || typeof condition !== 'object') { errors.push(`${path} 条件为空。`); return; }
        if (!TRIGGER_CONDITIONS.some(item => item.kind === condition.kind)) { errors.push(`${path} 使用未知条件「${condition.kind}」。`); return; }
        if (condition.kind === 'all' || condition.kind === 'any') {
            if (!Array.isArray(condition.conditions) || condition.conditions.length === 0) errors.push(`${path} 的 ${condition.kind.toUpperCase()} 组不能为空。`);
            else condition.conditions.forEach((child, index) => validateCondition(child, `${path}/${index + 1}`));
        }
        if (condition.kind === 'not') {
            if (!condition.condition) errors.push(`${path} 的 NOT 缺少子条件。`); else validateCondition(condition.condition, `${path}/NOT`);
        }
        if (condition.kind === 'groupState' && !groupIds.has(condition.group)) errors.push(`${path} 引用不存在的单位组「${condition.group}」。`);
        if (condition.kind === 'unitsInArea' && !areaIds.has(condition.area)) errors.push(`${path} 引用不存在的区域「${condition.area}」。`);
        if (['eventInteractionIs', 'interactionStateIs'].includes(condition.kind) && !interactionIds.has(condition.interactable)) errors.push(`${path} 引用不存在的调查点「${condition.interactable}」。`);
        if (condition.kind === 'objectiveStatusIs' && !objectiveIds.has(condition.objective)) errors.push(`${path} 引用不存在的目标「${condition.objective}」。`);
        if (condition.kind === 'mechanicEnabled' && !MECHANIC_KEYS.includes(condition.mechanic)) errors.push(`${path} 引用不存在的机制「${condition.mechanic}」。`);
    };
    const validateAction = (action, path) => {
        if (!action || typeof action !== 'object') { errors.push(`${path} 效果为空。`); return; }
        if (!TRIGGER_ACTIONS.some(item => item.kind === action.kind)) { errors.push(`${path} 使用未知效果「${action.kind}」。`); return; }
        const target = action.target;
        if (target?.unit && !unitIds.has(target.unit)) errors.push(`${path} 引用不存在的单位「${target.unit}」。`);
        if (target?.group && !groupIds.has(target.group)) errors.push(`${path} 引用不存在的单位组「${target.group}」。`);
        if (action.kind === 'setVariable' && !variableIds.has(action.variable)) errors.push(`${path} 引用不存在的变量「${action.variable}」。`);
        if (action.kind === 'setTriggerEnabled' && !triggerIds.has(action.trigger)) errors.push(`${path} 引用不存在的触发器「${action.trigger}」。`);
        if (action.kind === 'setObjectiveStatus' && !objectiveIds.has(action.objective)) errors.push(`${path} 引用不存在的目标「${action.objective}」。`);
        if (action.kind === 'setInteractionState' && !interactionIds.has(action.interactable)) errors.push(`${path} 引用不存在的调查点「${action.interactable}」。`);
        if (action.kind === 'setMechanicEnabled' && !MECHANIC_KEYS.includes(action.mechanic)) errors.push(`${path} 引用不存在的机制「${action.mechanic}」。`);
        if (action.kind === 'delay') (action.then || []).forEach((child, index) => validateAction(child, `${path}/延迟${index + 1}`));
    };
    const seenTriggerIds = new Set();
    for (const t of (c.triggers || [])) {
        if (!t.id || seenTriggerIds.has(t.id)) errors.push(`触发器 id「${t.id || '空'}」缺失或重复。`);
        seenTriggerIds.add(t.id);
        (t.when || []).forEach((condition, index) => validateCondition(condition, `触发器「${t.id || '?'}」条件 ${index + 1}`));
        (t.do || []).forEach((action, index) => validateAction(action, `触发器「${t.id || '?'}」效果 ${index + 1}`));
    }
    for (const [key, value] of Object.entries(c.mechanics || {})) {
        if (!MECHANIC_KEYS.includes(key)) warnings.push(`未知机制开关「${key}」，运行时将忽略。`);
        if (typeof value !== 'boolean') errors.push(`机制开关「${key}」必须是布尔值。`);
    }

    return { errors, warnings };
}

// 单位在指定坐标是否合法落子（供编辑器 placement 校验复用）。
export function boardContains(radius, q, r) {
    return Math.max(Math.abs(q), Math.abs(r), Math.abs(q + r)) <= radius;
}
