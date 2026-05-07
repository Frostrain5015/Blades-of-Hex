import { hexToRgb, CAMP, UNIT_CONFIG, hexDistance, invalidateBoard, HEX_NEIGHBORS, TERRAIN_CONFIG, MORALE_CONFIG, calcIncome, WEATHER_CONFIG, WEATHER_CYCLE } from './config.js';
import { gameState, updateButtonColors, updateUI, logMessage, clearselection, saveGame, loadGame, serializeState, deserializeState, rebuildTileMap, notify, updateRecruitCostDisplay } from './state.js';
import { isNetworkGame, sendAction, getMyRole } from './network.js';
import { triggerCommanderTurnStart, triggerCommanderTurnEnd, getCommanderRecruitCost, triggerCommanderOnAttack, triggerCommanderOnCounterAttack, triggerCommanderOnKill, isInStallerZone, getCommander, setGameStateRef, setLogMessageRef, setSpawnFxRef } from './commanderInterface.js';
import { HexTile } from './HexTile.js';
import { Unit } from './Unit.js';
import {
    spawnExplosionParticles, spawnDirectionalParticles, spawnHealParticles, spawnGoldParticles, spawnRecruitEffect,
    triggerAttackFlash, triggerHealFlash, triggerRecruitFlash, triggerScreenShake,
    spawnSlashMarks, spawnMeleeSlash,
    spawnConfetti, triggerTurnFlash, clearTransientEffects,
    spawnMoraleEffect, spawnCommanderSkillEffect
} from './effects.js';
import { playSound } from './audio.js';

// ===== 联机广播 =====================
function broadcastAction(actionType, effectData = null) {
    if (isNetworkGame()) {
        sendAction(actionType, serializeState(), effectData);
    }
}

// ===== 二次确认弹窗 =====================
let _confirmActive = false;
let _cityCapturedInAttack = false;
let _moraleFxUnitId = null;
let _cmdFxData = null;     // 攻击将领特效 { x, y, glyph, label }
let _ctrCmdFxData = null;  // 反击将领特效 { x, y, glyph, label }
let _cmdFxExtra = null;    // 额外的将领特效（如尚书进驻城市）
let _endTurnCmdFxList = null; // 回合结束时的将领特效列表（联机同步用）
let _attackDmg = 0, _attackIsCrit = false;
let _counterDmg = 0, _counterX = 0, _counterY = 0;
let _healAmtRemote = 0, _healX = 0, _healY = 0;
let _killedThisAttack = null; // 击杀后延迟播放士气动画用

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

function applyFlankingMorale() {
    gameState.tiles.forEach(tile => {
        if (!tile.unit) return;
        const u = tile.unit;
        if (u._flankedApplied) return;
        const prev = u.morale;
        if (isSurrounded(u, gameState.tileMap)) {
            u.morale = 0;
            u.canAct = false;
            u._flankedApplied = true;
        } else if (isFlanked(u, gameState.tileMap)) {
            u.morale = Math.max(1, u.morale - 1);
            u._flankedApplied = true;
        }
        if (u.morale !== prev) {
            spawnMoraleEffect(u);
        }
    });
}

export function initMap() {
    gameState.tiles = [];

    // City definitions: each city anchors a Voronoi district
    const cityDefs = [
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

    logMessage('游戏开始，红军先手');

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

    invalidateBoard();
}

let _initMapEventsBound = false;

function initInitialUnits() {
    const map = gameState.tileMap;
    function spawn(type, camp, q, r) {
        const tile = map.get(`${q},${r}`);
        if (tile && !tile.unit) new Unit(type, camp, tile, false);
    }

    // ── 玩家阵型（镜像对称，各 3步 2骑 1炮） ──
    const formation = [
        ['infantry', 0, 0],    // 城市驻军
        ['cavalry',  1, 0],    // 前锋
        ['archer',   0, 1],    // 右翼火力
        ['infantry', -1, 1],   // 右翼后卫
        ['cavalry',  2, -1],   // 游击斥候
        ['infantry', 0, -1],   // 左翼步兵
    ];

    const p1City = gameState.tiles.find(t => t.isCity && t.districtId === 1);
    const p2City = gameState.tiles.find(t => t.isCity && t.districtId === 2);

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

// ===== 回合管理 =====================
let _turnProcessing = false;
let _neutralAiLock = false; // 防止AI在非中立回合异常触发

function _campKey(camp) {
    return camp === CAMP.player1 ? 'player1' : camp === CAMP.player2 ? 'player2' : 'neutral';
}

function _updateWeather() {
    const round = Math.floor(gameState.turnCounter / 3);  // 0-indexed full round
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

async function _doEndTurnPhase() {
    const camp = gameState.currentCamp;
    _endTurnCmdFxList = []; // 本回合将领特效收集

    // 包装 spawnFx 引用以收集特效坐标（不直接覆写 import binding）
    const origSpawn = spawnCommanderSkillEffect;
    setSpawnFxRef((x, y, glyph, label) => {
        _endTurnCmdFxList.push({ x, y, glyph: glyph || '★', label: label || '' });
        origSpawn(x, y, glyph, label);
    });

    // Unit reset + infantry city heal + 将领回合开始效果
    gameState.tiles.forEach(tile => {
        if (tile.unit) {
            tile.unit.canAct = true;
            tile.unit.movedThisTurn = false;
            tile.unit.moveDistance = 0;
            tile.unit.counterAttackCount = 0;
            tile.unit.remainingMP = tile.unit.config.speed;
            // SPD bonus re-apply from commander
            if (tile.unit.commander) {
                const cmdCfg = getCommander(tile.unit.commander);
                if (cmdCfg && cmdCfg.spdBonus) tile.unit.remainingMP += cmdCfg.spdBonus;
            }
            tile.unit.isNewRecruit = false;
            tile.unit._flankedApplied = false;
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
        }
    });

    // 将领回合开始效果（铁卫治疗等）
    triggerCommanderTurnStart(gameState, camp);

    // Income（中立减半，仅作象征性抵抗）
    const key = _campKey(camp);
    const cities = gameState.tiles.filter(t => t.isCity && t.camp === camp);
    const cityCount = cities.length;
    const income = camp === CAMP.neutral ? Math.floor(calcIncome(cityCount) / 2) : calcIncome(cityCount);
    gameState.playerGold[key] += income;
    // 将领回合结束效果（尚书屯田等）
    triggerCommanderTurnEnd(gameState, camp, key);
    if (income > 0) {
        logMessage(`${camp.name}回合结束，城市产出共计${income}金币`);
        cities.forEach((cityTile, i) => {
            const cityValue = i === 0 ? 20 : i === 1 ? 15 : 10;
            gameState.goldTexts.push({
                x: cityTile.x, y: cityTile.y,
                value: cityValue, prefix: '+', color: '#ffff00',
                timeLeft: 1000, lastUpdate: Date.now()
            });
            spawnGoldParticles(cityTile.x, cityTile.y);
        });
    }

    // Morale upkeep
    gameState.tiles.forEach(tile => {
        if (!tile.unit) return;
        if (tile.unit.morale === 3 && tile.unit.moraleBoostUntil <= gameState.turnCounter) {
            tile.unit.morale = 2;
        }
    });
    // Three-way toggle
    if (camp === CAMP.player1) {
        gameState.currentCamp = CAMP.player2;
    } else if (camp === CAMP.player2) {
        gameState.currentCamp = CAMP.neutral;
    } else {
        gameState.currentCamp = CAMP.player1;
    }
    gameState.turnCounter++;
    // 夹击仅在移动/攻击后判定，回合切换时不重复判定
    // 天气在新回合开始时更新（切回 P1 时）
    if (gameState.currentCamp === CAMP.player1) {
        _updateWeather();
    }

    // 恢复 commanderInterface 的 spawnFx 引用
    setSpawnFxRef(origSpawn);

    // Common end-phase effects
    playSound('turnEnd');
    triggerTurnFlash(gameState.currentCamp.color);
    updateUI();
    logMessage(`轮到${gameState.currentCamp.name}行动`);
    updateButtonColors();
    clearselection();
    gameState.undoStack = [];
    if (!isNetworkGame()) saveGame(true); // 自动存档静默，不弹提示
    broadcastAction('endTurn', { cmdFxList: _endTurnCmdFxList.length > 0 ? _endTurnCmdFxList : null });
}

export async function endTurn() {
    if (gameState.gameOver || _turnProcessing) return;
    _turnProcessing = true;

    try {
        const hasActionable = gameState.tiles.some(t =>
            t.unit && t.unit.camp === gameState.currentCamp && t.unit.canAct && !t.unit.isNewRecruit
        );
        if (hasActionable && gameState.currentCamp !== CAMP.neutral) {
            const confirmed = await showConfirm(
                `你仍有未行动的部队。\n确定要跳过行动，结束当前回合吗？`
            );
            if (!confirmed) return;
        }

        await _doEndTurnPhase();

        // Neutral AI turn（延迟引用避免与 ai.js 循环依赖）
        if (gameState.currentCamp === CAMP.neutral && !gameState.gameOver && !_neutralAiLock) {
            if (!isNetworkGame() || getMyRole() === 'player1') {
                _neutralAiLock = true;
                gameState.aiActing = true;
                try {
                    const { processNeutralTurn } = await import('./ai.js');
                    // 超时保护：15秒内必须完成，防止移动端异步挂起
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
                }
                // Auto-end neutral → P1（仅主机执行）
                if (!gameState.gameOver) {
                    await _doEndTurnPhase();
                }
                gameState.aiActing = false;
                _neutralAiLock = false;
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
    notify(`招募成功`);
    logMessage(`${gameState.currentCamp.name}成功招募${config.name}兵，金币-${effectiveCost}`);
    gameState.selectedCityTile = null;

    gameState.goldTexts.push({
        x: selectedCityTile.x, y: selectedCityTile.y,
        value: effectiveCost, prefix: '-', color: '#cccccc',
        timeLeft: 1000, lastUpdate: Date.now()
    });
    spawnGoldParticles(selectedCityTile.x, selectedCityTile.y);
    updateUI();
    broadcastAction('recruit', { x: selectedCityTile.x, y: selectedCityTile.y });
}

// ===== 移动范围计算 =====================

// Check if a tile is in 停滞者缚足 zone (staller + adjacent 6)
function _isInStallerZone(tile, friendlyCamp) {
    return isInStallerZone(tile, friendlyCamp, gameState.tileMap);
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
    if (unit.morale === 0) return [];

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
            // 停滞者【缚足】：自身及相邻6格敌军移动消耗+3
            if (_isInStallerZone(neighbor, friendlyCamp)) stepCost += 3;
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
    let range = unit.config.range;
    if (gameState.weather === 'fog'  && unit.type === 'archer') range -= 1;
    if (gameState.weather === 'wind' && unit.type === 'archer') range += 1;
    range = Math.max(1, Math.min(4, range));
    const startTile = unit.tile;
    return gameState.tiles.filter(tile => {
        return hexDistance(tile, startTile) <= range && tile.unit && tile.unit.camp !== unit.camp;
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

    if (targetTile.isCity && targetTile.camp !== unit.camp) {
        updateDistrictColor(targetTile, unit.camp);
    }
    // 尚书进驻城市：触发技能特效
    let _cmdFxForMove = null;
    if (targetTile.isCity && unit.commander === 'minister') {
        spawnCommanderSkillEffect(targetTile.x, targetTile.y, '★', '屯田');
        _cmdFxForMove = { x: targetTile.x, y: targetTile.y, glyph: '★', label: '屯田' };
    }
    applyFlankingMorale();
    updateRecruitCostDisplay(); // 尚书驻扎城市时及时刷新折扣
    broadcastAction('move', { unitId: unit.id, fromX, fromY, path, cmdFx: _cmdFxForMove });
}

// ===== 攻击 =====================
export function attackUnit(attackerUnit, targetUnit) {
    if (gameState.gameOver) return;
    if (!attackerUnit.canAct || !gameState.attackableTiles.includes(targetUnit.tile)) {
        notify('无法攻击：超出射程或单位已行动', 'error');
        return;
    }

    // 包装 spawnFx 引用以捕获将领特效的 glyph/label
    const _atkOrigSpawn = spawnCommanderSkillEffect;
    let _atkCmdFxCapture = null;
    setSpawnFxRef((x, y, glyph, label) => {
        _atkCmdFxCapture = { x, y, glyph: glyph || '★', label: label || '' };
        _atkOrigSpawn(x, y, glyph, label);
    });

    pushUndo();
    const attackResult = attackerUnit.calculateDamage(targetUnit);
    _attackDmg = attackResult.dmg; _attackIsCrit = attackResult.isCrit;
    const fromX = attackerUnit.tile.x, fromY = attackerUnit.tile.y;
    const toX = targetUnit.tile.x, toY = targetUnit.tile.y;
    playSound(attackResult.isCrit ? 'crit' : 'attack');
    triggerAttackFlash(toX, toY, attackResult.isCrit);
    if (attackerUnit.type === 'archer') {
        spawnDirectionalParticles(fromX, fromY, toX, toY, '#ff8844', attackResult.isCrit ? 22 : 10);
        spawnSlashMarks(toX, toY, fromX, fromY, attackResult.isCrit);
    } else {
        spawnMeleeSlash(toX, toY, fromX, fromY, attackResult.isCrit);
    }
    triggerScreenShake(attackResult.isCrit ? 6 : 3, attackResult.isCrit ? 200 : 120);
    const isTargetDead = targetUnit.takeDamage(attackResult.dmg, attackerUnit);
    logMessage(`${attackerUnit.camp.name}的${attackerUnit.config.name}兵攻击造成${Math.round(attackResult.dmg)}伤害${attackResult.isCrit ? '（暴击）' : ''}`);

    // 将领攻击效果（吸血鬼嗜血、谋士攻心等）
    _atkCmdFxCapture = null;
    const atkCmdResult = triggerCommanderOnAttack(attackerUnit, targetUnit, attackResult.dmg);
    if (atkCmdResult) {
        if (atkCmdResult.healAmt) {
            _healAmtRemote = atkCmdResult.healAmt; _healX = attackerUnit.tile.x; _healY = attackerUnit.tile.y;
        }
        if (atkCmdResult.moraleDropped) {
            spawnMoraleEffect(targetUnit);
            _moraleFxUnitId = targetUnit.id;
        }
    }
    _cmdFxData = _atkCmdFxCapture; // 攻击将领特效（含glyph+label）

    if (!isTargetDead) {
        const counterResult = targetUnit.calculateCounterDamage(attackerUnit);
        _counterDmg = counterResult.dmg;
        _counterX = attackerUnit.tile.x; _counterY = attackerUnit.tile.y;
        if (counterResult.dmg > 0) {
            attackerUnit.takeDamage(counterResult.dmg, targetUnit);
            // 反击将领效果（吸血鬼嗜血等）
            _atkCmdFxCapture = null;
            triggerCommanderOnCounterAttack(attackerUnit, targetUnit, counterResult.dmg);
            _ctrCmdFxData = _atkCmdFxCapture; // 反击将领特效（含glyph+label）
        }
        attackerUnit.canAct = false;
    } else {
        const targetTile = targetUnit.tile;
        if (attackerUnit.type !== 'archer') {
            attackerUnit.tile.unit = null;
            attackerUnit.tile = targetTile;
            targetTile.unit = attackerUnit;
            // Animate the kill-move step
            attackerUnit.moveDistance++;
            attackerUnit.startMovePath([{ x: fromX, y: fromY }, { x: toX, y: toY }]);
            // Only occupy city when actually moving in (melee)
            if (targetTile.isCity) { updateDistrictColor(targetTile, attackerUnit.camp); _cityCapturedInAttack = true; }
            // 尚书通过近战击杀进驻城市：触发技能特效
            if (targetTile.isCity && attackerUnit.commander === 'minister') {
                spawnCommanderSkillEffect(targetTile.x, targetTile.y, '★', '屯田');
                _cmdFxExtra = { x: targetTile.x, y: targetTile.y, glyph: '★', label: '屯田' };
            }
        }
        if (attackerUnit.morale !== 0) {
            attackerUnit.morale = Math.min(3, attackerUnit.morale + 1);
            if (attackerUnit.morale === 3) attackerUnit.moraleBoostUntil = gameState.turnCounter + 4;
            _killedThisAttack = attackerUnit; // 延迟到夹击判定后播放士气动画
        }

        // 将领击杀效果（百夫长乘胜追击等）
        _atkCmdFxCapture = null;
        const killResult = triggerCommanderOnKill(attackerUnit, targetUnit);
        if (!killResult || !killResult.canActAgain) {
            attackerUnit.canAct = false;
        }
        if (_atkCmdFxCapture && !_cmdFxData) _cmdFxData = _atkCmdFxCapture;
    }

    // 恢复 spawnFx 引用
    setSpawnFxRef(_atkOrigSpawn);

    // 百夫长触发后：立即刷新攻击范围（无需取消重选）
    if (attackerUnit.canAct && attackerUnit.remainingMP > 0) {
        gameState.attackableTiles = getAttackableTiles(attackerUnit);
        gameState.movableTiles = getMovableTiles(attackerUnit);
        gameState.selectionTime = Date.now();
    } else {
        gameState.attackableTiles = [];
    }
    // 夹击判定在士气提升之后，随后统一播放士气动画，确保动画反映最终士气值
    const _preFlankMorale = _killedThisAttack ? _killedThisAttack.morale : null;
    applyFlankingMorale();
    if (_killedThisAttack && _killedThisAttack.morale === _preFlankMorale) {
        spawnMoraleEffect(_killedThisAttack);
        _moraleFxUnitId = _killedThisAttack.id;
    }
    _killedThisAttack = null;
    updateRecruitCostDisplay();
    broadcastAction('attack', {
        x: toX, y: toY,
        fromX, fromY,
        isCrit: attackResult.isCrit,
        killed: isTargetDead,
        cityCaptured: _cityCapturedInAttack || false,
        moraleFxUnitId: _moraleFxUnitId || null,
        cmdFxData: _cmdFxData || null,
        ctrCmdFxData: _ctrCmdFxData || null,
        attackDmg: _attackDmg, attackIsCrit: _attackIsCrit,
        counterDmg: _counterDmg, counterX: _counterX, counterY: _counterY,
        healAmt: _healAmtRemote, healX: _healX, healY: _healY,
        cmdFxExtra: _cmdFxExtra || null
    });
    _cityCapturedInAttack = false;
    _moraleFxUnitId = null;
    _cmdFxData = null;
    _ctrCmdFxData = null;
    _cmdFxExtra = null;
    _attackDmg = 0; _attackIsCrit = false;
    _counterDmg = 0; _healAmtRemote = 0;
}

// ===== 城市占领 =====================
function updateDistrictColor(cityTile, camp) {
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
    invalidateBoard();
    checkVictory();
}

// ===== 胜利检测 =====================
function checkVictory() {
    if (gameState.gameOver) return;

    const player1Districts = new Set();
    const player2Districts = new Set();

    gameState.tiles.forEach(tile => {
        if (tile.camp === CAMP.player1) {
            player1Districts.add(tile.districtId);
        } else if (tile.camp === CAMP.player2) {
            player2Districts.add(tile.districtId);
        }
    });

    if (player1Districts.size === 0) {
        gameState.gameOver = true;
        gameState.victoryCamp = CAMP.player2;
        triggerVictoryEffect();
        logMessage('红军失去所有行政区，蓝军胜利');
    } else if (player2Districts.size === 0) {
        gameState.gameOver = true;
        gameState.victoryCamp = CAMP.player1;
        triggerVictoryEffect();
        logMessage('蓝军失去所有行政区，红军胜利');
    }
}

export function triggerVictoryEffect() {
    const overlay = document.getElementById('victoryOverlay');
    const gameOverText = document.getElementById('gameOverText');
    const victoryCampText = document.getElementById('victoryCampText');

    playSound('victory');
    spawnConfetti(150);

    document.body.style.pointerEvents = 'none';

    const victoryRgb = hexToRgb(gameState.victoryCamp.color);
    overlay.style.backgroundColor = `rgba(${victoryRgb.r}, ${victoryRgb.g}, ${victoryRgb.b}, 0.85)`;

    gameOverText.textContent = '⚔ 游戏结束 ⚔';
    victoryCampText.textContent = `${gameState.victoryCamp.flag} ${gameState.victoryCamp.name}胜利！`;

    if (typeof gsap !== 'undefined') {
        const tl = gsap.timeline();
        tl.set(gameOverText, { opacity: 0, y: 30, fontSize: '72px', fontWeight: 'bold',
            color: '#fff', textShadow: '0 0 20px rgba(255,215,0,0.6), 0 0 40px rgba(255,215,0,0.3)' });
        tl.set(victoryCampText, { opacity: 0, scale: 0.5, fontSize: '56px', fontWeight: 'bold',
            color: '#ffd700', textShadow: '0 0 30px rgba(255,215,0,0.8), 0 0 60px rgba(255,215,0,0.4)' });
        tl.set(overlay, { opacity: 0 });
        overlay.classList.add('show');
        tl.to(overlay, { opacity: 1, duration: 0.6 });
        tl.to(gameOverText, { opacity: 1, y: 0, duration: 0.8, ease: 'power2.out' });
        tl.to(victoryCampText, { opacity: 1, scale: 1, duration: 0.7, ease: 'back.out(1.5)' }, '-=0.25');
        tl.to(gameOverText, { scale: 1.05, textShadow: '0 0 35px rgba(255,215,0,0.8), 0 0 70px rgba(255,215,0,0.4)', duration: 0.6, yoyo: true, repeat: -1, ease: 'sine.inOut' }, '+=0.1');
    } else {
        // Fallback to CSS animations
        gameOverText.style.animation = 'victoryTitleGlow 1.5s ease forwards';
        gameOverText.style.color = '#fff';
        gameOverText.style.fontSize = '72px';
        gameOverText.style.fontWeight = 'bold';
        gameOverText.style.textShadow = '0 0 20px rgba(255,215,0,0.6), 0 0 40px rgba(255,215,0,0.3)';
        gameOverText.style.marginBottom = '20px';
        victoryCampText.style.animation = 'victoryCampGlow 1s ease 0.5s forwards';
        victoryCampText.style.opacity = '0';
        victoryCampText.style.color = '#ffd700';
        victoryCampText.style.fontSize = '56px';
        victoryCampText.style.fontWeight = 'bold';
        victoryCampText.style.textShadow = '0 0 30px rgba(255,215,0,0.8), 0 0 60px rgba(255,215,0,0.4)';
        overlay.classList.add('show');
    }
}

// ===== 投降 =====================
async function handleSurrender() {
    if (gameState.gameOver) return;

    const confirmed = await showConfirm(
        `确定要投降吗？\n当前回合的${gameState.currentCamp.name}将立即战败，对手获得胜利。`
    );
    if (!confirmed) return;

    const surrenderCamp = gameState.currentCamp;
    const victoryCamp = surrenderCamp === CAMP.player1 ? CAMP.player2 : CAMP.player1;

    logMessage(`${surrenderCamp.name}选择投降，${victoryCamp.name}获得最终胜利！`);

    gameState.gameOver = true;
    gameState.victoryCamp = victoryCamp;

    triggerVictoryEffect();
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
    if (gameState.undoStack.length === 0) {
        notify('没有可撤销的操作', 'error');
        return;
    }
    const snapshot = gameState.undoStack.pop();
    deserializeState(snapshot, HexTile, Unit);
    clearTransientEffects();
    logMessage('已撤销上一步操作');
}
