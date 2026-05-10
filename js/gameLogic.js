import { hexToRgb, CAMP, UNIT_CONFIG, hexDistance, invalidateBoard, HEX_NEIGHBORS, TERRAIN_CONFIG, MORALE_CONFIG, calcIncome, WEATHER_CONFIG, WEATHER_CYCLE, TACTICAL_CARD_CONFIG, CARD_SYSTEM_CONFIG, DECK_COMPOSITION } from './config.js';
import { gameState, updateButtonColors, updateUI, logMessage, clearselection, saveGame, loadGame, serializeState, deserializeState, rebuildTileMap, notify, updateRecruitCostDisplay, hideTargetingBanner, resetGameState } from './state.js';
import { isNetworkGame, sendAction, getMyRole, sendMessage, syncCommanderState, leaveRoom, listRooms, isMyTurn } from './network.js';
import { triggerCommanderTurnStart, triggerCommanderTurnEnd, getCommanderRecruitCost, triggerCommanderOnAttack, triggerCommanderOnCounterAttack, triggerCommanderOnKill, triggerCommanderOnMoraleChange, getStallerSnareLayers, getCommander, setGameStateRef, setLogMessageRef, setSpawnFxRef } from './commanderInterface.js';
import { HexTile } from './HexTile.js';
import { Unit, _pendingRankUps } from './Unit.js';
import {
    spawnExplosionParticles, spawnDirectionalParticles, spawnHealParticles, spawnGoldParticles, spawnRecruitEffect,
    triggerAttackFlash, triggerHealFlash, triggerRecruitFlash, triggerScreenShake,
    spawnSlashMarks, spawnMeleeSlash,
    spawnConfetti, triggerTurnFlash, clearTransientEffects,
    spawnMoraleEffect, spawnCommanderSkillEffect,
    triggerFactionMoraleFlash,
    spawnProjectile, triggerRecoil, triggerCharge,
    spawnBloodDrain, spawnGongxinRipple, spawnLightningStrike,
    spawnGoldenFlame, spawnVictoryRipple,
    spawnCoinRain, spawnMinisterDominionRing, spawnCardUseEffect, spawnAirstrikeEffect
} from './effects.js';
import { playSound } from './audio.js';

// ===== 联机广播 =====================
function broadcastAction(actionType, effectData = null) {
    if (!isNetworkGame()) return;
    try {
        const state = serializeState();
        sendAction(actionType, state, effectData);
    } catch (e) {
        console.warn(`broadcastAction(${actionType}) failed:`, e);
    }
}

// ===== 二次确认弹窗 =====================
let _confirmActive = false;
let _cityCapturedInAttack = false;
let _moraleFxUnitId = null;
let _ctrMoraleFxUnitId = null; // 反击攻心目标士气特效
let _cmdFxData = null;     // 攻击将领特效 { x, y, glyph, label }
let _ctrCmdFxData = null;  // 反击将领特效 { x, y, glyph, label }
let _cmdFxExtra = null;    // 额外的将领特效（如尚书进驻城市）
let _endTurnCmdFxList = null; // 回合结束时的将领特效列表（联机同步用）
let _attackDmg = 0, _attackIsCrit = false;
let _counterDmg = 0, _counterX = 0, _counterY = 0;
let _healAmtRemote = 0, _healX = 0, _healY = 0;
let _killedThisAttack = null; // 击杀后延迟播放士气动画用
let _killerMoraleChanged = false;

function showConfirm(message) {
    if (_confirmActive) return Promise.resolve(false);
    _confirmActive = true;
    return new Promise((resolve) => {
        const overlay = document.getElementById('confirmOverlay');
        const msgEl = document.getElementById('confirmMessage');
        const yesBtn = document.getElementById('confirmYes');
        const noBtn = document.getElementById('confirmNo');

        msgEl.textContent = message;
        overlay.classList.add('show');

        function cleanup() {
            overlay.classList.remove('show');
            yesBtn.removeEventListener('click', onYes);
            noBtn.removeEventListener('click', onNo);
            document.removeEventListener('keydown', onKey);
            _confirmActive = false;
        }

        function onYes() { cleanup(); resolve(true); }
        function onNo()  { cleanup(); resolve(false); }
        function onKey(e) {
            if (e.key === 'Enter')       { e.preventDefault(); onYes(); }
            else if (e.key === 'Escape') { e.preventDefault(); onNo(); }
        }

        yesBtn.addEventListener('click', onYes);
        noBtn.addEventListener('click', onNo);
        document.addEventListener('keydown', onKey);
    });
}

// ===== 地图初始化 =====================

// Axial hex axes: each pair are opposite directions on the same axis
const HEX_AXES = [
    [[1, 0], [-1, 0]],
    [[0, 1], [0, -1]],
    [[1, -1], [-1, 1]]
];

function generateTerrain(tiles) {
    const nonCityTiles = tiles.filter(t => !t.isCity);
    const total = nonCityTiles.length;
    if (total === 0) return;

    const forestSeeds   = Math.floor(total * 0.08);
    const mountainSeeds = Math.floor(total * 0.04);

    for (let i = nonCityTiles.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [nonCityTiles[i], nonCityTiles[j]] = [nonCityTiles[j], nonCityTiles[i]];
    }

    for (let i = 0; i < forestSeeds; i++) {
        nonCityTiles[i].terrain = 'forest';
    }
    for (let i = forestSeeds; i < forestSeeds + mountainSeeds; i++) {
        nonCityTiles[i].terrain = 'mountain';
    }

    const map = gameState.tileMap;
    for (const tile of nonCityTiles) {
        if (tile.terrain !== 'plains') continue;
        let fCount = 0, mCount = 0;
        for (const [dq, dr] of HEX_NEIGHBORS) {
            const nb = map.get(`${tile.q + dq},${tile.r + dr}`);
            if (!nb) continue;
            if (nb.terrain === 'forest')   fCount++;
            if (nb.terrain === 'mountain') mCount++;
        }
        if (fCount >= 2) {
            tile.terrain = 'forest';
        } else if (mCount >= 2) {
            tile.terrain = 'mountain';
        } else if (fCount === 1 && Math.random() < 0.30) {
            tile.terrain = 'forest';
        } else if (mCount === 1 && Math.random() < 0.20) {
            tile.terrain = 'mountain';
        }
    }
}

function countAdjacentNonFriendlies(unit, tileMap) {
    let count = 0;
    for (const [dq, dr] of HEX_NEIGHBORS) {
        const nb = tileMap.get(`${unit.tile.q + dq},${unit.tile.r + dr}`);
        if (nb && nb.unit && nb.unit.camp !== unit.camp) count++;
    }
    return count;
}

function isFlanked(unit, tileMap) {
    for (const [[dq1, dr1], [dq2, dr2]] of HEX_AXES) {
        const nb1 = tileMap.get(`${unit.tile.q + dq1},${unit.tile.r + dr1}`);
        const nb2 = tileMap.get(`${unit.tile.q + dq2},${unit.tile.r + dr2}`);
        if (nb1 && nb1.unit && nb1.unit.camp !== unit.camp &&
            nb2 && nb2.unit && nb2.unit.camp !== unit.camp) {
            return true;
        }
    }
    return false;
}

function isSurrounded(unit, tileMap) {
    return countAdjacentNonFriendlies(unit, tileMap) >= 6;
}

export function recalcAllFlankingMorale() {
    gameState.tiles.forEach(tile => {
        if (!tile.unit) return;
        const u = tile.unit;
        const prev = u.morale;

        const surrounded = isSurrounded(u, gameState.tileMap);
        const flanked = !surrounded && isFlanked(u, gameState.tileMap);

        // 夹击/包围仅向下压制士气（不覆写，保留击杀加成等提升）
        if (surrounded) {
            if (u.morale > 0) u.morale = 0;
        } else if (flanked) {
            if (u.morale > 1) u.morale = 1;
        }

        // 仅在士气归零时禁用行动（不主动恢复，由回合开始管理）
        if (u.morale === 0) u.canAct = false;

        if (u.morale !== prev) {
            spawnMoraleEffect(u);
        }
    });
}

export function initMap() {
    gameState.tiles = [];

    // City definitions: each city anchors a Voronoi district
    const is3P = gameState.isThreePlayer;
    const cityDefs = is3P ? [
        // 三人对称地图：三座主城120°对称分布 + 中央中立城
        { q: 6,  r: 0,  s: -6, districtId: 1, camp: CAMP.player1 },
        { q: -6, r: 6,  s: 0,  districtId: 2, camp: CAMP.player2 },
        { q: 0,  r: -6, s: 6,  districtId: 3, camp: CAMP.player3 },
        { q: 0,  r: 0,  s: 0,  districtId: 5, camp: CAMP.neutral },
    ] : [
        { q: -6, r: 0,  s: 6,  districtId: 1, camp: CAMP.player1 },
        { q: 6,  r: 0,  s: -6, districtId: 2, camp: CAMP.player2 },
        { q: 0,  r: -6, s: 6,  districtId: 3, camp: CAMP.neutral },
        { q: 0,  r: 6,  s: -6, districtId: 4, camp: CAMP.neutral },
        { q: 0,  r: 0,  s: 0,  districtId: 5, camp: CAMP.neutral },
    ];

    // Create all hex tiles
    const allTiles = [];
    for (let q = -7; q <= 7; q++) {
        for (let r = -7; r <= 7; r++) {
            if (Math.abs(q + r) <= 7) {
                allTiles.push(new HexTile(q, r));
            }
        }
    }

    // Voronoi assignment: each tile belongs to the nearest city's district
    for (const tile of allTiles) {
        let bestDist = Infinity;
        let bestCity = null;
        for (const city of cityDefs) {
            const dist = hexDistance(tile, city);
            if (dist < bestDist) {
                bestDist = dist;
                bestCity = city;
            }
        }
        tile.districtId = bestCity.districtId;
        tile.camp = bestCity.camp;
        tile.currentColor = bestCity.camp.color;
        tile.targetColor = bestCity.camp.color;
        gameState.tiles.push(tile);
    }

    // Mark city tiles
    for (const city of cityDefs) {
        const cityTile = gameState.tiles.find(t => t.q === city.q && t.r === city.r);
        if (cityTile) cityTile.isCity = true;
    }

    updateButtonColors();
    rebuildTileMap();
    generateTerrain(gameState.tiles);
    initInitialUnits();

    logMessage(is3P ? '三人模式开始，红军先手' : '游戏开始，红军先手');

    // 绑定按钮事件（仅首次，避免重开时重复绑定）
    if (!_initMapEventsBound) {
        _initMapEventsBound = true;
        const surrenderBtn = document.getElementById('surrenderBtn');
        if (surrenderBtn) {
            surrenderBtn.addEventListener('click', handleSurrender);
        }
        document.getElementById('endTurnBtn').addEventListener('click', endTurn);
        document.getElementById('recruitInfantry').addEventListener('click', () => recruitUnit('infantry'));
        document.getElementById('recruitCavalry').addEventListener('click', () => recruitUnit('cavalry'));
        document.getElementById('recruitArcher').addEventListener('click', () => recruitUnit('archer'));

        const saveBtn = document.getElementById('saveGameBtn');
        const loadBtn = document.getElementById('loadGameBtn');
        if (saveBtn) saveBtn.addEventListener('click', () => saveGame());
        if (loadBtn) loadBtn.addEventListener('click', () => {
            loadGame(HexTile, Unit);
            clearTransientEffects();
        });
    }

    initCardDeck();
    invalidateBoard();
}

export function initCardDeck() {
    const deck = [...DECK_COMPOSITION];
    for (let i = deck.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [deck[i], deck[j]] = [deck[j], deck[i]];
    }
    gameState.cardDrawPile = deck;
    gameState.cardDiscardPile = [];
    // draw 1 free card per player from top of deck
    const freeCard1 = gameState.cardDrawPile.pop();
    const freeCard2 = gameState.cardDrawPile.pop();
    const freeCard3 = gameState.isThreePlayer ? gameState.cardDrawPile.pop() : null;
    gameState.playerHands = {
        player1: ['commanderDeploy', freeCard1].filter(Boolean),
        player2: ['commanderDeploy', freeCard2].filter(Boolean),
        player3: gameState.isThreePlayer ? ['commanderDeploy', freeCard3].filter(Boolean) : []
    };
    gameState.playerDrawsThisTurn = { player1: 0, player2: 0, player3: 0 };
    gameState.playerUsesThisTurn = { player1: 0, player2: 0, player3: 0 };
    gameState.cardStackExpanded = false;
}

export function drawCard(camp) {
    const campKey = camp === CAMP.player1 ? 'player1' : camp === CAMP.player2 ? 'player2' : camp === CAMP.player3 ? 'player3' : 'neutral';
    if (campKey === 'neutral') return null;

    if (gameState.playerDrawsThisTurn[campKey] >= CARD_SYSTEM_CONFIG.maxDrawsPerTurn) {
        notify('本回合已达到抽牌上限', 'error'); return null;
    }
    if (gameState.playerHands[campKey].length >= CARD_SYSTEM_CONFIG.maxHandSize) {
        notify('手牌已满（最多3张）', 'error'); return null;
    }
    if (gameState.playerGold[campKey] < CARD_SYSTEM_CONFIG.drawCost) {
        notify('金币不足（需30g）', 'error'); return null;
    }

    if (gameState.cardDrawPile.length === 0 && gameState.cardDiscardPile.length > 0) {
        gameState.cardDrawPile = [...gameState.cardDiscardPile];
        gameState.cardDiscardPile = [];
        for (let i = gameState.cardDrawPile.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [gameState.cardDrawPile[i], gameState.cardDrawPile[j]] = [gameState.cardDrawPile[j], gameState.cardDrawPile[i]];
        }
        logMessage('弃牌堆已洗入抽牌堆');
    }
    if (gameState.cardDrawPile.length === 0) {
        notify('卡组已空，无法抽牌', 'error'); return null;
    }

    gameState.playerGold[campKey] -= CARD_SYSTEM_CONFIG.drawCost;
    const cardId = gameState.cardDrawPile.pop();
    gameState.playerHands[campKey].push(cardId);
    gameState.playerDrawsThisTurn[campKey]++;

    const cfg = TACTICAL_CARD_CONFIG[cardId];
    logMessage(`${camp.name}花费30g抽到了【${cfg ? cfg.name : cardId}】`);
    updateUI();
    return cardId;
}

let _initMapEventsBound = false;

function initInitialUnits() {
    const map = gameState.tileMap;
    function spawn(type, camp, q, r) {
        const tile = map.get(`${q},${r}`);
        if (tile && !tile.unit) new Unit(type, camp, tile, false);
    }

    // ── 玩家阵型（各 3步 2骑 1炮） ──
    const formation = [
        ['infantry', 0, 0],    // 城市驻军
        ['cavalry',  1, 0],    // 前锋
        ['archer',   0, 1],    // 右翼火力
        ['infantry', -1, 1],   // 右翼后卫
        ['cavalry',  1, -1],   // 游击斥候
        ['infantry', 0, -1],   // 左翼步兵
    ];

    const p1City = gameState.tiles.find(t => t.isCity && t.districtId === 1);
    const p2City = gameState.tiles.find(t => t.isCity && t.districtId === 2);
    const p3City = gameState.tiles.find(t => t.isCity && t.districtId === 3);

    if (gameState.isThreePlayer) {
        // 三人模式：每方独立生成阵型
        for (const [type, dq, dr] of formation) {
            if (p1City) spawn(type, CAMP.player1, p1City.q + dq, p1City.r + dr);
            if (p2City) spawn(type, CAMP.player2, p2City.q + dq, p2City.r + dr);
            if (p3City) spawn(type, CAMP.player3, p3City.q + dq, p3City.r + dr);
        }
        // 中立·中央（district 5）—— 轻兵驻守
        const centerCity = gameState.tiles.find(t => t.isCity && t.districtId === 5);
        if (centerCity) new Unit('infantry', CAMP.neutral, centerCity, false);
        spawn('infantry', CAMP.neutral, -1, 1);
        spawn('archer',   CAMP.neutral, 1, 0);
    } else {
        for (const [type, dq, dr] of formation) {
            if (p1City) spawn(type, CAMP.player1, p1City.q + dq, p1City.r + dr);
            if (p2City) spawn(type, CAMP.player2, p2City.q - dq, p2City.r - dr);
        }

        // ── 中立·中央（district 5）── 重兵把守
        const centerCity = gameState.tiles.find(t => t.isCity && t.districtId === 5);
        if (centerCity) new Unit('infantry', CAMP.neutral, centerCity, false);
        spawn('infantry', CAMP.neutral, -1, 1);
        spawn('infantry', CAMP.neutral, 1, 0);
        spawn('archer',   CAMP.neutral, 0, 2);      // 中央炮台

        // ── 中立·上（district 3）
        const topCity = gameState.tiles.find(t => t.isCity && t.districtId === 3);
        if (topCity) new Unit('infantry', CAMP.neutral, topCity, false);
        spawn('archer', CAMP.neutral, 1, -5);

        // ── 中立·下（district 4）
        const bottomCity = gameState.tiles.find(t => t.isCity && t.districtId === 4);
        if (bottomCity) new Unit('infantry', CAMP.neutral, bottomCity, false);
        spawn('archer', CAMP.neutral, -1, 5);
    }
}

// ===== 回合管理 =====================
let _turnProcessing = false;
let _neutralAiLock = false; // 防止AI在非中立回合异常触发

function _campKey(camp) {
    return camp === CAMP.player1 ? 'player1' : camp === CAMP.player2 ? 'player2' : camp === CAMP.player3 ? 'player3' : 'neutral';
}

function _factionCount() { return gameState.isThreePlayer ? 4 : 3; }

// 三人模式中跳过已投降阵营，切换到下一个活跃阵营
function _skipToNextActiveCamp(fromCamp) {
    const order = [CAMP.player1, CAMP.player2, CAMP.player3, CAMP.neutral];
    const idx = order.indexOf(fromCamp);
    for (let i = 1; i <= 4; i++) {
        const next = order[(idx + i) % 4];
        if (!gameState.surrenderedCamps.includes(next)) {
            gameState.currentCamp = next;
            return;
        }
    }
}

// 获取下一个未投降的阵营（用于回合轮转）
function _nextActiveCamp(camp) {
    if (!gameState.isThreePlayer || gameState.surrenderedCamps.length === 0) {
        // 双人模式或无人投降，使用原有逻辑
        if (gameState.isThreePlayer) {
            if (camp === CAMP.player1) return CAMP.player2;
            if (camp === CAMP.player2) return CAMP.player3;
            if (camp === CAMP.player3) return CAMP.neutral;
            return CAMP.player1;
        }
        if (camp === CAMP.player1) return CAMP.player2;
        if (camp === CAMP.player2) return CAMP.neutral;
        return CAMP.player1;
    }
    // 三人模式有玩家已投降：跳过已投降阵营
    const order = [CAMP.player1, CAMP.player2, CAMP.player3, CAMP.neutral];
    const idx = order.indexOf(camp);
    for (let i = 1; i <= 4; i++) {
        const next = order[(idx + i) % 4];
        if (!gameState.surrenderedCamps.includes(next)) return next;
    }
    return CAMP.player1; // 不应到达
}

function _updateWeather() {
    const round = Math.floor(gameState.turnCounter / _factionCount());  // 0-indexed full round
    if (round < WEATHER_CYCLE.warmupRounds) {
        gameState.weather = 'clear';
        return;
    }
    const cycleRound = round - WEATHER_CYCLE.warmupRounds;
    const cycleLen = WEATHER_CYCLE.weatherDuration + WEATHER_CYCLE.clearDuration;  // 3
    const position = cycleRound % cycleLen;  // 0,1,2
    if (position === 0) {
        const pool = ['rain', 'fog', 'wind'].filter(w => w !== gameState.lastWeather);
        gameState.lastWeather = pool[Math.floor(Math.random() * pool.length)];
    }
    if (position < WEATHER_CYCLE.weatherDuration) {
        gameState.weather = gameState.lastWeather;
    } else {
        gameState.weather = 'clear';
    }
}

// 限时效果到期检查（每轮 P1 开始时调用一次）
function _expireTimedEffects() {
    gameState.tiles.forEach(tile => {
        if (!tile.unit) return;
        const u = tile.unit;

        // 击杀士气上升到期 → 恢复正常
        if (u.morale === 3 && u.moraleBoostUntil <= gameState.turnCounter) {
            u.morale = 2; // setter 自动 triggerCommanderOnMoraleChange
            spawnMoraleEffect(u);
        }

        // 主动技能持续倒计时（每轮减1）
        if (u._shieldTurns > 0) {
            u._shieldTurns--;
            if (u._shieldTurns <= 0 && u._shield > 0) {
                u._shield = 0;
                u._shieldMax = 0;
            }
        }
        if (u.activeSkillDur > 0) {
            u.activeSkillDur--;
            if (u.activeSkillDur <= 0) {
                const cmdCfg = getCommander(u.commander);
                if (cmdCfg && cmdCfg.activeSkill && cmdCfg.activeSkill.onExpire) {
                    cmdCfg.activeSkill.onExpire(u, {
                        gameState, logMessage, spawnFx: spawnCommanderSkillEffect
                    });
                }
            }
        }

        // 主动技能冷却倒计时（每轮减1）
        if (u.activeSkillCD > 0) {
            u.activeSkillCD--;
        }
        // Rank 4 每轮 15% 回血
        if (u._rankRegenPct > 0 && u.hp < u.maxHp) {
            u.heal(Math.round(u.maxHp * u._rankRegenPct));
        }
    });
}

async function _doEndTurnPhase() {
    const camp = gameState.currentCamp;
    _endTurnCmdFxList = []; // 本回合将领特效收集

    // 包装 spawnFx 引用以收集特效坐标（不直接覆写 import binding）
    const origSpawn = spawnCommanderSkillEffect;
    setSpawnFxRef((x, y, glyph, label) => {
        _endTurnCmdFxList.push({ x, y, glyph: glyph || '🎖️', label: label || '' });
        origSpawn(x, y, glyph, label);
    });

    // Unit reset + infantry city heal + 将领回合开始效果
    gameState.tiles.forEach(tile => {
        if (tile.unit) {
            tile.unit.canAct = tile.unit.morale !== 0;
            // mgNest: disable if no enemies in range
            if (tile.unit._isImmobile && tile.unit.canAct) {
                const atk = getAttackableTiles(tile.unit);
                if (atk.length === 0) tile.unit.canAct = false;
            }
            tile.unit.movedThisTurn = false;
            tile.unit.moveDistance = 0;
            tile.unit.counterAttackCount = 0;
            tile.unit._timesAttackedThisTurn = 0;
            tile.unit.remainingMP = tile.unit.config.speed;
            // SPD bonus re-apply from commander
            if (tile.unit.commander) {
                const cmdCfg = getCommander(tile.unit.commander);
                if (cmdCfg && cmdCfg.spdBonus) tile.unit.remainingMP += cmdCfg.spdBonus;
            }
            tile.unit.isNewRecruit = false;
            // 百夫长标记重置
            tile.unit._centurionTriggered = false;

            if (tile.unit.type === 'infantry' && tile.isCity && tile.unit.camp === camp) {
                const healPct = (gameState.weather === 'rain') ? 0.20 : 0.10;
                const healAmount = tile.unit.maxHp * healPct;
                const actualHeal = tile.unit.heal(healAmount);
                if (actualHeal > 0) {
                    logMessage(`${tile.unit.camp.name}的步兵驻守城市回复${Math.round(actualHeal)}生命值`);
                }
            }
            // 主动技能持续/冷却倒计时 → 移至回合开始时统一处理
        }
    });

    // 将领回合开始效果（铁卫治疗等）—— 在回合切换后为新阵营触发
    // 移至 turn toggle 之后，确保殉道者等效果在新回合开始时立即触发

    // Income（中立减半，仅作象征性抵抗）
    const key = _campKey(camp);
    const cities = gameState.tiles.filter(t => t.isCity && t.camp === camp && !(t._cityDisabledUntil >= gameState.turnCounter));
    const cityCount = cities.length;
    const income = camp === CAMP.neutral ? Math.floor(calcIncome(cityCount) / 2) : calcIncome(cityCount);
    gameState.playerGold[key] += income;
    // 将领回合结束效果（尚书屯田等）
    triggerCommanderTurnEnd(gameState, camp, key);
    // 尚书屯田金币雨
    const ministerUnit = gameState.tiles.reduce((f, t) => f || (t.unit && t.unit.commander === 'minister' && t.unit.camp === camp ? t.unit : null), null);
    if (ministerUnit && ministerUnit.tile.isCity) {
        spawnMinisterDominionRing(ministerUnit.tile.x, ministerUnit.tile.y);
        spawnCoinRain(ministerUnit.tile.x, ministerUnit.tile.y, 5);
    }
    if (income > 0) {
        logMessage(`${camp.name}回合结束，城市产出共计${income}金币`);
        cities.forEach((cityTile, i) => {
            const cityValue = i === 0 ? 20 : i === 1 ? 15 : 10;
            gameState.goldTexts.push({
                x: cityTile.x, y: cityTile.y,
                value: cityValue, prefix: '+', color: '#ffff00',
                timeLeft: 1000, lastUpdate: Date.now()
            });
            spawnCoinRain(cityTile.x, cityTile.y, 2);
        });
    }

    // Turn toggle（三人模式自动跳过已投降阵营）
    gameState.currentCamp = _nextActiveCamp(camp);
    gameState.turnCounter++;
    // 将领回合开始效果（铁卫治疗、殉道者自爆等）—— 为新阵营在新回合开始时触发
    triggerCommanderTurnStart(gameState, gameState.currentCamp);
    // 对策卡系统 v2：重置结束回合方的抽牌/用牌计数 + 清除禁锢
    const endingCampKey = _campKey(camp);
    if (endingCampKey !== 'neutral') {
        gameState.playerDrawsThisTurn[endingCampKey] = 0;
        gameState.playerUsesThisTurn[endingCampKey] = 0;
    }
    // 清除结束回合方所有单位的禁锢标记
    for (const tile of gameState.tiles) {
        if (tile.unit && tile.unit.camp === camp) {
            tile.unit._imprisoned = false;
        }
    }
    // 新回合（P1开始）→ 限时效果到期检查
    // 天气在新回合开始时更新
    if (gameState.currentCamp === CAMP.player1) {
        _updateWeather();
        _expireTimedEffects();
        // every 5 rounds: free card for all players
        const factionCount = gameState.isThreePlayer ? 4 : 3;
        const roundNum = Math.floor(gameState.turnCounter / factionCount);
        if (roundNum > 0 && roundNum % 5 === 0 && gameState.cardDrawPile.length > 0) {
            for (const key of ['player1', 'player2', 'player3']) {
                const h = gameState.playerHands[key];
                if (!h || h.length >= CARD_SYSTEM_CONFIG.maxHandSize) continue;
                if (gameState.cardDrawPile.length === 0) break;
                if (key === 'player3' && !gameState.isThreePlayer) continue;
                const card = gameState.cardDrawPile.pop();
                h.push(card);
                const cfg = TACTICAL_CARD_CONFIG[card];
                logMessage(`${key === 'player1' ? '红军' : key === 'player2' ? '蓝军' : '绿军'}获得免费对策卡【${cfg?.name || card}】`);
            }
        }
    }

    // 恢复 commanderInterface 的 spawnFx 引用
    setSpawnFxRef(origSpawn);

    // Common end-phase effects
    playSound('turnEnd');
    triggerTurnFlash(gameState.currentCamp.color);
    updateUI();
    logMessage(`轮到${gameState.currentCamp.name}行动`);
    updateButtonColors();
    if (gameState.cardTargeting) { gameState.cardTargeting = null; hideTargetingBanner(); }
    clearselection();
    gameState.undoStack = [];
    if (!isNetworkGame()) saveGame(true); // 自动存档静默，不弹提示
    broadcastAction('endTurn', { cmdFxList: _endTurnCmdFxList.length > 0 ? _endTurnCmdFxList : null });
}

export async function endTurn() {
    if (gameState.gameOver || _turnProcessing) return;
    _turnProcessing = true;

    try {
        const isAITurn = gameState.currentCamp === CAMP.neutral ||
            (gameState.gameMode === 'pve' && gameState.currentCamp === gameState.aiOpponentCamp);
        const hasActionable = gameState.tiles.some(t =>
            t.unit && t.unit.camp === gameState.currentCamp && t.unit.canAct && !t.unit.isNewRecruit
        );
        if (hasActionable && !isAITurn) {
            const confirmed = await showConfirm(
                `你仍有未行动的部队。\n确定要跳过行动，结束当前回合吗？`
            );
            if (!confirmed) return;
        }

        await _doEndTurnPhase();

        // 链式处理 AI 回合（对手 AI → 中立 AI），直到人类回合
        for (let i = 0; i < 3; i++) {
            if (gameState.gameOver) break;

            const isAIOpponent = gameState.gameMode === 'pve' &&
                gameState.currentCamp === gameState.aiOpponentCamp &&
                !gameState.aiActing;
            const isNeutral = gameState.currentCamp === CAMP.neutral &&
                !gameState.aiActing && !_neutralAiLock &&
                (!isNetworkGame() || getMyRole() === 'player1');

            if (isAIOpponent) {
                // PVE 对手 AI（Grok 进攻型人格）
                gameState.aiActing = true;
                try {
                    const { processOpponentTurn } = await import('./ai.js');
                    await Promise.race([
                        processOpponentTurn(gameState.aiOpponentCamp),
                        new Promise((_, reject) => setTimeout(() => reject(new Error('AI_TIMEOUT')), 15000))
                    ]);
                } catch (e) {
                    if (e && e.message === 'AI_TIMEOUT') {
                        logMessage('AI对手超时，强制结束回合');
                    } else {
                        logMessage('AI对手执行出错，跳过回合');
                    }
                    console.warn('AI opponent error:', e);
                } finally {
                    gameState.aiActing = false;
                }
                await new Promise(r => setTimeout(r, 2500));
                if (!gameState.gameOver) await _doEndTurnPhase();

            } else if (isNeutral) {
                // 中立 AI（Claude 防御型人格）
                _neutralAiLock = true;
                gameState.aiActing = true;
                try {
                    const { processNeutralTurn } = await import('./ai.js');
                    await Promise.race([
                        processNeutralTurn(),
                        new Promise((_, reject) => setTimeout(() => reject(new Error('AI_TIMEOUT')), 15000))
                    ]);
                } catch (e) {
                    if (e && e.message === 'AI_TIMEOUT') {
                        logMessage('中立AI超时，强制结束回合');
                    } else {
                        logMessage('中立AI执行出错，跳过回合');
                    }
                    console.warn('Neutral AI error:', e);
                } finally {
                    gameState.aiActing = false;
                    _neutralAiLock = false;
                }
                notify('本轮行动完毕 即将进入下一轮...', 'info');
                logMessage('本轮行动完毕 即将进入下一轮...');
                if (isNetworkGame()) sendMessage({ type: 'toast', text: '本轮行动完毕 即将进入下一轮...', toastType: 'info' });
                await new Promise(r => setTimeout(r, 2500));
                if (!gameState.gameOver) await _doEndTurnPhase();

            } else {
                break; // 人类回合
            }
        }
    } finally {
        _turnProcessing = false;
    }
}

// ===== 招募 =====================
export function recruitUnit(type) {
    if (gameState.gameOver) return;
    const config = UNIT_CONFIG[type];
    const currentPlayerKey = _campKey(gameState.currentCamp);

    if (!gameState.selectedCityTile) {
        notify('请先选中己方控制的空城市', 'error');
        return;
    }
    const selectedCityTile = gameState.selectedCityTile;
    if (selectedCityTile.camp !== gameState.currentCamp) {
        notify('该城市不属于当前阵营，无法招募', 'error');
        return;
    }
    if (selectedCityTile._cityDisabledUntil >= gameState.turnCounter) {
        notify('该城市遭到空袭，本回合无法招募', 'error');
        return;
    }
    if (selectedCityTile.unit) {
        notify('该城市已有单位驻守，无法招募', 'error');
        return;
    }
    if (!selectedCityTile.isCity) {
        notify('该地块不是城市，无法招募', 'error');
        return;
    }
    let effectiveCost = getCommanderRecruitCost(config.cost, gameState, gameState.currentCamp);
    if (gameState.playerGold[currentPlayerKey] < effectiveCost) {
        notify('金币不足', 'error');
        return;
    }

    pushUndo();
    gameState.playerGold[currentPlayerKey] -= effectiveCost;
    new Unit(type, gameState.currentCamp, selectedCityTile, true);
    playSound('recruit');
    triggerRecruitFlash(selectedCityTile.x, selectedCityTile.y);
    spawnRecruitEffect(selectedCityTile.x, selectedCityTile.y);
    logMessage(`${gameState.currentCamp.name}成功招募${config.name}兵，金币-${effectiveCost}`);
    gameState.selectedCityTile = null;

    gameState.goldTexts.push({
        x: selectedCityTile.x, y: selectedCityTile.y,
        value: effectiveCost, prefix: '-', color: '#cccccc',
        timeLeft: 1000, lastUpdate: Date.now()
    });
    spawnGoldParticles(selectedCityTile.x, selectedCityTile.y);
    recalcAllFlankingMorale();
    updateUI();
    broadcastAction('recruit', { x: selectedCityTile.x, y: selectedCityTile.y });
}

// ===== 移动范围计算 =====================

// 停滞者缚足层数（0/1/2/3），每层行动消耗+2
function _getStallerSnareLayers(tile, friendlyCamp) {
    return getStallerSnareLayers(tile, friendlyCamp, gameState.tileMap);
}

// Check if a tile is in enemy Zone of Control (adjacent to hostile unit)
function _isInEnemyZoC(tile, friendlyCamp) {
    const map = gameState.tileMap;
    for (const [dq, dr] of HEX_NEIGHBORS) {
        const neighbor = map.get(`${tile.q + dq},${tile.r + dr}`);
        if (neighbor && neighbor.unit && neighbor.unit.camp !== friendlyCamp) {
            return true;
        }
    }
    return false;
}

// BFS pathfinding: returns tiles reachable without passing through enemy lines
export function getMovableTiles(unit) {
    if (unit.morale === 0 || unit._imprisoned || unit._isImmobile) return [];

    const speed = unit.remainingMP;
    const startTile = unit.tile;
    const friendlyCamp = unit.camp;
    const map = gameState.tileMap;

    // BFS queue: [tile, remainingMP, cameFromZoC]
    const queue = [{ tile: startTile, remaining: speed, fromZoC: _isInEnemyZoC(startTile, friendlyCamp) }];
    const visited = new Map();
    visited.set(startTile, { remaining: speed, fromZoC: _isInEnemyZoC(startTile, friendlyCamp), parent: null });
    const result = [];

    let head = 0;
    while (head < queue.length) {
        const { tile: cur, remaining: curRem, fromZoC: curFromZoC } = queue[head++];
        if (cur !== startTile) result.push(cur);

        for (const [dq, dr] of HEX_NEIGHBORS) {
            const neighbor = map.get(`${cur.q + dq},${cur.r + dr}`);
            if (!neighbor) continue;
            if (neighbor.unit) continue; // occupied → impassable

            let stepCost = TERRAIN_CONFIG[neighbor.terrain].stepCost;
            if (gameState.weather === 'rain' && unit.type === 'cavalry') stepCost += 1;
            // 停滞者【缚足】：每层行动消耗+2
            const snareLayers = _getStallerSnareLayers(neighbor, friendlyCamp);
            if (snareLayers > 0) stepCost += snareLayers * 2;
            if (curRem < 1) continue;
            let newRem = curRem >= stepCost ? curRem - stepCost : 0;

            // Zone of Control: entering a ZoC tile costs all remaining MP (must stop)
            const neighborInZoC = _isInEnemyZoC(neighbor, friendlyCamp);
            // Cannot move from one ZoC directly into another (prevents sliding along lines)
            if (curFromZoC && neighborInZoC && cur !== startTile) continue;
            if (neighborInZoC && !curFromZoC) {
                newRem = 0; // enter ZoC → must stop
            }

            const prev = visited.get(neighbor);
            if (prev && prev.remaining >= newRem) continue; // already reached with ≥ MP

            const entry = { remaining: newRem, fromZoC: neighborInZoC, parent: cur };
            visited.set(neighbor, entry);
            queue.push({ tile: neighbor, remaining: newRem, fromZoC: neighborInZoC });
        }
    }

    gameState.moveParents = visited;
    return result;
}

export function getAttackableTiles(unit) {
    if (unit.morale === 0) return [];
    let range = unit.config.range;
    if (gameState.weather === 'fog' && unit.type === 'archer') range -= 1;
    if (unit.type === 'archer') {
        let bonus = 0;
        if (unit.tile.terrain === 'mountain') bonus = 1;
        if (gameState.weather === 'wind') bonus = Math.max(bonus, 1);
        range += bonus;
    }
    range = Math.max(1, Math.min(4, range));
    const startTile = unit.tile;
    return gameState.tiles.filter(tile => {
        if (!(hexDistance(tile, startTile) <= range && tile.unit && tile.unit.camp !== unit.camp)) return false;
        // 停滞者免疫炮兵攻击
        if (unit.type === 'archer' && tile.unit.commander === 'staller') return false;
        return true;
    });
}

// ===== 移动 =====================

// Reconstruct path from BFS parent map
function _reconstructPath(parents, startTile, targetTile) {
    const path = [];
    let cur = targetTile;
    while (cur) {
        path.unshift({ x: cur.x, y: cur.y });
        if (cur === startTile) break;
        const entry = parents.get(cur);
        cur = entry ? entry.parent : null;
    }
    return path;
}

export function moveUnit(unit, targetTile) {
    if (gameState.gameOver) return;
    if (unit.camp !== gameState.currentCamp) return;
    if (unit.isNewRecruit || !unit.canAct || !gameState.movableTiles.includes(targetTile) || targetTile.unit) {
        notify('该单位本回合无法移动', 'error');
        return;
    }

    pushUndo();
    const fromX = unit.tile.x;
    const fromY = unit.tile.y;

    // Reconstruct path for step-by-step animation
    const path = _reconstructPath(gameState.moveParents, unit.tile, targetTile);
    unit.tile.unit = null;
    unit.tile = targetTile;
    targetTile.unit = unit;
    unit.movedThisTurn = true;
    unit.moveDistance += path.length - 1;
    unit.startMovePath(path);
    playSound('move');

    const mpEntry = gameState.moveParents.get(targetTile);
    if (mpEntry) unit.remainingMP = mpEntry.remaining;

    gameState.movableTiles = [];
    gameState.attackableTiles = getAttackableTiles(unit);

    if (unit.remainingMP > 0) {
        // Can move again — recalculate movable range with remaining MP
        gameState.movableTiles = getMovableTiles(unit);
        gameState.selectionTime = Date.now();
    } else if (gameState.attackableTiles.length === 0) {
        unit.canAct = false;
        clearselection();
    }

    // 地雷触发（特效对所有玩家广播）
    let _mineTrigger = null;
    if (targetTile._minePlanted) {
        const mineCampKey = targetTile._mineCampKey;
        const unitCampKey = unit.camp === CAMP.player1 ? 'p1' : unit.camp === CAMP.player2 ? 'p2' : unit.camp === CAMP.player3 ? 'p3' : 'neutral';
        if (mineCampKey !== unitCampKey) {
            const mineDmg = unit.takeDamage(100, null) ? 100 : 0;
            gameState.damageTexts.push({
                x: targetTile.x, y: targetTile.y, value: mineDmg, isCrit: true,
                timeLeft: 900, lastUpdate: Date.now()
            });
            spawnDirectionalParticles(targetTile.x, targetTile.y + 10, targetTile.x, targetTile.y - 50, '#ff4400', 20);
            spawnDirectionalParticles(targetTile.x, targetTile.y + 10, targetTile.x, targetTile.y - 50, '#ffaa00', 12);
            spawnExplosionParticles(targetTile.x, targetTile.y, '#664400', 8);
            triggerScreenShake(6, 250);
            playSound('attack');
            logMessage(`💣 地雷触发！${unit.camp.name}${unit.config.name}兵受到${mineDmg}伤害`);
            _mineTrigger = { x: targetTile.x, y: targetTile.y, dmg: mineDmg };
            targetTile._minePlanted = false;
            targetTile._mineCampKey = null;
        }
    }

    if (targetTile.isCity && targetTile.camp !== unit.camp) {
        updateDistrictColor(targetTile, unit.camp, unit);
    }
    // 尚书进驻城市：触发技能特效
    let _cmdFxForMove = null;
    if (targetTile.isCity && unit.commander === 'minister') {
        spawnMinisterDominionRing(targetTile.x, targetTile.y);
        spawnCommanderSkillEffect(targetTile.x, targetTile.y, '🎖️', '屯田');
        _cmdFxForMove = { x: targetTile.x, y: targetTile.y, glyph: '🎖️', label: '屯田' };
    }
    recalcAllFlankingMorale();
    updateRecruitCostDisplay(); // 尚书驻扎城市时及时刷新折扣
    const rankUpsMove = _pendingRankUps.splice(0);
    broadcastAction('move', { unitId: unit.id, fromX, fromY, path, cmdFx: _cmdFxForMove, rankUps: rankUpsMove.length ? rankUpsMove : null, mineTrigger: _mineTrigger });
}

// ===== 攻击 =====================
export function attackUnit(attackerUnit, targetUnit) {
    if (gameState.gameOver) return;
    if (attackerUnit.camp !== gameState.currentCamp) return;
    if (!attackerUnit.canAct || !gameState.attackableTiles.includes(targetUnit.tile)) {
        notify('无法攻击：超出射程或单位已行动', 'error');
        return;
    }

    // 包装 spawnFx 引用以捕获将领特效的 glyph/label
    const _atkOrigSpawn = spawnCommanderSkillEffect;
    let _atkCmdFxCapture = null;
    setSpawnFxRef((x, y, glyph, label) => {
        _atkCmdFxCapture = { x, y, glyph: glyph || '🎖️', label: label || '' };
        _atkOrigSpawn(x, y, glyph, label);
    });

    pushUndo();
    _killerMoraleChanged = false;
    const attackResult = attackerUnit.calculateDamage(targetUnit);
    _attackDmg = attackResult.dmg; _attackIsCrit = attackResult.isCrit;
    if (attackResult.isCrit) attackerUnit.addXP(2);
    if (attackResult.dmg > 0) attackerUnit.addXP(1);
    const fromX = attackerUnit.tile.x, fromY = attackerUnit.tile.y;
    const toX = targetUnit.tile.x, toY = targetUnit.tile.y;
    playSound(attackResult.isCrit ? 'crit' : 'attack');
    const isCrit = attackResult.isCrit;

    // 核心状态修改：扣血、击杀判定（先于视觉效果，保证广播时状态正确）
    const isTargetDead = targetUnit.takeDamage(attackResult.dmg, attackerUnit);

    let atkCmdResult = null, ctrCmdResult = null;
    try {
        if (attackerUnit.type === 'archer') {
            spawnProjectile(fromX, fromY, toX, toY, isCrit, () => {
                triggerAttackFlash(toX, toY, isCrit);
                triggerRecoil(fromX, fromY, toX, toY);
                spawnDirectionalParticles(fromX, fromY, toX, toY, '#ff8844', isCrit ? 8 : 4);
                triggerScreenShake(isCrit ? 6 : 3, isCrit ? 200 : 120);
            });
        } else {
            triggerAttackFlash(toX, toY, isCrit);
            spawnMeleeSlash(toX, toY, fromX, fromY, isCrit);
            triggerScreenShake(isCrit ? 6 : 3, isCrit ? 200 : 120);
        }
        // 近战突进特效（击杀时由 movePath 处理位移，不重复触发）
        if (attackerUnit.type !== 'archer' && !isTargetDead) {
            triggerCharge(attackerUnit.id, fromX, fromY, toX, toY);
        }
        logMessage(`${attackerUnit.camp.name}的${attackerUnit.config.name}兵攻击造成${Math.round(attackResult.dmg)}伤害${attackResult.isCrit ? '（强击）' : ''}`);

        // 将领攻击效果（吸血鬼嗜血、谋士攻心等）
        _atkCmdFxCapture = null;
        atkCmdResult = triggerCommanderOnAttack(attackerUnit, targetUnit, attackResult.dmg);
        if (atkCmdResult) {
            if (atkCmdResult.healAmt) {
                _healAmtRemote = atkCmdResult.healAmt; _healX = attackerUnit.tile.x; _healY = attackerUnit.tile.y;
            }
            if (attackerUnit.commander === 'vampire') {
                const bloodDestX = (isTargetDead && attackerUnit.type !== 'archer') ? toX : fromX;
                const bloodDestY = (isTargetDead && attackerUnit.type !== 'archer') ? toY : fromY;
                spawnBloodDrain(toX, toY, bloodDestX, bloodDestY);
            }
            if (atkCmdResult.moraleDropped) {
                if (attackerUnit.commander === 'advisor') spawnGongxinRipple(toX, toY, false);
                spawnMoraleEffect(targetUnit);
                _moraleFxUnitId = targetUnit.id;
            }
            if (atkCmdResult.converted) {
                if (attackerUnit.commander === 'advisor') spawnGongxinRipple(toX, toY, true);
            }
        }
        _cmdFxData = _atkCmdFxCapture;

        if (!isTargetDead) {
            // 连续承受攻击经验：第x次受击奖励(x-1)点经验
            targetUnit._timesAttackedThisTurn = (targetUnit._timesAttackedThisTurn || 0) + 1;
            const enduranceXp = targetUnit._timesAttackedThisTurn - 1;
            if (enduranceXp > 0) targetUnit.addXP(enduranceXp);

            const counterResult = targetUnit.calculateCounterDamage(attackerUnit);
            _counterDmg = counterResult.dmg;
            _counterX = attackerUnit.tile.x; _counterY = attackerUnit.tile.y;
            if (counterResult.dmg > 0) {
                targetUnit.addXP(1);
                if (counterResult.isCrit) targetUnit.addXP(2);
                attackerUnit.takeDamage(counterResult.dmg, targetUnit);
                _atkCmdFxCapture = null;
                ctrCmdResult = triggerCommanderOnCounterAttack(attackerUnit, targetUnit, counterResult.dmg);
                if (ctrCmdResult && targetUnit.commander === 'vampire') {
                    spawnBloodDrain(attackerUnit.tile.x, attackerUnit.tile.y, targetUnit.tile.x, targetUnit.tile.y);
                }
                if (ctrCmdResult?.moraleDropped) {
                    if (targetUnit.commander === 'advisor') spawnGongxinRipple(attackerUnit.tile.x, attackerUnit.tile.y, false);
                    spawnMoraleEffect(attackerUnit);
                    _ctrMoraleFxUnitId = attackerUnit.id;
                }
                if (ctrCmdResult?.converted) {
                    if (targetUnit.commander === 'advisor') spawnGongxinRipple(attackerUnit.tile.x, attackerUnit.tile.y, true);
                }
                _ctrCmdFxData = _atkCmdFxCapture;
            }
            attackerUnit.canAct = false;
        } else {
            const targetTile = targetUnit.tile;
            if (attackerUnit.type !== 'archer') {
                attackerUnit.tile.unit = null;
                attackerUnit.tile = targetTile;
                targetTile.unit = attackerUnit;
                attackerUnit.moveDistance++;
                attackerUnit.startMovePath([{ x: fromX, y: fromY }, { x: toX, y: toY }]);
                if (targetTile.isCity) { updateDistrictColor(targetTile, attackerUnit.camp, attackerUnit); _cityCapturedInAttack = true; }
                if (targetTile.isCity && attackerUnit.commander === 'minister') {
                    spawnCommanderSkillEffect(targetTile.x, targetTile.y, '🎖️', '屯田');
                    _cmdFxExtra = { x: targetTile.x, y: targetTile.y, glyph: '🎖️', label: '屯田' };
                }
            }
            if (targetUnit.commander) {
                const killerKey = attackerUnit.camp === CAMP.player1 ? 'player1' :
                                  attackerUnit.camp === CAMP.player2 ? 'player2' :
                                  attackerUnit.camp === CAMP.player3 ? 'player3' : 'neutral';
                if (killerKey !== 'neutral') {
                    gameState.factionMoraleBoost[killerKey] = gameState.turnCounter + 6;
                    for (const tile of gameState.tiles) {
                        const u = tile.unit;
                        if (u && u.camp === attackerUnit.camp && u.morale !== 0 && u.morale < 3) {
                            const oldM = u.morale;
                            u.morale = Math.min(3, u.morale + 1);
                            if (u.morale === 3) u.moraleBoostUntil = gameState.turnCounter + 6;
                            if (u.morale !== oldM) {
                                spawnMoraleEffect(u);
                            }
                        }
                    }
                    triggerFactionMoraleFlash('#ffd700');
                    logMessage(`⚔ ${attackerUnit.camp.name}斩杀敌方将领，全军士气+1！`);
                }
            }
            if (attackerUnit.morale !== 0) {
                const oldKillerM = attackerUnit.morale;
                attackerUnit.morale = Math.min(3, attackerUnit.morale + 1);
                if (attackerUnit.morale === 3) attackerUnit.moraleBoostUntil = gameState.turnCounter + 6;
                // morale setter 自动 triggerCommanderOnMoraleChange
                _killedThisAttack = attackerUnit;
                _killerMoraleChanged = attackerUnit.morale !== oldKillerM;
            }
            _atkCmdFxCapture = null;
            const killResult = triggerCommanderOnKill(attackerUnit, targetUnit);
            if (!killResult || !killResult.canActAgain) {
                attackerUnit.canAct = false;
            } else {
                spawnGoldenFlame(fromX, fromY);
                spawnVictoryRipple(fromX, fromY);
            }
            if (_atkCmdFxCapture && !_cmdFxData) _cmdFxData = _atkCmdFxCapture;
            const rankExtra = [0, 2, 5, 12];
            const killXp = 3 + (rankExtra[targetUnit._rank] || 0);
            const bonusXp = targetUnit.commander ? 10 : 0;
            attackerUnit.addXP(killXp + bonusXp);
        }

        // 恢复 spawnFx 引用
        setSpawnFxRef(_atkOrigSpawn);

        if (attackerUnit.canAct && attackerUnit.remainingMP > 0) {
            gameState.attackableTiles = getAttackableTiles(attackerUnit);
            gameState.movableTiles = getMovableTiles(attackerUnit);
            gameState.selectionTime = Date.now();
        } else {
            gameState.attackableTiles = [];
        }
        recalcAllFlankingMorale();
        if (_killedThisAttack && _killerMoraleChanged) {
            spawnMoraleEffect(_killedThisAttack);
            _killerMoraleChanged = false;
            _moraleFxUnitId = _killedThisAttack.id;
        }
        _killedThisAttack = null;
        updateRecruitCostDisplay();
    } finally {
        // 无论视觉效果是否出错，确保联机同步一定执行
        const rankUps = _pendingRankUps.splice(0);
        broadcastAction('attack', {
            x: toX, y: toY,
            fromX, fromY,
            attackerUnitId: attackerUnit.id,
            attackerType: attackerUnit.type,
            isCrit: attackResult.isCrit,
            killed: isTargetDead,
            cityCaptured: _cityCapturedInAttack || false,
            moraleFxUnitId: _moraleFxUnitId || null,
            cmdFxData: _cmdFxData || null,
            ctrCmdFxData: _ctrCmdFxData || null,
            attackDmg: _attackDmg, attackIsCrit: _attackIsCrit,
            counterDmg: _counterDmg, counterX: _counterX, counterY: _counterY,
            healAmt: _healAmtRemote, healX: _healX, healY: _healY,
            cmdFxExtra: _cmdFxExtra || null,
            rankUps: rankUps.length ? rankUps : null,
            bloodDrain: attackerUnit.commander === 'vampire' ? {
                toX, toY,
                fromX: (isTargetDead && attackerUnit.type !== 'archer') ? toX : fromX,
                fromY: (isTargetDead && attackerUnit.type !== 'archer') ? toY : fromY
            } : null,
            purpleLightning: (atkCmdResult?.moraleDropped || atkCmdResult?.converted || ctrCmdResult?.moraleDropped || ctrCmdResult?.converted) ? {
                x: atkCmdResult?.moraleDropped || atkCmdResult?.converted ? toX : attackerUnit.tile.x,
                y: atkCmdResult?.moraleDropped || atkCmdResult?.converted ? toY : attackerUnit.tile.y,
                converted: atkCmdResult?.converted || ctrCmdResult?.converted || false,
                isCtr: !!(ctrCmdResult?.moraleDropped || ctrCmdResult?.converted) && !atkCmdResult?.moraleDropped && !atkCmdResult?.converted
            } : null,
            ctrBloodDrain: (ctrCmdResult && targetUnit.commander === 'vampire') ? { toX: attackerUnit.tile.x, toY: attackerUnit.tile.y, fromX: targetUnit.tile.x, fromY: targetUnit.tile.y } : null,
            ctrMoraleFxUnitId: _ctrMoraleFxUnitId || null
        });
        _cityCapturedInAttack = false;
        _moraleFxUnitId = null;
        _ctrMoraleFxUnitId = null;
        _cmdFxData = null;
        _ctrCmdFxData = null;
        _cmdFxExtra = null;
        _attackDmg = 0; _attackIsCrit = false;
        _counterDmg = 0; _healAmtRemote = 0;
    }
}

// ===== 城市占领 =====================
function updateDistrictColor(cityTile, camp, attackerUnit = null) {
    if (!cityTile.isCity) return;
    if (cityTile.camp === camp) return;

    const oldCamp = cityTile.camp;
    const attackerGoldKey = _campKey(camp);
    const defenderGoldKey = _campKey(oldCamp);

    // 统一掠夺公式：按守方剩余城市数均摊其50%金币
    const defenderCityCount = gameState.tiles.filter(t => t.isCity && t.camp === oldCamp).length;
    const plunderGold = defenderCityCount > 0
        ? Math.floor((1 / defenderCityCount) * 0.5 * gameState.playerGold[defenderGoldKey])
        : 0;

    cityTile.setCampWithFade(camp);

    if (plunderGold > 0) {
        gameState.playerGold[attackerGoldKey] += plunderGold;
        gameState.playerGold[defenderGoldKey] -= plunderGold;
        logMessage(`${camp.name}攻占${oldCamp.name}城市(${cityTile.q},${cityTile.r})，掠夺${plunderGold}金币`);
        gameState.goldTexts.push({
            x: cityTile.x, y: cityTile.y,
            value: plunderGold, prefix: '+', color: '#ffff00',
            timeLeft: 1000, lastUpdate: Date.now()
        });
        spawnGoldParticles(cityTile.x, cityTile.y);
    } else {
        logMessage(`${camp.name}攻占了${oldCamp.name}的城市(${cityTile.q},${cityTile.r})`);
    }

    const districtId = cityTile.districtId;
    gameState.tiles.forEach(tile => {
        if (tile.districtId === districtId) {
            tile.setCampWithFade(camp);
        }
    });

    logMessage(`${camp.name}占领的(${cityTile.q},${cityTile.r})城市所属行政区已归属${camp.name}`);
    if (attackerUnit) attackerUnit.addXP(5);
    invalidateBoard();
    checkVictory();
}

// ===== 胜利检测 =====================
function checkVictory() {
    if (gameState.gameOver) return;

    const player1Districts = new Set();
    const player2Districts = new Set();
    const player3Districts = new Set();

    gameState.tiles.forEach(tile => {
        if (tile.camp === CAMP.player1) {
            player1Districts.add(tile.districtId);
        } else if (tile.camp === CAMP.player2) {
            player2Districts.add(tile.districtId);
        } else if (tile.camp === CAMP.player3) {
            player3Districts.add(tile.districtId);
        }
    });

    if (gameState.isThreePlayer) {
        // 三人模式：失去所有行政区即淘汰
        const districtMap = {
            [CAMP.player1]: player1Districts,
            [CAMP.player2]: player2Districts,
            [CAMP.player3]: player3Districts
        };
        // 检测新被淘汰的玩家（尚未在 surrenderedCamps 中）
        for (const camp of [CAMP.player1, CAMP.player2, CAMP.player3]) {
            if (districtMap[camp].size === 0 && !gameState.surrenderedCamps.includes(camp)) {
                gameState.surrenderedCamps.push(camp);
                // 剩余部队移交中立AI
                let remainingUnits = 0;
                for (const tile of gameState.tiles) {
                    if (tile.unit && tile.unit.camp === camp) {
                        tile.unit.camp = CAMP.neutral;
                        remainingUnits++;
                    }
                }
                logMessage(`${camp.name}失去所有行政区，已被淘汰！剩余${remainingUnits}支部队移交中立AI`);
                notify(`${camp.name}已战败`, 'info');
            }
        }
        // 最后幸存者胜利
        const alive = [];
        if (player1Districts.size > 0) alive.push(CAMP.player1);
        if (player2Districts.size > 0) alive.push(CAMP.player2);
        if (player3Districts.size > 0) alive.push(CAMP.player3);
        if (alive.length <= 1) {
            gameState.gameOver = true;
            gameState.victoryCamp = alive.length === 1 ? alive[0] : CAMP.neutral;
            const winnerName = alive.length === 1 ? alive[0].name : '中立';
            logMessage(`${winnerName}获得最终胜利`);
            setTimeout(() => triggerVictoryEffect(), 1500);
        }
    } else {
        if (player1Districts.size === 0) {
            gameState.gameOver = true;
            gameState.victoryCamp = CAMP.player2;
            logMessage('红军失去所有行政区，蓝军胜利');
            setTimeout(() => triggerVictoryEffect(), 1500);
        } else if (player2Districts.size === 0) {
            gameState.gameOver = true;
            gameState.victoryCamp = CAMP.player1;
            logMessage('蓝军失去所有行政区，红军胜利');
            setTimeout(() => triggerVictoryEffect(), 1500);
        }
    }
}

export function triggerVictoryEffect() {
    const overlay = document.getElementById('victoryOverlay');
    const panel = document.getElementById('victoryPanel');
    const gameOverText = document.getElementById('gameOverText');
    const victoryCampText = document.getElementById('victoryCampText');

    playSound('victory');
    spawnConfetti(150);

    document.body.style.pointerEvents = 'none';

    const vc = gameState.victoryCamp;
    const campColor = vc.color;
    gameOverText.textContent = '游戏结束';
    if (vc === CAMP.player1) {
        victoryCampText.textContent = '红军胜利';
        victoryCampText.style.color = '#ff7777';
        victoryCampText.style.textShadow = '0 0 24px rgba(255,120,120,0.55), 0 0 50px rgba(220,80,80,0.25)';
    } else if (vc === CAMP.player2) {
        victoryCampText.textContent = '蓝军胜利';
        victoryCampText.style.color = '#7799ff';
        victoryCampText.style.textShadow = '0 0 24px rgba(120,140,255,0.55), 0 0 50px rgba(80,100,220,0.25)';
    } else if (vc === CAMP.player3) {
        victoryCampText.textContent = '绿军胜利';
        victoryCampText.style.color = '#77dd77';
        victoryCampText.style.textShadow = '0 0 24px rgba(120,220,120,0.55), 0 0 50px rgba(80,180,80,0.25)';
    } else {
        victoryCampText.textContent = '中立胜利';
        victoryCampText.style.color = '#aaaaaa';
        victoryCampText.style.textShadow = '0 0 24px rgba(180,180,180,0.55)';
    }

    if (typeof gsap !== 'undefined') {
        const tl = gsap.timeline();
        tl.set(panel, { opacity: 0, scale: 0.9, y: 20 });
        tl.set(gameOverText, { opacity: 0, y: 16 });
        tl.set(victoryCampText, { opacity: 0, y: 12 });
        overlay.classList.add('show');
        tl.to(panel, { opacity: 1, scale: 1, y: 0, duration: 0.5, ease: 'power2.out' });
        tl.to(gameOverText, { opacity: 1, y: 0, duration: 0.6, ease: 'power2.out' }, '-=0.2');
        tl.to(victoryCampText, { opacity: 1, y: 0, duration: 0.5, ease: 'back.out(1.4)' }, '-=0.15');
    } else {
        gameOverText.style.color = '#e6c560';
        gameOverText.style.fontSize = '52px';
        victoryCampText.style.fontSize = '40px';
        overlay.classList.add('show');
    }
}

// ===== 投降 / 退出（PVE / 观战） =====================
async function handleSurrender() {
    if (gameState.gameOver) return;

    // PVE 模式：退出回到大厅
    if (gameState.gameMode === 'pve') {
        const confirmed = await showConfirm('确定要退出当前游戏吗？\n进度将不会保存。');
        if (!confirmed) return;
        gameState.gameOver = true;
        resetGameState();
        document.getElementById('gameWrapper').style.display = 'none';
        const lobby = document.getElementById('lobbyOverlay');
        lobby.style.display = '';
        document.getElementById('lobbyHome').style.display = '';
        document.getElementById('multiplayerLobby').style.display = 'none';
        document.getElementById('roomWaiting').style.display = 'none';
        document.getElementById('lobbyReady').style.display = 'none';
        return;
    }

    // 联机：根据角色判断投降方；本地：根据当前回合判断
    const myRole = getMyRole();
    const surrenderCamp = isNetworkGame()
        ? (myRole === 'player1' ? CAMP.player1 : myRole === 'player2' ? CAMP.player2 : myRole === 'player3' ? CAMP.player3 : CAMP.player1)
        : gameState.currentCamp;

    // 三人模式中已投降玩家：按钮变为"退出"，点击后退出至大厅
    if (gameState.isThreePlayer && gameState.surrenderedCamps.includes(surrenderCamp)) {
        leaveRoom();
        document.getElementById('gameWrapper').style.display = 'none';
        document.getElementById('opponentTurnBanner').style.display = 'none';
        document.getElementById('networkIndicator').style.display = 'none';
        document.body.style.pointerEvents = '';
        const lobby = document.getElementById('lobbyOverlay');
        lobby.style.display = '';
        document.getElementById('lobbyHome').style.display = 'none';
        document.getElementById('multiplayerLobby').style.display = '';
        document.getElementById('roomWaiting').style.display = 'none';
        document.getElementById('lobbyReady').style.display = 'none';
        document.getElementById('connectionBar').classList.add('visible');
        document.getElementById('lobbyStatus').textContent = '';
        listRooms();
        resetGameState();
        return;
    }

    let victoryCamp;
    if (gameState.isThreePlayer) {
        // 三人模式：投降方出局，游戏继续（若只剩一人则该人胜利）
        const alive = [];
        for (const c of [CAMP.player1, CAMP.player2, CAMP.player3]) {
            if (c !== surrenderCamp) {
                const hasDistrict = gameState.tiles.some(t => t.isCity && t.camp === c);
                alive.push(c);
            }
        }
        victoryCamp = alive.length === 1 ? alive[0] : null;
    } else {
        victoryCamp = surrenderCamp === CAMP.player1 ? CAMP.player2 : CAMP.player1;
    }

    if (gameState.isThreePlayer && victoryCamp === null) {
        // 三人投降：城市、行政区、部队全部归属中立AI
        const confirmed = await showConfirm(
            `确定要投降吗？\n${surrenderCamp.name}将退出战斗，领土与部队归属中立AI。`
        );
        if (!confirmed) return;
        logMessage(`${surrenderCamp.name}选择投降，领土与部队归属中立！`);
        gameState.surrenderedCamps.push(surrenderCamp);
        for (const tile of gameState.tiles) {
            if (tile.camp === surrenderCamp) tile.setCampWithFade(CAMP.neutral);
            if (tile.unit && tile.unit.camp === surrenderCamp) {
                tile.unit.camp = CAMP.neutral;
            }
        }
        // 跳过该阵营回合，切换到下一个未投降阵营
        if (gameState.currentCamp === surrenderCamp) {
            _skipToNextActiveCamp(surrenderCamp);
        }
        // 投降方显示观战横幅
        const banner = document.getElementById('opponentTurnBanner');
        if (banner && isNetworkGame()) {
            const myCamp = myRole === 'player1' ? CAMP.player1 : myRole === 'player2' ? CAMP.player2 : myRole === 'player3' ? CAMP.player3 : null;
            if (myCamp === surrenderCamp) {
                banner.innerHTML = '<span>👁</span><span>您已战败，观战中</span>';
                banner.classList.add('visible');
            }
        }
        checkVictory();
        updateButtonColors();
        broadcastAction('surrender');
        return;
    }

    const confirmed = await showConfirm(
        `确定要投降吗？\n${surrenderCamp.name}将立即战败，${victoryCamp.name}获得胜利。`
    );
    if (!confirmed) return;

    logMessage(`${surrenderCamp.name}选择投降，${victoryCamp.name}获得最终胜利！`);

    gameState.gameOver = true;
    gameState.victoryCamp = victoryCamp;

    setTimeout(() => triggerVictoryEffect(), 1500);
    updateButtonColors();
    broadcastAction('surrender');
}

// ===== 撤销系统 =====================
function pushUndo() {
    gameState.undoStack.push(serializeState());
    if (gameState.undoStack.length > 5) gameState.undoStack.shift();
}

export function undoLastAction() {
    if (gameState.gameOver) return;
    if (isNetworkGame()) {
        notify('联机模式下无法撤销', 'error');
        return;
    }
    if (gameState.gameMode === 'pve') {
        notify('PVE模式下无法撤销', 'error');
        return;
    }
    if (gameState.undoStack.length === 0) {
        notify('没有可撤销的操作', 'error');
        return;
    }
    const snapshot = gameState.undoStack.pop();
    deserializeState(snapshot, HexTile, Unit);
    clearTransientEffects();
    logMessage('已撤销上一步操作');
}

// ==== 对策卡系统 =====================

export function cancelCardTargeting() {
    gameState.cardTargeting = null;
    hideTargetingBanner();
}

export function executeTacticalCard(cardId, targetTile, _fromX = 0, _fromY = 0) {
    const cfg = TACTICAL_CARD_CONFIG[cardId];
    if (!cfg) return;

    const myCamp = isNetworkGame() ? (getMyRole() === 'player1' ? CAMP.player1 : getMyRole() === 'player2' ? CAMP.player2 : CAMP.player3) : gameState.currentCamp;
    const campKey = myCamp === CAMP.player1 ? 'player1' : myCamp === CAMP.player2 ? 'player2' : 'player3';

    // validate targeting
    const tg = cfg.targeting;
    if (tg === 'enemyGlobal') {
        if (!targetTile || !targetTile.unit || targetTile.unit.camp === myCamp) { notify('无效目标'); return; }
    } else if (tg === 'friendlyAlive') {
        if (!targetTile || !targetTile.unit || targetTile.unit.camp !== myCamp) { notify('无效目标'); return; }
    } else if (tg === 'emptyTile') {
        if (!targetTile || targetTile.unit) { notify('该格已占用'); return; }
    } else if (tg === 'emptyFriendlyNonCityNonMountain') {
        if (!targetTile || targetTile.unit) { notify('该格已占用'); return; }
        if (targetTile.isCity) { notify('不能部署在城市'); return; }
        if (targetTile.terrain === 'mountain') { notify('不能部署在山地'); return; }
        if (targetTile.camp !== myCamp) { notify('只能部署在己方领土'); return; }
    } else if (tg === 'emptyFriendlyLandmine') {
        if (!targetTile || targetTile.unit) { notify('该格已占用'); return; }
        if (targetTile.isCity) { notify('不能部署在城市'); return; }
        if (targetTile.camp !== myCamp) { notify('只能部署在己方领土'); return; }
    } else if (tg === 'enemyCity') {
        if (!targetTile || !targetTile.isCity || targetTile.camp === myCamp)
            { notify('请选择敌方城市'); return; }
    } else if (tg === 'shieldTarget') {
        if (!targetTile || !targetTile.unit) { notify('请选择单位'); return; }
    }

    // validate hand + capture card position for burn anim
    const hand = gameState.playerHands[campKey];
    const idx = hand.indexOf(cardId);
    if (idx === -1) { notify('手牌中没有该卡'); return; }
    const nBefore = hand.length;
    const fromI = nBefore - 1 - idx; // position index in stack (0=leftmost)

    // validate use limit
    if (gameState.playerUsesThisTurn[campKey] >= CARD_SYSTEM_CONFIG.maxUsesPerTurn) {
        notify('本回合已达到使用上限（2次）', 'error'); return;
    }

    // for damage/spawn/shield cards: save state, undo visual, re-apply after burn
    const isDelayedCard = cardId === 'lightning' || cardId === 'airstrike' || cardId === 'mgNest' || cardId === 'shield';
    let _savedHPs = null;
    let _mgNestSaved = null;
    let _shieldSaved = null;
    if (isDelayedCard) {
        _savedHPs = [];
        if (cardId === 'lightning' && targetTile.unit) {
            _savedHPs.push({ tile: targetTile, hp: targetTile.unit.hp });
        } else if (cardId === 'airstrike') {
            const dirs = [[0,0],[1,0],[1,-1],[0,-1],[-1,0],[-1,1],[0,1]];
            for (const [dq, dr] of dirs) {
                const ht = gameState.tileMap.get(`${targetTile.q + dq},${targetTile.r + dr}`);
                if (ht && ht.unit) _savedHPs.push({ tile: ht, hp: ht.unit.hp });
            }
        } else if (cardId === 'mgNest') {
            _mgNestSaved = targetTile.unit;
        } else if (cardId === 'shield' && targetTile.unit) {
            const u = targetTile.unit;
            _shieldSaved = { unit: u, shield: u._shield, shieldMax: u._shieldMax, shieldTurns: u._shieldTurns };
        }
    }

    // execute
    const helpers = { getCommander, Unit, getMyCamp: () => myCamp };
    const result = cfg.execute(targetTile, gameState, helpers);
    gameState.cardTargeting = null;
    hideTargetingBanner();

    // undo visual: save mgNest after execute, then hide
    if (cardId === 'mgNest' && targetTile.unit) {
        _mgNestSaved = targetTile.unit;
        targetTile.unit._airdropWaiting = true;
    }
    // undo visual: restore shield to pre-execute values
    if (_shieldSaved && _shieldSaved.unit) {
        _shieldSaved.unit._shield = _shieldSaved.shield;
        _shieldSaved.unit._shieldMax = _shieldSaved.shieldMax;
        _shieldSaved.unit._shieldTurns = _shieldSaved.shieldTurns;
    }
    // restore HP for damage cards — re-apply in setTimeout
    if (_savedHPs) {
        for (const s of _savedHPs) {
            if (s.tile.unit) s.tile.unit.hp = s.hp;
        }
    }

    // remove from hand, discard (except commanderDeploy)
    hand.splice(idx, 1);
    if (cardId !== 'commanderDeploy') {
        gameState.cardDiscardPile.push(cardId);
    }
    gameState.playerUsesThisTurn[campKey]++;

    const x = targetTile.x, y = targetTile.y;

    // VFX + 视觉反馈延迟至烧牌动画结束后播放（与远端同步）
    const BURN_MS = 1600;
    switch (cardId) {
        case 'heal': {
            const healAmt = result.healAmt;
            logMessage(`💚【疗愈】${targetTile.unit.camp.name}${targetTile.unit.config.name}兵回复${healAmt}生命值`);
            setTimeout(() => {
                if (healAmt > 0 && targetTile.unit) {
                    targetTile.unit.hp = Math.min(targetTile.unit.maxHp, targetTile.unit.hp + healAmt);
                    gameState.healTexts.push({
                        x, y, value: healAmt,
                        timeLeft: 1000, lastUpdate: Date.now()
                    });
                    spawnHealParticles(x, y);
                    triggerHealFlash(x, y);
                }
                playSound('recruit');
            }, BURN_MS);
            break;
        }
        case 'lightning': {
            const dmg = result.dmg;
            logMessage(`⚡【雷击】对${targetTile.unit.camp.name}${targetTile.unit.config.name}兵造成${dmg}真实伤害`);
            setTimeout(() => {
                let hpAfter = 0;
                if (_savedHPs && _savedHPs[0] && _savedHPs[0].tile.unit) {
                    hpAfter = Math.max(0, _savedHPs[0].hp - dmg);
                    _savedHPs[0].tile.unit.hp = hpAfter;
                }
                if (hpAfter <= 0 && targetTile.unit) {
                    const dc = targetTile.unit.camp;
                    const dck = dc === CAMP.player1 ? 'player1' : dc === CAMP.player2 ? 'player2' : dc === CAMP.player3 ? 'player3' : 'neutral';
                    gameState.killCount[dck]++;
                    logMessage(`${dc.name}${targetTile.unit.config.name}兵被雷击消灭`);
                    targetTile.unit = null;
                    spawnExplosionParticles(x, y, '#ff4400', 28);
                    spawnExplosionParticles(x, y, '#ffaa00', 14);
                    triggerScreenShake(4, 150);
                }
                gameState.damageTexts.push({
                    x, y, value: dmg, isTrueDmg: true,
                    timeLeft: 1000, lastUpdate: Date.now()
                });
                spawnLightningStrike(x, y);
                triggerScreenShake(10, 350);
                playSound('attack');
            }, BURN_MS);
            break;
        }
        case 'mgNest': {
            logMessage(`${myCamp.name}在(${targetTile.q},${targetTile.r})部署了机枪堡`);
            setTimeout(() => {
                if (_mgNestSaved) _mgNestSaved._airdropWaiting = false;
                spawnRecruitEffect(x, y);
                triggerRecruitFlash(x, y);
                playSound('recruit');
            }, BURN_MS);
            break;
        }
        case 'imprison': {
            logMessage(`🔗【禁锢】${targetTile.unit.camp.name}${targetTile.unit.config.name}兵下回合无法移动`);
            setTimeout(() => {
                spawnCommanderSkillEffect(x, y, '🔗', '禁锢');
                playSound('recruit');
            }, BURN_MS);
            break;
        }
        case 'forceMarch': {
            logMessage(`🏃【强行军】${targetTile.unit.camp.name}${targetTile.unit.config.name}兵回复2点行动力并可再次行动`);
            setTimeout(() => {
                spawnCommanderSkillEffect(x, y, '🏃', '强行军');
                playSound('recruit');
            }, BURN_MS);
            break;
        }
        case 'airstrike': {
            const results = result.results || [];
            const killedTiles = results.filter(r => r.killed).map(r => ({ q: r.q, r: r.r }));
            result.killedTiles = killedTiles;
            for (const r of results) {
                if (r.killed) {
                    const tile = gameState.tileMap.get(`${r.q},${r.r}`);
                    if (tile && tile.unit && tile.unit.hp <= 0) {
                        const dc = tile.unit.camp;
                        const dck = dc === CAMP.player1 ? 'player1' : dc === CAMP.player2 ? 'player2' : dc === CAMP.player3 ? 'player3' : 'neutral';
                        gameState.killCount[dck]++;
                    }
                }
            }
            logMessage(`✈️【空袭】对${targetTile.camp.name}城市(${targetTile.q},${targetTile.r})及周边造成轰炸伤害`);
            spawnAirstrikeEffect(x, y, results);
            setTimeout(() => {
                // re-apply damage after burn
                if (_savedHPs) {
                    for (const s of _savedHPs) {
                        const r = results.find(rr => rr.q === s.tile.q && rr.r === s.tile.r);
                        if (s.tile.unit && r) s.tile.unit.hp = Math.max(0, s.hp - r.dmg);
                    }
                }
                for (const r of results) {
                    const tile = gameState.tileMap.get(`${r.q},${r.r}`);
                    if (tile) {
                        if (r.killed && tile.unit) tile.unit = null;
                        spawnExplosionParticles(tile.x, tile.y, '#ff8800', 10);
                        gameState.damageTexts.push({
                            x: tile.x, y: tile.y, value: r.dmg, isCrit: false,
                            timeLeft: 900, lastUpdate: Date.now()
                        });
                    }
                }
                triggerScreenShake(6, 300);
                playSound('attack');
            }, BURN_MS);
            break;
        }
        case 'airdrop': {
            logMessage(`🪂【空降】${myCamp.name}在(${targetTile.q},${targetTile.r})空降了步兵`);
            // hide unit until parachute lands
            targetTile.unit._airdropWaiting = true;
            spawnAirstrikeEffect(x, y, [], 'airdrop');
            setTimeout(() => {
                targetTile.unit._airdropWaiting = false;
                if (targetTile.isCity && targetTile.camp !== myCamp) {
                    updateDistrictColor(targetTile, myCamp, targetTile.unit);
                }
                spawnRecruitEffect(x, y);
                triggerRecruitFlash(x, y);
                playSound('recruit');
            }, BURN_MS);
            break;
        }
        case 'shield': {
            logMessage(`🛡️【护盾】${targetTile.unit.camp.name}${targetTile.unit.config.name}兵获得50点护盾（3回合）`);
            setTimeout(() => {
                if (_shieldSaved && _shieldSaved.unit) {
                    _shieldSaved.unit._shield = 50;
                    _shieldSaved.unit._shieldMax = 50;
                    _shieldSaved.unit._shieldTurns = 3;
                }
                spawnCommanderSkillEffect(x, y, '🛡️', '护盾');
                playSound('recruit');
            }, BURN_MS);
            break;
        }
        case 'landmine': {
            logMessage(`💣【地雷】${myCamp.name}在(${targetTile.q},${targetTile.r})埋设了地雷`);
            setTimeout(() => {
                spawnCommanderSkillEffect(x, y, '💣', '地雷');
                playSound('recruit');
            }, BURN_MS);
            break;
        }
        case 'commanderDeploy': {
            const cmdCfg = getCommander(result.commander);
            logMessage(`${myCamp.name}【${cmdCfg?.name || result.commander}】部署到${targetTile.unit.config.name}兵`);
            if (isNetworkGame()) {
                syncCommanderState(
                    gameState.commanderPoolP1, gameState.commanderPoolP2,
                    gameState.commanderP1, gameState.commanderP2,
                    gameState.commanderP1Confirmed, gameState.commanderP2Confirmed,
                    gameState.commanderP1Deployed, gameState.commanderP2Deployed,
                    gameState.commanderPhase,
                    myCamp === CAMP.player1 ? targetTile.unit.id : null,
                    myCamp === CAMP.player2 ? targetTile.unit.id : null,
                    gameState.commanderPoolP3, gameState.commanderP3,
                    gameState.commanderP3Confirmed, gameState.commanderP3Deployed,
                    myCamp === CAMP.player3 ? targetTile.unit.id : null
                );
            }
            setTimeout(() => {
                spawnCommanderSkillEffect(x, y);
                if (result.commander === 'minister' && targetTile.isCity) {
                    spawnMinisterDominionRing(x, y);
                }
                playSound('recruit');
            }, BURN_MS);
            break;
        }
    }

    gameState.cardStackExpanded = false;
    recalcAllFlankingMorale();
    updateUI();
    // 烧牌动画 — 人类玩家从手牌飞到中央；AI/中立/远端在中央直接出现
    const isAI = gameState.gameMode === 'pve' && gameState.currentCamp === gameState.aiOpponentCamp;
    const isHumanLocal = !isAI && gameState.currentCamp !== CAMP.neutral;
    spawnCardUseEffect(cardId, 500, 375, isHumanLocal, _fromX || 900, _fromY || 600);
    broadcastAction('tacticalCard', { cardId, x, y, q: targetTile.q, r: targetTile.r, dmg: result.dmg, deployed: result.deployed, commander: result.commander, healAmt: result.healAmt, imprisoned: result.imprisoned, killedTiles: result.killedTiles, airstrike: result.airstrike });
}
