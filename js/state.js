import { CAMP, LOG_LIMIT, UNIT_CONFIG, invalidateBoard, WEATHER_CONFIG, HEX_NEIGHBORS, hexEdge, HEX_SIZE, getRound } from './config.js';
import { computeCampBorders, computeDistrictBorders } from './HexTile.js';
import { getCommander, getCommanderRecruitCost } from './commanderInterface.js';
import { isNetworkGame, isMyTurn, getMyRole, sendAction } from './network.js';
import { emit } from './eventBus.js';
import { isTileVisible } from './fogOfWar.js';
import {
    createMatchState, resetMatchState, createClientUiState, resetClientUiState,
    serializeMatchState, restoreMatchState
} from '../engine/matchState.js';

// ===== 计数器滚动动画工具 =====================
const _counterStore = {};

function animateCounter(el, newVal, fmtFn, key) {
    const k = key || el.id || 'default';
    const prev = _counterStore[k] != null ? _counterStore[k] : newVal;
    if (prev === newVal) { el.textContent = fmtFn(newVal); return; }
    _counterStore[k] = newVal;
    const start = performance.now();
    const duration = 350;
    function tick(now) {
        const t = Math.min((now - start) / duration, 1);
        const ease = 1 - Math.pow(1 - t, 3); // ease-out cubic
        el.textContent = fmtFn(Math.round(prev + (newVal - prev) * ease));
        if (t < 1) requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
}

// ===== 游戏核心状态 =====================
// 字段归属的唯一出处在 engine/matchState.js：
//   MatchState（规则结算/可序列化） + ClientUiState（本地选中/动画/浮层）。
// 过渡期两者仍合并为同一个单例对象，旧代码的引用方式不变。
export const gameState = Object.assign(createMatchState(), createClientUiState());

// ===== 重置游戏状态（再来一局时调用） =====================
export function resetGameState() {
    resetMatchState(gameState);
    resetClientUiState(gameState);
    // 清除计数器动画记忆
    for (const k of Object.keys(_counterStore)) delete _counterStore[k];
}

export function rebuildTileMap() {
    gameState.tileMap = new Map();
    for (const tile of gameState.tiles) {
        gameState.tileMap.set(`${tile.q},${tile.r}`, tile);
    }
}

/**
 * 将当前 HUD 的查看对象保存为稳定标识，而非 Tile / Unit 实例。
 * 远端快照会重建这些实例，只有 ID 或坐标能在同步后安全恢复。
 */
export function setInspectionTarget(tile) {
    if (!tile) {
        gameState.inspectionTarget = null;
        return;
    }
    gameState.inspectionTarget = tile.unit
        ? { kind: 'unit', unitId: tile.unit.id }
        : { kind: 'tile', q: tile.q, r: tile.r };
}

function _resolveInspectionTarget(target) {
    if (!target) return null;
    if (target.kind === 'unit') {
        for (const tile of gameState.tiles) {
            if (tile.unit?.id === target.unitId && tile.unit.hp > 0) return tile;
        }
        return null;
    }
    if (target.kind === 'tile') return gameState.tileMap.get(`${target.q},${target.r}`) || null;
    return null;
}

function _getLegacyInspectionTarget() {
    const tile = gameState.selectedTile || gameState.selectedUnit?.tile || null;
    if (!tile) return null;
    return tile.unit
        ? { kind: 'unit', unitId: tile.unit.id }
        : { kind: 'tile', q: tile.q, r: tile.r };
}

// idCounter 和 nextId 已移至 uid.js

function _campKeyStr(camp) {
    if (camp === CAMP.player1) return 'player1';
    if (camp === CAMP.player2) return 'player2';
    if (camp === CAMP.player3) return 'player3';
    return 'neutral';
}

// 返回当前客户端应使用的观察阵营（遭遇战/多人模式迷雾渲染用）
export function getViewingCamp() {
    if (isNetworkGame()) {
        const role = getMyRole();
        let camp = CAMP.player1;
        if (role === 'player1') camp = CAMP.player1;
        else if (role === 'player2') camp = CAMP.player2;
        else if (role === 'player3') camp = CAMP.player3;
        // 已投降/战败：切换为观战视角，揭示全图视野
        if (gameState.surrenderedCamps.includes(camp)) return CAMP.neutral;
        return camp;
    }
    // PVE 模式人类固定观察己方（无论当前回合是谁）
    if (gameState.gameMode === 'pve' && gameState.aiOpponentCamp) {
        const humanCamp = gameState.aiOpponentCamp === CAMP.player1 ? CAMP.player2 : CAMP.player1;
        if (gameState.surrenderedCamps.includes(humanCamp)) return CAMP.neutral;
        return humanCamp;
    }
    return gameState.currentCamp;
}

// ===== UI 更新 =====================
export function updateButtonColors() {
    const myCamp = _getMyCamp();
    const displayCamp = isNetworkGame() ? myCamp : (gameState.gameMode === 'pve' ? _getHumanCamp() : gameState.currentCamp);
    const panel = document.getElementById('commandPanel');
    if (panel) {
        panel.setAttribute('data-camp', displayCamp === CAMP.player1 ? 'p1' : displayCamp === CAMP.player2 ? 'p2' : 'p3');
    }
    const card1 = document.getElementById('campCard1');
    const card2 = document.getElementById('campCard2');
    const card3 = document.getElementById('campCard3');
    if (card1) card1.classList.toggle('active', displayCamp === CAMP.player1);
    if (card2) card2.classList.toggle('active', displayCamp === CAMP.player2);
    if (card3) card3.classList.toggle('active', displayCamp === CAMP.player3);
}

function _getMyCamp() {
    if (isNetworkGame()) {
        const role = getMyRole();
        if (role === 'player1') return CAMP.player1;
        if (role === 'player2') return CAMP.player2;
        if (role === 'player3') return CAMP.player3;
        return CAMP.player1;
    }
    if (gameState.gameMode === 'pve' && gameState.aiOpponentCamp) {
        return gameState.aiOpponentCamp === CAMP.player1 ? CAMP.player2 : CAMP.player1;
    }
    return gameState.currentCamp;
}

function _getHumanCamp() {
    if (gameState.gameMode === 'pve' && gameState.aiOpponentCamp) {
        return gameState.aiOpponentCamp === CAMP.player1 ? CAMP.player2 : CAMP.player1;
    }
    return gameState.currentCamp;
}

function _getRecruitCost(type) {
    const baseCost = UNIT_CONFIG[type].cost;
    const myCamp = _getMyCamp();
    // 通过将领接口获取实际招募费用（尚书需驻扎城市才打折）
    return getCommanderRecruitCost(baseCost, gameState, myCamp);
}

export function updateRecruitCostDisplay() {
    const tile = gameState.selectedCityTile;
    const isVillage = tile && tile.isVillage;
    const types = isVillage ? [null, null, null] : ['infantry', 'cavalry', 'archer'];
    const btnIds = ['recruitInfantry', 'recruitCavalry', 'recruitArcher'];
    const glyphs = ['⚔️', '🐎', '🎯'];
    const names  = ['步兵', '骑兵', '炮兵'];
    for (let i = 0; i < btnIds.length; i++) {
        const btn = document.getElementById(btnIds[i]);
        if (!btn) continue;
        if (!types[i]) { btn.style.display = 'none'; continue; }
        btn.style.display = '';
        const glyphEl = btn.querySelector('.unit-glyph');
        const typeEl = btn.querySelector('.unit-type');
        const costSpan = btn.querySelector('.unit-cost');
        if (glyphEl && glyphs[i]) glyphEl.textContent = glyphs[i];
        if (typeEl && names[i]) typeEl.textContent = names[i];
        if (!costSpan) continue;
        const baseCost = UNIT_CONFIG[types[i]].cost;
        const cost = _getRecruitCost(types[i]);
        const discountPct = cost < baseCost ? Math.round((1 - cost / baseCost) * 100) : 0;
        const discountSuffix = discountPct > 0 ? `<small> (-${discountPct}%)</small>` : '';
        costSpan.innerHTML = `<small>$</small><span class="unit-cost-num">${cost}</span>${discountSuffix}`;
        const numEl = costSpan.querySelector('.unit-cost-num');
        if (numEl) animateCounter(numEl, cost, n => String(n), `cost_${types[i]}`);
    }
}

export function updateRecruitButtonStates() {
    const btns = {
        infantry: document.getElementById('recruitInfantry'),
        cavalry: document.getElementById('recruitCavalry'),
        archer: document.getElementById('recruitArcher')
    };

    const opponentTurn = isNetworkGame() && !isMyTurn(gameState.currentCamp);
    const isNeutralTurn = gameState.currentCamp === CAMP.neutral;
    const inCommanderSetup = gameState.commanderPhase === 'selection';
    if (opponentTurn || isNeutralTurn || gameState.gameOver || inCommanderSetup) {
        for (const btn of Object.values(btns)) {
            if (btn) { btn.disabled = true; btn.classList.remove('available'); }
        }
        return;
    }

    const tile = gameState.selectedCityTile;
    const isVillage = tile && tile.isVillage;
    const isCity = tile && tile.isCity;
    const canRecruitCity = isCity && tile.camp === gameState.currentCamp && !tile.unit;
    const canRecruitVillage = isVillage && tile.camp === gameState.currentCamp && !tile.unit;
    const currentKey = _campKeyStr(gameState.currentCamp);
    const gold = gameState.playerGold[currentKey];

    // 村庄不可招募（仅保留产币+补员功能）
    if (isVillage) {
        for (const btn of Object.values(btns)) {
            if (btn) { btn.disabled = true; btn.classList.remove('available'); }
        }
        return;
    }

    for (const [type, btn] of Object.entries(btns)) {
        if (!btn) continue;
        const cost = _getRecruitCost(type);
        const affordable = gold >= cost;
        const available = canRecruitCity && affordable;
        btn.disabled = !available;
        if (available) {
            btn.classList.add('available');
        } else {
            btn.classList.remove('available');
        }
    }
}

function _spawnGoldDelta(el, delta) {
    if (!el || delta === 0) return;
    const rect = el.getBoundingClientRect();
    const span = document.createElement('span');
    const isGain = delta > 0;
    span.textContent = (isGain ? '+' : '') + '$' + Math.abs(delta);
    span.style.cssText = `
        position: fixed; left: ${rect.left + rect.width / 2}px; top: ${rect.top - 4}px;
        transform: translate(-50%, 0);
        font-size: 15px; font-weight: bold; font-family: "Noto Serif SC", "Noto Serif CJK SC", serif;
        color: ${isGain ? '#44dd44' : '#cc5555'};
        text-shadow: 0 0 8px ${isGain ? 'rgba(60,220,60,0.8)' : 'rgba(200,80,80,0.8)'};
        pointer-events: none; z-index: 1000; white-space: nowrap;
    `;
    document.body.appendChild(span);
    const start = performance.now();
    const duration = 1800;
    function tick(now) {
        const t = (now - start) / duration;
        if (t >= 1) { span.remove(); return; }
        span.style.opacity = Math.max(0, 1 - t);
        span.style.top = (rect.top - 4 - 24 * t) + 'px';
        requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
}

export function updateUI() {
    const turnEl = document.getElementById('currentTurn');
    turnEl.textContent = gameState.currentCamp.name;
    if (typeof gsap !== 'undefined') {
        gsap.to(turnEl, { color: gameState.currentCamp.color, duration: 0.35 });
    } else {
        turnEl.style.color = gameState.currentCamp.color;
    }
    const gold1El = document.getElementById('player1Gold');
    const gold2El = document.getElementById('player2Gold');
    const gold3El = document.getElementById('player3Gold');
    const newGold1 = gameState.playerGold.player1;
    const newGold2 = gameState.playerGold.player2;
    const newGold3 = gameState.playerGold.player3;
    // 联机/中立/AI对手回合：禁用操作按钮、显示提示条
    const opponentTurn = isNetworkGame() && !isMyTurn(gameState.currentCamp);
    const isNeutralTurn = gameState.currentCamp === CAMP.neutral;
    const isAIOpponentTurn = gameState.gameMode === 'pve' && gameState.currentCamp === gameState.aiOpponentCamp;
    const inCommanderSetup = gameState.commanderPhase === 'selection';
    const disableBtns = opponentTurn || isNeutralTurn || isAIOpponentTurn || gameState.gameOver || inCommanderSetup;
    ['endTurnBtn', 'recruitInfantry', 'recruitCavalry', 'recruitArcher'].forEach(id => {
        const btn = document.getElementById(id);
        if (btn) btn.disabled = disableBtns;
    });
    // 投降/退出：PVE 模式下按钮改为"退出"，始终可用（AI 回合也可退出）
    const surrenderBtn = document.getElementById('surrenderBtn');
    if (surrenderBtn) {
        const myCamp = _getMyCamp();
        const alreadySurrendered = gameState.isThreePlayer && gameState.surrenderedCamps.includes(myCamp);
        if (alreadySurrendered) {
            surrenderBtn.textContent = '退出';
            surrenderBtn.disabled = false;
        } else if (gameState.gameMode === 'pve') {
            surrenderBtn.textContent = '退出';
            surrenderBtn.disabled = gameState.gameOver || inCommanderSetup;
        } else {
            surrenderBtn.textContent = '投降';
            // 只要没有投降过，就始终开放投降按钮（不限回合）
            surrenderBtn.disabled = gameState.gameOver || inCommanderSetup;
        }
    }
    const banner = document.getElementById('opponentTurnBanner');
    if (banner) {
        const myCamp = _getMyCamp();
        const isSpectator = gameState.isThreePlayer && gameState.surrenderedCamps.includes(myCamp);
        if (isSpectator) {
            banner.innerHTML = '<span>👁</span><span>您已战败，观战中</span>';
            banner.classList.add('visible');
        } else {
            banner.innerHTML = '<span>⏳</span><span>等待对手行动...</span>';
            if (opponentTurn || isNeutralTurn || isAIOpponentTurn) {
                banner.classList.add('visible');
            } else {
                banner.classList.remove('visible');
            }
        }
    }

    if (newGold1 !== gameState.previousGold.player1) {
        const delta1 = newGold1 - gameState.previousGold.player1;
        const fogHide1 = gameState.skirmishFog && getViewingCamp() !== CAMP.player1;
        if (gold1El) animateCounter(gold1El, fogHide1 ? -1 : newGold1, n => n < 0 ? '???' : '$' + String(n));
        if (!fogHide1 && gold1El && typeof gsap !== 'undefined') {
            gsap.fromTo(gold1El, { scale: 0.85, textShadow: '0 0 20px rgba(255,215,0,0.9)' },
                { scale: 1, textShadow: '0 0 0px rgba(255,215,0,0)', duration: 0.45, ease: 'back.out(1.7)' });
        }
        if (!fogHide1 && gameState.previousGold.player1 >= 0) _spawnGoldDelta(gold1El, delta1);
        gameState.previousGold.player1 = newGold1;
    }
    if (newGold2 !== gameState.previousGold.player2) {
        const delta2 = newGold2 - gameState.previousGold.player2;
        const fogHide2 = gameState.skirmishFog && getViewingCamp() !== CAMP.player2;
        if (gold2El) animateCounter(gold2El, fogHide2 ? -1 : newGold2, n => n < 0 ? '???' : '$' + String(n));
        if (!fogHide2 && gold2El && typeof gsap !== 'undefined') {
            gsap.fromTo(gold2El, { scale: 0.85, textShadow: '0 0 20px rgba(255,215,0,0.9)' },
                { scale: 1, textShadow: '0 0 0px rgba(255,215,0,0)', duration: 0.45, ease: 'back.out(1.7)' });
        }
        if (!fogHide2 && gameState.previousGold.player2 >= 0) _spawnGoldDelta(gold2El, delta2);
        gameState.previousGold.player2 = newGold2;
    }
    if (newGold3 !== gameState.previousGold.player3) {
        const delta3 = newGold3 - gameState.previousGold.player3;
        const fogHide3 = gameState.skirmishFog && getViewingCamp() !== CAMP.player3;
        if (gold3El) animateCounter(gold3El, fogHide3 ? -1 : newGold3, n => n < 0 ? '???' : '$' + String(n));
        if (!fogHide3 && gold3El && typeof gsap !== 'undefined') {
            gsap.fromTo(gold3El, { scale: 0.85, textShadow: '0 0 20px rgba(255,215,0,0.9)' },
                { scale: 1, textShadow: '0 0 0px rgba(255,215,0,0)', duration: 0.45, ease: 'back.out(1.7)' });
        }
        if (!fogHide3 && gameState.previousGold.player3 >= 0) _spawnGoldDelta(gold3El, delta3);
        gameState.previousGold.player3 = newGold3;
    }

    updateRecruitButtonStates();
    updateRecruitCostDisplay();
    updateStatsPanel();
    _updateWeatherUI();
}

let _prevWeather = 'clear';
function _updateWeatherUI() {
    const cfg = WEATHER_CONFIG[gameState.weather];
    const badge = document.getElementById('weatherBadge');
    const iconEl = document.getElementById('weatherIcon');
    const labelEl = document.getElementById('weatherLabel');
    if (!badge || !iconEl || !labelEl) return;

    iconEl.textContent = '';
    labelEl.textContent = cfg.icon + cfg.name;
    badge.style.background = `rgba(0,0,0,0.35)`;
    badge.style.boxShadow = `0 0 12px ${cfg.color}33`;

    if (gameState.weather !== _prevWeather) {
        _prevWeather = gameState.weather;
        badge.classList.add('switching');
        setTimeout(() => badge.classList.remove('switching'), 300);
    }
}

// ===== 日志 =====================
export function logMessage(msg) {
    gameState.logHistory.push(msg);
    if (gameState.logHistory.length > LOG_LIMIT) gameState.logHistory.shift();
}

export function updateStatsPanel() {
    const content = document.getElementById('statsContent');
    if (!content) return;
    const turnNum = getRound(gameState);
    content.innerHTML = `
        <div class="stat-turn-num" style="font-size:48px;font-weight:bold;text-align:center;line-height:1.2;">${turnNum}</div>
        <div class="stat-turn-label" style="text-align:center;">回合</div>
    `;
    const turnEl = content.querySelector('.stat-turn-num');
    if (turnEl) animateCounter(turnEl, turnNum, n => String(n), 'turnNum');
}

// ===== 部署完成收尾（单机/联机统一入口） =====================
export function finalizeDeployment() {
    if (gameState.commanderPhase === 'done') return; // 防止重复调用
    gameState.commanderPhase = 'done';
    notify('游戏开始', 'info');
    // 联机：广播部署完成
    if (isNetworkGame()) sendAction('deployDone', serializeState());
    gameState.currentCamp = CAMP.player1;
    for (const tile of gameState.tiles) {
        if (tile.unit && tile.unit.commander) {
            tile.unit.canAct = true;
            tile.unit.remainingMP = tile.unit.config.speed + (getCommander(tile.unit.commander)?.spdBonus || 0);
        }
    }
    // 启用按钮（同步，避免移动端setTimeout延迟）
    ['endTurnBtn', 'surrenderBtn', 'recruitInfantry', 'recruitCavalry', 'recruitArcher'].forEach(id => {
        const btn = document.getElementById(id);
        if (btn) btn.disabled = false;
    });
    // 强制UI刷新
    const turnEl = document.getElementById('currentTurn');
    if (turnEl) { turnEl.textContent = '红军'; turnEl.style.color = '#ffaaaa'; }
    updateButtonColors();
    updateUI();
    notify('双方将领已部署，战斗开始！');
}

// ===== 选中清除 =====================
export function clearselection() {
    gameState.selectedUnit = null;
    gameState.selectedCityTile = null;
    gameState.selectedTile = null;
    gameState.movableTiles = [];
    gameState.attackableTiles = [];
    gameState.selectionTime = 0;
    gameState.deselecting = false;
    setInspectionTarget(null);
    updateRecruitButtonStates();
}

export function deselectUnit() {
    gameState.deselectMoveTiles = [...gameState.movableTiles];
    gameState.deselectAtkTiles = [...gameState.attackableTiles];
    gameState.deselectOrigin = gameState.selectedUnit ? gameState.selectedUnit.tile : null;
    gameState.deselecting = true;
    gameState.deselectionTime = performance.now();
    gameState.selectedUnit = null;
    gameState.selectedCityTile = null;
    gameState.movableTiles = [];
    gameState.attackableTiles = [];
    gameState.selectionTime = 0;
    setInspectionTarget(null);
    updateRecruitButtonStates();
}

// ===== 序列化 / 快照（联机同步 + 断线重连用） =====================
// 用共享种子显式播种对局 RNG,使所有客户端开局即确定一致(联机模式)。
// seed 可为数字或字符串(字符串会用 createRng 的来源派生)。
export function seedMatchRng(seed) {
    const s = typeof seed === 'string'
        ? [...seed].reduce((h, c) => (Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0), 2166136261 >>> 0)
        : (seed >>> 0);
    gameState.rng.setState(s || 1);
}

export function serializeState() {
    return serializeMatchState(gameState);
}

export function deserializeState(data, HexTileClass, UnitClass, options = {}) {
    restoreMatchState(gameState, data, { HexTileClass, UnitClass, computeCampBorders, computeDistrictBorders });
    // 界面刷新属于客户端职责，不进 engine
    gameState.cardStackExpanded = false;
    if (!options.preserveClientUi) clearselection();
    updateStatsPanel();
    updateUI();
    updateButtonColors();
    invalidateBoard();
}

// ==== 即时通知横幅 ====
let _notifyTimer = null;
let _notifyPersistent = false;

function _showNotifyBanner(icon, text, type, persistent = false) {
    const el = document.getElementById('notificationBanner');
    if (!el) return;
    if (_notifyTimer) clearTimeout(_notifyTimer);

    // 清除旧类型样式
    el.classList.remove('notify-info', 'notify-success', 'notify-warn', 'notify-error');

    el.children[0].textContent = icon;
    el.children[1].textContent = text;
    el.classList.add('visible', `notify-${type}`);

    _notifyPersistent = persistent;
    if (!persistent) {
        _notifyTimer = setTimeout(() => _dismissNotifyBanner(), 2500);
    }
}

function _dismissNotifyBanner() {
    const el = document.getElementById('notificationBanner');
    if (!el) return;
    _notifyPersistent = false;
    if (_notifyTimer) clearTimeout(_notifyTimer);
    el.classList.remove('visible');
}

export function dismissToast() {
    _dismissNotifyBanner();
}

export function notify(text, type = 'info', persistent = false) {
    if (gameState.aiActing && type === 'error') return;
    const cfg = { success: ['✓', 'success'], error: ['!', 'error'], info: ['i', 'info'], warn: ['⚠', 'warn'] };
    const [icon, cssType] = cfg[type] || cfg.info;
    _showNotifyBanner(icon, text, cssType, persistent);
}

// ==== 对策卡选择目标横幅 ====
export function showTargetingBanner(text) {
    const el = document.getElementById('cardTargetingBanner');
    if (!el) return;
    el.children[0].textContent = '🎯';
    el.children[1].textContent = text;
    el.classList.add('visible');
}

export function hideTargetingBanner() {
    const el = document.getElementById('cardTargetingBanner');
    if (!el) return;
    el.classList.remove('visible');
}

export function resolveUnitById(id) {
    for (const tile of gameState.tiles) {
        if (tile.unit && tile.unit.id === id) return tile.unit;
    }
    return null;
}

// ===== 远程状态同步（联机模式收到对手操作时调用） =====================
export function applyRemoteState(data, HexTileClass, UnitClass) {
    // 对局快照会重建 Tile / Unit 实例；观察目标属于纯本地 UI 状态，必须先以稳定 ID/坐标保存。
    const inspectionTarget = gameState.inspectionTarget || _getLegacyInspectionTarget();
    deserializeState(data, HexTileClass, UnitClass, { preserveClientUi: true });

    // 远端操作期间不能保留可行动范围或卡牌瞄准，但可以继续查看有效且可见的目标。
    gameState.selectedUnit = null;
    gameState.selectedCityTile = null;
    gameState.selectedTile = null;
    gameState.movableTiles = [];
    gameState.attackableTiles = [];
    gameState.moveParents = new Map();
    gameState.cardTargeting = null;

    const tile = _resolveInspectionTarget(inspectionTarget);
    const isVisible = tile && isTileVisible(tile, getViewingCamp(), gameState);
    if (isVisible) {
        gameState.selectedTile = tile;
        gameState.selectedUnit = tile.unit || null;
        gameState.inspectionTarget = inspectionTarget;
    } else {
        gameState.inspectionTarget = null;
    }
    emit('client:inspectionRestored', isVisible ? tile : null);
}
