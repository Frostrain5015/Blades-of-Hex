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
    TRIGGER_EVENTS, TRIGGER_CONDITIONS, TRIGGER_ACTIONS,
    BOARD_RADIUS_MIN, BOARD_RADIUS_MAX
} from '../runtime/schema.js';
import { buildBoardFromConfig } from '../runtime/mapBuilder.js';
import {
    el, section, textRow, numRow, selectRow, checkRow, textareaRow,
    checkGroup, itemList, card, hint, parseCoordList, coordListToText
} from './forms.js';

// ── 模块状态 ─────────────────────────────────────────────────
let config = createDefaultLevel();
let preview = { tiles: [], tileMap: new Map(), villageTiles: new Map(), campBorderEdges: [], districtBorderEdges: [] };
let canvas = null, ctx = null;
let activeTab = 'board';
let selection = null;              // {kind:'tile',q,r} | {kind:'unit',index} | {kind:'step',id} | {kind:'trigger',index} | {kind:'objective',id} | {kind:'optional',index} | {kind:'result'}
let hoverTile = null;
let painting = false;
let lastPaintKey = '';
let unitSeq = 1;
let callbacks = { onPlaytest: null, onBack: null };
let initialized = false;
let showCoords = false;

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
    ctx.clearRect(0, 0, canvas.width, canvas.height);

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

    // 悬浮与选中高亮
    if (hoverTile) drawHexagonOutline(ctx, hoverTile.x, hoverTile.y, HEX_SIZE, 'rgba(255,255,255,0.55)', 1.6);
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
    const px = (e.clientX - rect.left) * (canvas.width / rect.width);
    const py = (e.clientY - rect.top) * (canvas.height / rect.height);
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

function updateHint(tile) {
    const hintEl = $id('editorCanvasHint');
    if (!hintEl) return;
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
    else if (activeTab === 'story') body.appendChild(buildStoryList());
    else if (activeTab === 'triggers') body.appendChild(buildTriggerList());
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
            label: `${t.id || 'trigger_' + i} · ${TRIGGER_EVENTS.find(e => e.id === t.on)?.label || t.on}`
        })),
        activeKey: selection?.kind === 'trigger' ? String(selection.index) : null,
        onSelect: (key) => { selection = { kind: 'trigger', index: Number(key) }; renderToolPanel(); renderInspector(); },
        onDelete: (key) => mutate(c => {
            c.triggers.splice(Number(key), 1);
            if (selection?.kind === 'trigger') selection = null;
        }),
        addLabel: '+ 新增触发器',
        onAdd: () => mutate(c => {
            c.triggers.push({ id: `trigger_${c.triggers.length + 1}`, on: 'turnStarted', once: true, when: [], do: [] });
            selection = { kind: 'trigger', index: c.triggers.length - 1 };
        })
    }));
    wrap.appendChild(secTrig);

    const objIds = Object.keys(config.objectives);
    const secObj = section(`主目标（${objIds.length}）`);
    secObj.appendChild(itemList({
        items: objIds.map(id => ({ key: id, label: `${id} · ${config.objectives[id].title || ''}` })),
        activeKey: selection?.kind === 'objective' ? selection.id : null,
        onSelect: (id) => { selection = { kind: 'objective', id }; renderToolPanel(); renderInspector(); },
        onDelete: (id) => mutate(c => {
            delete c.objectives[id];
            if (c.initialObjective === id) c.initialObjective = '';
            if (selection?.kind === 'objective' && selection.id === id) selection = null;
        }),
        addLabel: '+ 新增主目标',
        onAdd: () => mutate(c => {
            let n = 1;
            while (c.objectives[`obj${n}`]) n++;
            c.objectives[`obj${n}`] = { title: '', detail: '' };
            selection = { kind: 'objective', id: `obj${n}` };
            if (!c.initialObjective) c.initialObjective = `obj${n}`;
        })
    }));
    secObj.appendChild(selectRow('初始目标', config.initialObjective,
        { '': '（无）', ...Object.fromEntries(objIds.map(id => [id, config.objectives[id].title || id])) },
        v => mutate(c => { c.initialObjective = v; }, { rebuildPanels: false })));
    wrap.appendChild(secObj);

    const secOpt = section(`支线目标（${config.optionalObjectives.length}）`);
    secOpt.appendChild(itemList({
        items: config.optionalObjectives.map((o, i) => ({ key: String(i), label: `${o.id} · ${o.text || ''}` })),
        activeKey: selection?.kind === 'optional' ? String(selection.index) : null,
        onSelect: (key) => { selection = { kind: 'optional', index: Number(key) }; renderToolPanel(); renderInspector(); },
        onDelete: (key) => mutate(c => {
            c.optionalObjectives.splice(Number(key), 1);
            if (selection?.kind === 'optional') selection = null;
        }),
        addLabel: '+ 新增支线',
        onAdd: () => mutate(c => {
            c.optionalObjectives.push({ id: `opt${c.optionalObjectives.length + 1}`, text: '', when: [] });
            selection = { kind: 'optional', index: c.optionalObjectives.length - 1 };
        })
    }));
    wrap.appendChild(secOpt);

    const resBtn = el('button', 'ed-add-btn', '⚖ 编辑结算与星级规则');
    resBtn.addEventListener('click', () => { selection = { kind: 'result' }; renderInspector(); });
    wrap.appendChild(resBtn);
    return wrap;
}

function buildMetaBasics() {
    const wrap = el('div');
    const secId = section('关卡标识');
    secId.appendChild(textRow('关卡 id', config.id, v => mutate(c => { c.id = v; }, { rebuildPanels: false }), '如 petra-siege'));
    secId.appendChild(textRow('所属传记', config.chronicleId, v => mutate(c => { c.chronicleId = v; }, { rebuildPanels: false })));
    secId.appendChild(numRow('随机种子', config.seed, v => mutate(c => { c.seed = Math.round(v); }, { rebuildPanels: false })));
    secId.appendChild(numRow('回合上限', config.turnLimit, v => mutate(c => { c.turnLimit = Math.max(0, Math.round(v)); }, { rebuildPanels: false }), { min: 0, max: 99 }));
    wrap.appendChild(secId);

    const secEnv = section('环境');
    secEnv.appendChild(selectRow('天气', config.weather, WEATHER_LABELS, v => mutate(c => { c.weather = v; }, { rebuildPanels: false })));
    secEnv.appendChild(selectRow('AI 阵营', config.aiOpponentCamp, { player1: '红军', player2: '蓝军' }, v => mutate(c => { c.aiOpponentCamp = v; }, { rebuildPanels: false })));
    secEnv.appendChild(numRow('AI 难度', config.aiDifficulty, v => mutate(c => { c.aiDifficulty = Math.max(0.1, v); }, { rebuildPanels: false }), { min: 0.1, max: 3, step: 0.1 }));
    wrap.appendChild(secEnv);

    wrap.appendChild(hint('开场标题、金币、将领与初始手牌在右侧检查器中设置。'));
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
    if (selection?.kind === 'optional' && config.optionalObjectives[selection.index]) {
        title.textContent = '支线目标';
        body.appendChild(buildOptionalInspector(selection.index));
        return;
    }
    if (selection?.kind === 'result') {
        title.textContent = '结算与星级';
        body.appendChild(buildResultInspector());
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
    wrap.appendChild(numRow('坐标 q', u.q, v => mutate(c => { c.units[index].q = Math.round(v); })));
    wrap.appendChild(numRow('坐标 r', u.r, v => mutate(c => { c.units[index].r = Math.round(v); })));
    const del = el('button', 'ed-add-btn', '🗑 删除该单位');
    del.addEventListener('click', () => mutate(c => { c.units.splice(index, 1); selection = null; }));
    wrap.appendChild(del);
    wrap.appendChild(hint('单位 id 供剧情/触发器引用（目标环、存活判定、白名单）。'));
    return wrap;
}

function stepOptions(includeEmpty) {
    const ids = Object.keys(config.steps);
    const opts = Object.fromEntries(ids.map(id => [id, id]));
    return includeEmpty ? { '': '（无）', ...opts } : opts;
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
    wrap.appendChild(textRow('目标环·坐标', targetCoord ? `${targetCoord.q},${targetCoord.r}` : '', v => mutate(c => {
        const list = parseCoordList(v);
        if (list.length) c.steps[stepId].target = list[0];
        else if (typeof c.steps[stepId].target === 'object') delete c.steps[stepId].target;
    }, { rebuildPanels: false }), '如 0,0（优先于单位）'));

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
    secAllow.appendChild(textRow('可点坐标', coordListToText(allow.tiles), v => setAllow('tiles', parseCoordList(v)), 'q,r; q,r'));
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
        default: return {};
    }
}

function conditionEditor(cond, onChange, onRemove) {
    const meta = TRIGGER_CONDITIONS.find(c => c.kind === cond.kind) || TRIGGER_CONDITIONS[0];
    const box = card(meta.label, onRemove);
    box.appendChild(selectRow('条件', cond.kind, Object.fromEntries(TRIGGER_CONDITIONS.map(c => [c.kind, c.label])), v => {
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
            box.appendChild(numRow('q', cond.q ?? 0, v => patch({ q: Math.round(v) })));
            box.appendChild(numRow('r', cond.r ?? 0, v => patch({ r: Math.round(v) })));
            box.appendChild(selectRow('归属', cond.camp || 'player1', CAMP_LABELS, v => patch({ camp: v })));
            break;
        case 'number':
            box.appendChild(numRow('数值', cond.value ?? 1, v => patch({ value: Math.round(v) }))); break;
        case 'text':
            box.appendChild(textRow('值', cond.value || '', v => patch({ value: v }))); break;
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
        box.appendChild(numRow('q', u.q ?? 0, v => patch({ q: Math.round(v) })));
        box.appendChild(numRow('r', u.r ?? 0, v => patch({ r: Math.round(v) })));
        box.appendChild(numRow('生命%', u.hpPct ?? 100, v => patch({ hpPct: Math.max(1, Math.min(100, Math.round(v))) })));
        wrap.appendChild(box);
    });
    const add = el('button', 'ed-add-btn', '+ 添加生成单位');
    add.addEventListener('click', () => onChange([...(units || []), { type: 'infantry', camp: 'player2', q: 0, r: 0 }]));
    wrap.appendChild(add);
    return wrap;
}

function actionEditor(action, onChange, onRemove, allowNested = true) {
    const meta = TRIGGER_ACTIONS.find(a => a.kind === action.kind) || TRIGGER_ACTIONS[0];
    const box = card(meta.label, onRemove);
    const kinds = allowNested ? TRIGGER_ACTIONS : TRIGGER_ACTIONS.filter(a => a.kind !== 'delay');
    box.appendChild(selectRow('动作', action.kind, Object.fromEntries(kinds.map(a => [a.kind, a.label])), v => onChange({ kind: v, ...actionDefaults(v) })));
    const patch = (fields) => onChange({ ...action, ...fields });
    switch (meta.arg) {
        case 'step':
            box.appendChild(selectRow('步骤', action.step || '', stepOptions(true), v => patch({ step: v })));
            box.appendChild(checkRow('立即显示', !!action.immediate, v => patch({ immediate: v || undefined })));
            break;
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
    wrap.appendChild(selectRow('监听事件', trig.on, Object.fromEntries(TRIGGER_EVENTS.map(e => [e.id, e.label])), v => mutate(c => { c.triggers[index].on = v; })));
    const evMeta = TRIGGER_EVENTS.find(e => e.id === trig.on);
    if (evMeta?.note) wrap.appendChild(hint(evMeta.note));
    wrap.appendChild(checkRow('只触发一次', trig.once !== false, set('once')));

    const secWhen = section('条件（AND）');
    secWhen.appendChild(conditionListEditor(trig.when || [], list => mutate(c => { c.triggers[index].when = list; })));
    wrap.appendChild(secWhen);

    const secDo = section('动作');
    secDo.appendChild(actionListEditor(trig.do || [], list => mutate(c => { c.triggers[index].do = list; })));
    wrap.appendChild(secDo);
    return wrap;
}

function buildObjectiveInspector(id) {
    const wrap = el('div');
    const obj = config.objectives[id];
    wrap.appendChild(textRow('标题', obj.title, v => mutate(c => { c.objectives[id].title = v; })));
    wrap.appendChild(textareaRow('描述', obj.detail, v => mutate(c => { c.objectives[id].detail = v; }, { rebuildPanels: false }), 3));
    wrap.appendChild(hint('通过触发器动作「切换主目标」在关卡中途更换目标。'));
    return wrap;
}

function buildOptionalInspector(index) {
    const wrap = el('div');
    const opt = config.optionalObjectives[index];
    wrap.appendChild(textRow('支线 id', opt.id, v => mutate(c => { c.optionalObjectives[index].id = v; })));
    wrap.appendChild(textRow('文案', opt.text, v => mutate(c => { c.optionalObjectives[index].text = v; })));
    const sec = section('完成条件（结算时判定；留空则由触发器「标记支线完成」驱动）');
    sec.appendChild(conditionListEditor(opt.when || [], list => mutate(c => { c.optionalObjectives[index].when = list; })));
    wrap.appendChild(sec);
    return wrap;
}

function buildResultInspector() {
    const wrap = el('div');
    const res = config.result;
    wrap.appendChild(textareaRow('胜利文案', res.winText, v => mutate(c => { c.result.winText = v; }, { rebuildPanels: false }), 3));
    wrap.appendChild(textareaRow('失败文案', res.loseText, v => mutate(c => { c.result.loseText = v; }, { rebuildPanels: false }), 3));

    const secAuto = section('内置胜负判定（可选）');
    secAuto.appendChild(checkRow('歼灭敌军即胜', !!res.eliminateEnemy, v => mutate(c => { c.result.eliminateEnemy = v || undefined; }, { rebuildPanels: false })));
    secAuto.appendChild(numRow('存活至回合', res.surviveToTurn ?? 0, v => mutate(c => { c.result.surviveToTurn = v > 0 ? Math.round(v) : undefined; }, { rebuildPanels: false }), { min: 0, max: 99 }));
    secAuto.appendChild(checkGroup('保护单位（阵亡即败）', Object.entries(unitOptions(false)).map(([value, label]) => ({ value, label })), res.protectUnits, v => mutate(c => { c.result.protectUnits = v.length ? v : undefined; }, { rebuildPanels: false })));
    secAuto.appendChild(textRow('保护失败文案', res.protectFailText || '', v => mutate(c => { c.result.protectFailText = v || undefined; }, { rebuildPanels: false })));
    wrap.appendChild(secAuto);

    const secStars = section('星级规则（基础 1 星；每满足一条 +1，封顶 3）');
    (res.starRules || []).forEach((rule, i) => {
        const box = card(rule.label || `规则 ${i + 1}`, () => mutate(c => { c.result.starRules.splice(i, 1); }));
        box.appendChild(textRow('说明', rule.label || '', v => mutate(c => { c.result.starRules[i].label = v; }, { rebuildPanels: false })));
        box.appendChild(conditionListEditor(rule.when || [], list => mutate(c => { c.result.starRules[i].when = list; })));
        secStars.appendChild(box);
    });
    const add = el('button', 'ed-add-btn', '+ 添加星级规则');
    add.addEventListener('click', () => mutate(c => { c.result.starRules.push({ label: '', when: [] }); }));
    secStars.appendChild(add);
    wrap.appendChild(secStars);
    return wrap;
}

function buildMetaInspector() {
    const wrap = el('div');
    const secIntro = section('开场遮罩');
    secIntro.appendChild(textRow('战役标题', config.intro.campaignTitle, v => mutate(c => { c.intro.campaignTitle = v; }, { rebuildPanels: false }), '如 将星列传 · 染血的鸢尾花'));
    secIntro.appendChild(textRow('关卡副题', config.intro.scenarioSubtitle, v => mutate(c => { c.intro.scenarioSubtitle = v; }, { rebuildPanels: false }), '如 第一章 雨夜孤城'));
    wrap.appendChild(secIntro);

    const secGold = section('初始金币');
    for (const key of ['player1', 'player2', 'player3']) {
        secGold.appendChild(numRow(CAMP_LABELS[key], config.gold[key] ?? 4, v => mutate(c => { c.gold[key] = Math.max(0, Math.round(v)); }, { rebuildPanels: false }), { min: 0, max: 99 }));
    }
    wrap.appendChild(secGold);

    const secCmd = section('阵营主将（HUD/技能条）');
    for (const key of ['player1', 'player2']) {
        secCmd.appendChild(selectRow(CAMP_LABELS[key], config.commanders[key] || '', { '': '（无，或由单位自动补全）', ...COMMANDER_LABELS },
            v => mutate(c => { c.commanders[key] = v || null; }, { rebuildPanels: false })));
    }
    wrap.appendChild(secCmd);

    const secHands = section('初始手牌');
    for (const key of ['player1', 'player2']) {
        secHands.appendChild(checkGroup(CAMP_LABELS[key], CARD_IDS.map(id => ({ value: id, label: CARD_LABELS[id] })), config.hands[key],
            v => mutate(c => { c.hands[key] = v; }, { rebuildPanels: false })));
    }
    wrap.appendChild(secHands);
    return wrap;
}

// ═══════════════════ 导入 / 导出 / 校验 / 试玩 ═══════════════════
function runValidation({ silent = false } = {}) {
    const { errors, warnings } = validateLevel(config);
    if (errors.length) {
        setStatus('✗ ' + errors.concat(warnings.map(w => '⚠ ' + w)).join('\n'), 'error');
        return false;
    }
    if (!silent) {
        setStatus(warnings.length ? warnings.map(w => '⚠ ' + w).join('\n') : '✓ 校验通过', warnings.length ? '' : 'ok');
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
        // 无剧情也允许试玩，仅提示
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

    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerup', onPointerUp);
    canvas.addEventListener('pointerleave', () => { hoverTile = null; onPointerUp(); render(); });

    for (const tab of document.querySelectorAll('.editor-tab')) {
        tab.addEventListener('click', () => {
            activeTab = tab.dataset.tab;
            document.querySelectorAll('.editor-tab').forEach(t => t.classList.toggle('active', t === tab));
            selection = null;
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

/** 试玩返回时恢复编辑器（保留当前配置与选中状态）。 */
export function reopenEditorAfterPlaytest() {
    $id('editorOverlay').style.display = '';
    refreshAll('试玩结束，已返回编辑器');
}
