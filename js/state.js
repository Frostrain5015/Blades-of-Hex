import { CAMP, LOG_LIMIT, UNIT_CONFIG, invalidateBoard, calcIncome, WEATHER_CONFIG } from './config.js';
import { getCommander, getCommanderRecruitCost } from './commanderInterface.js';
import { isNetworkGame, isMyTurn, getMyRole, sendAction } from './network.js';

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
export const gameState = {
    tiles: [],
    tileMap: new Map(),
    currentCamp: CAMP.player1,
    playerGold: { player1: 40, player2: 40, neutral: 20 },
    selectedUnit: null,
    movableTiles: [],
    moveParents: new Map(),
    attackableTiles: [],
    damageTexts: [],
    healTexts: [],
    selectedCityTile: null,
    selectedTile: null,
    goldTexts: [],
    hoveredTile: null,
    selectionTime: 0,
    gameOver: false,
    victoryCamp: null,
    previousGold: { player1: 25, player2: 25, neutral: 25 },
    undoStack: [],
    turnCounter: 0,
    logHistory: [],
    killCount: { player1: 0, player2: 0, neutral: 0 },
    aiActing: false,
    weather: 'clear',
    lastWeather: null,
    deselecting: false,
    deselectionTime: 0,
    deselectMoveTiles: [],
    deselectAtkTiles: [],
    deselectOrigin: null,
    // 将领系统
    commanderPoolP1: [],
    commanderPoolP2: [],
    commanderP1: null,
    commanderP2: null,
    commanderP1Confirmed: false,
    commanderP2Confirmed: false,
    commanderP1Deployed: false,
    commanderP2Deployed: false,
    commanderPhase: 'done',  // 'selection' | 'deployment' | 'done'
    factionMoraleBoost: { player1: 0, player2: 0 }
};

// ===== 重置游戏状态（再来一局时调用） =====================
export function resetGameState() {
    gameState.tiles = [];
    gameState.tileMap = new Map();
    gameState.currentCamp = CAMP.player1;
    gameState.playerGold = { player1: 40, player2: 40, neutral: 20 };
    gameState.selectedUnit = null;
    gameState.movableTiles = [];
    gameState.moveParents = new Map();
    gameState.attackableTiles = [];
    gameState.damageTexts = [];
    gameState.healTexts = [];
    gameState.selectedCityTile = null;
    gameState.selectedTile = null;
    gameState.goldTexts = [];
    gameState.hoveredTile = null;
    gameState.selectionTime = 0;
    gameState.gameOver = false;
    gameState.victoryCamp = null;
    gameState.previousGold = { player1: 25, player2: 25, neutral: 25 };
    gameState.undoStack = [];
    gameState.turnCounter = 0;
    gameState.logHistory = [];
    gameState.killCount = { player1: 0, player2: 0, neutral: 0 };
    gameState.aiActing = false;
    gameState.weather = 'clear';
    gameState.lastWeather = null;
    gameState.deselecting = false;
    gameState.deselectionTime = 0;
    gameState.deselectMoveTiles = [];
    gameState.deselectAtkTiles = [];
    gameState.deselectOrigin = null;
    gameState.commanderPoolP1 = [];
    gameState.commanderPoolP2 = [];
    gameState.commanderP1 = null;
    gameState.commanderP2 = null;
    gameState.commanderP1Confirmed = false;
    gameState.commanderP2Confirmed = false;
    gameState.commanderP1Deployed = false;
    gameState.commanderP2Deployed = false;
    gameState.commanderPhase = 'done';
    gameState.factionMoraleBoost = { player1: 0, player2: 0 };
    // 清除计数器动画记忆
    for (const k of Object.keys(_counterStore)) delete _counterStore[k];
}

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
    const myCamp = _getMyCamp();
    const displayCamp = isNetworkGame() ? myCamp : gameState.currentCamp;
    const panel = document.getElementById('commandPanel');
    if (panel) {
        panel.setAttribute('data-camp', displayCamp === CAMP.player1 ? 'p1' : 'p2');
    }
    const card1 = document.getElementById('campCard1');
    const card2 = document.getElementById('campCard2');
    if (card1) card1.classList.toggle('active', displayCamp === CAMP.player1);
    if (card2) card2.classList.toggle('active', displayCamp === CAMP.player2);
}

function _getMyCamp() {
    if (isNetworkGame()) {
        return getMyRole() === 'player1' ? CAMP.player1 : CAMP.player2;
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
    const types = ['infantry', 'cavalry', 'archer'];
    const btnIds = ['recruitInfantry', 'recruitCavalry', 'recruitArcher'];
    for (let i = 0; i < types.length; i++) {
        const btn = document.getElementById(btnIds[i]);
        if (!btn) continue;
        const costSpan = btn.querySelector('.unit-cost');
        if (!costSpan) continue;
        const baseCost = UNIT_CONFIG[types[i]].cost;
        const cost = _getRecruitCost(types[i]);
        const discountSuffix = cost < baseCost ? '<small> (-20%)</small>' : '';
        costSpan.innerHTML = `<span class="unit-cost-num">${cost}</span><small>g</small>${discountSuffix}`;
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
    const inCommanderSetup = gameState.commanderPhase === 'selection' || gameState.commanderPhase === 'deployment';
    if (opponentTurn || isNeutralTurn || gameState.gameOver || inCommanderSetup) {
        for (const btn of Object.values(btns)) {
            if (btn) { btn.disabled = true; btn.classList.remove('available'); }
        }
        return;
    }

    const city = gameState.selectedCityTile;
    const canRecruit = city && city.isCity && city.camp === gameState.currentCamp && !city.unit;
    const currentKey = gameState.currentCamp === CAMP.player1 ? 'player1' : gameState.currentCamp === CAMP.player2 ? 'player2' : 'neutral';
    const gold = gameState.playerGold[currentKey];

    for (const [type, btn] of Object.entries(btns)) {
        if (!btn) continue;
        const cost = _getRecruitCost(type);
        const affordable = gold >= cost;
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
    if (gameState.commanderPhase === 'deployment') {
        turnEl.textContent = '⚑ 部署';
        turnEl.style.color = '#ffd700';
    } else {
        turnEl.textContent = gameState.currentCamp.name;
        if (typeof gsap !== 'undefined') {
            gsap.to(turnEl, { color: gameState.currentCamp.color, duration: 0.35 });
        } else {
            turnEl.style.color = gameState.currentCamp.color;
        }
    }
    const gold1El = document.getElementById('player1Gold');
    const gold2El = document.getElementById('player2Gold');
    const newGold1 = gameState.playerGold.player1;
    const newGold2 = gameState.playerGold.player2;
    // 联机/中立回合：禁用操作按钮、显示提示条
    const opponentTurn = isNetworkGame() && !isMyTurn(gameState.currentCamp);
    const isNeutralTurn = gameState.currentCamp === CAMP.neutral;
    const inCommanderSetup = gameState.commanderPhase === 'selection' || gameState.commanderPhase === 'deployment';
    const disableBtns = opponentTurn || isNeutralTurn || gameState.gameOver || inCommanderSetup;
    ['endTurnBtn', 'recruitInfantry', 'recruitCavalry', 'recruitArcher'].forEach(id => {
        const btn = document.getElementById(id);
        if (btn) btn.disabled = disableBtns;
    });
    // 投降按钮在非己方回合亦可使用，仅在选将/部署/游戏结束时禁用
    const surrenderBtn = document.getElementById('surrenderBtn');
    if (surrenderBtn) surrenderBtn.disabled = gameState.gameOver || inCommanderSetup;
    const banner = document.getElementById('opponentTurnBanner');
    if (gameState.commanderPhase === 'deployment') {
        // 部署阶段：自己已部署且对方未部署时才显示等待横幅
        const myRoleDeployed = isNetworkGame()
            ? (getMyRole() === 'player1' ? gameState.commanderP1Deployed : gameState.commanderP2Deployed)
            : (gameState.currentCamp === CAMP.player1 ? gameState.commanderP1Deployed : gameState.commanderP2Deployed);
        const bothDeployed = gameState.commanderP1Deployed && gameState.commanderP2Deployed;
        if (banner) {
            if (myRoleDeployed && !bothDeployed) {
                banner.innerHTML = '<span>⏳</span><span>等待对手部署...</span>';
                banner.style.display = 'flex';
            } else {
                banner.style.display = 'none';
            }
        }
    } else if (banner) {
        banner.innerHTML = '<span>⏳</span><span>等待对手行动...</span>';
        banner.style.display = (opponentTurn || isNeutralTurn) ? 'flex' : 'none';
    }

    if (newGold1 !== gameState.previousGold.player1) {
        animateCounter(gold1El, newGold1, n => String(n));
        if (typeof gsap !== 'undefined') {
            gsap.fromTo(gold1El, { scale: 0.85, textShadow: '0 0 20px rgba(255,215,0,0.9)' },
                { scale: 1, textShadow: '0 0 0px rgba(255,215,0,0)', duration: 0.45, ease: 'back.out(1.7)' });
        }
        gameState.previousGold.player1 = newGold1;
    }
    if (newGold2 !== gameState.previousGold.player2) {
        animateCounter(gold2El, newGold2, n => String(n));
        if (typeof gsap !== 'undefined') {
            gsap.fromTo(gold2El, { scale: 0.85, textShadow: '0 0 20px rgba(255,215,0,0.9)' },
                { scale: 1, textShadow: '0 0 0px rgba(255,215,0,0)', duration: 0.45, ease: 'back.out(1.7)' });
        }
        gameState.previousGold.player2 = newGold2;
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
    console.log(msg);
}

export function updateStatsPanel() {
    const content = document.getElementById('statsContent');
    if (!content) return;
    const p1c = gameState.tiles.filter(t => t.isCity && t.camp === CAMP.player1).length;
    const p2c = gameState.tiles.filter(t => t.isCity && t.camp === CAMP.player2).length;
    const nc  = gameState.tiles.filter(t => t.isCity && t.camp === CAMP.neutral).length;
    const p1i = calcIncome(p1c);
    const p2i = calcIncome(p2c);
    const ni  = calcIncome(nc);

    if (gameState.commanderPhase === 'deployment') {
        content.innerHTML = `
            <div class="stat-turn-label">阶段</div>
            <div class="stat-turn-num" style="font-size:22px;color:#ffd700;">部署</div>
            <div class="stat-row"><span class="stat-p1">红军</span><span class="stat-val">🏰${p1c}</span></div>
            <div class="stat-row"><span class="stat-p2">蓝军</span><span class="stat-val">🏰${p2c}</span></div>
            <div class="stat-row"><span class="stat-n">中立</span><span class="stat-val">🏰${nc}</span></div>
        `;
    } else {
        const turnNum = Math.floor(gameState.turnCounter / 3) + 1;
        content.innerHTML = `
            <div class="stat-turn-label">回合</div>
            <div class="stat-turn-num">${turnNum}</div>
            <div class="stat-row"><span class="stat-p1">红军</span><span class="stat-val">⚔${gameState.killCount.player1} 🏰${p1c} ⚱${p1i}</span></div>
            <div class="stat-row"><span class="stat-p2">蓝军</span><span class="stat-val">⚔${gameState.killCount.player2} 🏰${p2c} ⚱${p2i}</span></div>
            <div class="stat-row"><span class="stat-n">中立</span><span class="stat-val">⚔${gameState.killCount.neutral} 🏰${nc} ⚱${ni}</span></div>
        `;
        const turnEl = content.querySelector('.stat-turn-num');
        if (turnEl) animateCounter(turnEl, turnNum, n => String(n), 'turnNum');
    }
}

// ===== 部署完成收尾（单机/联机统一入口） =====================
export function finalizeDeployment() {
    if (gameState.commanderPhase === 'done') return; // 防止重复调用
    gameState.commanderPhase = 'done';
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
    updateRecruitButtonStates();
}

export function deselectUnit() {
    gameState.deselectMoveTiles = [...gameState.movableTiles];
    gameState.deselectAtkTiles = [...gameState.attackableTiles];
    gameState.deselectOrigin = gameState.selectedUnit ? gameState.selectedUnit.tile : null;
    gameState.deselecting = true;
    gameState.deselectionTime = Date.now();
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
            remainingMP: t.unit.remainingMP,
            commander: t.unit.commander,
            _centurionTriggered: t.unit._centurionTriggered,
            _atkBonus: t.unit._atkBonus,
            displaySpeed: t.unit.displaySpeed,
            xp: t.unit._xp,
            rank: t.unit._rank,
            fallen: t.unit._fallen || false,
            activeSkillCD: t.unit.activeSkillCD,
            activeSkillDur: t.unit.activeSkillDur,
            gongxinStacks: t.unit._gongxinStacks || 0
        } : null
    }));

    return {
        tiles: tilesData,
        serializedAt: Date.now(),
        currentCampKey: gameState.currentCamp === CAMP.player1 ? 'p1' : gameState.currentCamp === CAMP.player2 ? 'p2' : 'neutral',
        playerGold: { ...gameState.playerGold },
        turnCounter: gameState.turnCounter,
        gameOver: gameState.gameOver,
        victoryCampKey: gameState.victoryCamp ? (gameState.victoryCamp === CAMP.player1 ? 'p1' : gameState.victoryCamp === CAMP.player2 ? 'p2' : 'neutral') : null,
        logHistory: [...gameState.logHistory],
        idCounter: idCounter,
        weather: gameState.weather,
        lastWeather: gameState.lastWeather,
        killCount: { ...gameState.killCount },
        commanderPoolP1: [...gameState.commanderPoolP1],
        commanderPoolP2: [...gameState.commanderPoolP2],
        commanderP1: gameState.commanderP1,
        commanderP2: gameState.commanderP2,
        commanderP1Confirmed: gameState.commanderP1Confirmed,
        commanderP2Confirmed: gameState.commanderP2Confirmed,
        commanderP1Deployed: gameState.commanderP1Deployed,
        commanderP2Deployed: gameState.commanderP2Deployed,
        commanderPhase: gameState.commanderPhase,
        factionMoraleBoost: { ...gameState.factionMoraleBoost }
    };
}

export function deserializeState(data, HexTileClass, UnitClass) {
    const campMap = { p1: CAMP.player1, p2: CAMP.player2, neutral: CAMP.neutral };

    idCounter = data.idCounter;
    gameState.gameOver = data.gameOver;
    gameState.victoryCamp = data.victoryCampKey ? campMap[data.victoryCampKey] : null;
    gameState.currentCamp = campMap[data.currentCampKey] || CAMP.player1;
    gameState.playerGold = { player1: 40, player2: 40, neutral: 20, ...data.playerGold };
    // previousGold 不参与同步，保持本地值用于计数器动画
    gameState.turnCounter = data.turnCounter;
    gameState.logHistory = [...data.logHistory];
    gameState.weather = data.weather || 'clear';
    gameState.lastWeather = data.lastWeather || null;
    if (data.killCount) gameState.killCount = { player1: 0, player2: 0, neutral: 0, ...data.killCount };
    gameState.commanderPoolP1 = data.commanderPoolP1 || [];
    gameState.commanderPoolP2 = data.commanderPoolP2 || [];
    gameState.commanderP1 = data.commanderP1 || null;
    gameState.commanderP2 = data.commanderP2 || null;
    gameState.commanderP1Confirmed = data.commanderP1Confirmed || false;
    gameState.commanderP2Confirmed = data.commanderP2Confirmed || false;
    gameState.commanderP1Deployed = data.commanderP1Deployed || false;
    gameState.commanderP2Deployed = data.commanderP2Deployed || false;
    gameState.commanderPhase = data.commanderPhase || 'done';
    if (data.factionMoraleBoost) {
        gameState.factionMoraleBoost = { player1: 0, player2: 0, ...data.factionMoraleBoost };
    } else {
        gameState.factionMoraleBoost = { player1: 0, player2: 0 };
    }

    // Preserve displayHp & commander for units (prevents flicker & commander loss on sync)
    const oldDisplayHp = new Map();
    const oldCommander = new Map();
    for (const tile of gameState.tiles) {
        if (tile.unit) {
            oldDisplayHp.set(tile.unit.id, { hp: tile.unit.hp, displayHp: tile.unit.displayHp });
            if (tile.unit.commander) {
                oldCommander.set(tile.unit.id, {
                    commander: tile.unit.commander,
                    _atkBonus: tile.unit._atkBonus,
                    displaySpeed: tile.unit.displaySpeed
                });
            }
        }
    }

    // 校准渐变动画时间戳，补偿网络延迟
    const timeDelta = data.serializedAt ? Date.now() - data.serializedAt : 0;

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
        // 将主机时间戳校准为本地时间，若动画已过期则直接应用目标色
        if (td.fadeStartTime) {
            const adjustedStart = td.fadeStartTime + timeDelta;
            if (Date.now() - adjustedStart >= tile.fadeDuration) {
                tile.fadeStartTime = null;
                tile.currentColor = tile.targetColor;
                tile.startColor = tile.targetColor;
            } else {
                tile.fadeStartTime = adjustedStart;
            }
        } else {
            tile.fadeStartTime = null;
        }
        if (td.unit) {
            const unit = new UnitClass(td.unit.type, campMap[td.unit.campKey], tile, td.unit.isNewRecruit, td.unit.id);
            unit.hp = td.unit.hp;
            unit.maxHp = td.unit.maxHp;
            unit.canAct = td.unit.canAct;
            unit.movedThisTurn = td.unit.movedThisTurn;
            unit.counterAttackCount = td.unit.counterAttackCount;
            const rawMorale = td.unit.morale;
            if (typeof rawMorale === 'number') unit.morale = rawMorale;
            else if (rawMorale === 'high') unit.morale = 3;
            else if (rawMorale === 'low') unit.morale = 1;
            else if (rawMorale === 'chaos') unit.morale = 0;
            else unit.morale = 2;
            unit.moraleBoostUntil = td.unit.moraleBoostUntil || 0;
            unit.remainingMP = td.unit.remainingMP ?? unit.config.speed;
            unit.commander = td.unit.commander || null;
            unit._centurionTriggered = td.unit._centurionTriggered || false;
            unit._atkBonus = td.unit._atkBonus || 0;
            unit.displaySpeed = td.unit.displaySpeed ?? unit.config.speed;
            unit._xp = td.unit.xp || 0;
            unit._rank = td.unit.rank || 0;
            unit._fallen = td.unit.fallen || false;
            unit.activeSkillCD = td.unit.activeSkillCD || 0;
            unit.activeSkillDur = td.unit.activeSkillDur || 0;
            unit._gongxinStacks = td.unit.gongxinStacks || 0;
            // 保留本地已知的将领数据（对方状态同步中可能缺失我方部署的将领）
            if (!unit.commander) {
                const saved = oldCommander.get(unit.id);
                if (saved) {
                    unit.commander = saved.commander;
                    unit._atkBonus = saved._atkBonus;
                    unit.displaySpeed = saved.displaySpeed;
                }
            }
            const prev = oldDisplayHp.get(unit.id);
            if (prev && prev.hp === unit.hp) unit.displayHp = prev.displayHp;
            tile.unit = unit;
        }
        return tile;
    });

    rebuildTileMap();
    clearselection();
    updateStatsPanel();
    updateUI();
    updateButtonColors();
    invalidateBoard();
}

// ==== Toast 胶囊提示 ====
let _toastTimer = null;
let _toastPersistent = false;
function showToast(icon, text, accentColor, persistent = false) {
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
    _toastPersistent = persistent;
    if (typeof gsap !== 'undefined') {
        gsap.killTweensOf(el);
        gsap.set(el, { clearProps: 'all' });
        gsap.fromTo(el, { y: -60, opacity: 0 }, { y: 0, opacity: 1, duration: 0.4, ease: 'back.out(1.4)' });
    } else {
        el.classList.remove('hide');
        void el.offsetWidth;
        el.classList.add('show');
    }

    if (!persistent) {
        _toastTimer = setTimeout(() => _dismissToast(), 2000);
    }
}

function _dismissToast() {
    const el = document.getElementById('toast');
    if (!el) return;
    _toastPersistent = false;
    if (_toastTimer) clearTimeout(_toastTimer);
    if (typeof gsap !== 'undefined') {
        gsap.to(el, { y: -16, opacity: 0, duration: 0.22, ease: 'power2.in' });
    } else {
        el.classList.remove('show');
        el.classList.add('hide');
    }
}

export function dismissToast() {
    _dismissToast();
}

export function notify(text, type = 'info', persistent = false) {
    if (gameState.aiActing && type === 'error') return;
    const cfg = { success: ['✓', '#6fcf7a'], error: ['!', '#e8a840'], info: ['i', '#aac8e0'], warn: ['⚠', '#e8a840'] };
    const [icon, color] = cfg[type] || cfg.info;
    showToast(icon, text, color, persistent);
}

export function saveGame(silent = false) {
    try {
        const data = serializeState();
        localStorage.setItem('bladesOfHex_save', JSON.stringify(data));
        if (!silent) notify('存档成功', 'success');
        logMessage('游戏已存档');
        return true;
    } catch (e) {
        if (!silent) notify('存档失败', 'error');
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
    // 远端状态同步后清除本地选中，避免对手回合残留光圈
    gameState.selectedUnit = null;
    gameState.selectedCityTile = null;
    gameState.selectedTile = null;
    gameState.movableTiles = [];
    gameState.attackableTiles = [];
}
