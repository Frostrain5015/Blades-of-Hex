// 关卡配置 Schema —— 战役编辑器与运行时之间的唯一数据契约。
// 一个 level 配置（下称 config）是纯 JSON 可序列化对象：编辑器产出它，
// scenarioFromConfig 把它包装成通用控制器认识的 scenario 接口来运行。
// 枚举尽量从规则层派生，保证与游戏本体同步（单一数据源）。
import { UNIT_CONFIG } from '../../rules/units.js';
import { COMMANDER_CONFIG } from '../../rules/commanders.js';
import { TERRAIN_CONFIG, FORTIFICATION_CONFIG, WEATHER_CONFIG } from '../../rules/terrain.js';
import { TACTICAL_CARD_CONFIG } from '../../rules/cards.js';
import { MECHANIC_DEFINITIONS, MECHANIC_KEYS, createDefaultMechanics } from '../../rules/mechanics.js';
import { FACTION_COLOR_KEYS, FACTION_PALETTE, getFlagColors, getPaletteEntry, getTileColor } from '../../rules/camps.js';
import {
    BOARD_LAYOUT, BOARD_LAYOUT_KEYS, normalizeBoardLayout, isBoardCoordinatePlayable
} from '../../rules/boardLayout.js';
import {
    SURFACE_KIND, SURFACE_KINDS, SURFACE_SPEC_KINDS,
    hasAdjacentWater, isWaterSurface, tileCoordinateKey
} from '../../rules/surfaces.js';
import {
    RIVER_CROSSING_KINDS, RIVER_WIDTHS,
    areCanonicalRiverVerticesAdjacent, canonicalRiverSegmentKey,
    canonicalRiverVertex, canonicalRiverVertexKey, findRiverPathSelfIntersections
} from '../../rules/hydrography.js';
import { canUnitOccupyTile } from '../../rules/movement.js';
import { NPC_DIALOGUE_PORTRAIT_IDS, NPC_DIALOGUE_PORTRAIT_LABELS } from '../portraits.js';

export const SCHEMA_VERSION = 3;
export const RELATION_KEYS = Object.freeze(['ally', 'neutral', 'enemy']);
export const OBJECTIVE_STATUS_KEYS = Object.freeze(['hidden', 'active', 'completed', 'failed']);
export const VARIABLE_TYPES = Object.freeze(['number', 'boolean', 'string']);
export const VARIABLE_SCOPES = Object.freeze(['level', 'campaign']);
export { MECHANIC_KEYS };
export const MECHANIC_LABELS = Object.freeze(Object.fromEntries(MECHANIC_KEYS.map(key => [key, MECHANIC_DEFINITIONS[key].label])));

/** 编辑器只保存颜色 id；规则层调色板负责解析地块色与旗帜三阶色。 */
export { FACTION_COLOR_KEYS, FACTION_PALETTE, getFlagColors, getPaletteEntry, getTileColor } from '../../rules/camps.js';

// ── 枚举（派生自规则层，附中文标签供编辑器下拉）───────────────────
// 注意：动态阵营体系不再默认包含"中立"，完全交由作者排布。
export const CAMP_KEYS = Object.freeze(['player1', 'player2', 'player3']);
export const CAMP_LABELS = Object.freeze({
    player1: '第一阵营', player2: '第二阵营', player3: '第三阵营'
});

export const UNIT_TYPES = Object.freeze(Object.keys(UNIT_CONFIG));
export const UNIT_LABELS = Object.freeze(
    Object.fromEntries(UNIT_TYPES.map(t => [t, UNIT_CONFIG[t].name]))
);

export const COMMANDER_IDS = Object.freeze(Object.keys(COMMANDER_CONFIG));
export const COMMANDER_LABELS = Object.freeze(
    Object.fromEntries(COMMANDER_IDS.map(id => [id, COMMANDER_CONFIG[id].definition.name]))
);
// 对白立绘除了将领 ID，也允许两张通用 NPC 兜底肖像。
export const DIALOGUE_PORTRAIT_IDS = Object.freeze([...COMMANDER_IDS, ...NPC_DIALOGUE_PORTRAIT_IDS]);
export const DIALOGUE_PORTRAIT_LABELS = Object.freeze({ ...COMMANDER_LABELS, ...NPC_DIALOGUE_PORTRAIT_LABELS });

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
export { BOARD_LAYOUT, BOARD_LAYOUT_KEYS };
export { SURFACE_KIND, SURFACE_KINDS, SURFACE_SPEC_KINDS, RIVER_WIDTHS, RIVER_CROSSING_KINDS };
export const BOARD_LAYOUT_LABELS = Object.freeze({
    [BOARD_LAYOUT.HEX]: '经典六边形',
    [BOARD_LAYOUT.BORDERLESS]: '无边军事地图'
});

// ── 触发器条件/动作词汇表（编辑器据此渲染下拉；运行时据此解释）──────────
// 事件已取消显式配置：所有触发器每次事件后都会尝试求值，由条件决定是否触发。
// 条件：布尔判定。
// 每条条件形如 { kind, ...字段 }；kind 必须与 triggers.js 的 evalCondition 分支一致。
export const TRIGGER_CONDITIONS = Object.freeze([
    { kind: 'any', label: '满足任一（OR）', arg: 'conditionGroup' },
    { kind: 'all', label: '满足全部（AND）', arg: 'conditionGroup' },
    { kind: 'not', label: '不满足（NOT）', arg: 'conditionSingle' },
    { kind: 'unitSelected', label: '指定单位被选中', arg: 'eventTarget', event: true },
    { kind: 'unitMovesToTile', label: '指定单位/单位组移动到指定地块/区域', arg: 'eventTargetArea', event: true },
    { kind: 'unitAttacksUnit', label: '指定单位攻击指定单位/单位组', arg: 'eventCombatPair', event: true },
    { kind: 'unitKilled', label: '指定单位/单位组被击败', arg: 'eventTarget', event: true },
    { kind: 'cityCaptured', label: '指定城市被占领', arg: 'eventCityCapture', event: true },
    { kind: 'turnStarted', label: '新回合/指定阵营回合开始时', arg: 'eventCampTurn', event: true },
    { kind: 'cardUsed', label: '使用指定对策卡', arg: 'cardCamp', event: true },
    { kind: 'skillUsed', label: '指定单位使用技能', arg: 'eventUnitSkill', event: true },
    { kind: 'eventNextIs',  label: '按钮跳转值为', arg: 'text', note: '配合「点击按钮」事件，匹配 step.next 的 __ 值', event: true },
    { kind: 'eventChoiceIs', label: '对话选项结果为', arg: 'text', event: true },
    { kind: 'timer',        label: '触发器启用后计时', arg: 'number', note: '本触发器每次启用后经过指定毫秒自动满足；开场启用时从关卡开始计时' }
    ,{ kind: 'cityOwnedBy',  label: '城市归属于',   arg: 'cityOwner' },
    { kind: 'unitExists', label: '单位存在/存活', arg: 'unitExists' }
    ,{ kind: 'unitHpCompare', label: '单位生命比较', arg: 'unitHpCompare' }
    ,{ kind: 'factionUnitCount', label: '阵营单位数量', arg: 'campCompare' }
    ,{ kind: 'goldCompare', label: '阵营金币比较', arg: 'goldCompare' }
    ,{ kind: 'variableCompare', label: '关卡变量比较', arg: 'variableCompare' }
    ,{ kind: 'tileOwnedBy', label: '地块当前归属于', arg: 'cityOwner' }
    ,{ kind: 'relationIs', label: '外交关系为', arg: 'relation' }
    ,{ kind: 'weatherIs', label: '当前天气为', arg: 'weather' }
    ,{ kind: 'objectiveStatusIs', label: '目标状态为', arg: 'objectiveStatus' }
    ,{ kind: 'interactionStateIs', label: '调查点状态为', arg: 'interactionState' }
    ,{ kind: 'collectibleUnlocked', label: '已获得/未获得收藏物', arg: 'collectibleState' }
    ,{ kind: 'groupState', label: '单位组状态为', arg: 'groupState' }
    ,{ kind: 'unitsInArea', label: '区域内单位数量', arg: 'areaCount' }
    ,{ kind: 'eventInteractionIs', label: '事件调查点是', arg: 'interaction', event: true }
    ,{ kind: 'mechanicEnabled', label: '机制已启用/禁用', arg: 'mechanicBoolean' }
    ,{ kind: 'triggerEnabled', label: '触发器已启用/禁用', arg: 'triggerBoolean' }
]);

// 动作：对关卡状态/UI 的副作用。每条形如 { kind, ...字段 }；kind 必须与
// triggers.js 的 runAction 分支一致。
export const TRIGGER_ACTIONS = Object.freeze([
    { kind: 'showStep',      label: '显示步骤',     arg: 'inlineStep',  }
    ,{ kind: 'spawnUnits',    label: '生成单位',     arg: 'spawnGroup' }
    ,{ kind: 'unlockInput',   label: '解除输入锁',   arg: 'none', note: '关闭严格引导，玩家自由操作' }
    ,{ kind: 'lockInput',     label: '开启输入锁',   arg: 'lockStep', note: '恢复严格引导模式，可选配白名单（不产生视觉高亮）' }
    ,{ kind: 'setVariable', label: '修改变量', arg: 'variableOperation' }
    ,{ kind: 'setTriggerEnabled', label: '启用/禁用触发器', arg: 'triggerEnabled' }
    ,{ kind: 'setObjectiveStatus', label: '设置目标状态', arg: 'objectiveStatus' }
    ,{ kind: 'changeGold', label: '修改金币', arg: 'campOperation' }
    ,{ kind: 'changeUnitHp', label: '修改单位生命', arg: 'unitOperation' }
    ,{ kind: 'changeUnitFaction', label: '改变单位阵营', arg: 'unitCamp' }
    ,{ kind: 'setUnitState', label: '设置单位状态', arg: 'unitState' }
    ,{ kind: 'applyEffect', label: '施加效果', arg: 'effectApply', note: '为指定单位添加临时效果（攻防速HP修正），效果会显示在左上角徽章栏' }
    ,{ kind: 'assignCommander', label: '部署将领', arg: 'unitCommander' }
    ,{ kind: 'setDiplomacy', label: '改变外交关系', arg: 'relation' }
    ,{ kind: 'setWeather', label: '改变天气', arg: 'weather' }
    ,{ kind: 'revealTiles', label: '揭示地块', arg: 'fogReveal', note: '向指定阵营揭示单位所在地、指定地块或命名区域；默认永久' }
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
        factions: [{ id: 'player1', name: '第一阵营', note: '', color: 'red', controller: 'human', participatesInTurns: true, active: true }],
        turnOrder: ['player1'],
        diplomacy: {},
        mechanics: createDefaultMechanics(),
        aiOpponentCamp: '',
        aiDifficulty: 1.0,
        gold: { player1: 6 },
        commanders: {},
        hands: { player1: [] },
        storyCommanders: [],        // [{ id, name, archetype?, portrait? }]
        collectibles: [],           // [{ id, name, emoji, description }]
        // 阵营不是逐格独立属性：每个 districtId 的阵营由该区划内的城市（颜色来源）单向决定，
        // 与 gameLogic.updateDistrictColor 的运行时规则一致——城市变色，全区划跟着变色。
        // 因此棋盘只需描述「区划范围」(districts) 与「区划颜色来源」(cities.camp)，
        // 不存在独立的逐格阵营覆盖表。
        board: {
            layout: BOARD_LAYOUT.HEX,
            radius: BOARD_RADIUS_DEFAULT,
            cities: [
                { q: 0, r: 0, districtId: 5, camp: 'player1' }   // 城市即该区划的颜色来源
            ],
            surface: [],            // 稀疏表：[{ q, r, kind:'shallowWater'|'deepWater' }]；缺省 land
            terrain: [],            // [{ q, r, type }]  非 plains 的地块
            villages: [],           // [{ q, r, districtId }]
            fortifications: [],     // [{ q, r, type }]  trench/flak
            districts: [],          // [{ q, r, districtId }] 覆盖 Voronoi 归属，用于手绘不规则边界
            rivers: [],             // [{ id, width, points:[{q,r,vertex}] }]
            crossings: [],          // [{ riverId, segmentIndex, kind:'ford'|'bridge' }]
            ports: []               // [{ q, r }]，邻接实体水域的格，建为浅水港口
        },
        units: [],                  // [{ id, type, camp, q, r, commander?|storyCommander?, hpPct, morale, canAct }]
        unitGroups: [],             // [{ id, unitIds:[] }]
        areas: [],                  // [{ id, tiles:[{q,r}] }]
        interactables: [],          // [{ id, q, r, label, enabled, unitIds:[...], collectibleId? }]
        variables: [],              // [{ id, scope:'level'|'campaign', type, initial }]
        objectives: {},             // { objId: { title, detail, active, main, highlight?:{unit,tiles,area} } }
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
    merged.storyCommanders = Array.isArray(raw.storyCommanders) ? raw.storyCommanders : [];
    merged.collectibles = Array.isArray(raw.collectibles) ? raw.collectibles : [];
    merged.factions = Array.isArray(raw.factions) ? raw.factions.map(item => {
        const palette = getPaletteEntry(item?.color);
        return { ...item, note: typeof item?.note === 'string' ? item.note.trim() : '', color: palette?.id || item?.color };
    }) : def.factions.map(item => ({ ...item }));
    const configuredFactionIds = new Set(merged.factions.map(item => item.id));
    merged.localPlayerCamp = configuredFactionIds.has(raw.localPlayerCamp) ? raw.localPlayerCamp : def.localPlayerCamp;
    merged.turnOrder = Array.isArray(raw.turnOrder) ? [...raw.turnOrder] : [merged.localPlayerCamp];
    merged.diplomacy = raw.diplomacy && typeof raw.diplomacy === 'object' ? structuredClone(raw.diplomacy) : structuredClone(def.diplomacy);
    merged.mechanics = createDefaultMechanics(raw.mechanics || {});
    merged.board = { ...def.board, ...(raw.board || {}) };
    // 旧关卡缺字段时补经典布局；未知显式值原样保留，让编译器能够给出准确错误，
    // 运行时 mapBuilder 仍会安全降级到经典布局。
    merged.board.layout = raw.board?.layout == null ? BOARD_LAYOUT.HEX : raw.board.layout;
    for (const key of ['cities', 'surface', 'terrain', 'villages', 'fortifications', 'districts', 'rivers', 'crossings', 'ports']) {
        merged.board[key] = Array.isArray(merged.board[key]) ? merged.board[key] : [];
    }
    merged.units = Array.isArray(raw.units) ? raw.units : [];
    merged.unitGroups = Array.isArray(raw.unitGroups) ? raw.unitGroups : [];
    merged.areas = Array.isArray(raw.areas) ? raw.areas : [];
    merged.interactables = Array.isArray(raw.interactables) ? raw.interactables.map(item => {
        const normalized = { ...item, unitIds: Array.isArray(item?.unitIds) ? [...new Set(item.unitIds)] : [] };
        delete normalized.once; // 旧字段从未参与运行时；重复调查统一由状态重新设为 available 控制。
        return normalized;
    }) : [];
    merged.variables = Array.isArray(raw.variables) ? raw.variables : [];
    merged.objectives = raw.objectives && typeof raw.objectives === 'object' ? raw.objectives : {};
    merged.triggers = Array.isArray(raw.triggers) ? raw.triggers.map(trigger => {
        const when = Array.isArray(trigger?.when) ? trigger.when : [];
        // v2 早期版本曾公开 levelStarted；唯一常见写法可无损迁移为 AoE 式空条件开场触发器。
        if (when.length === 1 && when[0]?.kind === 'levelStarted') return { ...trigger, when: [] };
        return trigger;
    }) : [];
    merged.result = { ...def.result, ...(raw.result || {}) };
    merged.result.starRules = Array.isArray(merged.result.starRules) ? merged.result.starRules : [];
    return merged;
}

// ── 校验：返回 { errors:[], warnings:[] }，编辑器据此提示、运行时据此拦截 ─
export function validateLevel(config) {
    const errors = [];
    const warnings = [];
    const c = config || {};
    const declaredFactionIds = new Set((c.factions || []).map(faction => faction?.id).filter(Boolean));
    const factionIds = declaredFactionIds;

    if (!c.id || !/^[a-z0-9-]+$/i.test(c.id)) errors.push('关卡 id 缺失或含非法字符（仅允许字母/数字/连字符）。');
    if (!c.title) warnings.push('关卡缺少标题。');

    const rawLayout = c.board?.layout ?? BOARD_LAYOUT.HEX;
    if (!BOARD_LAYOUT_KEYS.includes(rawLayout)) {
        errors.push(`未知棋盘布局「${rawLayout}」。`);
    }
    const layout = normalizeBoardLayout(rawLayout);
    const radius = c.board?.radius ?? BOARD_RADIUS_DEFAULT;
    if (layout === BOARD_LAYOUT.HEX && (radius < BOARD_RADIUS_MIN || radius > BOARD_RADIUS_MAX)) {
        errors.push(`棋盘半径 ${radius} 超出允许范围 ${BOARD_RADIUS_MIN}~${BOARD_RADIUS_MAX}。`);
    }
    const inBoard = (q, r) => isBoardCoordinatePlayable({ layout, radius }, q, r);

    // Surface is a sparse water-only table. It is resolved before every other
    // board feature so invalid ownership/urban overlays cannot leak onto water.
    const surfaceSpecs = c.board?.surface || [];
    const surfaceMap = new Map();
    const seenSurfaceCoordinates = new Set();
    for (const surface of surfaceSpecs) {
        const validCoordinate = Number.isInteger(surface?.q) && Number.isInteger(surface?.r);
        if (!validCoordinate) {
            errors.push(`表面坐标 (${surface?.q},${surface?.r}) 必须是整数。`);
            continue;
        }
        const key = tileCoordinateKey(surface.q, surface.r);
        if (seenSurfaceCoordinates.has(key)) errors.push(`地块 (${key}) 重复声明了表面类型。`);
        seenSurfaceCoordinates.add(key);
        if (!inBoard(surface.q, surface.r)) errors.push(`表面地块 (${key}) 落在棋盘之外。`);
        if (!SURFACE_SPEC_KINDS.includes(surface.kind)) {
            errors.push(`地块 (${key}) 的表面类型「${surface.kind}」无效；稀疏表只保存 shallowWater/deepWater。`);
            continue;
        }
        if (inBoard(surface.q, surface.r)) surfaceMap.set(key, surface.kind);
    }
    const isWaterAt = (q, r) => isWaterSurface(surfaceMap.get(tileCoordinateKey(q, r)));

    // River paths are checked on the canonical integer vertex lattice. This
    // makes physically coincident refs compare exactly, without pixel epsilon.
    const riverIds = new Set();
    const riverById = new Map();
    const globalSegments = new Map();
    for (const river of (c.board?.rivers || [])) {
        const riverId = river?.id || '';
        if (!/^[a-z][a-z0-9_-]{0,63}$/i.test(riverId)) errors.push(`河流 id「${riverId || '空'}」非法。`);
        if (riverIds.has(riverId)) errors.push(`河流 id「${riverId}」重复。`);
        riverIds.add(riverId);
        if (!RIVER_WIDTHS.includes(river?.width)) errors.push(`河流「${riverId || '未命名'}」宽度「${river?.width}」无效。`);
        const points = Array.isArray(river?.points) ? river.points : [];
        if (!Array.isArray(river?.points) || points.length < 2) errors.push(`河流「${riverId || '未命名'}」至少需要两个顶点。`);
        const canonicalPoints = [];
        const seenVertices = new Set();
        for (let pointIndex = 0; pointIndex < points.length; pointIndex++) {
            const point = points[pointIndex];
            const coordinateValid = Number.isInteger(point?.q) && Number.isInteger(point?.r);
            const vertexValid = Number.isInteger(point?.vertex) && point.vertex >= 0 && point.vertex <= 5;
            if (!coordinateValid || !vertexValid) {
                errors.push(`河流「${riverId || '未命名'}」第 ${pointIndex + 1} 个顶点引用非法。`);
                canonicalPoints.push(null);
                continue;
            }
            if (!inBoard(point.q, point.r)) errors.push(`河流「${riverId || '未命名'}」第 ${pointIndex + 1} 个顶点引用棋盘外地块 (${point.q},${point.r})。`);
            const canonical = canonicalRiverVertex(point);
            canonicalPoints.push(canonical);
            const vertexKey = canonicalRiverVertexKey(point);
            if (seenVertices.has(vertexKey)) errors.push(`河流「${riverId || '未命名'}」重复经过 canonical 顶点 ${vertexKey}，形成自交或回环。`);
            seenVertices.add(vertexKey);
        }
        for (let segmentIndex = 0; segmentIndex < canonicalPoints.length - 1; segmentIndex++) {
            const from = canonicalPoints[segmentIndex];
            const to = canonicalPoints[segmentIndex + 1];
            if (!from || !to) continue;
            if (from.key === to.key) {
                errors.push(`河流「${riverId || '未命名'}」第 ${segmentIndex + 1} 段为零长度。`);
                continue;
            }
            if (!areCanonicalRiverVerticesAdjacent(from, to)) {
                errors.push(`河流「${riverId || '未命名'}」第 ${segmentIndex + 1} 段跨越了非相邻 canonical 顶点。`);
            }
            const segmentKey = canonicalRiverSegmentKey(from, to);
            if (globalSegments.has(segmentKey)) {
                const previous = globalSegments.get(segmentKey);
                errors.push(`河流「${riverId || '未命名'}」第 ${segmentIndex + 1} 段与「${previous.riverId}」第 ${previous.segmentIndex + 1} 段重复。`);
            } else {
                globalSegments.set(segmentKey, { riverId, segmentIndex });
            }
        }
        const intersections = findRiverPathSelfIntersections(points);
        if (intersections.length) {
            const first = intersections[0];
            errors.push(`河流「${riverId || '未命名'}」第 ${first.leftSegmentIndex + 1} 段与第 ${first.rightSegmentIndex + 1} 段自交。`);
        }
        if (!riverById.has(riverId)) riverById.set(riverId, river);
    }

    const seenCrossings = new Set();
    for (const crossing of (c.board?.crossings || [])) {
        const river = riverById.get(crossing?.riverId);
        if (!river) errors.push(`河流通行点引用了不存在的河流「${crossing?.riverId}」。`);
        if (!Number.isInteger(crossing?.segmentIndex)
            || crossing.segmentIndex < 0
            || crossing.segmentIndex >= Math.max(0, (river?.points?.length || 0) - 1)) {
            errors.push(`河流「${crossing?.riverId}」的通行点引用了无效河段 ${crossing?.segmentIndex}。`);
        }
        if (!RIVER_CROSSING_KINDS.includes(crossing?.kind)) {
            errors.push(`河流「${crossing?.riverId}」河段 ${crossing?.segmentIndex} 的通行点类型「${crossing?.kind}」无效。`);
        }
        const key = `${crossing?.riverId}:${crossing?.segmentIndex}`;
        if (seenCrossings.has(key)) errors.push(`河流「${crossing?.riverId}」河段 ${crossing?.segmentIndex} 重复设置了通行点。`);
        seenCrossings.add(key);
    }

    const seenPorts = new Set();
    for (const port of (c.board?.ports || [])) {
        if (!Number.isInteger(port?.q) || !Number.isInteger(port?.r)) {
            errors.push(`港口坐标 (${port?.q},${port?.r}) 必须是整数。`);
            continue;
        }
        const key = tileCoordinateKey(port.q, port.r);
        if (seenPorts.has(key)) errors.push(`港口 (${key}) 重复。`);
        seenPorts.add(key);
        if (!inBoard(port.q, port.r)) errors.push(`港口 (${key}) 落在棋盘之外。`);
        if (isWaterAt(port.q, port.r)) errors.push(`港口 (${key}) 必须放在陆地上。`);
        if (inBoard(port.q, port.r) && !hasAdjacentWater(surfaceMap, port.q, port.r)) {
            errors.push(`港口 (${key}) 必须邻接至少一个实体水域地块。`);
        }
    }

    const cities = c.board?.cities || [];
    if (cities.length === 0) warnings.push('棋盘没有任何城市，玩家可能无法获得收入或胜负判定。');
    const districtCityCount = new Map();
    const cityCenters = new Set();
    const urbanCoordinates = new Map();
    for (const city of cities) {
        const cityCoordinateValid = Number.isInteger(city?.q) && Number.isInteger(city?.r);
        if (!cityCoordinateValid || !inBoard(city.q, city.r)) errors.push(`城市 (${city?.q},${city?.r}) 落在棋盘之外或坐标不是整数。`);
        const centerKey = cityCoordinateValid ? tileCoordinateKey(city.q, city.r) : null;
        if (centerKey && cityCenters.has(centerKey)) errors.push(`坐标 (${centerKey}) 上有多个城市中心。`);
        if (centerKey) cityCenters.add(centerKey);
        if (!city?.camp) errors.push(`城市 (${city?.q},${city?.r}) 缺少阵营归属，请在城市属性中指定。`);
        else if (!factionIds.has(city.camp)) errors.push(`城市 (${city.q},${city.r}) 的阵营「${city.camp}」未在本关阵营列表中声明。`);
        districtCityCount.set(city?.districtId, (districtCityCount.get(city?.districtId) || 0) + 1);

        let authoredFootprint = [];
        if (city?.footprint != null && !Array.isArray(city.footprint)) {
            errors.push(`城市 (${city?.q},${city?.r}) 的 footprint 必须是坐标数组。`);
        } else if (Array.isArray(city?.footprint)) {
            authoredFootprint = city.footprint;
        }
        const footprint = [{ q: city?.q, r: city?.r }, ...authoredFootprint];
        const localFootprint = new Set();
        for (const point of footprint) {
            if (!Number.isInteger(point?.q) || !Number.isInteger(point?.r) || !inBoard(point.q, point.r)) {
                errors.push(`城市 (${city?.q},${city?.r}) 的 footprint 包含棋盘外或非整数坐标 (${point?.q},${point?.r})。`);
                continue;
            }
            const pointKey = tileCoordinateKey(point.q, point.r);
            if (localFootprint.has(pointKey)) continue; // 中心可显式出现在 footprint 中。
            localFootprint.add(pointKey);
            if (isWaterAt(point.q, point.r)) errors.push(`城市 (${city?.q},${city?.r}) 的 footprint 不能覆盖水域地块 (${pointKey})。`);
            const existingCity = urbanCoordinates.get(pointKey);
            if (existingCity && existingCity !== centerKey) errors.push(`城市 footprint 在地块 (${pointKey}) 发生重叠。`);
            else urbanCoordinates.set(pointKey, centerKey);
        }
    }
    // 阵营由区划内唯一的城市（颜色来源）派生，一个 districtId 不能有两座颜色来源冲突的城市。
    for (const [districtId, count] of districtCityCount) {
        if (count > 1) errors.push(`行政区 ${districtId} 有 ${count} 座城市，颜色来源不唯一。`);
    }
    for (const entry of (c.board?.districts || [])) {
        if (!Number.isInteger(entry?.q) || !Number.isInteger(entry?.r) || !inBoard(entry.q, entry.r)) {
            errors.push(`区划范围 (${entry?.q},${entry?.r}) 落在棋盘之外或坐标不是整数。`);
            continue;
        }
        if (isWaterAt(entry.q, entry.r)) errors.push(`水域地块 (${entry.q},${entry.r}) 不能声明行政区。`);
        if (!districtCityCount.has(entry.districtId)) {
            warnings.push(`区划范围 (${entry.q},${entry.r}) 指定为行政区 ${entry.districtId}，但该行政区没有城市作为颜色来源，将显示为中立。`);
        }
    }
    for (const entry of (c.board?.terrain || [])) {
        if (Number.isInteger(entry?.q) && Number.isInteger(entry?.r) && isWaterAt(entry.q, entry.r)) {
            errors.push(`水域地块 (${entry.q},${entry.r}) 不能叠加陆地地形。`);
        }
    }
    for (const village of (c.board?.villages || [])) {
        if (!Number.isInteger(village?.q) || !Number.isInteger(village?.r) || !inBoard(village.q, village.r)) {
            errors.push(`村庄 (${village?.q},${village?.r}) 落在棋盘之外或坐标不是整数。`);
            continue;
        }
        if (isWaterAt(village.q, village.r)) errors.push(`水域地块 (${village.q},${village.r}) 不能放置村庄。`);
        const villageKey = tileCoordinateKey(village.q, village.r);
        if (urbanCoordinates.has(villageKey)) {
            errors.push(`村庄 (${villageKey}) 不能与城市 footprint 重叠。`);
        }
    }
    for (const fortification of (c.board?.fortifications || [])) {
        if (!Number.isInteger(fortification?.q) || !Number.isInteger(fortification?.r) || !inBoard(fortification.q, fortification.r)) {
            errors.push(`工事 (${fortification?.q},${fortification?.r}) 落在棋盘之外或坐标不是整数。`);
            continue;
        }
        if (isWaterAt(fortification.q, fortification.r)) errors.push(`水域地块 (${fortification.q},${fortification.r}) 不能放置工事。`);
    }

    const storyCommanderIds = new Set();
    for (const commander of (c.storyCommanders || [])) {
        const id = commander?.id || '';
        if (!/^[a-z][a-z0-9_-]{0,47}$/i.test(id)) errors.push(`剧情将领 id「${id || '空'}」非法（使用字母开头，后续仅限字母、数字、_、-）。`);
        if (storyCommanderIds.has(id)) errors.push(`剧情将领 id「${id}」重复。`);
        storyCommanderIds.add(id);
        if (!commander?.name?.trim()) errors.push(`剧情将领「${id || '未命名'}」缺少剧情名字。`);
        if (commander?.archetype && !COMMANDER_IDS.includes(commander.archetype)) errors.push(`剧情将领「${id}」引用未知玩法原型「${commander.archetype}」。`);
        if (commander?.portrait && !DIALOGUE_PORTRAIT_IDS.includes(commander.portrait)) errors.push(`剧情将领「${id}」引用不存在的立绘「${commander.portrait}」。`);
    }

    const seen = new Set();
    const unitIds = new Set();
    const mountedStoryCommanders = new Set();
    for (const u of (c.units || [])) {
        if (!UNIT_TYPES.includes(u.type)) errors.push(`单位使用了未知兵种「${u.type}」。`);
        if (!factionIds.has(u.camp)) errors.push(`单位阵营「${u.camp}」未在本关阵营列表中声明。`);
        if (!inBoard(u.q, u.r)) errors.push(`单位 (${u.q},${u.r}) 落在棋盘之外。`);
        const key = `${u.q},${u.r}`;
        if (UNIT_TYPES.includes(u.type) && Number.isInteger(u.q) && Number.isInteger(u.r) && inBoard(u.q, u.r)) {
            const authoredTile = {
                q: u.q,
                r: u.r,
                s: -u.q - u.r,
                surface: surfaceMap.get(key) || SURFACE_KIND.LAND,
                isPort: seenPorts.has(key)
            };
            if (!canUnitOccupyTile({ type: u.type }, authoredTile)) {
                const domain = UNIT_CONFIG[u.type].movementDomain || 'land';
                errors.push(`单位「${u.id || key}」的移动域 ${domain} 无法部署在地块 (${key}) 的表面上。`);
            }
        }
        if (seen.has(key)) errors.push(`坐标 (${key}) 上有多个单位重叠。`);
        seen.add(key);
        if (!u.id) errors.push(`坐标 (${key}) 的单位缺少 id。`);
        else if (unitIds.has(u.id)) errors.push(`单位 id「${u.id}」重复。`);
        else unitIds.add(u.id);
        if (u.commander && !COMMANDER_IDS.includes(u.commander)) errors.push(`单位绑定了未知将领「${u.commander}」。`);
        if (u.storyCommander && !storyCommanderIds.has(u.storyCommander)) errors.push(`单位「${u.id || key}」绑定了不存在的剧情将领「${u.storyCommander}」。`);
        if (u.storyCommander && u.commander) errors.push(`单位「${u.id || key}」不能同时直挂玩法将领与剧情将领。`);
        if (u.storyCommander && mountedStoryCommanders.has(u.storyCommander)) errors.push(`剧情将领「${u.storyCommander}」不能在开场同时挂载到多个单位。`);
        if (u.storyCommander) mountedStoryCommanders.add(u.storyCommander);
        if (u.id && u.id.startsWith('__')) warnings.push(`单位 id「${u.id}」以 __ 开头，可能与内部保留冲突。`);
    }

    if (!declaredFactionIds.has(c.localPlayerCamp)) errors.push(`本地玩家阵营「${c.localPlayerCamp}」未在本关阵营列表中声明。`);
    const seenFactionIds = new Set();
    for (const faction of (c.factions || [])) {
        if (!/^[a-z][a-z0-9_-]{0,31}$/i.test(faction.id || '')) errors.push(`阵营定义 id「${faction.id}」非法（使用字母开头，后续仅限字母、数字、_、-）。`);
        if (seenFactionIds.has(faction.id)) errors.push(`阵营定义「${faction.id}」重复。`);
        if (faction.id === 'neutral') errors.push('neutral 是系统保留阵营，不能在作者阵营列表中重复定义。');
        seenFactionIds.add(faction.id);
        if (!faction.name) warnings.push(`阵营「${faction.id}」没有显示名。`);
        if (faction.note !== undefined && typeof faction.note !== 'string') errors.push(`阵营「${faction.id}」剧情备注必须是文本。`);
        if (!FACTION_COLOR_KEYS.includes(faction.color)) {
            errors.push(`阵营「${faction.id}」颜色选项「${faction.color}」无效（可用：${FACTION_COLOR_KEYS.join('、')}）。`);
        }
    }
    const humanFactions = (c.factions || []).filter(faction => faction.controller === 'human');
    if (humanFactions.length !== 1) errors.push('单人战役必须恰好指定一个“玩家”控制阵营。');
    if (humanFactions.length === 1 && humanFactions[0].id !== c.localPlayerCamp) errors.push('玩家视角阵营必须与唯一的“玩家”控制阵营一致。');
    const expectedTurnIds = (c.factions || []).filter(faction => faction.active !== false && faction.participatesInTurns !== false).map(faction => faction.id);
    const turnOrder = Array.isArray(c.turnOrder) ? c.turnOrder : [];
    if (!turnOrder.length) errors.push('回合行动顺序不能为空。');
    if (new Set(turnOrder).size !== turnOrder.length) errors.push('回合行动顺序包含重复阵营。');
    for (const id of turnOrder) if (!expectedTurnIds.includes(id)) errors.push(`回合行动顺序包含未启用或不参与回合的阵营「${id}」。`);
    for (const id of expectedTurnIds) if (!turnOrder.includes(id)) errors.push(`参与回合的阵营「${id}」没有加入回合行动顺序。`);
    for (const [left, relations] of Object.entries(c.diplomacy || {})) for (const [right, relation] of Object.entries(relations || {})) {
        if (!factionIds.has(left) || !factionIds.has(right) || left === right) errors.push(`外交关系「${left}→${right}」引用非法。`);
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
    const collectibleIds = new Set();
    for (const collectible of (c.collectibles || [])) {
        const id = collectible?.id || '';
        if (!/^[a-z][a-z0-9_-]{0,63}$/i.test(id)) errors.push(`收藏物 id「${id || '空'}」非法（使用字母开头，后续仅限字母、数字、_、-）。`);
        if (collectibleIds.has(id)) errors.push(`收藏物 id「${id}」重复。`);
        collectibleIds.add(id);
        if (!collectible?.name?.trim()) errors.push(`收藏物「${id || '未命名'}」缺少名称。`);
        if (!collectible?.emoji?.trim()) errors.push(`收藏物「${id || '未命名'}」缺少 Emoji 符号。`);
        if (!collectible?.description?.trim()) errors.push(`收藏物「${id || '未命名'}」缺少剧情说明。`);
    }
    const interactionIds = new Set();
    const interactionTiles = new Set();
    for (const item of (c.interactables || [])) {
        if (!item.id || interactionIds.has(item.id)) errors.push(`调查点 id「${item.id || '空'}」缺失或重复。`);
        interactionIds.add(item.id);
        if (!inBoard(item.q, item.r)) errors.push(`调查点「${item.id}」位于棋盘外。`);
        if (!item.label) warnings.push(`调查点「${item.id}」没有显示文案。`);
        const point = `${item.q},${item.r}`;
        if (interactionTiles.has(point)) errors.push(`调查点「${item.id}」与另一调查点重叠在 (${point})；调查点必须各自占用一个精确地块。`);
        interactionTiles.add(point);
        if (!Array.isArray(item.unitIds) || item.unitIds.length === 0) errors.push(`调查点「${item.id}」必须指定至少一个执行单位。`);
        for (const unitId of (item.unitIds || [])) if (!unitIds.has(unitId)) errors.push(`调查点「${item.id}」引用不存在的执行单位「${unitId}」。`);
        if (item.collectibleId && !collectibleIds.has(item.collectibleId)) errors.push(`调查点「${item.id}」绑定了本关未定义的收藏物「${item.collectibleId}」。`);
    }
    const variableIds = new Set();
    for (const variable of (c.variables || [])) {
        if (!variable.id || variableIds.has(variable.id)) errors.push(`变量 id「${variable.id || '空'}」缺失或重复。`);
        variableIds.add(variable.id);
        if (!VARIABLE_TYPES.includes(variable.type)) errors.push(`变量「${variable.id}」类型非法。`);
        if (!VARIABLE_SCOPES.includes(variable.scope)) errors.push(`变量「${variable.id}」作用域非法。`);
        if (variable.initial != null && VARIABLE_TYPES.includes(variable.type) && typeof variable.initial !== variable.type) {
            errors.push(`变量「${variable.id}」的初始值类型与变量类型不一致。`);
        }
    }

    const activeMainCount = Object.values(c.objectives || {}).filter(o => o.main && o.active !== false).length;
    if (activeMainCount === 0 && Object.keys(c.objectives || {}).length > 0) {
        warnings.push('没有设置任何主要目标，玩家将无法通过目标完成获得胜利。');
    }

    const triggerIds = new Set((c.triggers || []).map(t => t.id).filter(Boolean));
    const objectiveIds = new Set(Object.keys(c.objectives || {}));
    for (const [objectiveId, objective] of Object.entries(c.objectives || {})) {
        if (!objective || typeof objective !== 'object' || Array.isArray(objective)) {
            errors.push(`目标「${objectiveId}」配置必须是对象。`);
            continue;
        }
        const highlight = objective.highlight;
        if (highlight == null) continue;
        if (typeof highlight !== 'object' || Array.isArray(highlight)) {
            errors.push(`目标「${objectiveId}」的提示光圈配置必须是对象。`);
            continue;
        }
        if (highlight.unit && !unitIds.has(highlight.unit)) {
            errors.push(`目标「${objectiveId}」的提示光圈引用不存在的单位「${highlight.unit}」。`);
        }
        if (highlight.area && !areaIds.has(highlight.area)) {
            errors.push(`目标「${objectiveId}」的提示光圈引用不存在的区域「${highlight.area}」。`);
        }
        if (highlight.tiles != null && !Array.isArray(highlight.tiles)) {
            errors.push(`目标「${objectiveId}」的提示光圈地块必须是数组。`);
        } else {
            for (const point of (highlight.tiles || [])) {
                if (!Number.isInteger(point?.q) || !Number.isInteger(point?.r) || !inBoard(point.q, point.r)) {
                    errors.push(`目标「${objectiveId}」的提示光圈包含棋盘外坐标 (${point?.q},${point?.r})。`);
                }
            }
        }
        if (!highlight.unit && !highlight.area && !(highlight.tiles || []).length) {
            warnings.push(`目标「${objectiveId}」启用了提示光圈，但没有指定单位、位置或区域。`);
        }
    }
    const conditionMeta = (kind) => TRIGGER_CONDITIONS.find(item => item?.kind === kind);
    const conditionContainsEvent = (condition) => {
        if (!condition || typeof condition !== 'object') return false;
        if (conditionMeta(condition.kind)?.event) return true;
        if (Array.isArray(condition.conditions)) return condition.conditions.some(conditionContainsEvent);
        return condition.kind === 'not' && conditionContainsEvent(condition.condition);
    };
    const conditionContainsTimer = (condition) => {
        if (!condition || typeof condition !== 'object') return false;
        if (condition.kind === 'timer') return true;
        if (Array.isArray(condition.conditions)) return condition.conditions.some(conditionContainsTimer);
        return condition.kind === 'not' && conditionContainsTimer(condition.condition);
    };
    const validateCondition = (condition, path) => {
        if (!condition || typeof condition !== 'object') { errors.push(`${path} 条件为空。`); return; }
        if (!TRIGGER_CONDITIONS.some(item => item?.kind === condition.kind)) { errors.push(`${path} 使用未知条件「${condition.kind}」。`); return; }
        if (condition.kind === 'all' || condition.kind === 'any') {
            if (!Array.isArray(condition.conditions) || condition.conditions.length === 0) errors.push(`${path} 的 ${condition.kind.toUpperCase()} 组不能为空。`);
            else condition.conditions.forEach((child, index) => validateCondition(child, `${path}/${index + 1}`));
        }
        if (condition.kind === 'not') {
            if (!condition.condition) errors.push(`${path} 的 NOT 缺少子条件。`); else validateCondition(condition.condition, `${path}/NOT`);
        }
        const target = condition.target;
        if (['unitAlive', 'unitDead', 'unitExists', 'unitHpCompare'].includes(condition.kind) && !unitIds.has(condition.unit)) {
            errors.push(`${path} 引用不存在的单位「${condition.unit}」。`);
        }
        if (target?.unit && !unitIds.has(target.unit)) errors.push(`${path} 引用不存在的单位「${target.unit}」。`);
        if (target?.group && !groupIds.has(target.group)) errors.push(`${path} 引用不存在的单位组「${target.group}」。`);
        if (['unitSelected', 'unitMovesToTile', 'unitMovesToArea', 'unitKilled', 'skillUsed'].includes(condition.kind)
            && !target?.unit && !target?.group) errors.push(`${path} 必须选择一个单位或单位组。`);
        if (condition.kind === 'unitMovesToTile') {
            if (Array.isArray(condition.tiles) && condition.tiles.length) {
                condition.tiles.forEach((tile, index) => {
                    if (!Number.isInteger(tile?.q) || !Number.isInteger(tile?.r) || !inBoard(tile.q, tile.r)) {
                        errors.push(`${path} 的区域地块 ${index + 1} (${tile?.q},${tile?.r}) 不在棋盘内。`);
                    }
                });
            } else if (condition.area) {
                if (!areaIds.has(condition.area)) errors.push(`${path} 引用不存在的区域「${condition.area}」。`);
            } else if (!Number.isInteger(condition.q) || !Number.isInteger(condition.r) || !inBoard(condition.q, condition.r)) {
                errors.push(`${path} 的目标地块 (${condition.q},${condition.r}) 不在棋盘内。`);
            }
        }
        if (condition.kind === 'unitMovesToArea' && !areaIds.has(condition.area)) errors.push(`${path} 引用不存在的区域「${condition.area}」。`);
        if (condition.kind === 'unitAttacksUnit') {
            if (!condition.attacker?.unit && !condition.attacker?.group) errors.push(`${path} 必须选择攻击方单位或单位组。`);
            if (!condition.defender?.unit && !condition.defender?.group) errors.push(`${path} 必须选择受击方单位或单位组。`);
            if (condition.attacker?.unit && !unitIds.has(condition.attacker.unit)) errors.push(`${path} 引用不存在的攻击单位「${condition.attacker.unit}」。`);
            if (condition.attacker?.group && !groupIds.has(condition.attacker.group)) errors.push(`${path} 引用不存在的攻击单位组「${condition.attacker.group}」。`);
            if (condition.defender?.unit && !unitIds.has(condition.defender.unit)) errors.push(`${path} 引用不存在的受击单位「${condition.defender.unit}」。`);
            if (condition.defender?.group && !groupIds.has(condition.defender.group)) errors.push(`${path} 引用不存在的受击单位组「${condition.defender.group}」。`);
        }
        if (condition.kind === 'cityCaptured') {
            if (!Number.isInteger(condition.q) || !Number.isInteger(condition.r) || !inBoard(condition.q, condition.r)) errors.push(`${path} 的城市地块 (${condition.q},${condition.r}) 不在棋盘内。`);
            if (!(c.board?.cities || []).some(city => city.q === condition.q && city.r === condition.r)) warnings.push(`${path} 指向的地块不是已配置城市。`);
            if (condition.camp && !factionIds.has(condition.camp)) errors.push(`${path} 的占领阵营「${condition.camp}」未在本关阵营列表中声明。`);
        }
        if (condition.kind === 'turnStarted' && condition.camp && !factionIds.has(condition.camp)) errors.push(`${path} 的阵营「${condition.camp}」未在本关阵营列表中声明。`);
        if (['cityOwnedBy', 'tileOwnedBy', 'factionUnitCount', 'goldCompare'].includes(condition.kind) && !factionIds.has(condition.camp)) errors.push(`${path} 的阵营「${condition.camp}」未在本关阵营列表中声明。`);
        if (['cityOwnedBy', 'tileOwnedBy'].includes(condition.kind)) {
            if (!Number.isInteger(condition.q) || !Number.isInteger(condition.r) || !inBoard(condition.q, condition.r)) {
                errors.push(`${path} 的目标地块 (${condition.q},${condition.r}) 不在棋盘内。`);
            }
            if (condition.kind === 'cityOwnedBy' && !(c.board?.cities || []).some(city => city.q === condition.q && city.r === condition.r)) {
                warnings.push(`${path} 指向的地块不是已配置城市。`);
            }
        }
        if (condition.kind === 'relationIs' && (!factionIds.has(condition.camp) || !factionIds.has(condition.targetCamp))) errors.push(`${path} 的外交阵营引用未在本关阵营列表中声明。`);
        if (condition.kind === 'relationIs' && condition.camp === condition.targetCamp) errors.push(`${path} 不能比较同一阵营与自身的外交关系。`);
        if (condition.kind === 'relationIs' && !RELATION_KEYS.includes(condition.relation)) errors.push(`${path} 的外交关系「${condition.relation}」无效。`);
        if (condition.kind === 'unitsInArea' && condition.camp && !factionIds.has(condition.camp)) errors.push(`${path} 的阵营筛选「${condition.camp}」未在本关阵营列表中声明。`);
        if (['cardUsed', 'eventCardIs'].includes(condition.kind) && !CARD_IDS.includes(condition.value)) errors.push(`${path} 引用不存在的对策卡「${condition.value}」。`);
        if (condition.kind === 'groupState' && !groupIds.has(condition.group)) errors.push(`${path} 引用不存在的单位组「${condition.group}」。`);
        if (condition.kind === 'unitsInArea' && condition.area && !areaIds.has(condition.area)) errors.push(`${path} 引用不存在的区域「${condition.area}」。`);
        if (['eventInteractionIs', 'interactionStateIs'].includes(condition.kind) && !interactionIds.has(condition.interactable)) errors.push(`${path} 引用不存在的调查点「${condition.interactable}」。`);
        if (condition.kind === 'objectiveStatusIs' && !objectiveIds.has(condition.objective)) errors.push(`${path} 引用不存在的目标「${condition.objective}」。`);
        if (condition.kind === 'collectibleUnlocked' && !condition.collectible) errors.push(`${path} 必须填写收藏物 ID。`);
        if (condition.kind === 'mechanicEnabled' && !MECHANIC_KEYS.includes(condition.mechanic)) errors.push(`${path} 引用不存在的机制「${condition.mechanic}」。`);
        if (condition.kind === 'variableCompare') {
            const variable = (c.variables || []).find(item => item.id === condition.variable && item.scope === (condition.scope || 'level'));
            if (!variable) errors.push(`${path} 引用不存在的${condition.scope === 'campaign' ? '战役' : '本关'}变量「${condition.variable}」。`);
            else {
                if (condition.value != null && typeof condition.value !== variable.type) errors.push(`${path} 的比较值类型与变量「${condition.variable}」不一致。`);
                if (variable.type !== 'number' && !['==', '!='].includes(condition.op || '==')) errors.push(`${path} 的${variable.type}变量只能使用等于或不等于比较。`);
            }
        }
    };
    const validateAction = (action, path) => {
        if (!action || typeof action !== 'object') { errors.push(`${path} 效果为空。`); return; }
        if (!TRIGGER_ACTIONS.some(item => item.kind === action.kind)) { errors.push(`${path} 使用未知效果「${action.kind}」。`); return; }
        const target = action.target;
        if (target?.unit && !unitIds.has(target.unit)) errors.push(`${path} 引用不存在的单位「${target.unit}」。`);
        if (target?.group && !groupIds.has(target.group)) errors.push(`${path} 引用不存在的单位组「${target.group}」。`);
        if (action.kind === 'setVariable' && !variableIds.has(action.variable)) errors.push(`${path} 引用不存在的变量「${action.variable}」。`);
        if (action.kind === 'setVariable') {
            const variable = (c.variables || []).find(item => item.id === action.variable);
            if (variable && variable.type !== 'number' && (action.operation || 'set') !== 'set') {
                errors.push(`${path} 的${variable.type}变量只能使用“设为”操作。`);
            }
            if (variable && action.value != null && typeof action.value !== variable.type) {
                errors.push(`${path} 的值类型与变量「${action.variable}」不一致。`);
            }
        }
        if (action.kind === 'setTriggerEnabled' && !triggerIds.has(action.trigger)) errors.push(`${path} 引用不存在的触发器「${action.trigger}」。`);
        if (action.kind === 'setObjectiveStatus') {
            if (!objectiveIds.has(action.objective)) errors.push(`${path} 引用不存在的目标「${action.objective}」。`);
            if (!OBJECTIVE_STATUS_KEYS.includes(action.status)) errors.push(`${path} 设置了非法目标状态「${action.status}」。`);
        }
        if (action.kind === 'setInteractionState') {
            if (!interactionIds.has(action.interactable)) errors.push(`${path} 引用不存在的调查点「${action.interactable}」。`);
            if (!['disabled', 'available', 'completed'].includes(action.state)) errors.push(`${path} 设置了非法调查点状态「${action.state}」。`);
        }
        if (action.kind === 'setMechanicEnabled' && !MECHANIC_KEYS.includes(action.mechanic)) errors.push(`${path} 引用不存在的机制「${action.mechanic}」。`);
        if (['changeGold', 'changeUnitFaction'].includes(action.kind) && !factionIds.has(action.camp)) errors.push(`${path} 的阵营「${action.camp}」未在本关阵营列表中声明。`);
        if (['changeUnitHp', 'changeUnitFaction', 'setUnitState', 'applyEffect', 'assignCommander', 'removeUnits'].includes(action.kind)
            && !target?.unit && !target?.group && !action.unit) errors.push(`${path} 必须选择一个单位或单位组。`);
        if (action.kind === 'setDiplomacy' && (!factionIds.has(action.camp) || !factionIds.has(action.targetCamp))) errors.push(`${path} 的外交阵营引用未在本关阵营列表中声明。`);
        if (action.kind === 'setDiplomacy' && action.camp === action.targetCamp) errors.push(`${path} 不能设置同一阵营与自身的外交关系。`);
        if (action.kind === 'setDiplomacy' && !RELATION_KEYS.includes(action.relation)) errors.push(`${path} 的外交关系「${action.relation}」无效。`);
        if (action.kind === 'endScenario' && !['win', 'lose'].includes(action.result || 'win')) errors.push(`${path} 的关卡结果必须是胜利或失败。`);
        if (action.kind === 'changeGold' && !['set', 'add', 'subtract'].includes(action.operation || 'add')) errors.push(`${path} 的金币操作无效。`);
        if (action.kind === 'changeGold' && !Number.isFinite(action.value)) errors.push(`${path} 的金币数值必须是数字。`);
        if (action.kind === 'changeUnitHp') {
            if (!['set', 'add', 'subtract'].includes(action.operation || 'subtract')) errors.push(`${path} 的生命操作无效。`);
            if (!['value', 'percent'].includes(action.mode || 'value')) errors.push(`${path} 的生命单位无效。`);
            if (!Number.isFinite(action.value) || action.value < 0) errors.push(`${path} 的生命数值必须是非负数字。`);
        }
        if (action.kind === 'setUnitState' && !['canAct', 'canMove', 'canAttack', 'targetable', 'invulnerable', 'canCounterattack'].includes(action.state)) errors.push(`${path} 的单位状态「${action.state}」无效。`);
        if (action.kind === 'assignCommander' && action.commander && !COMMANDER_IDS.includes(action.commander)) errors.push(`${path} 引用不存在的将领「${action.commander}」。`);
        if (action.kind === 'assignCommander' && action.storyCommander && !storyCommanderIds.has(action.storyCommander)) errors.push(`${path} 引用不存在的剧情将领「${action.storyCommander}」。`);
        if (action.kind === 'assignCommander' && action.commander && action.storyCommander) errors.push(`${path} 不能同时部署玩法将领与剧情将领。`);
        if (action.kind === 'setWeather' && !WEATHER_KEYS.includes(action.weather)) errors.push(`${path} 的天气「${action.weather}」无效。`);
        if (action.kind === 'revealTiles') {
            if (!factionIds.has(action.camp)) errors.push(`${path} 的受益阵营「${action.camp}」未在本关阵营列表中声明。`);
            const hasUnitTarget = !!target?.unit || !!target?.group;
            const hasTileTarget = Array.isArray(target?.tiles) && target.tiles.length > 0;
            const hasAreaTarget = !!target?.area;
            if (!hasUnitTarget && !hasTileTarget && !hasAreaTarget) {
                errors.push(`${path} 必须选择单位、单位组、地块或命名区域。`);
            }
            if (target?.area && !areaIds.has(target.area)) errors.push(`${path} 引用不存在的区域「${target.area}」。`);
            for (const tile of target?.tiles || []) {
                if (!Number.isInteger(tile?.q) || !Number.isInteger(tile?.r) || !inBoard(tile.q, tile.r)) {
                    errors.push(`${path} 的揭示坐标不在棋盘内。`);
                }
            }
            if (action.durationRounds != null
                && (!Number.isInteger(action.durationRounds) || action.durationRounds <= 0)) {
                errors.push(`${path} 的持续回合必须是正整数；留空表示永久。`);
            }
        }
        if (action.kind === 'removeUnits' && !['despawn', 'kill'].includes(action.mode || 'despawn')) errors.push(`${path} 的移除方式无效。`);
        if (action.kind === 'applyEffect') {
            if (action.duration != null && (!Number.isInteger(action.duration) || action.duration < 0)) errors.push(`${path} 的效果持续回合必须是非负整数。`);
            if (action.rule && !['minHp', 'maxHp', 'godMode'].includes(action.rule)) errors.push(`${path} 的效果规则「${action.rule}」无效。`);
            if (action.rule && action.rule !== 'godMode' && (!Number.isFinite(action.rulePercent) || action.rulePercent <= 0 || action.rulePercent > 100)) errors.push(`${path} 的效果阈值必须在 1 到 100 之间。`);
            for (const [key, value] of Object.entries(action.statMods || {})) {
                if (!['atkPct', 'atkFlat', 'defPct', 'meleeDefPct', 'rangeDefPct', 'spdFlat', 'hpPct', 'hpFlat'].includes(key)) errors.push(`${path} 包含未知效果属性「${key}」。`);
                else if (!Number.isFinite(value)) errors.push(`${path} 的效果属性「${key}」必须是数字。`);
            }
        }
        if (action.kind === 'spawnUnits') {
            const seenSpawnTiles = new Set();
            const seenSpawnIds = new Set();
            const seenSpawnStoryCommanders = new Set();
            for (const [index, spec] of (action.units || []).entries()) {
                const specPath = `${path} 的生成单位 ${index + 1}`;
                if (!UNIT_TYPES.includes(spec?.type)) errors.push(`${specPath} 的单位类型「${spec?.type}」不存在。`);
                if (!factionIds.has(spec?.camp)) errors.push(`${specPath} 的阵营「${spec?.camp}」未在本关阵营列表中声明。`);
                if (!Number.isInteger(spec?.q) || !Number.isInteger(spec?.r) || !inBoard(spec.q, spec.r)) errors.push(`${specPath} 的坐标不在棋盘内。`);
                if (UNIT_TYPES.includes(spec?.type)
                    && Number.isInteger(spec?.q)
                    && Number.isInteger(spec?.r)
                    && inBoard(spec.q, spec.r)) {
                    const spawnKey = tileCoordinateKey(spec.q, spec.r);
                    const authoredTile = {
                        q: spec.q,
                        r: spec.r,
                        s: -spec.q - spec.r,
                        surface: surfaceMap.get(spawnKey) || SURFACE_KIND.LAND,
                        isPort: seenPorts.has(spawnKey)
                    };
                    if (!canUnitOccupyTile({ type: spec.type }, authoredTile)) {
                        const domain = UNIT_CONFIG[spec.type].movementDomain || 'land';
                        errors.push(`${specPath} 的移动域 ${domain} 无法部署在地块 (${spawnKey}) 的表面上。`);
                    }
                }
                if (spec?.commander && !COMMANDER_IDS.includes(spec.commander)) errors.push(`${specPath} 引用不存在的将领「${spec.commander}」。`);
                if (spec?.storyCommander && !storyCommanderIds.has(spec.storyCommander)) errors.push(`${specPath} 引用不存在的剧情将领「${spec.storyCommander}」。`);
                if (spec?.commander && spec?.storyCommander) errors.push(`${specPath} 不能同时直挂玩法将领与剧情将领。`);
                if (spec?.storyCommander && seenSpawnStoryCommanders.has(spec.storyCommander)) errors.push(`${path} 同一次生成不能把剧情将领「${spec.storyCommander}」挂载到多个单位。`);
                if (spec?.storyCommander) seenSpawnStoryCommanders.add(spec.storyCommander);
                if (spec?.hp != null && (!Number.isFinite(spec.hp) || spec.hp <= 0)) errors.push(`${specPath} 的生命值必须是正数。`);
                if (spec?.hpPct != null && (!Number.isFinite(spec.hpPct) || spec.hpPct <= 0 || spec.hpPct > 100)) errors.push(`${specPath} 的生命百分比必须在 1 到 100 之间。`);
                const tileKey = `${spec?.q},${spec?.r}`;
                if (seenSpawnTiles.has(tileKey)) errors.push(`${path} 同一次生成不能把多个单位放在同一地块。`);
                seenSpawnTiles.add(tileKey);
                if (spec?.id) {
                    if (unitIds.has(spec.id) || seenSpawnIds.has(spec.id)) errors.push(`${specPath} 的单位 ID「${spec.id}」与已有单位或本动作重复。`);
                    seenSpawnIds.add(spec.id);
                }
            }
        }
        // ── 内联 showStep 参数完整性 ──
        if (action.kind === 'showStep' && !action.step) {
            if (!action.text) errors.push(`${path} 的 showStep 缺少台词。`);
            if (action.mode === 'character' && !action.speaker?.name) errors.push(`${path} 的台词模式缺少说话人。`);
            if (action.speaker?.portrait && !DIALOGUE_PORTRAIT_IDS.includes(action.speaker.portrait)) {
                errors.push(`${path} 的对白立绘「${action.speaker.portrait}」不存在。`);
            }
            // next 不校验引用（可能是本触发器内其他 _id 或后续注册的步骤）
            // boardLock:true 时建议配 highlight；否则会锁定全部操作。
            if (action.boardLock && !action.highlight) warnings.push(`${path} 启用了操作锁但未配高亮目标，所有操作将被锁定。`);
        }
        // ── 施加效果名称 ──
        if (action.kind === 'applyEffect' && !action.name && !action.rule && (!action.statMods || !Object.keys(action.statMods).length)) {
            errors.push(`${path} 施加效果缺少效果名称和任何属性修正。`);
        }
        // ── 改变外交 ──
        if (action.kind === 'setDiplomacy' && (!action.camp || !action.targetCamp)) errors.push(`${path} 改变外交关系缺少阵营 A 或阵营 B。`);
    };
    // ── 条件参数完整性（非事件条件不需要全部验证，留空=不限制） ──
    const minConditionChecks = (cond, path) => {
        if (cond.kind === 'unitMovesToTile' && cond.q == null && cond.r == null && !cond.tiles?.length && !cond.area) {
            errors.push(`${path} 缺少目标位置（请填坐标或涂抹区域）。`);
        }
        if (cond.kind === 'unitAttacksUnit' && !cond.attacker?.unit && !cond.attacker?.group && !cond.attackerCamp
            && !cond.defender?.unit && !cond.defender?.group && !cond.defenderCamp) {
            errors.push(`${path} 至少需要指定攻击方或受击方的单位/阵营。`);
        }
        if (['eventNextIs', 'eventChoiceIs'].includes(cond.kind) && !cond.value) errors.push(`${path} 缺少跳转值。`);
        if (cond.kind === 'timer' && (!cond.value || cond.value <= 0)) errors.push(`${path} 启用后等待时间必须大于 0 毫秒。`);
        if (cond.kind === 'turnStarted' && cond.turn != null && cond.turn <= 0) errors.push(`${path} 回合数必须大于 0。`);
        if (cond.kind === 'cityCaptured' && (cond.q == null || cond.r == null)) errors.push(`${path} 缺少城市坐标。`);
        if (cond.kind === 'goldCompare' && cond.value == null) errors.push(`${path} 缺少金币比较值。`);
        if (cond.kind === 'variableCompare' && !cond.variable) errors.push(`${path} 缺少变量名。`);
        if (cond.kind === 'triggerEnabled' && !cond.trigger) errors.push(`${path} 缺少触发器 ID。`);
        if (cond.kind === 'groupState' && !cond.group) errors.push(`${path} 缺少单位组 ID。`);
        if (cond.kind === 'unitsInArea' && !cond.area) errors.push(`${path} 缺少区域。`);
    };
    const seenTriggerIds = new Set();
    for (const t of (c.triggers || [])) {
        if (!t.id || seenTriggerIds.has(t.id)) errors.push(`触发器 id「${t.id || '空'}」缺失或重复。`);
        seenTriggerIds.add(t.id);
        if (!t.do?.length) errors.push(`触发器「${t.id || '?'}」没有动作；无动作触发器没有意义。`);
        if (t.once === false && !(t.when || []).some(condition => conditionContainsEvent(condition) || conditionContainsTimer(condition))) {
            warnings.push(`重复触发器「${t.id || '?'}」只包含状态条件，可能在每次事件后重复执行。`);
        }
        (t.when || []).forEach((condition, index) => {
            validateCondition(condition, `触发器「${t.id || '?'}」条件 ${index + 1}`);
            minConditionChecks(condition, `触发器「${t.id || '?'}」条件 ${index + 1}`);
        });
        (t.do || []).forEach((action, index) => validateAction(action, `触发器「${t.id || '?'}」效果 ${index + 1}`));
    }
    for (const [key, value] of Object.entries(c.mechanics || {})) {
        if (!MECHANIC_KEYS.includes(key)) warnings.push(`未知机制开关「${key}」，运行时将忽略。`);
        if (typeof value !== 'boolean') errors.push(`机制开关「${key}」必须是布尔值。`);
    }

    return { errors, warnings };
}

// 单位在指定坐标是否合法落子（供编辑器 placement 校验复用）。
export function boardContains(boardOrRadius, q, r) {
    const board = typeof boardOrRadius === 'number'
        ? { layout: BOARD_LAYOUT.HEX, radius: boardOrRadius }
        : boardOrRadius;
    return isBoardCoordinatePlayable(board, q, r);
}
