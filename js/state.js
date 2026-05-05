import { CAMP, LOG_LIMIT, UNIT_CONFIG, invalidateBoard } from './config.js';
import { isNetworkGame, isMyTurn } from './network.js';

// ===== 游戏核心状态 =====================
export const gameState = {
    tiles: [],
    tileMap: new Map(),
    currentCamp: CAMP.player1,
    playerGold: { player1: 25, player2: 25 },
    selectedUnit: null,
    movableTiles: [],
    moveParents: new Map(),
    attackableTiles: [],
    damageTexts: [],
    healTexts: [],
    selectedCityTile: null,
    selectedTile: null,
    capturedNeutralCities: new Set(),
    goldTexts: [],
    hoveredTile: null,
    selectionTime: 0,
    gameOver: false,
    victoryCamp: null,
    previousGold: { player1: 25, player2: 25 },
    undoStack: [],
    turnCounter: 0,
    logHistory: []
};

export function rebuildTileMap() {
    gameState.tileMap = new Map();
    for (const tile of gameState.tiles) {
        gameState.tileMap.set(`${tile.q},${tile.r}`, tile);
    }
}

let idCounter = 0;
export function nextId() { return ++idCounter; }

// ===== UI 更新 =====================
export function updateButtonColors() {
    const panel = document.getElementById('commandPanel');
    if (panel) {
        panel.setAttribute('data-camp', gameState.currentCamp === CAMP.player1 ? 'p1' : 'p2');
    }
    const card1 = document.getElementById('campCard1');
    const card2 = document.getElementById('campCard2');
    if (card1) card1.classList.toggle('active', gameState.currentCamp === CAMP.player1);
    if (card2) card2.classList.toggle('active', gameState.currentCamp === CAMP.player2);
}

export function updateRecruitButtonStates() {
    const btns = {
        infantry: document.getElementById('recruitInfantry'),
        cavalry: document.getElementById('recruitCavalry'),
        archer: document.getElementById('recruitArcher')
    };

    const opponentTurn = isNetworkGame() && !isMyTurn(gameState.currentCamp);
    if (opponentTurn || gameState.gameOver) {
        for (const btn of Object.values(btns)) {
            if (btn) { btn.disabled = true; btn.classList.remove('available'); }
        }
        return;
    }

    const city = gameState.selectedCityTile;
    const canRecruit = city && city.isCity && city.camp === gameState.currentCamp && !city.unit;
    const currentKey = gameState.currentCamp === CAMP.player1 ? 'player1' : 'player2';
    const gold = gameState.playerGold[currentKey];

    for (const [type, btn] of Object.entries(btns)) {
        if (!btn) continue;
        const affordable = gold >= UNIT_CONFIG[type].cost;
        const available = canRecruit && affordable;
        btn.disabled = !available;
        if (available) {
            btn.classList.add('available');
        } else {
            btn.classList.remove('available');
        }
    }
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
    const newGold1 = gameState.playerGold.player1;
    const newGold2 = gameState.playerGold.player2;
    // 联机：非己方回合时禁用操作按钮、显示提示条
    const opponentTurn = isNetworkGame() && !isMyTurn(gameState.currentCamp);
    ['endTurnBtn', 'recruitInfantry', 'recruitCavalry', 'recruitArcher', 'surrenderBtn'].forEach(id => {
        const btn = document.getElementById(id);
        if (btn) btn.disabled = opponentTurn;
    });
    const banner = document.getElementById('opponentTurnBanner');
    if (banner) banner.style.display = opponentTurn ? 'flex' : 'none';

    if (newGold1 !== gameState.previousGold.player1) {
        gold1El.textContent = newGold1;
        if (typeof gsap !== 'undefined') {
            gsap.fromTo(gold1El, { scale: 0.7, textShadow: '0 0 20px rgba(255,215,0,0.9)' },
                { scale: 1, textShadow: '0 0 0px rgba(255,215,0,0)', duration: 0.45, ease: 'back.out(1.7)' });
        }
        gameState.previousGold.player1 = newGold1;
    }
    if (newGold2 !== gameState.previousGold.player2) {
        gold2El.textContent = newGold2;
        if (typeof gsap !== 'undefined') {
            gsap.fromTo(gold2El, { scale: 0.7, textShadow: '0 0 20px rgba(255,215,0,0.9)' },
                { scale: 1, textShadow: '0 0 0px rgba(255,215,0,0)', duration: 0.45, ease: 'back.out(1.7)' });
        }
        gameState.previousGold.player2 = newGold2;
    }

    updateRecruitButtonStates();
}

// ===== 日志 =====================
function _colorizeFactions(text) {
    return text
        .replace(/红军/g, '<span style="color:#ff6666;font-weight:bold;">红军</span>')
        .replace(/蓝军/g, '<span style="color:#6688ff;font-weight:bold;">蓝军</span>');
}

export function logMessage(msg) {
    gameState.logHistory.push(msg);
    if (gameState.logHistory.length > LOG_LIMIT) gameState.logHistory.shift();

    const logList = document.getElementById('logList');
    const logItem = document.createElement('div');
    logItem.className = 'log-item';
    logItem.innerHTML = _colorizeFactions(msg);
    logList.appendChild(logItem);
    logList.scrollTop = logList.scrollHeight;

    while (logList.children.length > LOG_LIMIT) {
        logList.removeChild(logList.firstChild);
    }

    console.log(msg);
}

export function rebuildLogDOM() {
    const logList = document.getElementById('logList');
    logList.innerHTML = '';
    gameState.logHistory.forEach(msg => {
        const logItem = document.createElement('div');
        logItem.className = 'log-item';
        logItem.innerHTML = _colorizeFactions(msg);
        logList.appendChild(logItem);
    });
    logList.scrollTop = logList.scrollHeight;
}

// ===== 日志窗口切换 =====================
function _showLog(overlay, container, btn) {
    overlay.classList.add('show');
    btn.classList.add('active');
    // Reset to default bottom-right position
    container.style.left = '';
    container.style.top = '';
    container.style.right = '16px';
    container.style.bottom = '16px';
}

function _hideLog(overlay, btn) {
    overlay.classList.remove('show');
    btn.classList.remove('active');
}

export function initLogToggle() {
    const toggleBtn = document.getElementById('logToggleBtn');
    const overlay = document.getElementById('logOverlay');
    const container = document.getElementById('logContainer');
    const header = document.getElementById('logHeader');
    const closeBtn = document.getElementById('logCloseBtn');
    if (!toggleBtn || !overlay || !container) return;

    toggleBtn.addEventListener('click', () => {
        if (overlay.classList.contains('show')) {
            _hideLog(overlay, toggleBtn);
        } else {
            _showLog(overlay, container, toggleBtn);
        }
    });

    if (closeBtn) {
        closeBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            _hideLog(overlay, toggleBtn);
        });
    }

    // 点击浮窗外侧区域关闭
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) {
            _hideLog(overlay, toggleBtn);
        }
    });

    // Escape 键关闭
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && overlay.classList.contains('show')) {
            _hideLog(overlay, toggleBtn);
        }
    });

    // 拖动
    if (header) {
        let dragging = false, startX = 0, startY = 0, origLeft = 0, origTop = 0;

        header.addEventListener('mousedown', (e) => {
            if (e.target === closeBtn) return;
            dragging = true;
            const rect = container.getBoundingClientRect();
            // Switch from right/bottom to left/top
            container.style.right = 'auto';
            container.style.bottom = 'auto';
            container.style.left = rect.left + 'px';
            container.style.top = rect.top + 'px';
            container.classList.add('dragging');
            startX = e.clientX;
            startY = e.clientY;
            origLeft = rect.left;
            origTop = rect.top;
            e.preventDefault();
        });

        window.addEventListener('mousemove', (e) => {
            if (!dragging) return;
            const dx = e.clientX - startX;
            const dy = e.clientY - startY;
            container.style.left = Math.max(0, Math.min(window.innerWidth - container.offsetWidth, origLeft + dx)) + 'px';
            container.style.top = Math.max(0, Math.min(window.innerHeight - 40, origTop + dy)) + 'px';
        });

        window.addEventListener('mouseup', () => {
            if (!dragging) return;
            dragging = false;
            container.classList.remove('dragging');
        });
    }
}

// ===== 选中清除 =====================
export function clearselection() {
    gameState.selectedUnit = null;
    gameState.selectedCityTile = null;
    gameState.movableTiles = [];
    gameState.attackableTiles = [];
    gameState.selectionTime = 0;
    updateRecruitButtonStates();
}

// ===== 序列化 / 快照（存档 + 撤销用） =====================
export function serializeState() {
    const tileIndex = new Map();
    gameState.tiles.forEach((t, i) => tileIndex.set(t, i));

    const tilesData = gameState.tiles.map(t => ({
        id: t.id,
        q: t.q, r: t.r, s: t.s,
        campKey: t.camp === CAMP.player1 ? 'p1' : t.camp === CAMP.player2 ? 'p2' : 'neutral',
        isCity: t.isCity,
        districtId: t.districtId,
        terrain: t.terrain,
        startColor: t.startColor,
        targetColor: t.targetColor,
        currentColor: t.currentColor,
        fadeStartTime: t.fadeStartTime,
        unit: t.unit ? {
            id: t.unit.id,
            type: t.unit.type,
            campKey: t.unit.camp === CAMP.player1 ? 'p1' : t.unit.camp === CAMP.player2 ? 'p2' : 'neutral',
            hp: t.unit.hp,
            maxHp: t.unit.maxHp,
            canAct: t.unit.canAct,
            movedThisTurn: t.unit.movedThisTurn,
            counterAttackCount: t.unit.counterAttackCount,
            isNewRecruit: t.unit.isNewRecruit,
            morale: t.unit.morale,
            moraleBoostUntil: t.unit.moraleBoostUntil,
            remainingMP: t.unit.remainingMP
        } : null
    }));

    return {
        tiles: tilesData,
        currentCampKey: gameState.currentCamp === CAMP.player1 ? 'p1' : 'p2',
        playerGold: { ...gameState.playerGold },
        previousGold: { ...gameState.previousGold },
        capturedNeutralCities: [...gameState.capturedNeutralCities],
        turnCounter: gameState.turnCounter,
        gameOver: gameState.gameOver,
        victoryCampKey: gameState.victoryCamp ? (gameState.victoryCamp === CAMP.player1 ? 'p1' : 'p2') : null,
        logHistory: [...gameState.logHistory],
        idCounter: idCounter
    };
}

export function deserializeState(data, HexTileClass, UnitClass) {
    idCounter = data.idCounter;
    gameState.gameOver = data.gameOver;
    gameState.victoryCamp = data.victoryCampKey ? (data.victoryCampKey === 'p1' ? CAMP.player1 : CAMP.player2) : null;
    gameState.currentCamp = data.currentCampKey === 'p1' ? CAMP.player1 : CAMP.player2;
    gameState.playerGold = { ...data.playerGold };
    gameState.previousGold = { ...data.previousGold };
    gameState.capturedNeutralCities = new Set(data.capturedNeutralCities);
    gameState.turnCounter = data.turnCounter;
    gameState.logHistory = [...data.logHistory];

    const campMap = { p1: CAMP.player1, p2: CAMP.player2, neutral: CAMP.neutral };

    // Preserve displayHp for units whose HP hasn't changed (prevents visual flicker on remote state sync)
    const oldDisplayHp = new Map();
    for (const tile of gameState.tiles) {
        if (tile.unit) oldDisplayHp.set(tile.unit.id, { hp: tile.unit.hp, displayHp: tile.unit.displayHp });
    }

    gameState.tiles = data.tiles.map(td => {
        const tile = new HexTileClass(td.q, td.r, td.id);
        tile.s = td.s;
        tile.camp = campMap[td.campKey];
        tile.isCity = td.isCity;
        tile.districtId = td.districtId;
        tile.terrain = td.terrain || 'plains';
        tile.startColor = td.startColor;
        tile.targetColor = td.targetColor;
        tile.currentColor = td.currentColor;
        tile.fadeStartTime = td.fadeStartTime;
        if (td.unit) {
            const unit = new UnitClass(td.unit.type, campMap[td.unit.campKey], tile, td.unit.isNewRecruit, td.unit.id);
            unit.hp = td.unit.hp;
            unit.maxHp = td.unit.maxHp;
            unit.canAct = td.unit.canAct;
            unit.movedThisTurn = td.unit.movedThisTurn;
            unit.counterAttackCount = td.unit.counterAttackCount;
            unit.morale = td.unit.morale || 'normal';
            unit.moraleBoostUntil = td.unit.moraleBoostUntil || 0;
            unit.remainingMP = td.unit.remainingMP ?? unit.config.speed;
            const prev = oldDisplayHp.get(unit.id);
            if (prev && prev.hp === unit.hp) unit.displayHp = prev.displayHp;
            tile.unit = unit;
        }
        return tile;
    });

    rebuildTileMap();
    clearselection();
    rebuildLogDOM();
    updateUI();
    updateButtonColors();
    invalidateBoard();
}

export function snapshotState() {
    return serializeState();
}

export function restoreState(snapshot, HexTileClass, UnitClass) {
    // Clear transient effects so visuals don't linger from the undone action
    const effects = document.querySelector('script[data-effects]');
    // We use a dynamic import approach below — but for simplicity just import inline
    deserializeState(snapshot, HexTileClass, UnitClass);
}

// ==== Toast 胶囊提示 ====
let _toastTimer = null;
function showToast(icon, text, accentColor) {
    let el = document.getElementById('toast');
    if (!el) {
        el = document.createElement('div');
        el.id = 'toast';
        el.innerHTML = '<span class="toast-icon"></span><span class="toast-text"></span>';
        document.body.appendChild(el);
    }
    el.querySelector('.toast-icon').textContent = icon;
    el.querySelector('.toast-icon').style.color = accentColor;
    el.querySelector('.toast-text').textContent = text;

    if (_toastTimer) clearTimeout(_toastTimer);
    if (typeof gsap !== 'undefined') {
        gsap.killTweensOf(el);
        gsap.set(el, { clearProps: 'all' });
        gsap.fromTo(el, { y: -60, opacity: 0 }, { y: 0, opacity: 1, duration: 0.4, ease: 'back.out(1.4)' });
    } else {
        el.classList.remove('hide');
        void el.offsetWidth;
        el.classList.add('show');
    }

    _toastTimer = setTimeout(() => {
        if (typeof gsap !== 'undefined') {
            gsap.to(el, { y: -16, opacity: 0, duration: 0.22, ease: 'power2.in' });
        } else {
            el.classList.remove('show');
            el.classList.add('hide');
        }
    }, 2000);
}

export function notify(text, type = 'info') {
    const cfg = { success: ['✓', '#6fcf7a'], error: ['!', '#e8a840'], info: ['i', '#aac8e0'] };
    const [icon, color] = cfg[type] || cfg.info;
    showToast(icon, text, color);
}

export function saveGame() {
    try {
        const data = serializeState();
        localStorage.setItem('bladesOfHex_save', JSON.stringify(data));
        notify('存档成功', 'success');
        logMessage('游戏已存档');
        return true;
    } catch (e) {
        notify('存档失败', 'error');
        logMessage('存档失败');
        return false;
    }
}

export function loadGame(HexTileClass, UnitClass) {
    try {
        const raw = localStorage.getItem('bladesOfHex_save');
        if (!raw) {
            notify('没有可读取的存档', 'error');
            logMessage('没有找到存档');
            return false;
        }
        const data = JSON.parse(raw);
        deserializeState(data, HexTileClass, UnitClass);
        notify('读档成功', 'success');
        logMessage('游戏已读档');
        return true;
    } catch (e) {
        notify('读档失败', 'error');
        logMessage('读档失败');
        return false;
    }
}

// ===== 远程状态同步（联机模式收到对手操作时调用） =====================
export function applyRemoteState(data, HexTileClass, UnitClass) {
    deserializeState(data, HexTileClass, UnitClass);
}
