import { CAMP, LOG_LIMIT, UNIT_CONFIG, invalidateBoard, WEATHER_CONFIG, HEX_NEIGHBORS, hexEdge, HEX_SIZE, getRound } from './config.js';
import { nextId, getCounter, setCounter } from './uid.js';
import { computeCampBorders, computeDistrictBorders } from './HexTile.js';
import { getCommander, getCommanderRecruitCost } from './commanderInterface.js';
import { isNetworkGame, isMyTurn, getMyRole, sendAction } from './network.js';
import { createRng } from '../core/rng.js';

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
    playerGold: { player1: 4, player2: 4, player3: 4, neutral: 4 },
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
    previousGold: { player1: 4, player2: 4, player3: 4, neutral: 4 },
    turnCounter: 0,
    logHistory: [],
    killCount: { player1: 0, player2: 0, player3: 0, neutral: 0 },
    aiActing: false,
    gameMode: 'local',      // 'local' | 'pve' | 'network'
    aiOpponentCamp: null,   // PVE 模式下 AI 对手的阵营（CAMP.player1 或 CAMP.player2）
    isThreePlayer: false,   // 三人模式
    surrenderedCamps: [],   // 三人模式中已投降的阵营
    weather: 'clear',
    lastWeather: null,
    weatherLockUntil: 0,  // E1: 占星者星移锁定天气至该回合
    _cardOverrides: {},   // E3: 纵横家合纵卡牌覆盖 { campKey: { handSizeBonus, useBonus } }
    _soulMarks: [],       // E2: 亡灵法师亡魂标记 [{ q, r, campKey, bornAt }]
    _fuel: { player1: 0, player2: 0, player3: 0 },  // E4: 空军上校燃料
    _colonelDeployed: {}, // E4: 上校部署标记 { campKey: bool }
    // 模拟用确定性 RNG(战斗/卡牌/将领/天气掷骰)。永不为 null;对局开始时由
    // seedMatchRng() 重新播种。装饰性随机不走这里。状态随 serialize 同步,
    // 使联机收方与重连保持一致。详见 core/rng.js。
    rng: createRng((Date.now() >>> 0) || 1),
    deselecting: false,
    deselectionTime: 0,
    deselectMoveTiles: [],
    deselectAtkTiles: [],
    deselectOrigin: null,
    // 将领系统
    commanderPoolP1: [],
    commanderPoolP2: [],
    commanderPoolP3: [],
    commanderP1: null,
    commanderP2: null,
    commanderP3: null,
    commanderP1Confirmed: false,
    commanderP2Confirmed: false,
    commanderP3Confirmed: false,
    commanderP1Deployed: false,
    commanderP2Deployed: false,
    commanderP3Deployed: false,
    commanderPhase: 'done',  // 'selection' | 'deployment' | 'done'
    factionMoraleBoost: { player1: 0, player2: 0, player3: 0 },
    // 对策卡系统 v2
    cardDrawPile: [],
    cardDiscardPile: [],
    playerHands: { player1: [], player2: [], player3: [] },
    playerDrawsThisTurn: { player1: 0, player2: 0, player3: 0 },
    playerUsesThisTurn: { player1: 0, player2: 0, player3: 0 },
    cardStackExpanded: false,
    cardTargeting: null,
    // 战争迷雾（遭遇战模式）
    skirmishFog: false,
    visibleTiles: { player1: new Set(), player2: new Set(), player3: new Set() },
    exploredTiles: { player1: new Set(), player2: new Set(), player3: new Set() },
    _prevVisibleTiles: { player1: new Set(), player2: new Set(), player3: new Set() },
    _fogTransitionStart: 0,
    // 侦察揭示：{ player1: Map("q,r" → expiresAt), ... }
    scoutReveals: { player1: new Map(), player2: new Map(), player3: new Map() },
    // 国界线（阵营交界边集）
    campBorderEdges: [],
    // 行政区界线（同阵营不同行政区交界）
    districtBorderEdges: [],
    // 村庄：Map("q,r" → { districtId, q, r })
    villageTiles: new Map(),
    // PVE 难度：对手 AI 经济倍率（不影响中立 AI）
    aiDifficulty: 1.0,
    // 遭遇战胜利时保存的完整棋盘快照（用于查看完整棋局）
    _victoryBoardSnapshot: null
};

// ===== 重置游戏状态（再来一局时调用） =====================
export function resetGameState() {
    gameState.tiles = [];
    gameState.tileMap = new Map();
    gameState.currentCamp = CAMP.player1;
    gameState.playerGold = { player1: 4, player2: 4, player3: 4, neutral: 4 };
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
    gameState.previousGold = { player1: -1, player2: -1, player3: -1, neutral: -1 };
    gameState.turnCounter = 0;
    // 新对局重新播种模拟 RNG(联机模式随后会被 state-sync 对齐;可由
    // seedMatchRng 显式指定共享种子以做到开局即跨端确定)。
    gameState.rng.setState((Date.now() >>> 0) ^ ((Math.random() * 0x7fffffff) >>> 0));
    gameState.logHistory = [];
    gameState.killCount = { player1: 0, player2: 0, player3: 0, neutral: 0 };
    gameState._friendlyDeathCount = {};
    gameState.aiActing = false;
    gameState.gameMode = 'local';
    gameState.aiOpponentCamp = null;
    gameState.isThreePlayer = false;
    gameState.surrenderedCamps = [];
    gameState.weather = 'clear';
    gameState.lastWeather = null;
    gameState.weatherLockUntil = 0;
    gameState._cardOverrides = {};
    gameState._soulMarks = [];
    gameState._fuel = { player1: 0, player2: 0, player3: 0 };
    gameState._colonelDeployed = {};
    gameState.deselecting = false;
    gameState.deselectionTime = 0;
    gameState.deselectMoveTiles = [];
    gameState.deselectAtkTiles = [];
    gameState.deselectOrigin = null;
    gameState.skirmishFog = false;
    gameState.visibleTiles = { player1: new Set(), player2: new Set(), player3: new Set() };
    gameState.exploredTiles = { player1: new Set(), player2: new Set(), player3: new Set() };
    gameState._prevVisibleTiles = { player1: new Set(), player2: new Set(), player3: new Set() };
    gameState._fogTransitionStart = 0;
    gameState.scoutReveals = { player1: new Map(), player2: new Map(), player3: new Map() };
    gameState.campBorderEdges = [];
    gameState.districtBorderEdges = [];
    gameState.villageTiles = new Map();
    gameState.aiDifficulty = 1.0;
    gameState._victoryBoardSnapshot = null;
    gameState.commanderPoolP1 = [];
    gameState.commanderPoolP2 = [];
    gameState.commanderPoolP3 = [];
    gameState.commanderP1 = null;
    gameState.commanderP2 = null;
    gameState.commanderP3 = null;
    gameState.commanderP1Confirmed = false;
    gameState.commanderP2Confirmed = false;
    gameState.commanderP3Confirmed = false;
    gameState.commanderP1Deployed = false;
    gameState.commanderP2Deployed = false;
    gameState.commanderP3Deployed = false;
    gameState.commanderPhase = 'done';
    gameState.factionMoraleBoost = { player1: 0, player2: 0, player3: 0 };
    gameState.cardDrawPile = [];
    gameState.cardDiscardPile = [];
    gameState.playerHands = { player1: [], player2: [], player3: [] };
    gameState.playerDrawsThisTurn = { player1: 0, player2: 0, player3: 0 };
    gameState.playerUsesThisTurn = { player1: 0, player2: 0, player3: 0 };
    gameState.cardStackExpanded = false;
    gameState.cardTargeting = null;
    // 清除计数器动画记忆
    for (const k of Object.keys(_counterStore)) delete _counterStore[k];
}

export function rebuildTileMap() {
    gameState.tileMap = new Map();
    for (const tile of gameState.tiles) {
        gameState.tileMap.set(`${tile.q},${tile.r}`, tile);
    }
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
        font-size: 15px; font-weight: bold; font-family: Arial, sans-serif;
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
    console.log(msg);
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
    const tileIndex = new Map();
    gameState.tiles.forEach((t, i) => tileIndex.set(t, i));

    function _campToKey(c) { return c === CAMP.player1 ? 'p1' : c === CAMP.player2 ? 'p2' : c === CAMP.player3 ? 'p3' : 'neutral'; }
    const tilesData = gameState.tiles.map(t => ({
        id: t.id,
        q: t.q, r: t.r, s: t.s,
        campKey: _campToKey(t.camp),
        isCity: t.isCity,
        isVillage: t.isVillage,
        villageDistrictId: t.villageDistrictId,
        districtId: t.districtId,
        terrain: t.terrain,
        startColor: t.startColor,
        targetColor: t.targetColor,
        currentColor: t.currentColor,
        fadeStartTime: t.fadeStartTime,
        minePlanted: t._minePlanted || false,
        mineCampKey: t._mineCampKey || null,
        cityDisabledUntil: t._cityDisabledUntil || 0,
        reinforcedThisTurn: t._reinforcedThisTurn || false,
        unit: t.unit ? {
            id: t.unit.id,
            type: t.unit.type,
            campKey: _campToKey(t.unit.camp),
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
            _rankDefBonus: t.unit._rankDefBonus || 0,
            _rankCritBonus: t.unit._rankCritBonus || 0,
            _rankRegenPct: t.unit._rankRegenPct || 0,
            displaySpeed: t.unit.displaySpeed,
            xp: t.unit._xp,
            rank: t.unit._rank,
            fallen: t.unit._fallen || false,
            activeSkillCD: t.unit.activeSkillCD,
            activeSkillDur: t.unit.activeSkillDur,
            phantomStacks: t.unit._phantomStacks || 0,
            gongxinStacks: t.unit._gongxinStacks || 0,
            gongxinCampKey: t.unit._gongxinCamp ? _campToKey(t.unit._gongxinCamp) : null,
            imprisoned: t.unit._imprisoned || false,
            isImmobile: t.unit._isImmobile || false,
            airdropWaiting: t.unit._airdropWaiting || false,
            martyrPrimed: t.unit._martyrPrimed || false,
            elegyBonus: t.unit._elegyBonus || 0,
            elegyProcessed: t.unit._elegyProcessed || 0,
            isSoulMinion: t.unit._isSoulMinion || false,
            shield: t.unit._shield || 0,
            shieldMax: t.unit._shieldMax || 0,
            shieldTurns: t.unit._shieldTurns || 0,
            faith: t.unit._faith || 0,
            oathGainTurn: t.unit._oathGainTurn ?? null,
            smiteReady: t.unit._smiteReady || false,
            smiteCharged: t.unit._smiteCharged || false,
            healingAura: t.unit._healingAura || 0,
            activeSkillBuffs: t.unit._activeSkillBuffs || null
        } : null
    }));

    return {
        tiles: tilesData,
        serializedAt: Date.now(),
        currentCampKey: _campToKey(gameState.currentCamp),
        playerGold: { ...gameState.playerGold },
        turnCounter: gameState.turnCounter,
        gameOver: gameState.gameOver,
        victoryCampKey: gameState.victoryCamp ? _campToKey(gameState.victoryCamp) : null,
        logHistory: [...gameState.logHistory],
        idCounter: getCounter(),
        weather: gameState.weather,
        lastWeather: gameState.lastWeather,
        weatherLockUntil: gameState.weatherLockUntil || 0,
        cardOverrides: gameState._cardOverrides || {},
        soulMarks: (gameState._soulMarks || []).map(m => ({ ...m })),
        fuel: { ...(gameState._fuel || {}) },
        colonelDeployed: { ...(gameState._colonelDeployed || {}) },
        rngState: gameState.rng.getState(),
        killCount: { ...gameState.killCount },
        friendlyDeathCount: { ...(gameState._friendlyDeathCount || {}) },
        commanderPoolP1: [...gameState.commanderPoolP1],
        commanderPoolP2: [...gameState.commanderPoolP2],
        commanderPoolP3: [...gameState.commanderPoolP3],
        commanderP1: gameState.commanderP1,
        commanderP2: gameState.commanderP2,
        commanderP3: gameState.commanderP3,
        commanderP1Confirmed: gameState.commanderP1Confirmed,
        commanderP2Confirmed: gameState.commanderP2Confirmed,
        commanderP3Confirmed: gameState.commanderP3Confirmed,
        commanderP1Deployed: gameState.commanderP1Deployed,
        commanderP2Deployed: gameState.commanderP2Deployed,
        commanderP3Deployed: gameState.commanderP3Deployed,
        commanderPhase: gameState.commanderPhase,
        factionMoraleBoost: { ...gameState.factionMoraleBoost },
        cardDrawPile: [...gameState.cardDrawPile],
        cardDiscardPile: [...gameState.cardDiscardPile],
        playerHands: { player1: [...gameState.playerHands.player1], player2: [...gameState.playerHands.player2], player3: [...gameState.playerHands.player3] },
        playerDrawsThisTurn: { ...gameState.playerDrawsThisTurn },
        playerUsesThisTurn: { ...gameState.playerUsesThisTurn },
        gameMode: gameState.gameMode || 'local',
        isThreePlayer: gameState.isThreePlayer || false,
        aiOpponentCampKey: gameState.aiOpponentCamp ? _campToKey(gameState.aiOpponentCamp) : null,
        surrenderedCampKeys: gameState.surrenderedCamps.map(c => _campToKey(c)),
        skirmishFog: gameState.skirmishFog || false,
        aiDifficulty: gameState.aiDifficulty || 1.0,
        visibleTiles: gameState.visibleTiles ? {
            player1: [...gameState.visibleTiles.player1],
            player2: [...gameState.visibleTiles.player2],
            player3: [...gameState.visibleTiles.player3]
        } : { player1: [], player2: [], player3: [] },
        exploredTiles: gameState.exploredTiles ? {
            player1: [...gameState.exploredTiles.player1],
            player2: [...gameState.exploredTiles.player2],
            player3: [...gameState.exploredTiles.player3]
        } : { player1: [], player2: [], player3: [] },
        scoutReveals: gameState.scoutReveals ? {
            player1: [...gameState.scoutReveals.player1],
            player2: [...gameState.scoutReveals.player2],
            player3: [...gameState.scoutReveals.player3]
        } : { player1: [], player2: [], player3: [] },
        villageTiles: [...gameState.villageTiles]
    };
}

export function deserializeState(data, HexTileClass, UnitClass) {
    const campMap = { p1: CAMP.player1, p2: CAMP.player2, p3: CAMP.player3, neutral: CAMP.neutral };

    setCounter(data.idCounter);
    gameState.gameOver = data.gameOver;
    gameState.victoryCamp = data.victoryCampKey ? campMap[data.victoryCampKey] : null;
    gameState.currentCamp = campMap[data.currentCampKey] || CAMP.player1;
    gameState.playerGold = { player1: 4, player2: 4, player3: 4, neutral: 4, ...data.playerGold };
    // previousGold 不参与同步，保持本地值用于计数器动画
    gameState.turnCounter = data.turnCounter;
    gameState.logHistory = [...data.logHistory];
    gameState.weather = data.weather || 'clear';
    gameState.lastWeather = data.lastWeather || null;
    gameState.weatherLockUntil = data.weatherLockUntil || 0;
    gameState._cardOverrides = data.cardOverrides || {};
    gameState._soulMarks = data.soulMarks || [];
    gameState._fuel = data.fuel || { player1: 0, player2: 0, player3: 0 };
    gameState._colonelDeployed = data.colonelDeployed || {};
    // 恢复模拟 RNG 状态(旧版本快照无此字段时保持当前 rng,不影响)
    if (data.rngState != null) gameState.rng.setState(data.rngState);
    if (data.killCount) gameState.killCount = { player1: 0, player2: 0, player3: 0, neutral: 0, ...data.killCount };
    gameState._friendlyDeathCount = data.friendlyDeathCount || {};
    gameState.commanderPoolP1 = data.commanderPoolP1 || [];
    gameState.commanderPoolP2 = data.commanderPoolP2 || [];
    gameState.commanderPoolP3 = data.commanderPoolP3 || [];
    gameState.commanderP1 = data.commanderP1 || null;
    gameState.commanderP2 = data.commanderP2 || null;
    gameState.commanderP3 = data.commanderP3 || null;
    gameState.commanderP1Confirmed = data.commanderP1Confirmed || false;
    gameState.commanderP2Confirmed = data.commanderP2Confirmed || false;
    gameState.commanderP3Confirmed = data.commanderP3Confirmed || false;
    gameState.commanderP1Deployed = data.commanderP1Deployed || false;
    gameState.commanderP2Deployed = data.commanderP2Deployed || false;
    gameState.commanderP3Deployed = data.commanderP3Deployed || false;
    gameState.commanderPhase = data.commanderPhase || 'done';
    if (data.factionMoraleBoost) {
        gameState.factionMoraleBoost = { player1: 0, player2: 0, player3: 0, ...data.factionMoraleBoost };
    } else {
        gameState.factionMoraleBoost = { player1: 0, player2: 0, player3: 0 };
    }
    if (data.cardDrawPile) gameState.cardDrawPile = [...data.cardDrawPile];
    if (data.cardDiscardPile) gameState.cardDiscardPile = [...data.cardDiscardPile];
    if (data.playerHands) {
        gameState.playerHands = {
            player1: [...(data.playerHands.player1 || [])],
            player2: [...(data.playerHands.player2 || [])],
            player3: [...(data.playerHands.player3 || [])]
        };
    }
    if (data.playerDrawsThisTurn) gameState.playerDrawsThisTurn = { player1: 0, player2: 0, player3: 0, ...data.playerDrawsThisTurn };
    if (data.playerUsesThisTurn) gameState.playerUsesThisTurn = { player1: 0, player2: 0, player3: 0, ...data.playerUsesThisTurn };
    gameState.cardStackExpanded = false;
    gameState.gameMode = data.gameMode || 'local';
    gameState.isThreePlayer = data.isThreePlayer || false;
    gameState.aiOpponentCamp = data.aiOpponentCampKey ? campMap[data.aiOpponentCampKey] : null;
    gameState.surrenderedCamps = (data.surrenderedCampKeys || []).map(k => campMap[k]).filter(Boolean);
    gameState.skirmishFog = data.skirmishFog || false;
    gameState.villageTiles = new Map(data.villageTiles || []);
    gameState.aiDifficulty = data.aiDifficulty || 1.0;
    if (data.visibleTiles) {
        gameState.visibleTiles = {
            player1: new Set(data.visibleTiles.player1 || []),
            player2: new Set(data.visibleTiles.player2 || []),
            player3: new Set(data.visibleTiles.player3 || [])
        };
    }
    if (data.exploredTiles) {
        gameState.exploredTiles = {
            player1: new Set(data.exploredTiles.player1 || []),
            player2: new Set(data.exploredTiles.player2 || []),
            player3: new Set(data.exploredTiles.player3 || [])
        };
    }
    if (data.scoutReveals) {
        gameState.scoutReveals = {
            player1: new Map(data.scoutReveals.player1 || []),
            player2: new Map(data.scoutReveals.player2 || []),
            player3: new Map(data.scoutReveals.player3 || [])
        };
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
        tile.isVillage = td.isVillage || false;
        tile.villageDistrictId = td.villageDistrictId || 0;
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
        tile._minePlanted = td.minePlanted || false;
        tile._mineCampKey = td.mineCampKey || null;
        tile._cityDisabledUntil = td.cityDisabledUntil || 0;
        tile._reinforcedThisTurn = td.reinforcedThisTurn || false;
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
            unit._rankDefBonus = td.unit._rankDefBonus || 0;
            unit._rankCritBonus = td.unit._rankCritBonus || 0;
            unit._rankRegenPct = td.unit._rankRegenPct || 0;
            unit.displaySpeed = td.unit.displaySpeed ?? unit.config.speed;
            unit._xp = td.unit.xp || 0;
            unit._rank = td.unit.rank || 0;
            unit._fallen = td.unit.fallen || false;
            unit.activeSkillCD = td.unit.activeSkillCD || 0;
            unit.activeSkillDur = td.unit.activeSkillDur || 0;
            unit._phantomStacks = td.unit.phantomStacks || 0;
            unit._gongxinStacks = td.unit.gongxinStacks || 0;
            if (td.unit.gongxinCampKey) {
                unit._gongxinCamp = campMap[td.unit.gongxinCampKey] || CAMP.neutral;
            }
            unit._imprisoned = td.unit.imprisoned || false;
            unit._isImmobile = td.unit.isImmobile || false;
            unit._airdropWaiting = td.unit.airdropWaiting || false;
            unit._martyrPrimed = td.unit.martyrPrimed || false;
            unit._elegyBonus = td.unit.elegyBonus || 0;
            unit._elegyProcessed = td.unit.elegyProcessed || 0;
            unit._isSoulMinion = td.unit.isSoulMinion || false;
            unit._shield = td.unit.shield || 0;
            unit._shieldMax = td.unit.shieldMax || 0;
            unit._shieldTurns = td.unit.shieldTurns || 0;
            unit._faith = td.unit.faith || 0;
            unit._oathGainTurn = td.unit.oathGainTurn ?? undefined;
            unit._smiteReady = td.unit.smiteReady || false;
            unit._smiteCharged = td.unit.smiteCharged || false;
            unit._healingAura = td.unit.healingAura || 0;
            unit._activeSkillBuffs = td.unit.activeSkillBuffs || null;
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
    gameState.campBorderEdges = computeCampBorders(gameState.tiles, gameState.tileMap);
    gameState.districtBorderEdges = computeDistrictBorders(gameState.tiles, gameState.tileMap);
    clearselection();
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
export function showTargetingBanner(text, hint = '') {
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
    deserializeState(data, HexTileClass, UnitClass);
    // 远端状态同步后清除本地选中，避免对手回合残留光圈
    gameState.selectedUnit = null;
    gameState.selectedCityTile = null;
    gameState.selectedTile = null;
    gameState.movableTiles = [];
    gameState.attackableTiles = [];
}
