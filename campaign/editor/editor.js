// 战役编辑器主控制器 —— 所见即所得关卡编辑。
// 数据源是一份 level 配置（schema.js 定义），一切编辑都是对配置的修改；
// 画布只是配置经 mapBuilder 重建后的预览。导出即下载该配置 JSON。
import { HEX_SIZE, hexPath, drawHexagonOutline, CAMP_FLAG_COLORS } from '../../js/config.js';
import { drawAllBorders, drawCampBorders, drawDistrictBorders } from '../../js/HexTile.js';
import {
    createDefaultLevel, normalizeLevel, validateLevel, boardContains,
    CAMP_KEYS, CAMP_LABELS, UNIT_TYPES, UNIT_LABELS,
    COMMANDER_IDS, COMMANDER_LABELS, TERRAIN_LABELS,
    FORTIFICATION_KEYS, FORTIFICATION_LABELS, WEATHER_LABELS,
    CARD_IDS, CARD_LABELS,
    MECHANIC_KEYS, MECHANIC_LABELS, RELATION_KEYS, OBJECTIVE_STATUS_KEYS,
    TRIGGER_CONDITIONS, TRIGGER_ACTIONS,
    BOARD_RADIUS_MIN, BOARD_RADIUS_MAX
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
let selection = null;              // {kind:'tile',q,r} | {kind:'unit',index} | {kind:'step',id} | {kind:'trigger',index} | {kind:'objective',id} | {kind:'optional',index} | {kind:'result'}
let hoverTile = null;
let painting = false;
let lastPaintKey = '';
let unitSeq = 1;
let callbacks = { onPlaytest: null, onBack: null };
let initialized = false;
let showCoords = false;
let pendingPick = null; // { mode:'tile'|'tiles', callback, picked:Set, label }
let pendingHighlight = null; // { q, r } | [{q,r}] | Set — 鼠标悬停图钉时高亮

const LEGACY_CONDITION_KINDS = new Set(['unitAlive', 'unitDead', 'cityOwnedBy', 'flagSet', 'flagUnset', 'turnAtLeast']);
const LEGACY_ACTION_KINDS = new Set(['setObjective', 'setOptional', 'setFlag', 'clearFlag', 'win', 'fail']);
function authorConditions(current = '') { return TRIGGER_CONDITIONS.filter(item => !LEGACY_CONDITION_KINDS.has(item.kind) || item.kind === current); }
function authorActions(current = '') { return TRIGGER_ACTIONS.filter(item => !LEGACY_ACTION_KINDS.has(item.kind) || item.kind === current); }

const FACTION_COLORS = [
    { value: '#e05050', label: '红' }, { value: '#f09a40', label: '橙' },
    { value: '#edd43c', label: '黄' }, { value: '#5cbf5c', label: '绿' },
    { value: '#40b8b8', label: '青' }, { value: '#5090e0', label: '蓝' },
    { value: '#b070e0', label: '紫' }, { value: '#666666', label: '深灰' },
    { value: '#dddddd', label: '白' }
];

const boardTool = { mode: 'terrain', terrain: 'forest', camp: 'player1', districtId: 1, fortification: 'trench', cityType: 'city', erase: { terrain: true, city: true, village: true, fortification: true, district: true, unit: true } };
const unitTemplate = { type: 'infantry', camp: 'player1', commander: '', hpPct: 100, morale: 2, canAct: true };

const undoStack = [];
const redoStack = [];
const UNDO_LIMIT = 60;

// ── 小工具 ──────────────────────────────────────────────────
const $id = (id) => document.getElementById(id);
const clone = (obj) => JSON.parse(JSON.stringify(obj));
const tileKey = (q, r) => `${q},${r}`;

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
    if (pendingPick) {
        for (const key of (pendingPick.picked || [])) {
            const t = preview.tileMap.get(key);
            if (t) drawHexagonOutline(ctx, t.x, t.y, HEX_SIZE, 'rgba(255,200,50,0.8)', 2.8);
        }
        if (hoverTile) drawHexagonOutline(ctx, hoverTile.x, hoverTile.y, HEX_SIZE, 'rgba(255,255,255,0.8)', 2);
    } else {
        if (hoverTile) drawHexagonOutline(ctx, hoverTile.x, hoverTile.y, HEX_SIZE, 'rgba(255,255,255,0.55)', 1.6);
    }
    // 悬停图钉时回显已存坐标
    if (pendingHighlight) {
        for (const key of (pendingHighlight.tiles || [pendingHighlight])) {
            const t = preview.tileMap.get(typeof key === 'string' ? key : tileKey(key.q, key.r));
            if (t) drawHexagonOutline(ctx, t.x, t.y, HEX_SIZE, 'rgba(100,200,255,0.7)', 2.4);
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
    const campKey = unit.camp === 'player1' ? 'p1' : unit.camp === 'player2' ? 'p2' : unit.camp === 'player3' ? 'p3' : 'neu';
    const fc = CAMP_FLAG_COLORS[campKey];
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
    if (unit.commander) {
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
            hintEl.textContent = '📌 点击棋盘上的目标地块（单击即确认）';
        } else {
            hintEl.textContent = `📌 ${pendingPick.label || '涂抹选择区域'} — 已选 ${pendingPick.picked.size} 格，点「✓ 确认」完成`;
        }
        return;
    }
    if (!tile) { hintEl.textContent = ''; return; }
    const unit = unitsByCoord().get(tileKey(tile.q, tile.r))?.unit;
    const parts = [
        `(${tile.q}, ${tile.r})`,
        `区${tile.districtId}`,
        CAMP_LABELS[campKeyOfTile(tile)] || '',
        TERRAIN_LABELS[tile.terrain] || '',
        tile.isCity ? '城市' : '',
        tile.isVillage ? '村庄' : '',
        tile.fortification ? FORTIFICATION_LABELS[tile.fortification] : '',
        unit ? `单位:${UNIT_LABELS[unit.type]}${unit.commander ? '·' + COMMANDER_LABELS[unit.commander] : ''}(${unit.id})` : ''
    ].filter(Boolean);
    hintEl.textContent = parts.join('　');
}

function campKeyOfTile(tile) {
    // preview tile.camp 是 CAMP 对象；用名字反查 key
    for (const key of CAMP_KEYS) {
        if (CAMP_LABELS[key] === tile.camp?.name) return key;
    }
    return 'neutral';
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
        secParam.appendChild(selectRow('阵营', boardTool.camp, CAMP_LABELS, v => { boardTool.camp = v; }));
    }
    if (boardTool.mode === 'city' || boardTool.mode === 'district') {
        secParam.appendChild(numRow('行政区号', boardTool.districtId, v => { boardTool.districtId = Math.max(0, Math.round(v)); }, { min: 0, max: 99, step: 1 }));
    }
    if (boardTool.mode === 'erase') {
        const opt = boardTool.erase;
        const toggle = (key) => (v) => { opt[key] = v; renderToolPanel(); };
        secParam.appendChild(checkRow('擦除地形', opt.terrain, toggle('terrain')));
        secParam.appendChild(checkRow('擦除城市', opt.city, toggle('city')));
        secParam.appendChild(checkRow('擦除村庄', opt.village, toggle('village')));
        secParam.appendChild(checkRow('擦除工事', opt.fortification, toggle('fortification')));
        secParam.appendChild(checkRow('擦除区划范围', opt.district, toggle('district')));
        secParam.appendChild(checkRow('擦除单位', opt.unit, toggle('unit')));
    }
    if (secParam.childElementCount > 1) wrap.appendChild(secParam);

    wrap.appendChild(hint(
        boardTool.mode === 'city' ? '放置/更新城市或村庄（由笔刷类型决定）。城市是该行政区的颜色来源——全区划的阵营颜色永远跟随城市阵营，改阵营直接在此重涂即可，删除请用橡皮擦。'
        : boardTool.mode === 'erase' ? '勾选下方要清除的内容类型后点击地块即可定向擦除。'
        : boardTool.mode === 'district' ? '涂区划范围：把地块划入指定行政区号（默认由最近城市决定）。地块本身不会因此变色，颜色仍由该行政区的城市决定；若该行政区没有城市，会显示为中立。'
        : '点击或拖动在棋盘上绘制。'));
    return wrap;
}

function buildUnitTools() {
    const wrap = el('div');
    const sec = section('单位模板（点击空格放置）');
    sec.appendChild(selectRow('兵种', unitTemplate.type, UNIT_LABELS, v => { unitTemplate.type = v; }));
    sec.appendChild(selectRow('阵营', unitTemplate.camp, CAMP_LABELS, v => { unitTemplate.camp = v; }));
    sec.appendChild(selectRow('将领', unitTemplate.commander, { '': '（无）', ...COMMANDER_LABELS }, v => { unitTemplate.commander = v; }));
    sec.appendChild(numRow('生命%', unitTemplate.hpPct, v => { unitTemplate.hpPct = Math.max(1, Math.min(100, Math.round(v))); }, { min: 1, max: 100 }));
    sec.appendChild(selectRow('士气', String(unitTemplate.morale), { 3: '上升', 2: '正常', 1: '下降', 0: '混乱' }, v => { unitTemplate.morale = Number(v); }));
    sec.appendChild(checkRow('本回合可行动', unitTemplate.canAct, v => { unitTemplate.canAct = v; }));
    wrap.appendChild(sec);

    const secList = section(`已放置单位（${config.units.length}）`);
    secList.appendChild(itemList({
        items: config.units.map((u, i) => ({
            key: String(i),
            label: `${u.id} · ${CAMP_LABELS[u.camp]}${UNIT_LABELS[u.type]}${u.commander ? '·' + COMMANDER_LABELS[u.commander] : ''} (${u.q},${u.r})`
        })),
        activeKey: selection?.kind === 'unit' ? String(selection.index) : null,
        onSelect: (key) => { selection = { kind: 'unit', index: Number(key) }; renderToolPanel(); renderInspector(); render(); },
        onDelete: (key) => mutate(c => {
            c.units.splice(Number(key), 1);
            if (selection?.kind === 'unit') selection = null;
        })
    }));
    wrap.appendChild(secList);
    wrap.appendChild(hint('点击画布空格放置模板单位；点击已有单位选中并在右侧编辑。'));
    return wrap;
}

function buildStoryList() {
    const wrap = el('div');
    const ids = Object.keys(config.steps);

    const secInit = section('初始步骤');
    secInit.appendChild(selectRow('开场', config.initialStep, { '': '（无）', ...Object.fromEntries(ids.map(id => [id, id])) },
        v => mutate(c => { c.initialStep = v; }, { rebuildPanels: false })));
    wrap.appendChild(secInit);

    const secSteps = section(`剧情步骤（${ids.length}）`);
    secSteps.appendChild(itemList({
        items: ids.map(id => {
            const s = config.steps[id];
            return { key: id, label: `${id} · ${s.mode === 'character' ? '台词' : '旁白'}${s.next ? '' : '（等待）'}` };
        }),
        activeKey: selection?.kind === 'step' ? selection.id : null,
        onSelect: (id) => { selection = { kind: 'step', id }; renderToolPanel(); renderInspector(); },
        onDelete: (id) => mutate(c => {
            delete c.steps[id];
            if (c.initialStep === id) c.initialStep = '';
            if (selection?.kind === 'step' && selection.id === id) selection = null;
        }),
        addLabel: '+ 新增步骤',
        onAdd: () => mutate(c => {
            let n = 1;
            while (c.steps[`step${n}`]) n++;
            c.steps[`step${n}`] = { mode: 'narrator', text: '', next: null };
            selection = { kind: 'step', id: `step${n}` };
            if (!c.initialStep) c.initialStep = `step${n}`;
        })
    }));
    wrap.appendChild(secSteps);
    wrap.appendChild(hint('步骤统一使用「下一步」按钮推进：填了跳转目标就显示按钮；留空则等待触发器推进（可配输入白名单）。'));
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
    const secPlayer = section('玩家视角');
    secPlayer.appendChild(selectRow('所属阵营', config.localPlayerCamp, factionOpts,
        value => mutate(c => { c.localPlayerCamp = value; }, { rebuildPanels: false })));
    wrap.appendChild(secPlayer);

    const secFactions = section('阵营');
    config.factions.forEach((faction, idx) => {
        const delBtn = idx > 0 ? (() => mutate(c => { c.factions.splice(idx, 1); }, { rebuildPanels: true })) : null;
        const box = card(faction.name || faction.id, delBtn);
        box.appendChild(textRow('id', faction.id, value => mutate(c => { c.factions[idx].id = value; }, { rebuildPanels: false })));
        box.appendChild(textRow('显示名', faction.name || faction.id, value => mutate(c => { c.factions[idx].name = value; }, { rebuildPanels: false })));
        box.appendChild(selectRow('颜色', faction.color, Object.fromEntries(FACTION_COLORS.map(c => [c.value, c.label])),
            value => mutate(c => { c.factions[idx].color = value; }, { rebuildPanels: false })));
        box.appendChild(selectRow('控制方式', faction.controller || 'ai', { human: '玩家', ai: 'AI', scripted: '剧情控制' },
            value => mutate(c => { c.factions[idx].controller = value; }, { rebuildPanels: false })));
        box.appendChild(checkRow('参与回合', faction.participatesInTurns !== false,
            value => mutate(c => { c.factions[idx].participatesInTurns = value; }, { rebuildPanels: false })));
        box.appendChild(checkRow('本关启用', faction.active !== false,
            value => mutate(c => { c.factions[idx].active = value; }, { rebuildPanels: false })));
        secFactions.appendChild(box);
    });
    const addFaction = el('button', 'ed-add-btn', '+ 新增阵营');
    addFaction.addEventListener('click', () => mutate(c => {
        let n = c.factions.length;
        while (c.factions.some(f => f.id === `player${n}`)) n++;
        c.factions.push({ id: `player${n}`, name: `新阵营${n}`, color: FACTION_COLORS[(n - 1) % FACTION_COLORS.length].value, controller: 'ai', participatesInTurns: true, active: true });
    }, { rebuildPanels: true }));
    secFactions.appendChild(addFaction);
    wrap.appendChild(secFactions);

    // 外交关系：仅列出启用的阵营对
    const activeFactions = config.factions.filter(f => f.active !== false);
    const secDiplomacy = section('初始外交关系（双向）');
    secDiplomacy.appendChild(hint('只编辑每对阵营一次；运行时自动双向生效。不同玩家阵营默认敌对。'));
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
    activeFactions.forEach(f => {
        secGold.appendChild(numRow(f.name, config.gold[f.id] ?? 4, v => mutate(c => { c.gold[f.id] = Math.max(0, Math.round(v)); }, { rebuildPanels: false }), { min: 0, max: 99 }));
    });
    wrap.appendChild(secGold);

    const secCmd = section('阵营主将（HUD/技能条）');
    activeFactions.filter(f => f.id !== 'neutral').forEach(f => {
        secCmd.appendChild(selectRow(f.name, config.commanders[f.id] || '', { '': '（无，或由单位自动补全）', ...COMMANDER_LABELS },
            v => mutate(c => { c.commanders[f.id] = v || null; }, { rebuildPanels: false })));
    });
    wrap.appendChild(secCmd);

    const secHands = section('初始手牌');
    activeFactions.filter(f => f.id !== 'neutral').forEach(f => {
        secHands.appendChild(checkGroup(f.name, CARD_IDS.map(id => ({ value: id, label: CARD_LABELS[id] })), config.hands[f.id] || [],
            v => mutate(c => { c.hands[f.id] = v; }, { rebuildPanels: false })));
    });
    wrap.appendChild(secHands);

    return wrap;
}

function buildMetaBasics() {
    const wrap = el('div');
    const secId = section('关卡标识');
    secId.appendChild(textRow('关卡 id', config.id, v => mutate(c => { c.id = v; }, { rebuildPanels: false }), '如 i1-2'));
    secId.appendChild(textRow('关卡名称', config.title, v => mutate(c => { c.title = v; }, { rebuildPanels: false })));
    secId.appendChild(textRow('传记名称', config.chronicleId, v => mutate(c => { c.chronicleId = v; }, { rebuildPanels: false })));
    secId.appendChild(textRow('章节标题', config.intro.chapterTitle || '', v => mutate(c => { c.intro.chapterTitle = v; }, { rebuildPanels: false }), '如 暮雨孤城'));
    secId.appendChild(numRow('随机种子', config.seed, v => mutate(c => { c.seed = Math.round(v); }, { rebuildPanels: false })));
    secId.appendChild(numRow('回合上限', config.turnLimit, v => mutate(c => { c.turnLimit = Math.max(0, Math.round(v)); }, { rebuildPanels: false }), { min: 0, max: 99 }));
    wrap.appendChild(secId);

    const secEnv = section('环境');
    secEnv.appendChild(selectRow('天气', config.weather, WEATHER_LABELS, v => mutate(c => { c.weather = v; }, { rebuildPanels: false })));
    secEnv.appendChild(selectRow('AI 阵营', config.aiOpponentCamp, { player1: '红军', player2: '蓝军' }, v => mutate(c => { c.aiOpponentCamp = v; }, { rebuildPanels: false })));
    secEnv.appendChild(numRow('AI 难度', config.aiDifficulty, v => mutate(c => { c.aiDifficulty = Math.max(0.1, v); }, { rebuildPanels: false }), { min: 0.1, max: 3, step: 0.1 }));
    wrap.appendChild(secEnv);

    wrap.appendChild(hint('章节标题、调查点与变量在右侧检查器中设置。'));
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
    if (selection?.kind === 'step' && config.steps[selection.id]) {
        title.textContent = `步骤 · ${selection.id}`;
        body.appendChild(buildStepInspector(selection.id));
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
    wrap.appendChild(hint(`行政区 ${tile.districtId} · ${CAMP_LABELS[campKeyOfTile(tile)]} · ${TERRAIN_LABELS[tile.terrain]}`
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
    wrap.appendChild(selectRow('阵营', u.camp, CAMP_LABELS, set('camp')));
    wrap.appendChild(selectRow('将领', u.commander || '', { '': '（无）', ...COMMANDER_LABELS }, v => mutate(c => { c.units[index].commander = v || null; })));
    wrap.appendChild(numRow('生命%', u.hpPct ?? 100, v => mutate(c => { c.units[index].hpPct = Math.max(1, Math.min(100, Math.round(v))); }), { min: 1, max: 100 }));
    wrap.appendChild(selectRow('士气', String(u.morale ?? 2), { 3: '上升', 2: '正常', 1: '下降', 0: '混乱' }, v => mutate(c => { c.units[index].morale = Number(v); })));
    wrap.appendChild(checkRow('本回合可行动', u.canAct !== false, set('canAct')));
    wrap.appendChild(coordRow('坐标', u.q, u.r, tile => mutate(c => { c.units[index].q = tile.q; c.units[index].r = tile.r; })));
    const del = el('button', 'ed-add-btn', '🗑 删除该单位');
    del.addEventListener('click', () => mutate(c => { c.units.splice(index, 1); selection = null; }));
    wrap.appendChild(del);
    wrap.appendChild(hint('单位 id 供剧情/触发器引用（目标环、存活判定、白名单）。'));
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
    const btn = el('button', 'ed-pick-btn', '📌');
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
    const btn = el('button', 'ed-pick-btn', '📌');
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
    const opts = Object.fromEntries(config.units.map(u => [u.id, `${u.id}（${CAMP_LABELS[u.camp]}${UNIT_LABELS[u.type]}）`]));
    return includeEmpty ? { '': '（无）', ...opts } : opts;
}

function buildStepInspector(stepId) {
    const wrap = el('div');
    const step = config.steps[stepId];
    const set = (key) => (v) => mutate(c => { c.steps[stepId][key] = v; }, { rebuildPanels: false });

    wrap.appendChild(textRow('步骤 id', stepId, v => {
        if (!v || v === stepId) return;
        if (config.steps[v]) { setStatus(`步骤 id「${v}」已存在`, 'error'); renderInspector(); return; }
        mutate(c => {
            c.steps[v] = c.steps[stepId];
            delete c.steps[stepId];
            if (c.initialStep === stepId) c.initialStep = v;
            for (const s of Object.values(c.steps)) if (s.next === stepId) s.next = v;
            selection = { kind: 'step', id: v };
        });
    }));
    wrap.appendChild(selectRow('类型', step.mode, { narrator: '旁白', character: '台词' }, v => mutate(c => {
        c.steps[stepId].mode = v;
        if (v === 'character' && !c.steps[stepId].speaker) c.steps[stepId].speaker = { name: '', portrait: '' };
    })));
    if (step.mode === 'character') {
        wrap.appendChild(textRow('说话人', step.speaker?.name || '', v => mutate(c => {
            c.steps[stepId].speaker = { ...(c.steps[stepId].speaker || {}), name: v };
        }, { rebuildPanels: false })));
        wrap.appendChild(selectRow('立绘', step.speaker?.portrait || '', { '': '（无）', ...Object.fromEntries(Object.values(COMMANDER_LABELS).map(n => [n, n])) },
            v => mutate(c => { c.steps[stepId].speaker = { ...(c.steps[stepId].speaker || {}), portrait: v }; }, { rebuildPanels: false })));
    }
    wrap.appendChild(textareaRow('文本', step.text, set('text'), 4));
    wrap.appendChild(selectRow('下一步', step.next || '', { '': '（等待触发器）', ...stepOptions(false), '__custom__': '自定义跳转值…' }, v => {
        if (v === '__custom__') {
            const custom = prompt('输入自定义跳转值（供触发器「点击按钮」事件匹配，建议 __ 前缀）', step.next || '__');
            if (custom != null) mutate(c => { c.steps[stepId].next = custom || null; });
            else renderInspector();
            return;
        }
        mutate(c => { c.steps[stepId].next = v || null; });
    }));

    // 目标环
    const targetUnit = typeof step.target === 'string' ? step.target : '';
    const targetCoord = step.target && typeof step.target === 'object' ? step.target : null;
    wrap.appendChild(selectRow('目标环·单位', targetUnit, unitOptions(), v => mutate(c => {
        if (v) c.steps[stepId].target = v;
        else if (typeof c.steps[stepId].target === 'string') delete c.steps[stepId].target;
    }, { rebuildPanels: false })));
    if (targetCoord) {
        wrap.appendChild(coordRow('目标环·坐标', targetCoord.q, targetCoord.r, tile => mutate(c => {
            c.steps[stepId].target = tile;
        }, { rebuildPanels: false })));
    } else {
        wrap.appendChild(coordRow('目标环·坐标', 0, 0, tile => mutate(c => {
            c.steps[stepId].target = tile;
        }, { rebuildPanels: false })));
    }

    // 输入白名单（等待步骤时的引导锁）
    const allow = step.allow || {};
    const secAllow = section('输入白名单（留空=不限制）');
    secAllow.appendChild(hint('等待步骤显示时，玩家只能点击白名单内的对象；对白步骤无需设置。'));
    const setAllow = (key, list) => mutate(c => {
        const a = { ...(c.steps[stepId].allow || {}) };
        if (list && list.length) a[key] = list; else delete a[key];
        if (Object.keys(a).length) c.steps[stepId].allow = a; else delete c.steps[stepId].allow;
    }, { rebuildPanels: false });
    secAllow.appendChild(checkGroup('可点单位', Object.entries(unitOptions(false)).map(([value, label]) => ({ value, label })), allow.units, v => setAllow('units', v)));
    const tileRow = el('div', 'ed-row');
    tileRow.appendChild(el('label', null, '可点坐标'));
    tileRow.appendChild(pickTilesButton(allow.tiles || [], list => setAllow('tiles', list)));
    const coordLabel = el('span', null, (allow.tiles || []).length ? `${allow.tiles.length} 格已选` : '未选择');
    coordLabel.style.cssText = 'color:rgba(255,255,255,0.5);font-size:12px;margin-left:6px;';
    tileRow.appendChild(coordLabel);
    // 更新标签的 hack
    const origPush = Array.prototype.push;
    secAllow.appendChild(tileRow);
    secAllow.appendChild(checkGroup('可用卡牌', CARD_IDS.map(id => ({ value: id, label: CARD_LABELS[id] })), allow.cards, v => setAllow('cards', v)));
    secAllow.appendChild(textRow('可用技能', (allow.actions || []).join('; '), v => setAllow('actions', v.split(/[;；]/).map(s => s.trim()).filter(Boolean)), '如 commander:'));
    secAllow.appendChild(textRow('提示语', allow.hint || '', v => mutate(c => {
        const a = { ...(c.steps[stepId].allow || {}) };
        if (v) a.hint = v; else delete a.hint;
        if (Object.keys(a).length) c.steps[stepId].allow = a; else delete c.steps[stepId].allow;
    }, { rebuildPanels: false }), '误点时显示'));
    wrap.appendChild(secAllow);
    return wrap;
}

// ── 触发器条件/动作编辑 ──
// 切换类型时预置默认参数，防止“新建即空参永不生效”。
function conditionDefaults(kind) {
    switch (kind) {
        case 'eventCardIs': return { value: CARD_IDS[0] };
        case 'eventCampIs': return { value: 'player1' };
        case 'cityOwnedBy': return { q: 0, r: 0, camp: 'player1' };
        case 'turnAtLeast': return { value: 1 };
        case 'stepIs': return { value: Object.keys(config.steps)[0] || '' };
        case 'eventUnitIs': case 'unitAlive': case 'unitDead': return { unit: config.units[0]?.id || '' };
        case 'unitExists': return { unit: config.units[0]?.id || '', alive: true };
        case 'unitHpCompare': return { unit: config.units[0]?.id || '', mode: 'percent', op: '<=', value: 50 };
        case 'factionUnitCount': return { camp: 'player2', op: '<=', value: 0 };
        case 'tileOwnedBy': return { q: 0, r: 0, camp: 'player1' };
        case 'relationIs': return { camp: 'player1', targetCamp: 'player2', relation: 'enemy' };
        case 'weatherIs': return { weather: 'clear' };
        case 'objectiveStatusIs': return { objective: Object.keys(config.objectives)[0] || '', status: 'active' };
        case 'interactionStateIs': return { interactable: config.interactables[0]?.id || '', state: 'available' };
        case 'groupState': return { group: config.unitGroups[0]?.id || '', state: 'anyAlive' };
        case 'unitsInArea': return { area: config.areas[0]?.id || '', camp: '', op: '>=', value: 1 };
        case 'eventTileIs': return { q: 0, r: 0 };
        case 'eventInteractionIs': return { interactable: config.interactables[0]?.id || '' };
        case 'mechanicEnabled': return { mechanic: MECHANIC_KEYS[0], enabled: true };
        case 'any': return { conditions: [{ kind: 'stepIs', ...conditionDefaults('stepIs') }] };
        case 'compare': return { left: { source: 'round' }, op: '>=', right: { source: 'constant', value: 1 } };
        default: return { value: '' };
    }
}
function actionDefaults(kind) {
    switch (kind) {
        case 'showStep': return { step: Object.keys(config.steps)[0] || '' };
        case 'setObjective': return { objective: Object.keys(config.objectives)[0] || '' };
        case 'setOptional': return { id: config.optionalObjectives[0]?.id || '' };
        case 'spawnUnits': return { units: [] };
        case 'delay': return { ms: 1000, then: [] };
        case 'log': case 'fail': return { text: '' };
        case 'setFlag': case 'clearFlag': case 'setPhase': return { value: '' };
        case 'setVariable': return { variable: config.variables[0]?.id || '', operation: 'set', value: 0 };
        case 'setTriggerEnabled': return { trigger: config.triggers[0]?.id || '', enabled: true };
        case 'emitSignal': return { value: '' };
        case 'setObjectiveStatus': return { objective: Object.keys(config.objectives)[0] || '', status: 'active' };
        case 'changeGold': return { camp: 'player1', operation: 'add', value: 1 };
        case 'changeUnitHp': return { target: { unit: config.units[0]?.id || '' }, operation: 'subtract', mode: 'value', value: 1 };
        case 'changeUnitFaction': return { target: { unit: config.units[0]?.id || '' }, camp: 'player1' };
        case 'setUnitState': return { target: { unit: config.units[0]?.id || '' }, state: 'canAct', value: true };
        case 'setUnitDefeatRule': return { target: { unit: config.units[0]?.id || '' }, minHp: 1, nonLethal: true };
        case 'setDiplomacy': return { camp: 'player1', targetCamp: 'player2', relation: 'enemy' };
        case 'setWeather': return { weather: 'clear' };
        case 'setInteractionState': return { interactable: config.interactables[0]?.id || '', state: 'available' };
        case 'removeUnits': return { target: { unit: config.units[0]?.id || '' }, mode: 'despawn' };
        case 'endScenario': return { result: 'win', reason: '' };
        case 'setMechanicEnabled': return { mechanic: MECHANIC_KEYS[0], enabled: true };
        default: return {};
    }
}

function conditionEditor(cond, onChange, onRemove, parentIsAny = false) {
    const meta = TRIGGER_CONDITIONS.find(c => c.kind === cond.kind) || TRIGGER_CONDITIONS[0];
    const box = card(meta.label, onRemove);
    const conditionKinds = authorConditions(cond.kind).filter(c => !parentIsAny || c.kind !== 'any');
    box.appendChild(selectRow('条件', cond.kind, Object.fromEntries(conditionKinds.map(c => [c.kind, c.label])), v => {
        onChange({ kind: v, ...conditionDefaults(v) });
    }));
    const patch = (fields) => onChange({ ...cond, ...fields });
    switch (meta.arg) {
        case 'step':
            box.appendChild(selectRow('步骤', cond.value || '', stepOptions(true), v => patch({ value: v }))); break;
        case 'unitRef':
            box.appendChild(selectRow('单位', cond.unit || '', unitOptions(), v => patch({ unit: v }))); break;
        case 'card':
            box.appendChild(selectRow('卡牌', cond.value || CARD_IDS[0], CARD_LABELS, v => patch({ value: v }))); break;
        case 'camp':
            box.appendChild(selectRow('阵营', cond.value || 'player1', CAMP_LABELS, v => patch({ value: v }))); break;
        case 'cityOwner':
            box.appendChild(coordRow('坐标', cond.q ?? 0, cond.r ?? 0, tile => patch(tile)));
            box.appendChild(selectRow('归属', cond.camp || 'player1', CAMP_LABELS, v => patch({ camp: v })));
            break;
        case 'number':
            box.appendChild(numRow('数值', cond.value ?? 1, v => patch({ value: Math.round(v) }))); break;
        case 'text':
            box.appendChild(textRow('值', cond.value || '', v => patch({ value: v }))); break;
        case 'conditionGroup':
            box.appendChild(conditionListEditor(cond.conditions || [], conditions => patch({ conditions }))); break;
        case 'conditionSingle':
            box.appendChild(conditionEditor(cond.condition || { kind: 'stepIs', ...conditionDefaults('stepIs') }, condition => patch({ condition }), null)); break;
        case 'unitExists':
            box.appendChild(selectRow('单位', cond.unit || '', unitOptions(), v => patch({ unit: v })));
            box.appendChild(selectRow('要求', cond.alive === false ? 'dead' : 'alive', { alive: '仍在场', dead: '已阵亡/不存在' }, v => patch({ alive: v === 'alive' }))); break;
        case 'unitHpCompare':
            box.appendChild(selectRow('单位', cond.unit || '', unitOptions(), v => patch({ unit: v })));
            box.appendChild(selectRow('数值类型', cond.mode || 'percent', { percent: '生命百分比', value: '生命点数' }, v => patch({ mode: v })));
            box.appendChild(selectRow('比较', cond.op || '<=', { '<': '小于', '<=': '小于等于', '==': '等于', '>=': '大于等于', '>': '大于' }, v => patch({ op: v })));
            box.appendChild(numRow('数值', cond.value ?? 50, v => patch({ value: v }))); break;
        case 'campCompare':
            box.appendChild(selectRow('阵营', cond.camp || 'player2', CAMP_LABELS, v => patch({ camp: v })));
            box.appendChild(selectRow('比较', cond.op || '<=', { '<=': '不多于', '==': '正好', '>=': '不少于' }, v => patch({ op: v })));
            box.appendChild(numRow('单位数', cond.value ?? 0, v => patch({ value: Math.max(0, Math.round(v)) }))); break;
        case 'relation':
            box.appendChild(selectRow('阵营 A', cond.camp || 'player1', CAMP_LABELS, v => patch({ camp: v })));
            box.appendChild(selectRow('阵营 B', cond.targetCamp || 'player2', CAMP_LABELS, v => patch({ targetCamp: v })));
            box.appendChild(selectRow('关系', cond.relation || 'enemy', { ally: '联盟', neutral: '中立', enemy: '敌对' }, v => patch({ relation: v }))); break;
        case 'weather': box.appendChild(selectRow('天气', cond.weather || 'clear', WEATHER_LABELS, v => patch({ weather: v }))); break;
        case 'objectiveStatus':
            box.appendChild(selectRow('目标', cond.objective || '', Object.fromEntries(Object.keys(config.objectives).map(id => [id, config.objectives[id].title || id])), v => patch({ objective: v })));
            box.appendChild(selectRow('状态', cond.status || 'active', { hidden: '隐藏', active: '进行中', completed: '已完成', failed: '已失败' }, v => patch({ status: v }))); break;
        case 'interactionState':
            box.appendChild(selectRow('调查点', cond.interactable || '', Object.fromEntries(config.interactables.map(item => [item.id, item.label || item.id])), v => patch({ interactable: v })));
            box.appendChild(selectRow('状态', cond.state || 'available', { disabled: '不可用', available: '可调查', completed: '已完成' }, v => patch({ state: v }))); break;
        case 'groupState':
            box.appendChild(selectRow('单位组', cond.group || '', Object.fromEntries(config.unitGroups.map(item => [item.id, item.id])), v => patch({ group: v })));
            box.appendChild(selectRow('状态', cond.state || 'anyAlive', { anyAlive: '至少一员存活', allAlive: '全员存活', allDead: '全员阵亡' }, v => patch({ state: v }))); break;
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
            box.appendChild(selectRow('阵营筛选', cond.camp || '', { '': '任意阵营', ...CAMP_LABELS }, v => patch({ camp: v })));
            box.appendChild(selectRow('比较', cond.op || '>=', { '<=': '不多于', '==': '正好', '>=': '不少于' }, v => patch({ op: v })));
            box.appendChild(numRow('单位数', cond.value ?? 1, v => patch({ value: Math.max(0, Math.round(v)) }))); break;
        }
        case 'coord':
            box.appendChild(coordRow('坐标', cond.q ?? 0, cond.r ?? 0, tile => patch(tile))); break;
        case 'interaction': box.appendChild(selectRow('调查点', cond.interactable || '', Object.fromEntries(config.interactables.map(item => [item.id, item.label || item.id])), v => patch({ interactable: v }))); break;
        case 'flagBoolean':
            box.appendChild(textRow('标记名', cond.flag || '', v => patch({ flag: v })));
            box.appendChild(checkRow('要求为“是”', cond.value !== false, v => patch({ value: v }))); break;
        case 'mechanicBoolean':
            box.appendChild(selectRow('机制', cond.mechanic || MECHANIC_KEYS[0], MECHANIC_LABELS, v => patch({ mechanic: v })));
            box.appendChild(selectRow('要求', cond.enabled === false ? 'off' : 'on', { on: '已启用', off: '已禁用' }, v => patch({ enabled: v === 'on' }))); break;
        case 'compare':
            box.appendChild(hint('高级比较用于回合、金币和变量。社区作者通常优先使用上面的专用条件。'));
            box.appendChild(selectRow('左值', cond.left?.source || 'round', { round: '当前回合', gold: '阵营金币', levelVariable: '本关变量', campaignVariable: '战役变量' }, v => patch({ left: { source: v } })));
            if (cond.left?.source === 'gold') box.appendChild(selectRow('阵营', cond.left.camp || 'player1', CAMP_LABELS, v => patch({ left: { ...cond.left, camp: v } })));
            if (cond.left?.source === 'levelVariable' || cond.left?.source === 'campaignVariable') box.appendChild(selectRow('变量', cond.left.variable || '', Object.fromEntries(config.variables.filter(item => item.scope === (cond.left.source === 'levelVariable' ? 'level' : 'campaign')).map(item => [item.id, item.id])), v => patch({ left: { ...cond.left, variable: v } })));
            box.appendChild(selectRow('比较', cond.op || '>=', { '==': '等于', '!=': '不等于', '<': '小于', '<=': '小于等于', '>=': '大于等于', '>': '大于' }, v => patch({ op: v })));
            box.appendChild(numRow('右侧常量', cond.right?.value ?? 1, v => patch({ right: { source: 'constant', value: v } }))); break;
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
        box.appendChild(selectRow('阵营', u.camp || 'player2', CAMP_LABELS, v => patch({ camp: v })));
        box.appendChild(selectRow('将领', u.commander || '', { '': '（无）', ...COMMANDER_LABELS }, v => patch({ commander: v || undefined })));
        box.appendChild(coordRow('坐标', u.q ?? 0, u.r ?? 0, tile => patch(tile)));
        box.appendChild(numRow('生命%', u.hpPct ?? 100, v => patch({ hpPct: Math.max(1, Math.min(100, Math.round(v))) })));
        wrap.appendChild(box);
    });
    const add = el('button', 'ed-add-btn', '+ 添加生成单位');
    add.addEventListener('click', () => onChange([...(units || []), { type: 'infantry', camp: 'player2', q: 0, r: 0 }]));
    wrap.appendChild(add);
    return wrap;
}

function targetEditor(target, onChange) {
    const wrap = el('div');
    const mode = target?.group ? 'group' : 'unit';
    wrap.appendChild(selectRow('作用对象', mode, { unit: '单个单位', group: '单位组' }, value => {
        onChange(value === 'group' ? { group: config.unitGroups[0]?.id || '' } : { unit: config.units[0]?.id || '' });
    }));
    if (mode === 'group') {
        wrap.appendChild(selectRow('单位组', target?.group || '', Object.fromEntries(config.unitGroups.map(group => [group.id, group.id])), value => onChange({ group: value })));
    } else {
        wrap.appendChild(selectRow('单位', target?.unit || '', unitOptions(), value => onChange({ unit: value })));
    }
    return wrap;
}

function actionEditor(action, onChange, onRemove, allowNested = true) {
    const meta = TRIGGER_ACTIONS.find(a => a.kind === action.kind) || TRIGGER_ACTIONS[0];
    const box = card(meta.label, onRemove);
    const kinds = authorActions(action.kind).filter(a => allowNested || a.kind !== 'delay');
    box.appendChild(selectRow('动作', action.kind, Object.fromEntries(kinds.map(a => [a.kind, a.label])), v => onChange({ kind: v, ...actionDefaults(v) })));
    const patch = (fields) => onChange({ ...action, ...fields });
    switch (meta.arg) {
        case 'step': {
            const stepId = action.step || '';
            const step = config.steps[stepId];
            box.appendChild(selectRow('步骤', stepId, {
                ...Object.fromEntries(Object.keys(config.steps).map(id => [id, id])),
                '__new__': '── 新建步骤 ──'
            }, v => {
                if (v === '__new__') {
                    let n = 1; while (config.steps[`page${n}`]) n++;
                    const newId = `page${n}`;
                    mutate(c => { c.steps[newId] = { mode: 'narrator', text: '', next: null }; }, { rebuildPanels: false, snapshot: false });
                    // 自动接在上一步之后构成连续对话
                    if (stepId && config.steps[stepId] && !config.steps[stepId].next) {
                        mutate(c => { c.steps[stepId].next = newId; }, { rebuildPanels: false, snapshot: false });
                    }
                    patch({ step: newId });
                    renderInspector();
                } else { patch({ step: v || '' }); }
            }));
            if (step) {
                const preview = el('div', 'ed-card');
                preview.style.cssText = 'margin:4px 0;padding:6px;background:rgba(255,255,255,0.04);font-size:12px;';
                preview.innerHTML = `<div style="color:#ffd866;font-weight:bold">${step.mode === 'character' ? '🗣 ' + (step.speaker?.name || '') : '📖 旁白'}</div><div style="color:rgba(255,255,255,0.7);margin-top:2px">${(step.text || '（空）').slice(0, 80)}${(step.text || '').length > 80 ? '…' : ''}</div>`;
                preview.addEventListener('click', () => { selection = { kind: 'step', id: stepId }; renderInspector(); });
                preview.style.cursor = 'pointer';
                box.appendChild(preview);
                box.appendChild(hint('点击预览编辑步骤内容'));
            }
            box.appendChild(checkRow('立即显示', !!action.immediate, v => patch({ immediate: v || undefined })));
            // 在上述步骤之后追加一页（自动设置 next 形成连续对话）
            if (step && !step.next) {
                const addPage = el('button', 'ed-add-btn', '➕ 加一页（自动续接）');
                addPage.addEventListener('click', () => mutate(c => {
                    let n = 1; while (c.steps[`page${n}`]) n++;
                    const newId = `page${n}`;
                    c.steps[newId] = { mode: 'narrator', text: '', next: null };
                    c.steps[stepId].next = newId;
                    patch({ step: stepId });
                    renderInspector();
                }, { rebuildPanels: false }));
                box.appendChild(addPage);
            }
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
            box.appendChild(textareaRow('文本', action.kind === 'setFlag' || action.kind === 'clearFlag' || action.kind === 'setPhase' ? action.value || '' : action.text || '', v => {
                if (action.kind === 'setFlag' || action.kind === 'clearFlag' || action.kind === 'setPhase') patch({ value: v });
                else patch({ text: v });
            }, 2));
            break;
        case 'delayGroup':
            box.appendChild(numRow('延迟(ms)', action.ms ?? 1000, v => patch({ ms: Math.max(0, Math.round(v)) })));
            box.appendChild(actionListEditor(action.then || [], list => patch({ then: list }), false));
            break;
        case 'variableOperation':
            box.appendChild(selectRow('变量', action.variable || '', Object.fromEntries(config.variables.map(item => [item.id, `${item.id}（${item.scope === 'campaign' ? '战役' : '本关'}）`])), v => patch({ variable: v })));
            box.appendChild(selectRow('操作', action.operation || 'set', { set: '设为', add: '增加', subtract: '减少', multiply: '乘以', divide: '除以', min: '取较小值', max: '取较大值' }, v => patch({ operation: v })));
            box.appendChild(numRow('数值', Number(action.value) || 0, v => patch({ value: v }))); break;
        case 'flagBoolean':
            box.appendChild(textRow('标记名', action.flag || '', v => patch({ flag: v })));
            box.appendChild(checkRow('设为“是”', action.value !== false, v => patch({ value: v }))); break;
        case 'triggerEnabled':
            box.appendChild(selectRow('触发器', action.trigger || '', Object.fromEntries(config.triggers.map(item => [item.id, item.title || item.id])), v => patch({ trigger: v })));
            box.appendChild(selectRow('状态', action.enabled === false ? 'off' : 'on', { on: '启用', off: '禁用' }, v => patch({ enabled: v === 'on' }))); break;
        case 'objectiveStatus':
            box.appendChild(selectRow('目标', action.objective || '', Object.fromEntries(Object.keys(config.objectives).map(id => [id, config.objectives[id].title || id])), v => patch({ objective: v })));
            box.appendChild(selectRow('状态', action.status || 'active', { hidden: '隐藏', active: '进行中', completed: '已完成', failed: '已失败' }, v => patch({ status: v }))); break;
        case 'campOperation':
            box.appendChild(selectRow('阵营', action.camp || 'player1', CAMP_LABELS, v => patch({ camp: v })));
            box.appendChild(selectRow('操作', action.operation || 'add', { set: '设为', add: '增加', subtract: '减少' }, v => patch({ operation: v })));
            box.appendChild(numRow('金币', action.value ?? 1, v => patch({ value: v }))); break;
        case 'unitOperation':
            box.appendChild(targetEditor(action.target, target => patch({ target })));
            box.appendChild(selectRow('操作', action.operation || 'subtract', { set: '设为', add: '治疗', subtract: '造成伤害' }, v => patch({ operation: v })));
            box.appendChild(selectRow('单位', action.mode || 'value', { value: '点数', percent: '最大生命百分比' }, v => patch({ mode: v })));
            box.appendChild(numRow('数值', action.value ?? 1, v => patch({ value: Math.max(0, v) }))); break;
        case 'unitCamp':
            box.appendChild(targetEditor(action.target, target => patch({ target })));
            box.appendChild(selectRow('新阵营', action.camp || 'player1', CAMP_LABELS, v => patch({ camp: v }))); break;
        case 'unitState':
            box.appendChild(targetEditor(action.target, target => patch({ target })));
            box.appendChild(selectRow('能力', action.state || 'canAct', { canAct: '本回合可行动', canMove: '允许移动', canAttack: '允许攻击', selectable: '允许玩家选择', targetable: '允许成为目标', invulnerable: '无敌' }, v => patch({ state: v })));
            box.appendChild(checkRow('启用', action.value !== false, v => patch({ value: v }))); break;
        case 'unitDefeatRule':
            box.appendChild(targetEditor(action.target, target => patch({ target })));
            box.appendChild(numRow('最低生命', action.minHp ?? 0, v => patch({ minHp: Math.max(0, Math.round(v)) })));
            box.appendChild(checkRow('致命伤保留 1 HP', !!action.nonLethal, v => patch({ nonLethal: v })));
            box.appendChild(checkRow('阵亡立即失败', !!action.failOnDeath, v => patch({ failOnDeath: v }))); break;
        case 'relation':
            box.appendChild(selectRow('阵营 A', action.camp || 'player1', CAMP_LABELS, v => patch({ camp: v })));
            box.appendChild(selectRow('阵营 B', action.targetCamp || 'player2', CAMP_LABELS, v => patch({ targetCamp: v })));
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

function conditionListEditor(list, onChange) {
    const wrap = el('div');
    (list || []).forEach((cond, i) => {
        wrap.appendChild(conditionEditor(cond,
            next => { const arr = list.slice(); arr[i] = next; onChange(arr); },
            () => { const arr = list.slice(); arr.splice(i, 1); onChange(arr); }));
    });
    const add = el('button', 'ed-add-btn', '+ 添加条件（全部满足才触发）');
    add.addEventListener('click', () => onChange([...(list || []), { kind: 'stepIs', ...conditionDefaults('stepIs') }]));
    wrap.appendChild(add);
    return wrap;
}

function actionListEditor(list, onChange, allowNested = true) {
    const wrap = el('div');
    (list || []).forEach((action, i) => {
        wrap.appendChild(actionEditor(action,
            next => { const arr = list.slice(); arr[i] = next; onChange(arr); },
            () => { const arr = list.slice(); arr.splice(i, 1); onChange(arr); },
            allowNested));
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

    const secWhen = section('条件（AND）');
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
    wrap.appendChild(checkRow('开场时启用', obj.active !== false, v => mutate(c => { c.objectives[id].active = v; }, { rebuildPanels: false })));
    wrap.appendChild(checkRow('主要目标（全部完成即胜利）', obj.main === true, v => mutate(c => { c.objectives[id].main = v || undefined; }, { rebuildPanels: false })));
    wrap.appendChild(hint('主要目标全部完成 → 胜利；任一主要目标失败 → 失败。通过触发器「设置目标状态」改变。'));
    return wrap;
}

function buildMetaInspector() {
    const wrap = el('div');
    const res = config.result;
    const secMechanics = section('本关开放机制');
    secMechanics.appendChild(hint('关闭的机制会隐藏或禁用入口，并由规则层拦截。需要中途教学解锁时，先关闭，再使用触发器“启用/禁用机制”。'));
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
    secGroups.appendChild(hint('用于整队全灭、增援、收编和批量改状态。组内引用稳定单位 id。'));
    config.unitGroups.forEach((group, index) => {
        const box = card(group.id || `单位组 ${index + 1}`, () => mutate(c => { c.unitGroups.splice(index, 1); }));
        box.appendChild(textRow('组 id', group.id, value => mutate(c => { c.unitGroups[index].id = value; })));
        box.appendChild(checkGroup('成员', Object.entries(unitOptions(false)).map(([value, label]) => ({ value, label })), group.unitIds,
            value => mutate(c => { c.unitGroups[index].unitIds = value; })));
        secGroups.appendChild(box);
    });
    const addGroup = el('button', 'ed-add-btn', '+ 新增单位组');
    addGroup.addEventListener('click', () => mutate(c => { c.unitGroups.push({ id: `group${c.unitGroups.length + 1}`, unitIds: [] }); }));
    secGroups.appendChild(addGroup); wrap.appendChild(secGroups);

    const secInteractions = section(`调查点（${config.interactables.length}）`);
    secInteractions.appendChild(hint('调查点是剧情交互，不是单位：不阻挡移动，也不会被 AI 攻击。'));
    config.interactables.forEach((item, index) => {
        const box = card(item.label || item.id || `调查点 ${index + 1}`, () => mutate(c => { c.interactables.splice(index, 1); }));
        box.appendChild(textRow('调查点 id', item.id, value => mutate(c => { c.interactables[index].id = value; })));
        box.appendChild(textRow('显示文案', item.label || '', value => mutate(c => { c.interactables[index].label = value; })));
        box.appendChild(coordRow('坐标', item.q, item.r, tile => mutate(c => { c.interactables[index].q = tile.q; c.interactables[index].r = tile.r; })));
        box.appendChild(checkRow('开场可用', item.enabled !== false, value => mutate(c => { c.interactables[index].enabled = value; })));
        box.appendChild(checkRow('只能完成一次', item.once !== false, value => mutate(c => { c.interactables[index].once = value; })));
        secInteractions.appendChild(box);
    });
    const addInteraction = el('button', 'ed-add-btn', '+ 新增调查点');
    addInteraction.addEventListener('click', () => mutate(c => { c.interactables.push({ id: `clue${c.interactables.length + 1}`, q: 0, r: 0, label: '调查', enabled: true, once: true }); }));
    secInteractions.appendChild(addInteraction); wrap.appendChild(secInteractions);

    const secVariables = section(`变量（${config.variables.length}）`);
    secVariables.appendChild(hint('关卡变量在重试时重置；战役变量仅在胜利结算时提交。'));
    config.variables.forEach((variable, index) => {
        const box = card(variable.id || `变量 ${index + 1}`, () => mutate(c => { c.variables.splice(index, 1); }));
        box.appendChild(textRow('变量 id', variable.id, value => mutate(c => { c.variables[index].id = value; })));
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
    if (!config.initialStep && !Object.keys(config.steps).length) {
        setStatus('提示：本关没有剧情步骤，将直接进入对局', '');
    }
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
    refreshAll('就绪 · 左侧选择工具，画布上直接绘制；Ctrl+Z 撤销');
}

export function closeEditor() {
    $id('editorOverlay').style.display = 'none';
}

/** 测试返回时恢复编辑器（保留当前配置与选中状态）。 */
export function reopenEditorAfterPlaytest() {
    $id('editorOverlay').style.display = '';
    refreshAll('测试结束，已返回编辑器');
}
