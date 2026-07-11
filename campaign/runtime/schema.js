// 关卡配置 Schema —— 战役编辑器与运行时之间的唯一数据契约。
// 一个 level 配置（下称 config）是纯 JSON 可序列化对象：编辑器产出它，
// scenarioFromConfig 把它包装成通用控制器认识的 scenario 接口来运行。
// 枚举尽量从规则层派生，保证与游戏本体同步（单一数据源）。
import { UNIT_CONFIG } from '../../rules/units.js';
import { COMMANDER_CONFIG } from '../../rules/commanders.js';
import { TERRAIN_CONFIG, FORTIFICATION_CONFIG, WEATHER_CONFIG } from '../../rules/terrain.js';
import { TACTICAL_CARD_CONFIG } from '../../rules/cards.js';

export const SCHEMA_VERSION = 1;

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

export const WEATHER_KEYS = Object.freeze(Object.keys(WEATHER_CONFIG)); // clear/rain/fog/wind
export const WEATHER_LABELS = Object.freeze(
    Object.fromEntries(WEATHER_KEYS.map(w => [w, WEATHER_CONFIG[w].name]))
);

export const CARD_IDS = Object.freeze(Object.keys(TACTICAL_CARD_CONFIG));
export const CARD_LABELS = Object.freeze(
    Object.fromEntries(CARD_IDS.map(id => [id, TACTICAL_CARD_CONFIG[id].name]))
);

// 棋盘半径限制：与设计文档一致（R=3~5），另留 2~6 的编辑余量。
export const BOARD_RADIUS_MIN = 2;
export const BOARD_RADIUS_MAX = 7;
export const BOARD_RADIUS_DEFAULT = 4;

// ── 触发器 DSL 词汇表（编辑器据此渲染下拉；运行时据此解释）──────────
// 事件：领域事件总线上的关卡钩子。
export const TRIGGER_EVENTS = Object.freeze([
    { id: 'levelStart',   label: '关卡开始',   note: '进入关卡、首个步骤显示后触发一次' },
    { id: 'stepShown',    label: '步骤显示时', note: '某剧情步骤展示时（配合 step 条件）' },
    { id: 'advance',      label: '点击按钮',   note: '玩家点击对白的继续按钮（配合 next 值）' },
    { id: 'tileSelected', label: '选中地块',   note: '玩家点击选中一个单位/地块' },
    { id: 'cardUsed',     label: '使用对策卡', note: '玩家打出一张对策卡' },
    { id: 'unitMoved',    label: '单位移动后', note: '任一单位完成移动' },
    { id: 'skillUsed',    label: '发动主动技', note: '将领主动技能被发动' },
    { id: 'cityCaptured', label: '城市易主',   note: '一座城市被占领' },
    { id: 'turnStarted',  label: '回合开始',   note: '某阵营回合开始' }
]);

// 条件：布尔判定。engine 另支持 all/any/not 组合（手写 JSON 用，编辑器不直接暴露）。
// 每条条件形如 { kind, ...字段 }；kind 必须与 triggers.js 的 evalCondition 分支一致。
export const TRIGGER_CONDITIONS = Object.freeze([
    { kind: 'stepIs',       label: '当前步骤为',   arg: 'step' },
    { kind: 'phaseIs',      label: '关卡阶段为',   arg: 'text' },
    { kind: 'eventUnitIs',  label: '事件单位是',   arg: 'unitRef', note: '触发事件涉及的单位其编辑器 id' },
    { kind: 'eventCardIs',  label: '事件卡牌是',   arg: 'card' },
    { kind: 'eventCampIs',  label: '事件阵营是',   arg: 'camp' },
    { kind: 'eventNextIs',  label: '按钮跳转值为', arg: 'text', note: '配合「点击按钮」事件，匹配 step.next 的 __ 值' },
    { kind: 'unitAlive',    label: '单位存活',     arg: 'unitRef' },
    { kind: 'unitDead',     label: '单位阵亡',     arg: 'unitRef' },
    { kind: 'cityOwnedBy',  label: '城市归属于',   arg: 'cityOwner' },
    { kind: 'turnAtLeast',  label: '回合数≥',      arg: 'number' },
    { kind: 'flagSet',      label: '标记已置位',   arg: 'text' },
    { kind: 'flagUnset',    label: '标记未置位',   arg: 'text' }
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
        intro: { campaignTitle: '将星列传', scenarioSubtitle: '新关卡' },
        weather: 'clear',
        aiOpponentCamp: 'player2',
        aiDifficulty: 1.0,
        gold: { player1: 6, player2: 6, player3: 6 },
        commanders: { player1: null, player2: null, player3: null },
        hands: { player1: [], player2: [], player3: [] },
        board: {
            radius: BOARD_RADIUS_DEFAULT,
            cities: [
                { q: 0, r: 0, districtId: 5, camp: 'neutral' }
            ],
            terrain: [],            // [{ q, r, type }]  非 plains 的地块
            villages: [],           // [{ q, r, districtId }]
            fortifications: [],     // [{ q, r, type }]  trench/flak
            camps: [],              // [{ q, r, camp }]  覆盖 Voronoi 归属
            districts: []           // [{ q, r, districtId }] 覆盖 Voronoi 归属
        },
        units: [],                  // [{ id, type, camp, q, r, commander, hpPct, morale, canAct }]
        // 剧情步骤（简化模型）：只有台词/旁白两种，按钮统一为「下一步」。
        //   { mode: 'narrator'|'character', text, speaker?: {name, portrait},
        //     next?: stepId|'__自定义__'|null,  // 有值→显示「下一步」；null→等待触发器推进
        //     target?: unitId|{q,r},            // 可选：目标环
        //     allow?: { units:[], tiles:[{q,r}], cards:[], actions:[], hint } } // 可选：输入白名单
        steps: {},
        objectives: {},             // { objId: { title, detail } }
        optionalObjectives: [],     // [{ id, text }]
        initialStep: '',
        initialObjective: '',
        triggers: [],               // [{ id, on, when:[], do:[], once }]
        result: {
            winText: '任务完成。',
            loseText: '任务失败，重新整顿部队。',
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
    merged.board = { ...def.board, ...(raw.board || {}) };
    for (const key of ['cities', 'terrain', 'villages', 'fortifications', 'camps', 'districts']) {
        merged.board[key] = Array.isArray(merged.board[key]) ? merged.board[key] : [];
    }
    merged.units = Array.isArray(raw.units) ? raw.units : [];
    merged.steps = raw.steps && typeof raw.steps === 'object' ? raw.steps : {};
    merged.objectives = raw.objectives && typeof raw.objectives === 'object' ? raw.objectives : {};
    merged.optionalObjectives = Array.isArray(raw.optionalObjectives) ? raw.optionalObjectives : [];
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
    for (const city of cities) {
        if (!inBoard(city.q, city.r)) errors.push(`城市 (${city.q},${city.r}) 落在棋盘之外。`);
    }

    const seen = new Set();
    for (const u of (c.units || [])) {
        if (!UNIT_TYPES.includes(u.type)) errors.push(`单位使用了未知兵种「${u.type}」。`);
        if (!CAMP_KEYS.includes(u.camp)) errors.push(`单位阵营「${u.camp}」非法。`);
        if (!inBoard(u.q, u.r)) errors.push(`单位 (${u.q},${u.r}) 落在棋盘之外。`);
        const key = `${u.q},${u.r}`;
        if (seen.has(key)) errors.push(`坐标 (${key}) 上有多个单位重叠。`);
        seen.add(key);
        if (u.commander && !COMMANDER_IDS.includes(u.commander)) errors.push(`单位绑定了未知将领「${u.commander}」。`);
        if (u.id && u.id.startsWith('__')) warnings.push(`单位 id「${u.id}」以 __ 开头，可能与内部保留冲突。`);
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
    if (c.initialObjective && !c.objectives?.[c.initialObjective]) {
        warnings.push(`initialObjective「${c.initialObjective}」在 objectives 中不存在。`);
    }

    for (const t of (c.triggers || [])) {
        if (!TRIGGER_EVENTS.some(e => e.id === t.on)) errors.push(`触发器「${t.id || '?'}」使用了未知事件「${t.on}」。`);
    }

    return { errors, warnings };
}

// 单位在指定坐标是否合法落子（供编辑器 placement 校验复用）。
export function boardContains(radius, q, r) {
    return Math.max(Math.abs(q), Math.abs(r), Math.abs(q + r)) <= radius;
}
