// 战役编辑器主控制器 —— 所见即所得关卡编辑。
// 数据源是一份 level 配置（schema.js 定义），一切编辑都是对配置的修改；
// 画布只是配置经 mapBuilder 重建后的预览。导出即下载该配置 JSON。
import { HEX_SIZE, hexPath, drawHexagonOutline, CAMP_FLAG_COLORS } from '../../js/config.js';
import { drawAllBorders, drawCampBorders, drawDistrictBorders } from '../../js/HexTile.js';
import {
    createDefaultLevel, normalizeLevel, validateLevel, boardContains,
    UNIT_TYPES, UNIT_LABELS,
    COMMANDER_IDS, COMMANDER_LABELS, DIALOGUE_PORTRAIT_LABELS, TERRAIN_LABELS,
    FORTIFICATION_KEYS, FORTIFICATION_LABELS, WEATHER_LABELS,
    CARD_IDS, CARD_LABELS,
    MECHANIC_KEYS, MECHANIC_LABELS, RELATION_KEYS, OBJECTIVE_STATUS_KEYS,
    TRIGGER_CONDITIONS, TRIGGER_ACTIONS,
    BOARD_RADIUS_MIN, BOARD_RADIUS_MAX,
    FACTION_PALETTE, getFlagColors
} from '../runtime/schema.js';
import { buildBoardFromConfig } from '../runtime/mapBuilder.js';
import {
    el, section, textRow, numRow, selectRow, checkRow, textareaRow,
    checkGroup, itemList, card, hint
} from './forms.js';

// ── 模块状态 ─────────────────────────────────────────────────
let config = createDefaultLevel();
let preview = { tiles: [], tileMap: new Map(), villageTiles: new Map(), campBorderEdges: [], districtBorderEdges: [] };
let canvas = null, ctx = null;
const EDITOR_LOGICAL_W = 1000;
const EDITOR_LOGICAL_H = 750;
let activeTab = 'board';
let selection = null;              // {kind:'tile',q,r} | {kind:'unit',index} | {kind:'storyCommander',index} | {kind:'trigger',index} | {kind:'objective',id}
let hoverTile = null;
let painting = false;
let lastPaintKey = '';
let unitSeq = 1;
let callbacks = { onPlaytest: null, onBack: null };
let initialized = false;
let showCoords = false;
let pendingPick = null; // { mode:'tile'|'tiles', callback, picked:Set, label }
let pendingHighlight = null; // { q, r } | [{q,r}] | Set — 鼠标悬停图钉时高亮
let pendingUnitFlag = null; // { q, r } — 单位图钉悬停时在棋盘上显示🚩

const LEGACY_CONDITION_KINDS = new Set(['unitAlive', 'unitDead', 'flagSet', 'flagUnset', 'turnAtLeast', 'eventCardIs']);
function authorConditions(current = '') { return TRIGGER_CONDITIONS.filter(item => item && (!LEGACY_CONDITION_KINDS.has(item.kind) || item.kind === current)); }
function authorActions() { return TRIGGER_ACTIONS; }

// 阵营配置只保存 palette id；具体地块色与旗色由规则层统一解析。
const FACTION_COLOR_OPTIONS = Object.fromEntries(FACTION_PALETTE.map(p => [p.id, p.label]));

const boardTool = { mode: 'terrain', terrain: 'forest', camp: 'player1', districtId: 1, fortification: 'trench', cityType: 'city', erase: { terrain: true, city: true, village: true, fortification: true, district: true, unit: true } };
const unitTemplate = { type: 'infantry', camp: 'player1', commander: '', storyCommander: '', hpPct: 100, morale: 2, canAct: true };

const undoStack = [];
const redoStack = [];
const UNDO_LIMIT = 60;

// ── 小工具 ──────────────────────────────────────────────────
const $id = (id) => document.getElementById(id);
const clone = (obj) => JSON.parse(JSON.stringify(obj));
const tileKey = (q, r) => `${q},${r}`;

function factionLabels() {
    return Object.fromEntries(config.factions.map(faction => [faction.id, faction.name || faction.id]));
}
function factionById(id) { return config.factions.find(faction => faction.id === id) || null; }
function storyCommanderById(id) { return config.storyCommanders.find(commander => commander.id === id) || null; }
function commanderMountValue(spec) {
    if (spec?.storyCommander) return `story:${spec.storyCommander}`;
    if (spec?.commander) return `base:${spec.commander}`;
    return '';
}
function commanderMountOptions() {
    const options = { '': '（无将领）' };
    for (const commander of config.storyCommanders) {
        const archetype = commander.archetype ? COMMANDER_LABELS[commander.archetype] || commander.archetype : '无玩法技能';
        options[`story:${commander.id}`] = `剧情 · ${commander.name || commander.id}（${archetype}）`;
    }
    for (const id of COMMANDER_IDS) options[`base:${id}`] = `标准 · ${COMMANDER_LABELS[id]}`;
    return options;
}
function setCommanderMount(spec, value) {
    delete spec.commander;
    delete spec.storyCommander;
    if (value.startsWith('story:')) spec.storyCommander = value.slice(6);
    else if (value.startsWith('base:')) spec.commander = value.slice(5);
}
function commanderMountLabel(spec) {
    if (spec?.storyCommander) {
        const story = storyCommanderById(spec.storyCommander);
        return story?.name || spec.storyCommander;
    }
    return spec?.commander ? COMMANDER_LABELS[spec.commander] || spec.commander : '';
}
function primaryFactionId() { return config.localPlayerCamp || config.factions.find(faction => faction.controller === 'human')?.id || config.factions[0]?.id || 'player1'; }
function nonLocalFactionId() { return config.factions.find(faction => faction.id !== primaryFactionId())?.id || primaryFactionId(); }
function syncTurnOrder(level) {
    const eligible = level.factions.filter(faction => faction.active !== false && faction.participatesInTurns !== false).map(faction => faction.id);
    const existing = Array.isArray(level.turnOrder) ? level.turnOrder : [];
    level.turnOrder = [...existing.filter(id => eligible.includes(id)), ...eligible.filter(id => !existing.includes(id))];
}

function renameMapKey(map, from, to) {
    if (!map || typeof map !== 'object' || from === to || !(from in map)) return;
    map[to] = map[from];
    delete map[from];
}

function replaceFactionReferences(level, from, to, { remove = false } = {}) {
    if (!from || from === to) return;
    const replacement = to || '';
    if (level.localPlayerCamp === from) level.localPlayerCamp = remove ? level.factions[0]?.id || '' : to;
    if (level.aiOpponentCamp === from) level.aiOpponentCamp = remove ? '' : to;
    level.turnOrder = (level.turnOrder || []).map(id => id === from ? replacement : id);
    for (const city of (level.board?.cities || [])) if (city.camp === from) city.camp = replacement;
    for (const unit of (level.units || [])) if (unit.camp === from) unit.camp = replacement;

    for (const map of [level.gold, level.hands, level.commanders]) {
        if (!map || typeof map !== 'object') continue;
        if (remove) delete map[from];
        else renameMapKey(map, from, to);
    }

    const previousDiplomacy = level.diplomacy || {};
    const nextDiplomacy = {};
    for (const [left, relations] of Object.entries(previousDiplomacy)) {
        if (remove && left === from) continue;
        const nextLeft = left === from ? to : left;
        nextDiplomacy[nextLeft] ||= {};
        for (const [right, relation] of Object.entries(relations || {})) {
            if (remove && right === from) continue;
            nextDiplomacy[nextLeft][right === from ? to : right] = relation;
        }
    }
    level.diplomacy = nextDiplomacy;

    const rewriteTriggerReferences = value => {
        if (Array.isArray(value)) { value.forEach(rewriteTriggerReferences); return; }
        if (!value || typeof value !== 'object') return;
        for (const [key, child] of Object.entries(value)) {
            if ((key === 'camp' || key === 'targetCamp') && child === from) value[key] = replacement;
            else rewriteTriggerReferences(child);
        }
    };
    rewriteTriggerReferences(level.triggers);
    rewriteTriggerReferences(level.optionalObjectives);
    rewriteTriggerReferences(level.result?.starRules);
    syncTurnOrder(level);
}

function replaceStoryCommanderReferences(level, from, to = '') {
    const rewrite = value => {
        if (Array.isArray(value)) { value.forEach(rewrite); return; }
        if (!value || typeof value !== 'object') return;
        for (const [key, child] of Object.entries(value)) {
            if (key === 'storyCommander' && child === from) {
                if (to) value[key] = to;
                else delete value[key];
            } else rewrite(child);
        }
    };
    rewrite(level.units);
    rewrite(level.triggers);
}

function setLocalPlayerFaction(level, factionId) {
    level.localPlayerCamp = factionId;
    for (const faction of level.factions) {
        if (faction.id === factionId) faction.controller = 'human';
        else if (faction.controller === 'human') faction.controller = 'ai';
    }
}

function setStatus(text, kind = '') {
    const bar = $id('editorStatusBar');
    if (!bar) return;
    bar.textContent = text;
    bar.className = 'editor-statusbar' + (kind ? ' ' + kind : '');
}

function nextUnitId() {
    const used = new Set(config.units.map(u => u.id));
    while (used.has(`u${unitSeq}`)) unitSeq++;
    return `u${unitSeq++}`;
}

// ── 快照与撤销 ───────────────────────────────────────────────
function pushUndo() {
    undoStack.push(JSON.stringify(config));
    if (undoStack.length > UNDO_LIMIT) undoStack.shift();
    redoStack.length = 0;
}

function undo() {
    if (!undoStack.length) { setStatus('没有可撤销的操作'); return; }
    redoStack.push(JSON.stringify(config));
    config = normalizeLevel(JSON.parse(undoStack.pop()));
    selection = null;
    refreshAll('已撤销');
}

function redo() {
    if (!redoStack.length) { setStatus('没有可重做的操作'); return; }
    undoStack.push(JSON.stringify(config));
    config = normalizeLevel(JSON.parse(redoStack.pop()));
    selection = null;
    refreshAll('已重做');
}

/** 统一修改入口：快照 → 修改 → 重建预览 → 重绘面板。 */
function mutate(fn, { snapshot = true, rebuildPanels = true } = {}) {
    if (snapshot) pushUndo();
    fn(config);
    rebuildPreview();
    if (rebuildPanels) { renderToolPanel(); renderInspector(); }
    render();
}

// ── 预览棋盘 ─────────────────────────────────────────────────
function rebuildPreview() {
    preview = { tiles: [], tileMap: new Map(), villageTiles: new Map(), campBorderEdges: [], districtBorderEdges: [] };
    buildBoardFromConfig(config, preview);
}

function unitsByCoord() {
    const map = new Map();
    config.units.forEach((u, i) => map.set(tileKey(u.q, u.r), { unit: u, index: i }));
    return map;
}

// ── 渲染 ────────────────────────────────────────────────────
function render() {
    if (!ctx) return;
    ctx.clearRect(0, 0, EDITOR_LOGICAL_W, EDITOR_LOGICAL_H);

    for (const tile of preview.tiles) tile.drawBase(ctx);
    drawAllBorders(ctx, preview.tiles, preview.tileMap);
    drawCampBorders(ctx, preview.campBorderEdges);
    drawDistrictBorders(ctx, preview.districtBorderEdges);

    // 城市行政区编号
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = 'bold 11px sans-serif';
    for (const tile of preview.tiles) {
        if (!tile.isCity) continue;
        ctx.fillStyle = 'rgba(20,20,20,0.75)';
        ctx.fillText(`区${tile.districtId}`, tile.x, tile.y + HEX_SIZE * 0.62);
    }
    if (showCoords) {
        ctx.font = '9px sans-serif';
        ctx.fillStyle = 'rgba(0,0,0,0.42)';
        for (const tile of preview.tiles) {
            ctx.fillText(`${tile.q},${tile.r}`, tile.x, tile.y - HEX_SIZE * 0.55);
        }
    }
    ctx.restore();

    // 单位标记
    for (const [key, entry] of unitsByCoord()) {
        const tile = preview.tileMap.get(key);
        if (tile) drawUnitMarker(tile, entry.unit, entry.index);
    }

    if (activeTab === 'meta' || activeTab === 'triggers') {
        ctx.save();
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.font = 'bold 9px sans-serif';
        for (const area of config.areas) {
            for (const point of (area.tiles || [])) {
                const tile = preview.tileMap.get(tileKey(point.q, point.r));
                if (!tile) continue;
                drawHexagonOutline(ctx, tile.x, tile.y, HEX_SIZE * 0.88, 'rgba(255,183,77,.7)', 1.2);
            }
            const first = preview.tileMap.get(tileKey(area.tiles?.[0]?.q, area.tiles?.[0]?.r));
            if (first) { ctx.fillStyle = 'rgba(80,42,8,.86)'; ctx.fillText(area.id, first.x, first.y - 18); }
        }
        for (const item of config.interactables) {
            const tile = preview.tileMap.get(tileKey(item.q, item.r));
            if (!tile) continue;
            ctx.fillStyle = item.enabled === false ? '#777' : '#ffd66b';
            ctx.font = 'bold 16px sans-serif'; ctx.fillText('?', tile.x, tile.y);
            ctx.font = 'bold 8px sans-serif'; ctx.fillText(item.id, tile.x, tile.y + 18);
        }
        ctx.restore();
    }

    // 悬浮与选中高亮
    // 取色/涂抹模式：高亮已选地块 + 已配置的坐标
    const now = performance.now();
    const pulse = (Math.sin(now / 400) + 1) / 2;
    if (pendingPick) {
        for (const key of (pendingPick.picked || [])) {
            const t = preview.tileMap.get(key);
            if (t) {
                hexPath(ctx, t.x, t.y, HEX_SIZE);
                ctx.fillStyle = `rgba(255,200,50,${0.15 + pulse * 0.25})`;
                ctx.fill();
                drawHexagonOutline(ctx, t.x, t.y, HEX_SIZE, `rgba(255,200,50,${0.5 + pulse * 0.3})`, 2);
            }
        }
        for (const flagKey of (pendingPick.flags || [])) {
            const m = flagKey.match(/^flag:(.+)$/);
            if (m) {
                const t = preview.tileMap.get(m[1]);
                if (t) { ctx.save(); var cr = HEX_SIZE * 0.4; ctx.beginPath(); ctx.arc(t.x, t.y, cr, 0, Math.PI * 2); ctx.fillStyle = 'rgba(255,215,0,0.85)'; ctx.fill(); ctx.strokeStyle = '#c8a030'; ctx.lineWidth = 2; ctx.stroke(); ctx.restore(); }
            }
        }
        if (hoverTile) {
            hexPath(ctx, hoverTile.x, hoverTile.y, HEX_SIZE);
            ctx.fillStyle = `rgba(255,255,255,${0.08 + pulse * 0.1})`;
            ctx.fill();
            drawHexagonOutline(ctx, hoverTile.x, hoverTile.y, HEX_SIZE, `rgba(255,255,255,${0.5 + pulse * 0.3})`, 1.8);
        }
    } else {
        if (hoverTile) {
            hexPath(ctx, hoverTile.x, hoverTile.y, HEX_SIZE);
            ctx.fillStyle = `rgba(255,255,255,${0.06 + pulse * 0.08})`;
            ctx.fill();
            drawHexagonOutline(ctx, hoverTile.x, hoverTile.y, HEX_SIZE, `rgba(255,255,255,${0.35 + pulse * 0.2})`, 1.4);
        }
    }
    // 悬停图钉时回显已存坐标
    if (pendingHighlight) {
        for (const key of (pendingHighlight.tiles || [pendingHighlight])) {
            const t = preview.tileMap.get(typeof key === 'string' ? key : tileKey(key.q, key.r));
            if (t) {
                hexPath(ctx, t.x, t.y, HEX_SIZE);
                ctx.fillStyle = `rgba(100,200,255,${0.1 + pulse * 0.2})`;
                ctx.fill();
                drawHexagonOutline(ctx, t.x, t.y, HEX_SIZE, `rgba(100,200,255,${0.45 + pulse * 0.25})`, 2);
            }
        }
    }
    // 单位图钉悬停时在棋盘上显示🚩
    if (pendingUnitFlag) {
        const t = preview.tileMap.get(tileKey(pendingUnitFlag.q, pendingUnitFlag.r));
        if (t) { ctx.save(); var cx = t.x, cy = t.y; var r = HEX_SIZE * 0.45; ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fillStyle = 'rgba(255,215,0,0.85)'; ctx.fill(); ctx.strokeStyle = '#c8a030'; ctx.lineWidth = 2.5; ctx.stroke(); ctx.font = 'bold 18px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = '#543c00'; ctx.fillText('●', cx, cy); ctx.restore(); }
    }
    // 选中目标时常驻预览其单位、位置和区域提示，便于作者核对配置。
    if (selection?.kind === 'objective') {
        const highlight = config.objectives[selection.id]?.highlight;
        const keys = new Set((highlight?.tiles || []).map(point => tileKey(point.q, point.r)));
        const area = config.areas.find(item => item.id === highlight?.area);
        for (const point of (area?.tiles || [])) keys.add(tileKey(point.q, point.r));
        const unit = config.units.find(item => item.id === highlight?.unit);
        if (unit) keys.add(tileKey(unit.q, unit.r));
        for (const key of keys) {
            const t = preview.tileMap.get(key);
            if (!t) continue;
            ctx.save();
            ctx.beginPath();
            ctx.arc(t.x, t.y, HEX_SIZE * (0.72 + pulse * 0.08), 0, Math.PI * 2);
            ctx.strokeStyle = `rgba(255,205,78,${0.58 + pulse * 0.28})`;
            ctx.lineWidth = 2.2 + pulse;
            ctx.shadowColor = 'rgba(255,179,45,0.7)';
            ctx.shadowBlur = 6 + pulse * 5;
            ctx.stroke();
            ctx.restore();
        }
    }
    const selTile = selectionTile();
    if (selTile) drawHexagonOutline(ctx, selTile.x, selTile.y, HEX_SIZE, '#e6c200', 2.4);
}

function selectionTile() {
    if (selection?.kind === 'tile') return preview.tileMap.get(tileKey(selection.q, selection.r)) || null;
    if (selection?.kind === 'unit') {
        const u = config.units[selection.index];
        return u ? preview.tileMap.get(tileKey(u.q, u.r)) || null : null;
    }
    return null;
}

function drawUnitMarker(tile, unit, index) {
    const campKey = unit.camp === 'player1' ? 'p1' : unit.camp === 'player2' ? 'p2' : unit.camp === 'player3' ? 'p3' : unit.camp === 'neutral' ? 'neu' : unit.camp;
    const fc = campKey === 'neu' ? CAMP_FLAG_COLORS.neu : getFlagColors(factionById(unit.camp)?.color);
    const x = tile.x, y = tile.y;
    ctx.save();
    ctx.beginPath();
    ctx.arc(x, y, 13, 0, Math.PI * 2);
    ctx.fillStyle = fc.main;
    ctx.fill();
    ctx.lineWidth = selection?.kind === 'unit' && selection.index === index ? 3 : 1.5;
    ctx.strokeStyle = selection?.kind === 'unit' && selection.index === index ? '#ffe9a8' : 'rgba(255,255,255,0.85)';
    ctx.stroke();
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 12px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(UNIT_LABELS[unit.type]?.[0] || '?', x, y + 0.5);
    if (unit.commander || unit.storyCommander) {
        ctx.font = '10px sans-serif';
        ctx.fillStyle = '#ffd700';
        ctx.fillText('★', x + 10, y - 10);
    }
    const hpPct = typeof unit.hpPct === 'number' ? unit.hpPct : 100;
    if (hpPct < 100) {
        ctx.fillStyle = 'rgba(0,0,0,0.55)';
        ctx.fillRect(x - 12, y + 15, 24, 4);
        ctx.fillStyle = hpPct > 50 ? '#7ec850' : '#e05050';
        ctx.fillRect(x - 12, y + 15, 24 * hpPct / 100, 4);
    }
    ctx.restore();
}

// ── 命中测试 ─────────────────────────────────────────────────
function eventToTile(e) {
    const rect = canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const px = (e.clientX - rect.left) * (canvas.width / rect.width) / dpr;
    const py = (e.clientY - rect.top) * (canvas.height / rect.height) / dpr;
    let best = null, bestDist = Infinity;
    for (const tile of preview.tiles) {
        const d = (tile.x - px) ** 2 + (tile.y - py) ** 2;
        if (d < bestDist) { bestDist = d; best = tile; }
    }
    return best && bestDist <= (HEX_SIZE * 1.05) ** 2 ? best : null;
}

// ── 棋盘画笔 ─────────────────────────────────────────────────
function removeFromList(list, q, r) {
    for (let i = list.length - 1; i >= 0; i--) {
        if (list[i].q === q && list[i].r === r) list.splice(i, 1);
    }
}

function applyBrush(tile) {
    const { q, r } = tile;
    const b = config.board;
    switch (boardTool.mode) {
        case 'terrain': {
            removeFromList(b.terrain, q, r);
            if (boardTool.terrain !== 'plains') b.terrain.push({ q, r, type: boardTool.terrain });
            break;
        }
        case 'city': {
            // 城市/村庄二合一笔刷：由 boardTool.cityType 区分（'city' | 'village'），两者互斥。
            removeFromList(b.cities, q, r);
            removeFromList(b.villages, q, r);
            if (boardTool.cityType === 'city') {
                removeFromList(b.districts, q, r);   // 清掉此格的范围覆盖残留
                b.cities.push({ q, r, districtId: boardTool.districtId, camp: boardTool.camp });
            } else {
                b.villages.push({ q, r, districtId: preview.tileMap.get(tileKey(q, r))?.districtId ?? boardTool.districtId });
            }
            break;
        }
        case 'fortification': {
            const exist = b.fortifications.find(f => f.q === q && f.r === r);
            if (exist && exist.type === boardTool.fortification) {
                removeFromList(b.fortifications, q, r);
            } else {
                removeFromList(b.fortifications, q, r);
                b.fortifications.push({ q, r, type: boardTool.fortification });
            }
            break;
        }
        case 'district': {
            removeFromList(b.districts, q, r);
            b.districts.push({ q, r, districtId: boardTool.districtId });
            break;
        }
        case 'erase': {
            const opt = boardTool.erase;
            if (opt.terrain) removeFromList(b.terrain, q, r);
            if (opt.city) removeFromList(b.cities, q, r);
            if (opt.village) removeFromList(b.villages, q, r);
            if (opt.fortification) removeFromList(b.fortifications, q, r);
            if (opt.district) removeFromList(b.districts, q, r);
            if (opt.unit) config.units = config.units.filter(u => !(u.q === q && u.r === r));
            break;
        }
    }
}

// 半径变化时裁剪棋盘外的内容，避免遗留非法条目。
function pruneOutOfBoard() {
    const radius = config.board.radius;
    const inside = (p) => boardContains(radius, p.q, p.r);
    let pruned = 0;
    for (const key of ['cities', 'terrain', 'villages', 'fortifications', 'districts']) {
        const before = config.board[key].length;
        config.board[key] = config.board[key].filter(inside);
        pruned += before - config.board[key].length;
    }
    const beforeUnits = config.units.length;
    config.units = config.units.filter(inside);
    pruned += beforeUnits - config.units.length;
    if (pruned > 0) setStatus(`半径调整：已移除 ${pruned} 个棋盘外条目`);
}

// ── 画布交互 ─────────────────────────────────────────────────
function onPointerDown(e) {
    const tile = eventToTile(e);
    if (!tile) return;
    canvas.setPointerCapture?.(e.pointerId);

    // 画布取色/涂抹模式：先于页签逻辑处理
    if (pendingPick) {
        const key = tileKey(tile.q, tile.r);
        if (pendingPick.mode === 'tile') {
            const cb = pendingPick.callback;
            pendingPick = null;
            cb({ q: tile.q, r: tile.r });
            return;
        }
        if (pendingPick.mode === 'tiles') {
            if (pendingPick.picked.has(key)) pendingPick.picked.delete(key);
            else pendingPick.picked.add(key);
            render();
            return;
        }
    }

    if (activeTab === 'board') {
        painting = true;
        lastPaintKey = '';
        pushUndo();                                  // 一次笔画一条撤销记录
        paintAt(tile);
        return;
    }
    if (activeTab === 'units') {
        const hit = unitsByCoord().get(tileKey(tile.q, tile.r));
        if (hit) {
            selection = { kind: 'unit', index: hit.index };
        } else {
            pushUndo();
            config.units.push({
                id: nextUnitId(),
                type: unitTemplate.type,
                camp: unitTemplate.camp,
                q: tile.q, r: tile.r,
                commander: unitTemplate.commander || null,
                storyCommander: unitTemplate.storyCommander || null,
                hpPct: unitTemplate.hpPct,
                morale: unitTemplate.morale,
                canAct: unitTemplate.canAct
            });
            selection = { kind: 'unit', index: config.units.length - 1 };
            rebuildPreview();
        }
        renderToolPanel();
        renderInspector();
        render();
        return;
    }
    // 其他页签：点击仅选中地块（供剧情 target/触发器坐标参考）
    const hit = unitsByCoord().get(tileKey(tile.q, tile.r));
    selection = hit ? { kind: 'unit', index: hit.index } : { kind: 'tile', q: tile.q, r: tile.r };
    updateHint(tile);
    renderInspector();
    render();
}

function paintAt(tile) {
    const key = tileKey(tile.q, tile.r);
    if (key === lastPaintKey) return;
    lastPaintKey = key;
    applyBrush(tile);
    rebuildPreview();
    render();
}

function onPointerMove(e) {
    const tile = eventToTile(e);
    hoverTile = tile;
    updateHint(tile);
    if (painting && tile && activeTab === 'board') paintAt(tile);
    else render();
}

function onPointerUp() {
    if (painting) { painting = false; renderInspector(); }
}

function updateHint(tile, modeInfo) {
    const hintEl = $id('editorCanvasHint');
    if (!hintEl) return;
    if (pendingPick) {
        if (pendingPick.mode === 'tile') {
            hintEl.textContent = '📌 选择目标地块';
        } else {
            hintEl.textContent = `📌 ${pendingPick.label || '涂抹选择区域'}`;
        }
        return;
    }
    if (!tile) { hintEl.textContent = ''; return; }
    const unit = unitsByCoord().get(tileKey(tile.q, tile.r))?.unit;
    const parts = [
        `(${tile.q}, ${tile.r})`,
        `区${tile.districtId}`,
        factionLabels()[campKeyOfTile(tile)] || '',
        TERRAIN_LABELS[tile.terrain] || '',
        tile.isCity ? '城市' : '',
        tile.isVillage ? '村庄' : '',
        tile.fortification ? FORTIFICATION_LABELS[tile.fortification] : '',
        unit ? `单位:${UNIT_LABELS[unit.type]}${commanderMountLabel(unit) ? '·' + commanderMountLabel(unit) : ''}(${unit.id})` : ''
    ].filter(Boolean);
    hintEl.textContent = parts.join('　');
}

function campKeyOfTile(tile) {
    return tile.camp?.id || config.factions.find(faction => faction.name === tile.camp?.name)?.id || config.factions[0]?.id || '';
}

// ═══════════════════ 左侧工具面板 ═══════════════════
function renderToolPanel() {
    const body = $id('editorTabBody');
    if (!body) return;
    body.innerHTML = '';
    if (activeTab === 'board') body.appendChild(buildBoardTools());
    else if (activeTab === 'units') body.appendChild(buildUnitTools());
    else if (activeTab === 'triggers') body.appendChild(buildTriggerList());
    else if (activeTab === 'factions') body.appendChild(buildFactionBasics());
    else body.appendChild(buildMetaBasics());
}

function brushGrid(items, activeValue, onPick, cols3 = false) {
    const grid = el('div', 'ed-grid' + (cols3 ? ' ed-grid-3' : ''));
    for (const item of items) {
        const btn = el('button', 'ed-brush' + (item.value === activeValue ? ' active' : ''), item.label);
        btn.addEventListener('click', () => { onPick(item.value); renderToolPanel(); });
        grid.appendChild(btn);
    }
    return grid;
}

function buildBoardTools() {
    const wrap = el('div');

    const secRadius = section('棋盘');
    secRadius.appendChild(numRow('半径', config.board.radius, v => {
        mutate(c => {
            c.board.radius = Math.max(BOARD_RADIUS_MIN, Math.min(BOARD_RADIUS_MAX, Math.round(v)));
            pruneOutOfBoard();
        });
    }, { min: BOARD_RADIUS_MIN, max: BOARD_RADIUS_MAX, step: 1 }));
    secRadius.appendChild(checkRow('显示坐标', showCoords, v => { showCoords = v; render(); }));
    wrap.appendChild(secRadius);

    const secBrush = section('笔刷');
    secBrush.appendChild(brushGrid([
        { value: 'terrain', label: '地形' },
        { value: 'city', label: '城市/村庄' },
        { value: 'fortification', label: '工事' },
        { value: 'district', label: '区划范围' },
        { value: 'erase', label: '橡皮擦' }
    ], boardTool.mode, v => { boardTool.mode = v; }));
    wrap.appendChild(secBrush);

    // 笔刷参数
    const secParam = section('笔刷参数');
    if (boardTool.mode === 'terrain') {
        secParam.appendChild(brushGrid(
            Object.entries(TERRAIN_LABELS).map(([value, label]) => ({ value, label })),
            boardTool.terrain, v => { boardTool.terrain = v; }, true));
    }
    if (boardTool.mode === 'fortification') {
        secParam.appendChild(brushGrid(
            FORTIFICATION_KEYS.map(value => ({ value, label: FORTIFICATION_LABELS[value] })),
            boardTool.fortification, v => { boardTool.fortification = v; }));
    }
    if (boardTool.mode === 'city') {
        secParam.appendChild(selectRow('类型', boardTool.cityType, { city: '城市', village: '村庄' }, v => { boardTool.cityType = v; }));
        secParam.appendChild(selectRow('阵营', boardTool.camp, factionLabels(), v => { boardTool.camp = v; }));
    }
    if (boardTool.mode === 'city' || boardTool.mode === 'district') {
        secParam.appendChild(numRow('行政区 ID', boardTool.districtId, v => { boardTool.districtId = Math.max(0, Math.round(v)); }, { min: 0, max: 99, step: 1 }));
    }
    if (boardTool.mode === 'erase') {
        const opt = boardTool.erase;
        const toggle = (key) => (v) => { opt[key] = v; renderToolPanel(); };
        secParam.appendChild(checkRow('地形', opt.terrain, toggle('terrain')));
        secParam.appendChild(checkRow('城市', opt.city, toggle('city')));
        secParam.appendChild(checkRow('村庄', opt.village, toggle('village')));
        secParam.appendChild(checkRow('工事', opt.fortification, toggle('fortification')));
        secParam.appendChild(checkRow('区划范围', opt.district, toggle('district')));
        secParam.appendChild(checkRow('单位', opt.unit, toggle('unit')));
    }
    if (secParam.childElementCount > 1) wrap.appendChild(secParam);

    return wrap;
}

function buildUnitTools() {
    const wrap = el('div');
    const sec = section('单位模板（点击空格放置）');
    sec.appendChild(selectRow('兵种', unitTemplate.type, UNIT_LABELS, v => { unitTemplate.type = v; }));
    sec.appendChild(selectRow('阵营', unitTemplate.camp, factionLabels(), v => { unitTemplate.camp = v; }));
    sec.appendChild(selectRow('挂载将领', commanderMountValue(unitTemplate), commanderMountOptions(), v => { setCommanderMount(unitTemplate, v); }));
    sec.appendChild(numRow('生命%', unitTemplate.hpPct, v => { unitTemplate.hpPct = Math.max(1, Math.min(100, Math.round(v))); }, { min: 1, max: 100 }));
    sec.appendChild(selectRow('士气', String(unitTemplate.morale), { 3: '上升', 2: '正常', 1: '下降', 0: '混乱' }, v => { unitTemplate.morale = Number(v); }));
    sec.appendChild(checkRow('本回合可行动', unitTemplate.canAct, v => { unitTemplate.canAct = v; }));
    wrap.appendChild(sec);

    const secStory = section(`剧情将领库（${config.storyCommanders.length}）`);
    secStory.appendChild(itemList({
        items: config.storyCommanders.map((commander, index) => ({
            key: String(index),
            label: `${commander.name || commander.id} · ${commander.archetype ? COMMANDER_LABELS[commander.archetype] : '纯剧情'}`
        })),
        activeKey: selection?.kind === 'storyCommander' ? String(selection.index) : null,
        onSelect: key => { selection = { kind: 'storyCommander', index: Number(key) }; renderToolPanel(); renderInspector(); render(); },
        onDelete: key => mutate(c => {
            const index = Number(key);
            const id = c.storyCommanders[index]?.id;
            c.storyCommanders.splice(index, 1);
            if (id) replaceStoryCommanderReferences(c, id);
            if (selection?.kind === 'storyCommander') selection = null;
        }),
        addLabel: '+ 新建剧情将领',
        onAdd: () => mutate(c => {
            let n = 1;
            while (c.storyCommanders.some(item => item.id === `story_commander_${n}`)) n++;
            c.storyCommanders.push({ id: `story_commander_${n}`, name: '新剧情将领', archetype: '', portrait: 'npcMale' });
            selection = { kind: 'storyCommander', index: c.storyCommanders.length - 1 };
        })
    }));
    secStory.appendChild(hint('剧情名覆盖战场上的原型名；选择玩法原型可继承技能与数值，留空则是只有将领身份和立绘的剧情人物。'));
    wrap.appendChild(secStory);

    const secList = section(`已放置单位（${config.units.length}）`);
    secList.appendChild(itemList({
        items: config.units.map((u, i) => ({
            key: String(i),
            label: `${u.id} · ${factionLabels()[u.camp] || u.camp}${UNIT_LABELS[u.type]}${commanderMountLabel(u) ? '·' + commanderMountLabel(u) : ''} (${u.q},${u.r})`
        })),
        activeKey: selection?.kind === 'unit' ? String(selection.index) : null,
        onSelect: (key) => { selection = { kind: 'unit', index: Number(key) }; renderToolPanel(); renderInspector(); render(); },
        onDelete: (key) => mutate(c => {
            c.units.splice(Number(key), 1);
            if (selection?.kind === 'unit') selection = null;
        })
    }));
    wrap.appendChild(secList);
    return wrap;
}


function buildTriggerList() {
    const wrap = el('div');

    const secTrig = section(`触发器（${config.triggers.length}）`);
    secTrig.appendChild(itemList({
        items: config.triggers.map((t, i) => ({
            key: String(i),
            label: `${t.enabled === false ? '⏸ ' : ''}${t.title || t.id || 'trigger_' + i}`
        })),
        activeKey: selection?.kind === 'trigger' ? String(selection.index) : null,
        onSelect: (key) => { selection = { kind: 'trigger', index: Number(key) }; renderToolPanel(); renderInspector(); },
        onDelete: (key) => mutate(c => {
            c.triggers.splice(Number(key), 1);
            if (selection?.kind === 'trigger') selection = null;
        }),
        addLabel: '+ 新增触发器',
        onAdd: () => mutate(c => {
            c.triggers.push({ id: `trigger_${c.triggers.length + 1}`, title: '', note: '', enabled: true, once: true, when: [], do: [] });
            selection = { kind: 'trigger', index: c.triggers.length - 1 };
        })
    }));
    wrap.appendChild(secTrig);

    const objIds = Object.keys(config.objectives);
    const secObj = section(`目标（${objIds.length}）`);
    secObj.appendChild(itemList({
        items: objIds.map(id => ({ key: id, label: `${id} · ${config.objectives[id].title || ''}${config.objectives[id].main ? ' ★' : ''}` })),
        activeKey: selection?.kind === 'objective' ? selection.id : null,
        onSelect: (id) => { selection = { kind: 'objective', id }; renderToolPanel(); renderInspector(); },
        onDelete: (id) => mutate(c => {
            delete c.objectives[id];
            if (selection?.kind === 'objective' && selection.id === id) selection = null;
        }),
        addLabel: '+ 新增目标',
        onAdd: () => mutate(c => {
            let n = 1;
            while (c.objectives[`obj${n}`]) n++;
            c.objectives[`obj${n}`] = { title: '', detail: '', active: true, main: false };
            selection = { kind: 'objective', id: `obj${n}` };
        })
    }));
    wrap.appendChild(secObj);

    return wrap;

}

function buildFactionBasics() {
    const wrap = el('div');
    const factionOpts = Object.fromEntries(config.factions.map(faction => [faction.id, faction.name || faction.id]));
    const relationLabels = { ally: '联盟', neutral: '中立', enemy: '敌对' };
    const secPlayer = section('玩家视角');
    secPlayer.appendChild(selectRow('所属阵营', config.localPlayerCamp, factionOpts,
        value => mutate(c => { setLocalPlayerFaction(c, value); }, { rebuildPanels: true })));
    wrap.appendChild(secPlayer);

    const secFactions = section('阵营');
    config.factions.forEach((faction, idx) => {
        const delBtn = idx > 0 ? (() => mutate(c => {
            const removed = c.factions[idx]?.id;
            c.factions.splice(idx, 1);
            replaceFactionReferences(c, removed, c.factions[0]?.id || '', { remove: true });
            if (!c.factions.some(item => item.controller === 'human')) setLocalPlayerFaction(c, c.factions[0]?.id || '');
        }, { rebuildPanels: true })) : null;
        const box = card(faction.name || faction.id, delBtn);
        box.appendChild(textRow('id', faction.id, value => {
            const nextId = value.trim();
            if (!/^[a-z][a-z0-9_-]{0,31}$/i.test(nextId)) {
                setStatus('阵营 ID 须以字母开头，且只含字母、数字、_ 或 -。', 'error');
                renderInspector();
                return;
            }
            if (nextId === 'neutral' || config.factions.some((item, itemIndex) => itemIndex !== idx && item.id === nextId)) {
                setStatus('阵营 ID 已存在，或使用了保留 ID neutral。', 'error');
                renderInspector();
                return;
            }
            mutate(c => {
                const oldId = c.factions[idx].id;
                replaceFactionReferences(c, oldId, nextId);
                c.factions[idx].id = nextId;
            }, { rebuildPanels: true });
        }));
        box.appendChild(textRow('显示名', faction.name || faction.id, value => mutate(c => { c.factions[idx].name = value; }, { rebuildPanels: false })));
        box.appendChild(textareaRow('剧情备注（留空不显示）', faction.note || '', value => mutate(c => { c.factions[idx].note = value; }, { rebuildPanels: false }), 2));
        box.appendChild(selectRow('颜色', faction.color, FACTION_COLOR_OPTIONS,
            value => mutate(c => { c.factions[idx].color = value; }, { rebuildPanels: false })));
        box.appendChild(selectRow('控制方式', faction.controller || 'ai', { human: '玩家', ai: 'AI', scripted: '剧情控制' },
            value => mutate(c => {
                c.factions[idx].controller = value;
                if (value === 'human') setLocalPlayerFaction(c, c.factions[idx].id);
            }, { rebuildPanels: true })));
        box.appendChild(checkRow('参与回合', faction.participatesInTurns !== false,
            value => mutate(c => { c.factions[idx].participatesInTurns = value; syncTurnOrder(c); }, { rebuildPanels: true })));
        box.appendChild(checkRow('本关启用', faction.active !== false,
            value => mutate(c => { c.factions[idx].active = value; syncTurnOrder(c); }, { rebuildPanels: true })));
        secFactions.appendChild(box);
    });
    const addFaction = el('button', 'ed-add-btn', '+ 新增阵营');
    addFaction.addEventListener('click', () => mutate(c => {
        let n = 1;
        while (c.factions.some(faction => faction.id === `faction${n}`)) n++;
        c.factions.push({ id: `faction${n}`, name: `新阵营${n}`, note: '', color: FACTION_PALETTE[(c.factions.length - 1) % FACTION_PALETTE.length].id, controller: 'ai', participatesInTurns: true, active: true });
        syncTurnOrder(c);
    }, { rebuildPanels: true }));
    secFactions.appendChild(addFaction);
    wrap.appendChild(secFactions);

    const secTurnOrder = section('回合行动顺序');
    const orderedIds = config.turnOrder?.filter(id => config.factions.some(faction => faction.id === id && faction.active !== false && faction.participatesInTurns !== false)) || [];
    orderedIds.forEach((id, index) => {
        const row = el('div', 'ed-row');
        row.appendChild(el('label', null, `${index + 1}. ${factionLabels()[id] || id}`));
        const up = el('button', 'ed-pick-btn', '↑');
        const down = el('button', 'ed-pick-btn', '↓');
        up.disabled = index === 0;
        down.disabled = index === orderedIds.length - 1;
        up.addEventListener('click', () => mutate(c => {
            [c.turnOrder[index - 1], c.turnOrder[index]] = [c.turnOrder[index], c.turnOrder[index - 1]];
        }));
        down.addEventListener('click', () => mutate(c => {
            [c.turnOrder[index], c.turnOrder[index + 1]] = [c.turnOrder[index + 1], c.turnOrder[index]];
        }));
        row.append(up, down); secTurnOrder.appendChild(row);
    });
    if (!orderedIds.length) secTurnOrder.appendChild(hint('至少启用一个参与回合的阵营。'));
    wrap.appendChild(secTurnOrder);

    // 外交关系：仅列出启用的阵营对（不再自动包含"中立"，完全交由作者排布）
    const activeFactions = config.factions.filter(f => f.active !== false);
    const authorFactions = config.factions.filter(f => f.active !== false);
    const secDiplomacy = section('初始外交关系');
    for (let i = 0; i < activeFactions.length; i++) {
        for (let j = i + 1; j < activeFactions.length; j++) {
            const left = activeFactions[i].id, right = activeFactions[j].id;
            const value = config.diplomacy?.[left]?.[right] ?? config.diplomacy?.[right]?.[left] ?? (left === 'neutral' || right === 'neutral' ? 'neutral' : 'enemy');
            secDiplomacy.appendChild(selectRow(`${activeFactions[i].name} ↔ ${activeFactions[j].name}`, value, relationLabels, rel => mutate(c => {
                if (!c.diplomacy[left]) c.diplomacy[left] = {};
                if (!c.diplomacy[right]) c.diplomacy[right] = {};
                c.diplomacy[left][right] = rel;
                c.diplomacy[right][left] = rel;
            }, { rebuildPanels: false })));
        }
    }
    wrap.appendChild(secDiplomacy);

    const secGold = section('初始金币');
    authorFactions.forEach(f => {
        secGold.appendChild(numRow(f.name, config.gold[f.id] ?? 4, v => mutate(c => { c.gold[f.id] = Math.max(0, Math.round(v)); }, { rebuildPanels: false }), { min: 0, max: 99 }));
    });
    wrap.appendChild(secGold);

    const secCmd = section('阵营主将');
    authorFactions.filter(f => ['player1', 'player2', 'player3'].includes(f.id)).forEach(f => {
        secCmd.appendChild(selectRow(f.name, config.commanders[f.id] || '', { '': '（无，或由单位自动补全）', ...COMMANDER_LABELS },
            v => mutate(c => { c.commanders[f.id] = v || null; }, { rebuildPanels: false })));
    });
    wrap.appendChild(secCmd);

    const secHands = section('初始手牌');
    authorFactions.forEach(f => {
        secHands.appendChild(checkGroup(f.name, CARD_IDS.map(id => ({ value: id, label: CARD_LABELS[id] })), config.hands[f.id] || [],
            v => mutate(c => { c.hands[f.id] = v; }, { rebuildPanels: false })));
    });
    wrap.appendChild(secHands);

    return wrap;
}

function buildMetaBasics() {
    const wrap = el('div');
    const secId = section('关卡标识');
    secId.appendChild(textRow('关卡 ID', config.id, v => mutate(c => { c.id = v; }, { rebuildPanels: false }), '如 i1-2'));
    secId.appendChild(textRow('关卡名称', config.title, v => mutate(c => { c.title = v; }, { rebuildPanels: false })));
    secId.appendChild(textRow('传记名称', config.chronicleId, v => mutate(c => { c.chronicleId = v; }, { rebuildPanels: false })));
    secId.appendChild(textRow('章节标题', config.intro.chapterTitle || '', v => mutate(c => { c.intro.chapterTitle = v; }, { rebuildPanels: false }), '如 暮雨孤城'));
    secId.appendChild(numRow('随机种子', config.seed, v => mutate(c => { c.seed = Math.round(v); }, { rebuildPanels: false })));
    secId.appendChild(numRow('回合上限', config.turnLimit, v => mutate(c => { c.turnLimit = Math.max(0, Math.round(v)); }, { rebuildPanels: false }), { min: 0, max: 99 }));
    wrap.appendChild(secId);

    const secEnv = section('环境');
    secEnv.appendChild(selectRow('天气', config.weather, WEATHER_LABELS, v => mutate(c => { c.weather = v; }, { rebuildPanels: false })));
    secEnv.appendChild(numRow('AI 难度', config.aiDifficulty, v => mutate(c => { c.aiDifficulty = Math.max(0.1, v); }, { rebuildPanels: false }), { min: 0.1, max: 3, step: 0.1 }));
    wrap.appendChild(secEnv);
    return wrap;
}

// ═══════════════════ 右侧检查器 ═══════════════════
function renderInspector() {
    const body = $id('editorInspectorBody');
    const title = $id('editorInspectorTitle');
    if (!body) return;
    body.innerHTML = '';

    if (activeTab === 'meta') {
        title.textContent = '开场与阵营配置';
        body.appendChild(buildMetaInspector());
        return;
    }
    if (selection?.kind === 'unit' && config.units[selection.index]) {
        title.textContent = '单位属性';
        body.appendChild(buildUnitInspector(selection.index));
        return;
    }
    if (selection?.kind === 'storyCommander' && config.storyCommanders[selection.index]) {
        title.textContent = '剧情将领身份';
        body.appendChild(buildStoryCommanderInspector(selection.index));
        return;
    }
    if (selection?.kind === 'trigger' && config.triggers[selection.index]) {
        title.textContent = '触发器';
        body.appendChild(buildTriggerInspector(selection.index));
        return;
    }
    if (selection?.kind === 'objective' && config.objectives[selection.id]) {
        title.textContent = `主目标 · ${selection.id}`;
        body.appendChild(buildObjectiveInspector(selection.id));
        return;
    }
    if (selection?.kind === 'tile') {
        title.textContent = `地块 (${selection.q}, ${selection.r})`;
        body.appendChild(buildTileInspector(selection.q, selection.r));
        return;
    }
    title.textContent = '检查器';
    body.appendChild(hint('在画布上点击地块或单位，或在左侧列表中选择条目。'));
}

function buildTileInspector(q, r) {
    const wrap = el('div');
    const tile = preview.tileMap.get(tileKey(q, r));
    if (!tile) { wrap.appendChild(hint('该地块不在棋盘内。')); return wrap; }
    wrap.appendChild(hint(`行政区 ${tile.districtId} · ${factionLabels()[campKeyOfTile(tile)] || campKeyOfTile(tile)} · ${TERRAIN_LABELS[tile.terrain]}`
        + `${tile.isCity ? ' · 城市' : ''}${tile.isVillage ? ' · 村庄' : ''}${tile.fortification ? ' · ' + FORTIFICATION_LABELS[tile.fortification] : ''}`));
    wrap.appendChild(hint('切换到「棋盘」页签用笔刷修改此格；切换到「单位」页签在此放置单位。'));
    return wrap;
}

function buildUnitInspector(index) {
    const wrap = el('div');
    const u = config.units[index];
    const set = (key) => (v) => mutate(c => { c.units[index][key] = v; });
    wrap.appendChild(textRow('单位 id', u.id, v => {
        if (!v) { setStatus('单位 id 不能为空', 'error'); renderInspector(); return; }
        if (config.units.some((other, i) => i !== index && other.id === v)) { setStatus(`单位 id「${v}」已存在`, 'error'); renderInspector(); return; }
        mutate(c => { c.units[index].id = v; });
    }));
    wrap.appendChild(selectRow('兵种', u.type, UNIT_LABELS, set('type')));
    wrap.appendChild(selectRow('阵营', u.camp, factionLabels(), set('camp')));
    wrap.appendChild(selectRow('挂载将领', commanderMountValue(u), commanderMountOptions(), v => mutate(c => { setCommanderMount(c.units[index], v); })));
    wrap.appendChild(numRow('生命%', u.hpPct ?? 100, v => mutate(c => { c.units[index].hpPct = Math.max(1, Math.min(100, Math.round(v))); }), { min: 1, max: 100 }));
    wrap.appendChild(selectRow('士气', String(u.morale ?? 2), { 3: '上升', 2: '正常', 1: '下降', 0: '混乱' }, v => mutate(c => { c.units[index].morale = Number(v); })));
    wrap.appendChild(checkRow('本回合可行动', u.canAct !== false, set('canAct')));
    wrap.appendChild(coordRow('坐标', u.q, u.r, tile => mutate(c => { c.units[index].q = tile.q; c.units[index].r = tile.r; })));
    const del = el('button', 'ed-add-btn', '🗑 删除该单位');
    del.addEventListener('click', () => mutate(c => { c.units.splice(index, 1); selection = null; }));
    wrap.appendChild(del);
    wrap.appendChild(hint('剧情将领需先在左侧“剧情将领库”创建；剧情名会覆盖玩法原型名。单位 id 供触发器、目标环和存活判定引用。'));
    return wrap;
}

function buildStoryCommanderInspector(index) {
    const wrap = el('div');
    const commander = config.storyCommanders[index];
    wrap.appendChild(textRow('身份 id', commander.id, value => {
        if (!value) { setStatus('剧情将领 id 不能为空', 'error'); renderInspector(); return; }
        if (config.storyCommanders.some((other, i) => i !== index && other.id === value)) {
            setStatus(`剧情将领 id「${value}」已存在`, 'error'); renderInspector(); return;
        }
        mutate(c => {
            const previous = c.storyCommanders[index].id;
            c.storyCommanders[index].id = value;
            replaceStoryCommanderReferences(c, previous, value);
        });
    }, '如 marcus'));
    wrap.appendChild(textRow('剧情名字', commander.name, value => mutate(c => { c.storyCommanders[index].name = value; }), '如 马库斯'));
    wrap.appendChild(selectRow('玩法原型', commander.archetype || '', { '': '（无技能，仅剧情身份）', ...COMMANDER_LABELS }, value => mutate(c => {
        c.storyCommanders[index].archetype = value || undefined;
        if (!value && !c.storyCommanders[index].portrait) c.storyCommanders[index].portrait = 'npcMale';
    })));
    const portraitOptions = commander.archetype
        ? { '': '（自动使用玩法原型立绘）', ...DIALOGUE_PORTRAIT_LABELS }
        : { npcMale: DIALOGUE_PORTRAIT_LABELS.npcMale, npcFemale: DIALOGUE_PORTRAIT_LABELS.npcFemale };
    wrap.appendChild(selectRow('人物立绘', commander.portrait || (commander.archetype ? '' : 'npcMale'), portraitOptions, value => mutate(c => {
        c.storyCommanders[index].portrait = value || undefined;
    })));
    wrap.appendChild(hint('“玩法原型”决定属性、技能和规则身份；“剧情名字”决定战场名牌与阵亡日志。无专属立绘的人物请选择 NPC 男性或 NPC 女性兜底立绘。'));
    const del = el('button', 'ed-add-btn', '🗑 删除该剧情将领');
    del.addEventListener('click', () => mutate(c => {
        const id = c.storyCommanders[index]?.id;
        c.storyCommanders.splice(index, 1);
        if (id) replaceStoryCommanderReferences(c, id);
        selection = null;
    }));
    wrap.appendChild(del);
    return wrap;
}

/** 仅带「📌 点选」的坐标行（无文本标签，悬停图钉时高亮已存坐标）。 */
function coordRow(labelText, q, r, onChange) {
    const r2 = el('div', 'ed-row');
    const label = el('label', null, labelText);
    label.style.cssText = 'min-width:50px;color:rgba(255,255,255,0.6);font-size:12px;';
    r2.appendChild(label);
    const btn = pickTileButton({ q, r }, onChange);
    // 悬停时回显已保存的坐标
    btn.addEventListener('mouseenter', () => { pendingHighlight = { q, r }; render(); });
    btn.addEventListener('mouseleave', () => { pendingHighlight = null; render(); });
    r2.appendChild(btn);
    return r2;
}

function stepOptions(includeEmpty) {
    const ids = Object.keys(config.steps);
    const opts = Object.fromEntries(ids.map(id => [id, id]));
    return includeEmpty ? { '': '（无）', ...opts } : opts;
}
// ── 画布取色/涂抹工具 ──
let _pickBar = null;
function clearPickBar() {
    if (_pickBar) { _pickBar.remove(); _pickBar = null; }
}
function showPickBar(mode, label, onConfirm, onCancel) {
    clearPickBar();
    const bar = el('div', 'editor-pick-bar');
    bar.innerHTML = `<span>${label}</span>`;
    if (mode === 'tiles') {
        const confirmBtn = el('button', 'ed-add-btn', '✓ 确认');
        confirmBtn.addEventListener('click', () => { clearPickBar(); pendingPick = null; onConfirm(); });
        bar.appendChild(confirmBtn);
    }
    const cancelBtn = el('button', 'ed-add-btn', '✕ 取消');
    cancelBtn.addEventListener('click', () => { clearPickBar(); pendingPick = null; onCancel?.(); render(); renderInspector(); });
    bar.appendChild(cancelBtn);
    document.querySelector('.editor-canvas-wrap')?.appendChild(bar);
    _pickBar = bar;
}

/** 生成一个「📌 点选」按钮，点击后进入单点取色模式。 */
function pickTileButton(current, onChange) {
    const btn = el('button', 'ed-pick-btn', '🚩');
    btn.title = '点击棋盘选择坐标';
    btn.addEventListener('click', () => {
        const picked = new Set();
        if (current && current.q != null) picked.add(tileKey(current.q, current.r));
        pendingPick = { mode: 'tile', callback: (tile) => { onChange(tile); renderInspector(); render(); }, picked, label: '点击地块选择坐标' };
        showPickBar('tile', '点击棋盘上的目标地块', null, () => {});
        render();
    });
    return btn;
}

/** 生成一个「📌 涂抹区域」按钮，点击后进入多选模式。 */
function pickTilesButton(initial, onChange, { hoverTiles } = {}) {
    const btn = el('button', 'ed-pick-btn', '🚩');
    btn.title = '点击棋盘涂抹选择区域';
    btn.addEventListener('mouseenter', () => {
        if (hoverTiles) { pendingHighlight = { tiles: hoverTiles }; render(); }
    });
    btn.addEventListener('mouseleave', () => { pendingHighlight = null; render(); });
    btn.addEventListener('click', () => {
        const picked = new Set((initial || []).map(p => tileKey(p.q, p.r)));
        pendingPick = { mode: 'tiles', callback: null, picked, label: '涂抹选择区域' };
        showPickBar('tiles', `涂抹选择区域 — 已选 ${picked.size} 格`, () => {
            const list = [...picked].map(k => { const [q, r] = k.split(',').map(Number); return { q, r }; });
            onChange(list);
            renderInspector();
        }, () => {});
        render();
    });
    return btn;
}

function unitOptions(includeEmpty = true) {
    const opts = Object.fromEntries(config.units.map(u => [u.id, `${u.id}（${factionLabels()[u.camp] || u.camp}${UNIT_LABELS[u.type]}）`]));
    return includeEmpty ? { '': '（无）', ...opts } : opts;
}
/** 生成一个「📌 选单位」按钮，点击后进入画布点选模式。currentId 为已选单位 id。 */
function pickUnitButton(onChange, currentId) {
    const btn = el('button', 'ed-pick-btn', '🚩');
    btn.title = '点击棋盘上的单位';
    // 悬停时在棋盘上高亮该单位位置
    btn.addEventListener('mouseenter', () => {
        if (!currentId) return;
        const u = config.units.find(u => u.id === currentId);
        if (u) { pendingUnitFlag = { q: u.q, r: u.r }; render(); }
    });
    btn.addEventListener('mouseleave', () => { pendingUnitFlag = null; render(); });
    btn.addEventListener('click', () => {
        const flags = new Set();
        if (currentId) {
            const u = config.units.find(u => u.id === currentId);
            if (u) flags.add(`flag:${u.q},${u.r}`);
        }
        pendingPick = { mode: 'tile', callback: (tile) => {
            const hit = unitsByCoord().get(tileKey(tile.q, tile.r));
            if (hit) { onChange(hit.unit.id); renderInspector(); render(); }
            else { setStatus('该格没有单位', 'error'); render(); }
        }, picked: new Set(), flags, label: '点击棋盘上的单位' };
        showPickBar('tile', '点击棋盘上的目标单位', null, () => {});
        render();
    });
    return btn;
}

function areaPickerRow(labelText, areaId, onChange) {
    const row = el('div', 'ed-row');
    row.appendChild(el('label', null, labelText));
    const select = el('select');
    select.appendChild(new Option('（选择已有区域）', ''));
    for (const area of config.areas) select.appendChild(new Option(area.id, area.id));
    select.value = config.areas.some(area => area.id === areaId) ? areaId : '';
    select.addEventListener('change', () => onChange(select.value));
    row.appendChild(select);

    const tiles = config.areas.find(area => area.id === areaId)?.tiles || [];
    row.appendChild(pickTilesButton(tiles, list => {
        if (!list.length) { setStatus('区域至少需要选择一块地块', 'error'); return; }
        const key = list.map(tile => `${tile.q},${tile.r}`).sort().join(';');
        const existing = config.areas.find(area => area.tiles.map(tile => `${tile.q},${tile.r}`).sort().join(';') === key);
        if (existing) { onChange(existing.id); return; }
        let newId = '';
        mutate(c => {
            let n = 1;
            while (c.areas.some(area => area.id === `area${n}`)) n++;
            newId = `area${n}`;
            c.areas.push({ id: newId, tiles: list });
        }, { rebuildPanels: false });
        onChange(newId);
    }));
    return row;
}

/** 内联区域行：点选按钮 + 已选格数，不依赖 config.areas 表。 */
function tilesPickerRow(labelText, tiles, onChange) {
    const row = el('div', 'ed-row');
    row.appendChild(el('label', null, labelText));
    row.appendChild(pickTilesButton(tiles || [], list => { onChange(list); renderInspector(); }));
    const label = el('span', null, (tiles || []).length ? `${tiles.length} 格已选` : '未选择');
    label.style.cssText = 'color:rgba(255,255,255,0.5);font-size:12px;margin-left:6px;';
    row.appendChild(label);
    return row;
}

function conditionDefaults(kind) {
    switch (kind) {
        case 'all': return { conditions: [] };
        case 'any': return { conditions: [] };
        case 'not': return { condition: { kind: 'timer', value: 1000 } };
        case 'unitSelected': return { target: { unit: config.units[0]?.id || '' } };
        case 'unitMovesToTile': return { target: { unit: config.units[0]?.id || '' }, tiles: [] };
        case 'unitMovesToArea': return { target: { unit: config.units[0]?.id || '' }, tiles: [] };
        case 'unitAttacksUnit': return { attacker: { unit: config.units[0]?.id || '' }, defender: { unit: config.units[1]?.id || config.units[0]?.id || '' } };
        case 'unitKilled': return { target: { unit: config.units[0]?.id || '' } };
        case 'cityCaptured': return { q: 0, r: 0, camp: '' };
        case 'turnStarted': return { camp: primaryFactionId() };
        case 'cardUsed': return { value: CARD_IDS[0] };
        case 'skillUsed': return { target: { unit: config.units[0]?.id || '' }, skill: '', skillType: '', stacks: undefined };
        case 'eventCardIs': return { value: CARD_IDS[0] };
        case 'eventChoiceIs': return { value: '' };
        case 'cityOwnedBy': return { q: 0, r: 0, camp: primaryFactionId() };
        case 'turnAtLeast': return { value: 1 };
        case 'unitExists': return { unit: config.units[0]?.id || '', alive: true };
        case 'unitHpCompare': return { unit: config.units[0]?.id || '', mode: 'percent', op: '<=', value: 50 };
        case 'factionUnitCount': return { camp: nonLocalFactionId(), op: '<=', value: 0 };
        case 'goldCompare': return { camp: primaryFactionId(), op: '>=', value: 1 };
        case 'variableCompare': return { variable: config.variables[0]?.id || '', op: '==', value: 0 };
        case 'tileOwnedBy': return { q: 0, r: 0, camp: primaryFactionId() };
        case 'relationIs': return { camp: primaryFactionId(), targetCamp: nonLocalFactionId(), relation: 'enemy' };
        case 'weatherIs': return { weather: 'clear' };
        case 'objectiveStatusIs': return { objective: Object.keys(config.objectives)[0] || '', status: 'active' };
        case 'interactionStateIs': return { interactable: config.interactables[0]?.id || '', state: 'available' };
        case 'groupState': return { group: config.unitGroups[0]?.id || '', state: 'anyAlive' };
        case 'unitsInArea': return { area: config.areas[0]?.id || '', camp: '', op: '>=', value: 1 };
        case 'eventInteractionIs': return { interactable: config.interactables[0]?.id || '' };
        case 'mechanicEnabled': return { mechanic: MECHANIC_KEYS[0], enabled: true };
        case 'timer': return { value: 1000 };
        case 'triggerEnabled': return { trigger: config.triggers[0]?.id || '', enabled: true };
        default: return { value: '' };
    }
}
function actionDefaults(kind) {
    switch (kind) {
        case 'showStep': return { mode: 'narrator', text: '', next: '' };
        case 'spawnUnits': return { units: [] };
        case 'unlockInput': return {};
        case 'lockInput': return { highlight: {} };
        case 'setVariable': return { variable: config.variables[0]?.id || '', operation: 'set', value: 0 };
        case 'setTriggerEnabled': return { trigger: config.triggers[0]?.id || '', enabled: true };
        case 'setObjectiveStatus': return { objective: Object.keys(config.objectives)[0] || '', status: 'active' };
        case 'changeGold': return { camp: primaryFactionId(), operation: 'add', value: 1 };
        case 'changeUnitHp': return { target: { unit: config.units[0]?.id || '' }, operation: 'subtract', mode: 'value', value: 1 };
        case 'changeUnitFaction': return { target: { unit: config.units[0]?.id || '' }, camp: primaryFactionId() };
        case 'setUnitState': return { target: { unit: config.units[0]?.id || '' }, state: 'canAct', value: true };
        case 'setDiplomacy': return { camp: primaryFactionId(), targetCamp: nonLocalFactionId(), relation: 'enemy' };
        case 'setWeather': return { weather: 'clear' };
        case 'setInteractionState': return { interactable: config.interactables[0]?.id || '', state: 'available' };
        case 'removeUnits': return { target: { unit: config.units[0]?.id || '' }, mode: 'despawn' };
        case 'assignCommander': return { target: { unit: config.units[0]?.id || '' }, commander: '' };
        case 'endScenario': return { result: 'win', reason: '' };
        case 'setMechanicEnabled': return { mechanic: MECHANIC_KEYS[0], enabled: true };
        default: return {};
    }
}

// 从条件/动作对象中提取参数摘要（🚩 + 地块高亮 格式）
function _paramLine(obj) {
    if (!obj || typeof obj !== 'object') return '';
    const parts = [];
    // 顶层字段
    if (obj.unit != null) parts.push(`单位:${obj.unit}`);
    if (obj.value != null) parts.push(`值:${obj.value}`);
    if (obj.target?.unit) parts.push(`目标:${obj.target.unit}`);
    if (obj.attacker?.unit) parts.push(`攻:${obj.attacker.unit}`);
    if (obj.attackerCamp) parts.push(`攻营:${obj.attackerCamp}`);
    if (obj.defender?.unit) parts.push(`守:${obj.defender.unit}`);
    if (obj.defenderCamp) parts.push(`守营:${obj.defenderCamp}`);
    if (typeof obj.q === 'number' && typeof obj.r === 'number') parts.push(`📍${obj.q},${obj.r}`);
    if (obj.area) parts.push(`区域:${obj.area}`);
    if (obj.tiles?.length) parts.push(`📍${obj.tiles.length}格`);
    if (obj.step) parts.push(`步骤:${obj.step}`);
    if (obj.objective) parts.push(`目标:${obj.objective}`);
    if (obj.status) parts.push(`→${obj.status}`);
    // highlight 嵌套字段（showStep 专用）
    if (obj.highlight) {
        const hl = obj.highlight;
        if (hl.unit) parts.push(`🔵${hl.unit}`);
        if (hl.tiles?.length) parts.push(`📍${hl.tiles.map(t => `${t.q},${t.r}`).join(';')}`);
        if (hl.hint) parts.push(`💬${hl.hint}`);
    }
    return parts.length ? `🚩 ${parts.join(' ')}` : '';
}
// 卡片空白处点击 → 高亮 + 参数预览
function _addCardClickHighlight(box, obj) {
    const line = _paramLine(obj);
    if (!line) return;
    const info = el('div', 'ed-card-info');
    info.textContent = line;
    info.style.cssText = 'display:none;padding:4px 8px;font-size:11px;color:rgba(255,215,0,0.7);border-top:1px solid rgba(255,215,0,0.15);margin-top:4px;';
    box.appendChild(info);
    let active = false;
    box.addEventListener('click', (e) => {
        const tag = e.target?.tagName;
        if (['SELECT', 'INPUT', 'BUTTON', 'TEXTAREA'].includes(tag)) return;
        active = !active;
        box.style.boxShadow = active ? 'inset 0 0 0 1px rgba(255,215,0,0.4)' : '';
        info.style.display = active ? '' : 'none';
	        if (active) {
	            const hl = _extractHighlights(obj);
	            pendingHighlight = hl?.tiles ? { tiles: hl.tiles } : null;
	            pendingUnitFlag = hl?.flag?.q != null ? hl.flag : null;
	        } else {
	            pendingHighlight = null;
	            pendingUnitFlag = null;
	        }
        render();
    });
}

// 从条件/动作萃取棋盘高亮数据（返回 { tiles, flag }，用于点击卡片后在棋盘上回显）

// 根据 statMods 自动生成效果描述文本
function _buildEffectDesc(m) {
    if (!m || typeof m !== 'object') return '';
    const parts = [];
    const _pct = (v, label) => { if (!v) return; parts.push(`${label}${v > 0 ? '提高' : '降低'}${Math.abs(v)}%`); };
    const _flat = (v, label) => { if (!v) return; parts.push(`${label}${v > 0 ? '提高' : '降低'}${Math.abs(v)}点`); };
    _pct(m.atkPct, '攻击力');
    _flat(m.atkFlat, '攻击力');
    _pct(m.defPct, '防御力');
    _pct(m.meleeDefPct, '对近战攻击防御力');
    _pct(m.rangeDefPct, '对远程攻击防御力');
    _flat(m.spdFlat, '行动力');
    _pct(m.hpPct, '生命上限');
    _flat(m.hpFlat, '生命上限');
    return parts.join('；');
}
function _extractHighlights(obj) {
    if (!obj || typeof obj !== 'object') return null;
    const tiles = [];
    const add = (q, r) => { if (q != null && r != null) tiles.push({ q, r }); };
    if (obj.q != null) add(obj.q, obj.r);
    if (obj.tiles) tiles.push(...obj.tiles);
    if (obj.target?.q != null) add(obj.target.q, obj.target.r);
    for (const key of ['target', 'attacker', 'defender']) {
        const t = obj[key];
        if (t?.unit) { const u = config.units.find(u => u.id === t.unit); if (u) add(u.q, u.r); }
        if (t?.group) { const g = config.unitGroups.find(g => g.id === t.group); if (g) g.unitIds.forEach(id => { const u = config.units.find(u => u.id === id); if (u) add(u.q, u.r); }); }
    }
    if (obj.highlight?.tiles) tiles.push(...obj.highlight.tiles);
    let flag = null;
    if (obj.highlight?.unit) { const u = config.units.find(u => u.id === obj.highlight.unit); if (u) flag = { q: u.q, r: u.r }; }
    // 从 target/attacker/defender 提取第一个单位作为🚩
    if (!flag) for (const key of ['target', 'attacker', 'defender']) {
        const t = obj[key];
        if (t?.unit) { const u = config.units.find(u => u.id === t.unit); if (u) { flag = { q: u.q, r: u.r }; break; } }
    }
    if (!flag && obj.highlight?.unit) flag = { unit: obj.highlight.unit };
    return { tiles: tiles.length ? tiles : undefined, flag };
}

function conditionEditor(cond, onChange, onRemove, parentIsAny = false) {
    if (!cond || typeof cond !== 'object') { console.warn('[编辑器] 非法条件', cond); return el('div'); }
    const meta = TRIGGER_CONDITIONS.find(c => c?.kind === cond.kind) || TRIGGER_CONDITIONS[0];
    const box = card(meta.label, onRemove);
    _addCardClickHighlight(box, cond);
    const conditionKinds = authorConditions(cond.kind).filter(c => !parentIsAny || c.kind !== 'any');
    box.appendChild(selectRow('条件', cond.kind, Object.fromEntries(conditionKinds.map(c => [c.kind, c.label])), v => {
        onChange({ kind: v, ...conditionDefaults(v) });
    }));
    const patch = (fields) => onChange({ ...cond, ...fields });
    switch (meta.arg) {
        case 'none':
            break;
        case 'eventTarget':
            box.appendChild(targetEditor(cond.target, target => patch({ target }), { label: '指定单位' }));
            box.appendChild(selectRow('阵营', cond.camp || '', { '': '任意', ...factionLabels() }, camp => patch({ camp: camp || undefined })));
            break;
        case 'eventTargetArea':
            box.appendChild(selectRow('阵营', cond.camp || '', { '': '任意', ...factionLabels() }, camp => patch({ camp: camp || undefined })));
            box.appendChild(targetEditor(cond.target, target => patch({ target }), { label: '移动单位' }));
            box.appendChild(tilesPickerRow('目标位置', cond.tiles || [], list => patch({ tiles: list.length ? list : undefined, q: undefined, r: undefined })));
            break;
        case 'eventCombatPair':
            box.appendChild(selectRow('攻击方阵营', cond.attackerCamp || '', { '': '任意', ...factionLabels() }, camp => patch({ attackerCamp: camp || undefined })));
            box.appendChild(targetEditor(cond.attacker, attacker => patch({ attacker }), { label: '攻击方单位' }));
            box.appendChild(selectRow('受击方阵营', cond.defenderCamp || '', { '': '任意', ...factionLabels() }, camp => patch({ defenderCamp: camp || undefined })));
            box.appendChild(targetEditor(cond.defender, defender => patch({ defender }), { label: '受击方单位' }));
            break;
        case 'eventCityCapture':
            box.appendChild(coordRow('城市坐标', cond.q ?? 0, cond.r ?? 0, tile => patch(tile)));
            box.appendChild(selectRow('占领阵营', cond.camp || '', { '': '任意', ...factionLabels() }, camp => patch({ camp: camp || undefined })));
            break;
        case 'eventCampTurn':
            box.appendChild(selectRow('阵营（留空=每轮首位）', cond.camp || '', { '': '（每轮首位）', ...factionLabels() }, camp => patch({ camp: camp || undefined })));
            box.appendChild(checkRow('延后若干轮才触发', cond.turn != null, enabled => patch({ turn: enabled ? 1 : undefined })));
            if (cond.turn != null) box.appendChild(numRow('延后回合数', cond.turn, v => patch({ turn: Math.max(1, Math.round(v)) }), { min: 1, max: 99 }));
            break;
        case 'eventUnitSkill':
            box.appendChild(selectRow('阵营', cond.camp || '', { '': '任意', ...factionLabels() }, camp => patch({ camp: camp || undefined })));
            box.appendChild(targetEditor(cond.target, target => patch({ target }), { label: '施放单位' }));
            box.appendChild(selectRow('技能类型', cond.skillType || '', { '': '任意', active: '主动技能', passive: '被动技能' }, v => patch({ skillType: v || undefined })));
            box.appendChild(textRow('技能 id（留空=任意）', cond.skill || '', skill => patch({ skill: skill || undefined })));
            if (cond.skillType === 'passive') {
                box.appendChild(selectRow('叠层比较', cond.stackOp || '>=', { '>=': '不少于', '<=': '不多于', '==': '等于' }, v => patch({ stackOp: v })));
                box.appendChild(numRow('叠层数', cond.stacks ?? 1, v => patch({ stacks: Math.max(1, Math.round(v)) }), { min: 1, max: 99 }));
            }
            break;
        case 'step':
            box.appendChild(selectRow('步骤', cond.value || '', stepOptions(true), v => patch({ value: v }))); break;
        case 'unitRef': {
            const unitRow = el('div', 'ed-row');
            unitRow.appendChild(el('label', null, '单位'));
            unitRow.appendChild(pickUnitButton(id => patch({ unit: id }), cond.unit));
            unitRow.appendChild(Object.assign(el('span', null, cond.unit || '未选择'), {style: {fontSize: '11px'}}));
            box.appendChild(unitRow);
            break;
        }
        case 'card':
            box.appendChild(selectRow('卡牌', cond.value || CARD_IDS[0], CARD_LABELS, v => patch({ value: v }))); break;
        case 'cardCamp':
            box.appendChild(selectRow('卡牌', cond.value || CARD_IDS[0], CARD_LABELS, v => patch({ value: v })));
            box.appendChild(selectRow('阵营', cond.camp || '', { '': '任意', ...factionLabels() }, camp => patch({ camp: camp || undefined })));
            break;
        case 'camp':
            box.appendChild(selectRow('阵营', cond.value || primaryFactionId(), factionLabels(), v => patch({ value: v }))); break;
        case 'cityOwner':
            box.appendChild(coordRow('坐标', cond.q ?? 0, cond.r ?? 0, tile => patch(tile)));
            box.appendChild(selectRow('归属', cond.camp || primaryFactionId(), factionLabels(), v => patch({ camp: v })));
            break;
        case 'number':
            box.appendChild(numRow('启用后等待（毫秒）', cond.value ?? 1000, v => patch({ value: Math.round(v) }))); break;
        case 'text':
            box.appendChild(textRow('值', cond.value || '', v => patch({ value: v }))); break;
        case 'conditionGroup':
            box.appendChild(conditionListEditor(cond.conditions || [], conditions => patch({ conditions }), { parentIsAny: meta.kind === 'any' })); break;
        case 'conditionSingle':
            box.appendChild(conditionEditor(
                cond.condition || { kind: 'timer', value: 1000 },
                condition => patch({ condition }),
                null,
                false
            ));
            break;
        case 'unitExists': {
            const uRow = el('div', 'ed-row');
            uRow.appendChild(el('label', null, '单位'));
            uRow.appendChild(pickUnitButton(id => patch({ unit: id })));
            uRow.appendChild(Object.assign(el('span', null, cond.unit || '未选择'), {style: {fontSize: '11px'}}));
            box.appendChild(uRow);
            box.appendChild(selectRow('要求', cond.alive === false ? 'dead' : 'alive', { alive: '仍在场', dead: '已阵亡/不存在' }, v => patch({ alive: v === 'alive' }))); break;
        }
        case 'unitHpCompare': {
            const uRow = el('div', 'ed-row');
            uRow.appendChild(el('label', null, '单位'));
            uRow.appendChild(pickUnitButton(id => patch({ unit: id })));
            uRow.appendChild(Object.assign(el('span', null, cond.unit || '未选择'), {style: {fontSize: '11px'}}));
            box.appendChild(uRow);
            box.appendChild(selectRow('数值类型', cond.mode || 'percent', { percent: '生命百分比', value: '生命点数' }, v => patch({ mode: v })));
            box.appendChild(selectRow('比较', cond.op || '<=', { '<': '小于', '<=': '小于等于', '==': '等于', '>=': '大于等于', '>': '大于' }, v => patch({ op: v })));
            box.appendChild(numRow('数值', cond.value ?? 50, v => patch({ value: v }))); break;
        }
        case 'campCompare':
            box.appendChild(selectRow('阵营', cond.camp || nonLocalFactionId(), factionLabels(), v => patch({ camp: v })));
            box.appendChild(selectRow('比较', cond.op || '<=', { '<=': '不多于', '==': '正好', '>=': '不少于' }, v => patch({ op: v })));
            box.appendChild(numRow('单位数', cond.value ?? 0, v => patch({ value: Math.max(0, Math.round(v)) }))); break;
        case 'relation':
            box.appendChild(selectRow('阵营 A', cond.camp || primaryFactionId(), factionLabels(), v => patch({ camp: v })));
            box.appendChild(selectRow('阵营 B', cond.targetCamp || nonLocalFactionId(), factionLabels(), v => patch({ targetCamp: v })));
            box.appendChild(selectRow('关系', cond.relation || 'enemy', { ally: '联盟', neutral: '中立', enemy: '敌对' }, v => patch({ relation: v }))); break;
        case 'weather': box.appendChild(selectRow('天气', cond.weather || 'clear', WEATHER_LABELS, v => patch({ weather: v }))); break;
        case 'objectiveStatus':
            box.appendChild(selectRow('目标', cond.objective || '', Object.fromEntries(Object.keys(config.objectives).map(id => [id, config.objectives[id].title || id])), v => patch({ objective: v })));
            box.appendChild(selectRow('状态', cond.status || 'active', { hidden: '隐藏（未启用）', active: '进行中', completed: '已完成', failed: '已失败' }, v => patch({ status: v }))); break;
        case 'interactionState':
            box.appendChild(selectRow('调查点', cond.interactable || '', Object.fromEntries(config.interactables.map(item => [item.id, item.label || item.id])), v => patch({ interactable: v })));
            box.appendChild(selectRow('状态', cond.state || 'available', { disabled: '不可用', available: '可调查', completed: '已完成' }, v => patch({ state: v }))); break;
        case 'groupState':
            box.appendChild(selectRow('单位组', cond.group || '', Object.fromEntries(config.unitGroups.map(item => [item.id, item.id])), v => patch({ group: v })));
            box.appendChild(selectRow('状态', cond.state || 'anyAlive', { anyAlive: '至少一员存活', allAlive: '全员存活', allDead: '全员阵亡', casualty: '出现减员（非全员存活但非全员阵亡）' }, v => patch({ state: v }))); break;
        case 'areaCount': {
            // 区域选择：下拉选已有区域 或 📌 画布涂抹后自动创建/复用
            const areaRow = el('div', 'ed-row');
            areaRow.appendChild(el('label', null, '区域'));
            const areaSel = el('select');
            const areaOpts = config.areas.map((item, i) => { const o = el('option'); o.value = item.id; o.textContent = item.id; return o; });
            areaOpts.forEach(o => areaSel.appendChild(o));
            if (!areaOpts.some(o => o.value === cond.area) && areaOpts[0]) areaSel.value = areaOpts[0].value;
            else areaSel.value = cond.area || '';
            areaSel.addEventListener('change', () => patch({ area: areaSel.value }));
            areaRow.appendChild(areaSel);
            const currentAreaTiles = config.areas.find(a => a.id === cond.area)?.tiles || [];
            areaRow.appendChild(pickTilesButton(currentAreaTiles, list => {
                // 查找坐标完全匹配的已有区域，没有则新建
                const key = list.map(t => `${t.q},${t.r}`).sort().join(';');
                let area = config.areas.find(a => a.tiles.map(t => `${t.q},${t.r}`).sort().join(';') === key);
                if (!area) {
                    let n = 1; while (config.areas.some(a => a.id === `area${n}`)) n++;
                    mutate(c => { c.areas.push({ id: `area${n}`, tiles: list }); }, { rebuildPanels: true, snapshot: false });
                    area = config.areas[config.areas.length - 1];
                } else {
                    mutate(c => { }, { rebuildPanels: false }); // 触发重绘
                }
                patch({ area: area.id });
                areaSel.value = area.id;
            }));
            box.appendChild(areaRow);
            box.appendChild(selectRow('阵营筛选', cond.camp || '', { '': '任意阵营', ...factionLabels() }, v => patch({ camp: v })));
            box.appendChild(selectRow('比较', cond.op || '>=', { '<=': '不多于', '==': '正好', '>=': '不少于' }, v => patch({ op: v })));
            box.appendChild(numRow('单位数', cond.value ?? 1, v => patch({ value: Math.max(0, Math.round(v)) }))); break;
        }
        case 'coord':
            box.appendChild(coordRow('坐标', cond.q ?? 0, cond.r ?? 0, tile => patch(tile))); break;
        case 'interaction': box.appendChild(selectRow('调查点', cond.interactable || '', Object.fromEntries(config.interactables.map(item => [item.id, item.label || item.id])), v => patch({ interactable: v }))); break;
        case 'goldCompare':
            box.appendChild(selectRow('阵营', cond.camp || primaryFactionId(), factionLabels(), v => patch({ camp: v })));
            box.appendChild(selectRow('比较', cond.op || '>=', { '<': '少于', '<=': '不多于', '==': '等于', '>=': '不少于', '>': '多于' }, v => patch({ op: v })));
            box.appendChild(numRow('金币', cond.value ?? 1, v => patch({ value: Math.max(0, v) }))); break;
        case 'variableCompare': {
            box.appendChild(selectRow('作用域', cond.scope || 'level', { level: '本关', campaign: '战役' }, v => patch({ scope: v, variable: '' })));
            const scopeVars = config.variables.filter(item => item.scope === (cond.scope || 'level'));
            box.appendChild(selectRow('变量', cond.variable || '', Object.fromEntries(scopeVars.map(item => [item.id, item.id])), v => patch({ variable: v })));
            const variable = scopeVars.find(item => item.id === cond.variable) || scopeVars[0];
            if (variable?.type === 'number') {
                box.appendChild(selectRow('比较', cond.op || '==', { '==': '等于', '!=': '不等于', '<': '小于', '<=': '小于等于', '>=': '大于等于', '>': '大于' }, v => patch({ op: v })));
                box.appendChild(numRow('数值', Number(cond.value) || 0, v => patch({ value: v })));
            } else if (variable?.type === 'boolean') {
                box.appendChild(selectRow('比较', cond.op || '==', { '==': '是', '!=': '不是' }, v => patch({ op: v })));
                box.appendChild(selectRow('数值', cond.value === true ? 'true' : 'false', { true: '是', false: '否' }, v => patch({ value: v === 'true' })));
            } else {
                box.appendChild(selectRow('比较', cond.op || '==', { '==': '等于', '!=': '不等于' }, v => patch({ op: v })));
                box.appendChild(textRow('数值', String(cond.value ?? ''), v => patch({ value: v })));
            }
            break;
        }
        case 'triggerBoolean':
            box.appendChild(selectRow('触发器', cond.trigger || '', Object.fromEntries(config.triggers.map(t => [t.id, t.title || t.id])), v => patch({ trigger: v })));
            box.appendChild(checkRow('已启用（勾=启用，不勾=禁用）', cond.enabled !== false, v => patch({ enabled: v }))); break;
        case 'mechanicBoolean':
            box.appendChild(selectRow('机制', cond.mechanic || MECHANIC_KEYS[0], MECHANIC_LABELS, v => patch({ mechanic: v })));
            box.appendChild(selectRow('要求', cond.enabled === false ? 'off' : 'on', { on: '已启用', off: '已禁用' }, v => patch({ enabled: v === 'on' }))); break;
        default: break;
    }
    if (meta.note) box.appendChild(hint(meta.note));
    return box;
}

function spawnGroupEditor(units, onChange) {
    const wrap = el('div');
    (units || []).forEach((u, i) => {
        const box = card(`生成单位 ${i + 1}`, () => {
            const next = units.slice(); next.splice(i, 1); onChange(next);
        });
        const patch = (fields) => {
            const next = units.slice(); next[i] = { ...u, ...fields }; onChange(next);
        };
        box.appendChild(textRow('id', u.id || '', v => patch({ id: v || undefined })));
        box.appendChild(selectRow('兵种', u.type || 'infantry', UNIT_LABELS, v => patch({ type: v })));
        box.appendChild(selectRow('阵营', u.camp || nonLocalFactionId(), factionLabels(), v => patch({ camp: v })));
        box.appendChild(selectRow('挂载将领', commanderMountValue(u), commanderMountOptions(), value => {
            const mounted = { ...u };
            setCommanderMount(mounted, value);
            patch({ commander: mounted.commander, storyCommander: mounted.storyCommander });
        }));
        box.appendChild(coordRow('坐标', u.q ?? 0, u.r ?? 0, tile => patch(tile)));
        box.appendChild(numRow('生命%', u.hpPct ?? 100, v => patch({ hpPct: Math.max(1, Math.min(100, Math.round(v))) })));
        wrap.appendChild(box);
    });
    const add = el('button', 'ed-add-btn', '+ 添加生成单位');
    add.addEventListener('click', () => onChange([...(units || []), { type: 'infantry', camp: nonLocalFactionId(), q: 0, r: 0 }]));
    wrap.appendChild(add);
    return wrap;
}

function targetEditor(target, onChange, { label = '作用对象' } = {}) {
    const wrap = el('div');
    const mode = target?.group ? 'group' : 'unit';
    wrap.appendChild(selectRow(label, mode, { unit: '单个单位', group: '单位组' }, value => {
        onChange(value === 'group' ? { group: config.unitGroups[0]?.id || '' } : { unit: config.units[0]?.id || '' });
    }));
    if (mode === 'group') {
        wrap.appendChild(selectRow('单位组', target?.group || '', Object.fromEntries(config.unitGroups.map(group => [group.id, group.id])), value => onChange({ group: value })));
    } else {
        const uRow = el('div', 'ed-row');
        uRow.appendChild(el('label', null, '单位'));
        uRow.appendChild(pickUnitButton(id => onChange({ unit: id }), target?.unit));
        uRow.appendChild(Object.assign(el('span', null, target?.unit || '未选择'), {style: {fontSize: '11px'}}));
        wrap.appendChild(uRow);
    }
    return wrap;
}

function actionEditor(action, onChange, onRemove, allowNested = true) {
    const meta = TRIGGER_ACTIONS.find(a => a.kind === action.kind) || TRIGGER_ACTIONS[0];
    const box = card(meta.label, onRemove);
    _addCardClickHighlight(box, action);
    const kinds = authorActions(action.kind).filter(a => allowNested || a.kind !== 'delay');
    box.appendChild(selectRow('动作', action.kind, Object.fromEntries(kinds.map(a => [a.kind, a.label])), v => onChange({ kind: v, ...actionDefaults(v) })));
    const patch = (fields) => onChange({ ...action, ...fields });
    switch (meta.arg) {
        case 'inlineStep': {
            // 向后兼容：旧格式 action 含有 step 字段引用步表
            if (action.step) {
                box.appendChild(selectRow('步骤', action.step, {
                    ...Object.fromEntries(Object.keys(config.steps || {}).map(id => [id, id])),
                    '__inline__': '── 转为内联格式 ──'
                }, v => {
                    if (v === '__inline__') {
                        const s = (config.steps || {})[action.step] || {};
                        const hl = {};
                        if (s.allow?.units?.length) hl.unit = s.allow.units[0];
                        if (s.allow?.tiles?.length) hl.tiles = s.allow.tiles;
                        if (s.allow?.hint) hl.hint = s.allow.hint;
                        if (s.target?.q != null) { if (!hl.tiles) hl.tiles = []; hl.tiles.push({ q: s.target.q, r: s.target.r }); }
                        onChange({ kind: 'showStep', mode: s.mode, text: s.text, speaker: s.speaker, next: s.next, highlight: Object.keys(hl).length ? hl : undefined, immediate: action.immediate });
                    } else { patch({ step: v || '' }); }
                }));
                if (action.step && config.steps?.[action.step]) {
                }
            }
            const dialogue = section('对话框内容');
            dialogue.appendChild(textRow('说话人', action.speaker?.name || '', v => patch({ speaker: { ...(action.speaker || {}), name: v } })));
            dialogue.appendChild(selectRow('立绘', action.speaker?.portrait || '', { '': '（无立绘）', ...DIALOGUE_PORTRAIT_LABELS }, v => patch({ speaker: { ...(action.speaker || {}), portrait: v || undefined } })));
            dialogue.appendChild(textareaRow('台词', action.text || '', v => patch({ text: v }), 3));
            box.appendChild(dialogue);
            // 高亮 = 操作放行 + 视觉指示一体化
            const hl = action.highlight || {};
            const secHl = section('高亮（放行 + 指示）');
            secHl.appendChild(textRow('提示文字', hl.hint || '', v => patch({ highlight: { ...hl, hint: v || undefined } })));
            secHl.appendChild(targetEditor(hl.unit ? { unit: hl.unit } : null, target => patch({ highlight: { ...hl, unit: target?.unit || undefined } }), { label: '单位出环' }));
            secHl.appendChild(tilesPickerRow('地块高亮', hl.tiles || [], tiles => patch({ highlight: { ...hl, tiles: tiles.length ? tiles : undefined } })));
            box.appendChild(secHl);
            box.appendChild(checkRow('棋盘操作锁（限制棋盘点击）', !!action.boardLock, v => patch({ boardLock: v || undefined })));
            box.appendChild(checkRow('对话框点击锁（禁止点击推进）', !!action.dialogLock, v => patch({ dialogLock: v || undefined })));
            break;
        }
        case 'lockStep': {
            // lockInput 的白名单（不产生视觉高亮）
            const hl = action.highlight || {};
            const sec = section('白名单（不产生视觉高亮）');
            sec.appendChild(textRow('提示文字', hl.hint || '', v => patch({ highlight: { ...hl, hint: v || undefined } })));
            sec.appendChild(textRow('放行单位', hl.unit || '', v => patch({ highlight: { ...hl, unit: v || undefined } }), '单位 ID 或 all'));
            sec.appendChild(tilesPickerRow('放行地块', hl.tiles || [], tiles => patch({ highlight: { ...hl, tiles: tiles.length ? tiles : undefined } })));
            box.appendChild(sec);
            break;
        }
        case 'objective':
            box.appendChild(selectRow('目标', action.objective || '', { '': '（选择）', ...Object.fromEntries(Object.keys(config.objectives).map(id => [id, config.objectives[id].title || id])) }, v => patch({ objective: v })));
            break;
        case 'optional':
            box.appendChild(selectRow('支线', action.id || '', { '': '（选择）', ...Object.fromEntries(config.optionalObjectives.map(o => [o.id, o.text || o.id])) }, v => patch({ id: v })));
            break;
        case 'spawnGroup':
            box.appendChild(spawnGroupEditor(action.units || [], units => patch({ units })));
            break;
        case 'text':
            box.appendChild(textareaRow('文本', action.text || '', v => patch({ text: v }), 2));
            break;
        case 'delayGroup':
            box.appendChild(numRow('延迟(ms)', action.ms ?? 1000, v => patch({ ms: Math.max(0, Math.round(v)) })));
            box.appendChild(actionListEditor(action.then || [], list => patch({ then: list }), false));
            break;
        case 'variableOperation': {
            const variable = config.variables.find(item => item.id === action.variable) || config.variables[0];
            const type = variable?.type || 'number';
            box.appendChild(selectRow('变量', action.variable || variable?.id || '', Object.fromEntries(config.variables.map(item => [item.id, `${item.id}（${item.scope === 'campaign' ? '战役' : '本关'}）`])), v => {
                const next = config.variables.find(item => item.id === v);
                patch({ variable: v, operation: 'set', value: next?.type === 'boolean' ? false : next?.type === 'string' ? '' : 0 });
            }));
            if (type === 'number') {
                box.appendChild(selectRow('操作', action.operation || 'set', { set: '设为', add: '增加', subtract: '减少', multiply: '乘以', divide: '除以', min: '取较小值', max: '取较大值' }, v => patch({ operation: v })));
                box.appendChild(numRow('数值', Number(action.value) || 0, v => patch({ value: v })));
            } else if (type === 'boolean') {
                box.appendChild(selectRow('数值', action.value === true ? 'true' : 'false', { true: '是', false: '否' }, v => patch({ operation: 'set', value: v === 'true' })));
            } else {
                box.appendChild(textRow('数值', String(action.value ?? ''), v => patch({ operation: 'set', value: v })));
            }
            break;
        }
        case 'timer': return { value: 1000 };
        case 'triggerEnabled':
            box.appendChild(selectRow('触发器', action.trigger || '', Object.fromEntries(config.triggers.map(item => [item.id, item.title || item.id])), v => patch({ trigger: v })));
            box.appendChild(selectRow('状态', action.enabled === false ? 'off' : 'on', { on: '启用', off: '禁用' }, v => patch({ enabled: v === 'on' }))); break;
        case 'objectiveStatus':
            box.appendChild(selectRow('目标', action.objective || '', Object.fromEntries(Object.keys(config.objectives).map(id => [id, config.objectives[id].title || id])), v => patch({ objective: v })));
            box.appendChild(selectRow('状态', action.status || 'active', { hidden: '隐藏（未启用）', active: '进行中', completed: '已完成', failed: '已失败' }, v => patch({ status: v }))); break;
        case 'campOperation':
            box.appendChild(selectRow('阵营', action.camp || primaryFactionId(), factionLabels(), v => patch({ camp: v })));
            box.appendChild(selectRow('操作', action.operation || 'add', { set: '设为', add: '增加', subtract: '减少' }, v => patch({ operation: v })));
            box.appendChild(numRow('金币', action.value ?? 1, v => patch({ value: v }))); break;
        case 'unitOperation':
            box.appendChild(targetEditor(action.target, target => patch({ target })));
            box.appendChild(selectRow('操作', action.operation || 'subtract', { set: '设为', add: '治疗', subtract: '造成伤害' }, v => patch({ operation: v })));
            box.appendChild(selectRow('单位', action.mode || 'value', { value: '点数', percent: '最大生命百分比' }, v => patch({ mode: v })));
            box.appendChild(numRow('数值', action.value ?? 1, v => patch({ value: Math.max(0, v) }))); break;
        case 'unitCamp':
            box.appendChild(targetEditor(action.target, target => patch({ target })));
            box.appendChild(selectRow('新阵营', action.camp || primaryFactionId(), factionLabels(), v => patch({ camp: v }))); break;
        case 'unitCommander':
            box.appendChild(targetEditor(action.target, target => patch({ target })));
            box.appendChild(selectRow('挂载将领', commanderMountValue(action), commanderMountOptions(), value => {
                const mounted = { ...action };
                setCommanderMount(mounted, value);
                patch({ commander: mounted.commander, storyCommander: mounted.storyCommander });
            }));
            box.appendChild(hint('剧情将领沿用将领库中的名字、立绘与玩法原型；选择“无将领”会卸下现有挂载。'));
            break;
        case 'unitState':
            box.appendChild(targetEditor(action.target, target => patch({ target })));
            box.appendChild(selectRow('能力', action.state || 'canAct', { canAct: '本回合可行动', canMove: '允许移动', canAttack: '允许攻击', targetable: '允许成为目标', invulnerable: '无敌', canCounterattack: '允许反击' }, v => patch({ state: v })));
            box.appendChild(checkRow('启用', action.value !== false, v => patch({ value: v }))); break;
        case 'effectApply': {
            box.appendChild(targetEditor(action.target, target => patch({ target }), { label: '施加目标' }));
            // 预设效果（自动填充名称/表情/修正/特殊规则）
            const PRESETS = {
                '': '── 自定义 ──',
                atkUp: '⚔️ 攻击++',
                defUp: '🛡️ 防御++',
                atkDown: '💔 攻击--',
                defDown: '🔻 防御--',
                spdUp: '💨 迅捷',
                spdDown: '🐢 迟缓',
                hpUp: '❤️ 生命上限提升',
                hpDown: '💀 生命上限降低',
                minHp: '🛡️ 锁下限（不会低于 X%）',
                maxHp: '🔒 锁上限（不会高于 X%）',
                godMode: '✨ 无敌'
            };
            const PRESET_VALUES = {
                atkUp: { name: '攻击上升', emoji: '⚔️', desc: '攻击力提高', statMods: { atkPct: '' }, rule: null },
                defUp: { name: '防御上升', emoji: '🛡️', desc: '防御力提高', statMods: { defPct: '' }, rule: null },
                atkDown: { name: '攻击下降', emoji: '⬇️', desc: '攻击力降低', statMods: { atkPct: '' }, rule: null },
                defDown: { name: '防御下降', emoji: '🔻', desc: '防御力降低', statMods: { defPct: '' }, rule: null },
                spdUp: { name: '迅捷', emoji: '⚡', desc: '行动力提高', statMods: { spdFlat: '' }, rule: null },
                spdDown: { name: '迟缓', emoji: '🐢', desc: '行动力降低', statMods: { spdFlat: '' }, rule: null },
                hpUp: { name: '丰饶', emoji: '💚', desc: '生命上限提高', statMods: { hpPct: '' }, rule: null },
                hpDown: { name: '脆弱', emoji: '💔', desc: '生命上限降低', statMods: { hpPct: '' }, rule: null },
                minHp: { name: '不可言说的力量', emoji: '❓', desc: '锁下限', statMods: {}, rule: 'minHp' },
                maxHp: { name: '不可言说的边界', emoji: '🔒', desc: '锁上限', statMods: {}, rule: 'maxHp' },
                godMode: { name: '无敌', emoji: '✨', desc: '免疫所有伤害', statMods: {}, rule: 'godMode' }
            };
            box.appendChild(selectRow('预设效果', action.preset || '', PRESETS, v => {
                const p = PRESET_VALUES[v];
                if (p) patch({ preset: v, name: p.name, emoji: p.emoji, desc: p.desc, statMods: p.statMods, rule: p.rule, ...(p.rule === 'minHp' || p.rule === 'maxHp' ? { rulePercent: 50 } : {}) });
                else patch({ preset: '', name: action.name || '', emoji: action.emoji || '✨', statMods: action.statMods || {}, rule: undefined });
            }));
            box.appendChild(textRow('效果名称', action.name || '', v => patch({ name: v })));
            box.appendChild(textareaRow('效果描述', action.desc || '', v => patch({ desc: v }), 2));
            box.appendChild(textRow('徽章Emoji', action.emoji || '✨', v => patch({ emoji: v || '✨' })));
            box.appendChild(numRow('持续回合(0=永久)', action.duration ?? 0, v => patch({ duration: Math.max(0, Math.round(v)) }), { min: 0, max: 99 }));
            if (action.rule === 'minHp' || action.rule === 'maxHp') {
                box.appendChild(numRow('阈值百分比', action.rulePercent ?? 50, v => patch({ rulePercent: Math.max(1, Math.min(100, Math.round(v))) }), { min: 1, max: 100 }));
            }
            const sec = section('属性修正（留空=不修正）');
            const patchStatMod = (key, value) => {
                const statMods = { ...(action.statMods || {}) };
                if (!Number.isFinite(value) || value === 0) delete statMods[key];
                else statMods[key] = value;
                patch({ statMods, desc: _buildEffectDesc(statMods) || undefined });
            };
            sec.appendChild(numRow('攻击力%', action.statMods?.atkPct ?? '', v => patchStatMod('atkPct', v), { min: -100, max: 500 }));
            sec.appendChild(numRow('攻击力(点)', action.statMods?.atkFlat ?? '', v => patchStatMod('atkFlat', v), { min: -999, max: 999 }));
            sec.appendChild(numRow('防御力%', action.statMods?.defPct ?? '', v => patchStatMod('defPct', v), { min: -100, max: 500 }));
            sec.appendChild(numRow('对近战攻击防御力%', action.statMods?.meleeDefPct ?? '', v => patchStatMod('meleeDefPct', v), { min: -100, max: 500 }));
            sec.appendChild(numRow('对远程攻击防御力%', action.statMods?.rangeDefPct ?? '', v => patchStatMod('rangeDefPct', v), { min: -100, max: 500 }));
            sec.appendChild(numRow('行动力', action.statMods?.spdFlat ?? '', v => patchStatMod('spdFlat', v), { min: -99, max: 99 }));
            sec.appendChild(numRow('生命上限%', action.statMods?.hpPct ?? '', v => patchStatMod('hpPct', v), { min: -100, max: 500 }));
            sec.appendChild(numRow('生命上限(点)', action.statMods?.hpFlat ?? '', v => patchStatMod('hpFlat', v), { min: -999, max: 999 }));
            box.appendChild(sec);
            break;
        }
        case 'relation':
            box.appendChild(selectRow('阵营 A', action.camp || primaryFactionId(), factionLabels(), v => patch({ camp: v })));
            box.appendChild(selectRow('阵营 B', action.targetCamp || nonLocalFactionId(), factionLabels(), v => patch({ targetCamp: v })));
            box.appendChild(selectRow('新关系', action.relation || 'enemy', { ally: '联盟', neutral: '中立', enemy: '敌对' }, v => patch({ relation: v }))); break;
        case 'weather': box.appendChild(selectRow('天气', action.weather || 'clear', WEATHER_LABELS, v => patch({ weather: v }))); break;
        case 'interactionState':
            box.appendChild(selectRow('调查点', action.interactable || '', Object.fromEntries(config.interactables.map(item => [item.id, item.label || item.id])), v => patch({ interactable: v })));
            box.appendChild(selectRow('状态', action.state || 'available', { disabled: '不可用', available: '可调查', completed: '已完成' }, v => patch({ state: v }))); break;
        case 'unitRemove':
            box.appendChild(targetEditor(action.target, target => patch({ target })));
            box.appendChild(selectRow('方式', action.mode || 'despawn', { despawn: '直接离场（不算阵亡）', kill: '处决（触发阵亡）' }, v => patch({ mode: v }))); break;
        case 'scenarioResult':
            box.appendChild(selectRow('结果', action.result || 'win', { win: '胜利', lose: '失败' }, v => patch({ result: v })));
            box.appendChild(textRow('原因/结局标识', action.reason || action.ending || '', v => action.result === 'lose' ? patch({ reason: v }) : patch({ ending: v }))); break;
        case 'mechanicBoolean':
            box.appendChild(selectRow('机制', action.mechanic || MECHANIC_KEYS[0], MECHANIC_LABELS, v => patch({ mechanic: v })));
            box.appendChild(selectRow('状态', action.enabled === false ? 'off' : 'on', { on: '启用', off: '禁用' }, v => patch({ enabled: v === 'on' })));
            box.appendChild(hint('动态修改会立即刷新界面，并由规则层同步拦截或放行。')); break;
        default: break;
    }
    if (meta.note) box.appendChild(hint(meta.note));
    return box;
}

function conditionListEditor(list, onChange, { parentIsAny = false } = {}) {
    const wrap = el('div');
    (list || []).forEach((cond, i) => {
        if (!cond) { console.warn(`[编辑器] 条件 ${i} 为空，已跳过`); return; }
        wrap.appendChild(conditionEditor(cond,
            next => { const arr = list.slice(); arr[i] = next; onChange(arr); },
            () => { const arr = list.slice(); arr.splice(i, 1); onChange(arr); },
            parentIsAny));
    });
    const add = el('button', 'ed-add-btn', '+ 添加条件');
    add.addEventListener('click', () => onChange([...(list || []), { kind: 'timer', ...conditionDefaults('timer') }]));
    wrap.appendChild(add);
    return wrap;
}

function actionListEditor(list, onChange, allowNested = true) {
    const wrap = el('div');
    let dragIndex = -1;
    (list || []).forEach((action, i) => {
        const editor = actionEditor(action,
            next => { const arr = list.slice(); arr[i] = next; onChange(arr); },
            () => { const arr = list.slice(); arr.splice(i, 1); onChange(arr); },
            allowNested);
        editor.draggable = true;
        editor.dataset.index = i;
        editor.addEventListener('dragstart', (e) => { dragIndex = Number(editor.dataset.index); e.dataTransfer.effectAllowed = 'move'; });
        editor.addEventListener('dragover', (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; });
        editor.addEventListener('drop', (e) => {
            e.preventDefault();
            if (dragIndex < 0 || dragIndex === i) return;
            const arr = list.slice();
            const [moved] = arr.splice(dragIndex, 1);
            arr.splice(i, 0, moved);
            onChange(arr);
            dragIndex = -1;
        });
        editor.addEventListener('dragend', () => { dragIndex = -1; });
        wrap.appendChild(editor);
    });
    const add = el('button', 'ed-add-btn', '+ 添加动作（依次执行）');
    add.addEventListener('click', () => onChange([...(list || []), { kind: 'showStep', ...actionDefaults('showStep') }]));
    wrap.appendChild(add);
    return wrap;
}

function buildTriggerInspector(index) {
    const wrap = el('div');
    const trig = config.triggers[index];
    const set = (key) => (v) => mutate(c => { c.triggers[index][key] = v; }, { rebuildPanels: false });

    wrap.appendChild(textRow('触发器 id', trig.id || '', set('id')));
    wrap.appendChild(textRow('列表标题', trig.title || '', set('title'), '给社区作者看的名称，如“第一批增援”'));
    wrap.appendChild(textareaRow('设计备注', trig.note || '', set('note'), 2));
    wrap.appendChild(checkRow('只触发一次', trig.once !== false, set('once')));
    wrap.appendChild(checkRow('开场启用', trig.enabled !== false, set('enabled')));

    const secWhen = section('条件（AND；留空 = 启用即执行）');
    secWhen.appendChild(conditionListEditor(trig.when || [], list => mutate(c => { c.triggers[index].when = list; })));
    wrap.appendChild(secWhen);

    const secDo = section('动作');
    secDo.appendChild(actionListEditor(trig.do || [], list => mutate(c => { c.triggers[index].do = list; })));
    wrap.appendChild(secDo);
    const duplicate = el('button', 'ed-add-btn', '复制该触发器');
    duplicate.addEventListener('click', () => mutate(c => {
        const copy = clone(c.triggers[index]);
        let n = 2; let id = `${copy.id || 'trigger'}-copy`;
        while (c.triggers.some(item => item.id === id)) id = `${copy.id || 'trigger'}-copy-${n++}`;
        copy.id = id; copy.title = copy.title ? `${copy.title}（副本）` : '';
        c.triggers.splice(index + 1, 0, copy); selection = { kind: 'trigger', index: index + 1 };
    }));
    wrap.appendChild(duplicate);
    return wrap;
}

function buildObjectiveInspector(id) {
    const wrap = el('div');
    const obj = config.objectives[id];
    wrap.appendChild(textRow('标题', obj.title, v => mutate(c => { c.objectives[id].title = v; })));
    wrap.appendChild(textareaRow('描述', obj.detail, v => mutate(c => { c.objectives[id].detail = v; }, { rebuildPanels: false }), 3));
    wrap.appendChild(checkRow('开场时显示为“进行中”', obj.active !== false, v => mutate(c => { c.objectives[id].active = v; }, { rebuildPanels: false })));
    wrap.appendChild(checkRow('主要目标', obj.main === true, v => mutate(c => { c.objectives[id].main = v || undefined; }, { rebuildPanels: false })));

    const updateHighlight = (fields) => mutate(c => {
        const current = { ...(c.objectives[id].highlight || {}), ...fields };
        if (!current.unit) delete current.unit;
        if (!current.area) delete current.area;
        if (!current.tiles?.length) delete current.tiles;
        c.objectives[id].highlight = Object.keys(current).length ? current : undefined;
    });
    const highlight = obj.highlight || {};
    const secHighlight = section('任务提示光圈（仅“进行中”时常驻）');
    const unitRow = el('div', 'ed-row');
    unitRow.appendChild(el('label', null, '跟随单位'));
    const unitSelect = el('select');
    for (const [value, label] of Object.entries(unitOptions(true))) unitSelect.appendChild(new Option(label, value));
    unitSelect.value = highlight.unit || '';
    unitSelect.addEventListener('change', () => updateHighlight({ unit: unitSelect.value || undefined }));
    unitRow.appendChild(unitSelect);
    unitRow.appendChild(pickUnitButton(unit => updateHighlight({ unit }), highlight.unit));
    secHighlight.appendChild(unitRow);
    secHighlight.appendChild(tilesPickerRow('指定位置', highlight.tiles || [], tiles => updateHighlight({ tiles: tiles.length ? tiles : undefined })));
    secHighlight.appendChild(areaPickerRow('命名区域', highlight.area || '', area => updateHighlight({ area: area || undefined })));
    secHighlight.appendChild(hint('可单独或组合指定：单位光圈会跟随移动；位置适合少量独立地块；区域适合可复用的一组地块。目标完成、失败或隐藏后自动停止显示。'));
    wrap.appendChild(secHighlight);
    return wrap;
}

function buildMetaInspector() {
    const wrap = el('div');
    const res = config.result;
    const secMechanics = section('开放机制');
    for (const key of MECHANIC_KEYS) {
        secMechanics.appendChild(checkRow(MECHANIC_LABELS[key], config.mechanics[key] !== false,
            value => mutate(c => { c.mechanics[key] = value; }, { rebuildPanels: false })));
    }
    wrap.appendChild(secMechanics);
    wrap.appendChild(checkRow('歼灭敌军即胜', !!res.eliminateEnemy, v => mutate(c => { c.result.eliminateEnemy = v || undefined; }, { rebuildPanels: false })));

    const secStars = section('星级规则（基础 1 星；每满足一条 +1，封顶 3）');
    (res.starRules || []).forEach((rule, i) => {
        const box = card(rule.label || `规则 ${i + 1}`, () => mutate(c => { c.result.starRules.splice(i, 1); }));
        box.appendChild(textRow('说明', rule.label || '', v => mutate(c => { c.result.starRules[i].label = v; }, { rebuildPanels: false })));
        box.appendChild(conditionListEditor(rule.when || [], list => mutate(c => { c.result.starRules[i].when = list; })));
        secStars.appendChild(box);
    });
    const addStar = el('button', 'ed-add-btn', '+ 添加星级规则');
    addStar.addEventListener('click', () => mutate(c => { c.result.starRules.push({ label: '', when: [] }); }));
    secStars.appendChild(addStar);
    wrap.appendChild(secStars);


    const secGroups = section(`单位组（${config.unitGroups.length}）`);
    config.unitGroups.forEach((group, index) => {
        const box = card(group.id || `单位组 ${index + 1}`, () => mutate(c => { c.unitGroups.splice(index, 1); }));
        box.appendChild(textRow('组 ID', group.id, value => mutate(c => { c.unitGroups[index].id = value; })));
        box.appendChild(checkGroup('成员', Object.entries(unitOptions(false)).map(([value, label]) => ({ value, label })), group.unitIds,
            value => mutate(c => { c.unitGroups[index].unitIds = value; })));
        secGroups.appendChild(box);
    });
    const addGroup = el('button', 'ed-add-btn', '+ 新增单位组');
    addGroup.addEventListener('click', () => mutate(c => { c.unitGroups.push({ id: `group${c.unitGroups.length + 1}`, unitIds: [] }); }));
    secGroups.appendChild(addGroup); wrap.appendChild(secGroups);

    const secInteractions = section(`调查点（${config.interactables.length}）`);
    config.interactables.forEach((item, index) => {
        const box = card(item.label || item.id || `调查点 ${index + 1}`, () => mutate(c => { c.interactables.splice(index, 1); }));
        box.appendChild(textRow('调查点 ID', item.id, value => mutate(c => { c.interactables[index].id = value; })));
        box.appendChild(textRow('显示文案', item.label || '', value => mutate(c => { c.interactables[index].label = value; })));
        box.appendChild(coordRow('坐标', item.q, item.r, tile => mutate(c => { c.interactables[index].q = tile.q; c.interactables[index].r = tile.r; })));
        box.appendChild(checkRow('开场可用', item.enabled !== false, value => mutate(c => { c.interactables[index].enabled = value; })));
        box.appendChild(checkRow('一次性触发', item.once !== false, value => mutate(c => { c.interactables[index].once = value; })));
        secInteractions.appendChild(box);
    });
    const addInteraction = el('button', 'ed-add-btn', '+ 新增调查点');
    addInteraction.addEventListener('click', () => mutate(c => { c.interactables.push({ id: `clue${c.interactables.length + 1}`, q: 0, r: 0, label: '调查', enabled: true, once: true }); }));
    secInteractions.appendChild(addInteraction); wrap.appendChild(secInteractions);

    const secVariables = section(`变量（${config.variables.length}）`);
    config.variables.forEach((variable, index) => {
        const box = card(variable.id || `变量 ${index + 1}`, () => mutate(c => { c.variables.splice(index, 1); }));
        box.appendChild(textRow('变量 ID', variable.id, value => mutate(c => { c.variables[index].id = value; })));
        box.appendChild(selectRow('作用域', variable.scope, { level: '本关', campaign: '整部战役' }, value => mutate(c => { c.variables[index].scope = value; })));
        box.appendChild(selectRow('类型', variable.type, { number: '数字', boolean: '是/否', string: '文本' }, value => mutate(c => { c.variables[index].type = value; c.variables[index].initial = value === 'boolean' ? false : value === 'string' ? '' : 0; })));
        if (variable.type === 'boolean') box.appendChild(checkRow('初始值', variable.initial === true, value => mutate(c => { c.variables[index].initial = value; })));
        else if (variable.type === 'number') box.appendChild(numRow('初始值', Number(variable.initial) || 0, value => mutate(c => { c.variables[index].initial = value; })));
        else box.appendChild(textRow('初始值', String(variable.initial || ''), value => mutate(c => { c.variables[index].initial = value; })));
        secVariables.appendChild(box);
    });
    const addVariable = el('button', 'ed-add-btn', '+ 新增变量');
    addVariable.addEventListener('click', () => mutate(c => { c.variables.push({ id: `var${c.variables.length + 1}`, scope: 'level', type: 'number', initial: 0 }); }));
    secVariables.appendChild(addVariable); wrap.appendChild(secVariables);
    return wrap;
}

// ═══════════════════ 导入 / 导出 / 编译 / 测试 ═══════════════════
function runValidation({ silent = false } = {}) {
    const { errors, warnings } = validateLevel(config);
    if (errors.length) {
        setStatus('✗ ' + errors.concat(warnings.map(w => '⚠ ' + w)).join('\n'), 'error');
        return false;
    }
    if (!silent) {
        setStatus(warnings.length ? warnings.map(w => '⚠ ' + w).join('\n') : '✓ 编译通过', warnings.length ? '' : 'ok');
    }
    return true;
}

function exportLevel() {
    if (!runValidation()) return;
    // 调用浏览器下载 API 存到本地
    const json = JSON.stringify(config, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${config.id || 'level'}.level.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setStatus(`✓ 已导出 ${a.download}`, 'ok');
}

function importLevel(file) {
    const reader = new FileReader();
    reader.onload = () => {
        try {
            const raw = JSON.parse(reader.result);
            pushUndo();
            config = normalizeLevel(raw);
            selection = null;
            unitSeq = 1;
            refreshAll(`✓ 已导入 ${file.name}`);
            runValidation({ silent: true });
        } catch (err) {
            setStatus(`✗ 导入失败：${err.message}`, 'error');
        }
    };
    reader.readAsText(file);
}

function newLevel() {
    if (!confirm('新建空白关卡？当前未导出的修改将丢失。')) return;
    config = createDefaultLevel();
    selection = null;
    undoStack.length = 0;
    redoStack.length = 0;
    unitSeq = 1;
    refreshAll('已新建空白关卡');
}

function playtest() {
    if (!runValidation()) return;
    callbacks.onPlaytest?.(clone(config));
}

// ═══════════════════ 生命周期 ═══════════════════
function refreshAll(statusText) {
    rebuildPreview();
    syncTitleInput();
    renderToolPanel();
    renderInspector();
    render();
    if (statusText) setStatus(statusText);
}

function syncTitleInput() {
    const input = $id('editorLevelTitle');
    if (input) input.value = config.title || '';
}

function onKeyDown(e) {
    if ($id('editorOverlay')?.style.display === 'none') return;
    // 输入框聚焦时不劫持快捷键
    const tag = document.activeElement?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'z') { e.preventDefault(); undo(); }
    else if ((e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === 'y' || (e.shiftKey && e.key.toLowerCase() === 'z'))) { e.preventDefault(); redo(); }
}

export function initEditor(cbs = {}) {
    callbacks = { ...callbacks, ...cbs };
    if (initialized) return;
    initialized = true;

    canvas = $id('editorCanvas');
    ctx = canvas.getContext('2d');
    // 与主游戏画布一致：按 devicePixelRatio 缩放宽高，保证 Retina 屏不模糊
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = EDITOR_LOGICAL_W * dpr;
    canvas.height = EDITOR_LOGICAL_H * dpr;
    canvas.style.width = EDITOR_LOGICAL_W + 'px';
    canvas.style.height = EDITOR_LOGICAL_H + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerup', onPointerUp);
    canvas.addEventListener('pointerleave', () => { hoverTile = null; onPointerUp(); render(); });

    for (const tab of document.querySelectorAll('.editor-tab')) {
        tab.addEventListener('click', () => {
            activeTab = tab.dataset.tab;
            document.querySelectorAll('.editor-tab').forEach(t => t.classList.toggle('active', t === tab));
            selection = null;
            if (pendingPick) { clearPickBar(); pendingPick = null; }
            renderToolPanel();
            renderInspector();
            render();
        });
    }

    $id('editorLevelTitle').addEventListener('change', () => {
        mutate(c => { c.title = $id('editorLevelTitle').value.trim(); }, { rebuildPanels: false });
    });
    $id('editorNewBtn').addEventListener('click', newLevel);
    $id('editorExportBtn').addEventListener('click', exportLevel);
    $id('editorValidateBtn').addEventListener('click', () => runValidation());
    $id('editorPlaytestBtn').addEventListener('click', playtest);
    $id('editorImportBtn').addEventListener('click', () => $id('editorImportInput').click());
    $id('editorImportInput').addEventListener('change', (e) => {
        const file = e.target.files?.[0];
        if (file) importLevel(file);
        e.target.value = '';
    });
    $id('editorBackBtn').addEventListener('click', () => { closeEditor(); callbacks.onBack?.(); });

    document.addEventListener('keydown', onKeyDown);
}

export function openEditor() {
    $id('editorOverlay').style.display = '';
    refreshAll('就绪 按下 Ctrl+Z 撤销上一个操作');
}

export function closeEditor() {
    $id('editorOverlay').style.display = 'none';
}

/** 测试返回时恢复编辑器（保留当前配置与选中状态）。 */
export function reopenEditorAfterPlaytest() {
    $id('editorOverlay').style.display = '';
    refreshAll('测试结束，已返回编辑器');
}
