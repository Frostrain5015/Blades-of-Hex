import { HEX_SIZE, canvas, ctx, hexPath, drawHexagonOutline, hexToRgb, CAMP, UNIT_CONFIG, hexDistance, invalidateBoard, HEX_NEIGHBORS, TERRAIN_CONFIG, MORALE_CONFIG } from './config.js';
import { gameState, updateButtonColors, updateUI, logMessage, clearselection, snapshotState, restoreState, saveGame, loadGame, serializeState, rebuildTileMap, notify } from './state.js';
import { isNetworkGame, sendAction } from './network.js';
import { HexTile } from './HexTile.js';
import { Unit } from './Unit.js';
import {
    spawnExplosionParticles, spawnDirectionalParticles, spawnHealParticles, spawnGoldParticles, spawnRecruitEffect,
    triggerAttackFlash, triggerHealFlash, triggerRecruitFlash, triggerScreenShake,
    spawnSlashMarks, spawnMeleeSlash,
    spawnConfetti, triggerTurnFlash, clearTransientEffects,
    spawnMoraleEffect
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
        const prev = u.morale;
        if (isSurrounded(u, gameState.tileMap)) {
            u.morale = 'chaos';
            u.canAct = false;
        } else if (isFlanked(u, gameState.tileMap)) {
            if (u.morale !== 'high') u.morale = 'low';
        } else if (u.morale !== 'high') {
            u.morale = 'normal';
        }
        if (u.morale !== prev && u.morale !== 'normal') {
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

    // 绑定按钮事件
    const surrenderBtn = document.getElementById('surrenderBtn');
    if (surrenderBtn) {
        surrenderBtn.addEventListener('click', handleSurrender);
    }
    document.getElementById('endTurnBtn').addEventListener('click', endTurn);
    document.getElementById('recruitInfantry').addEventListener('click', () => recruitUnit('infantry'));
    document.getElementById('recruitCavalry').addEventListener('click', () => recruitUnit('cavalry'));
    document.getElementById('recruitArcher').addEventListener('click', () => recruitUnit('archer'));

    // 存档 / 读档按钮
    const saveBtn = document.getElementById('saveGameBtn');
    const loadBtn = document.getElementById('loadGameBtn');
    if (saveBtn) saveBtn.addEventListener('click', () => saveGame());
    if (loadBtn) loadBtn.addEventListener('click', () => {
        loadGame(HexTile, Unit);
        clearTransientEffects();
    });

    invalidateBoard();
}

function initInitialUnits() {
    // Player 1 — left pole (district 1)
    const p1City = gameState.tiles.find(t => t.isCity && t.districtId === 1);
    if (p1City) {
        new Unit('infantry', CAMP.player1, p1City, false);
        const cavTile = gameState.tiles.find(t => t.q === -5 && t.r === 0);
        if (cavTile) new Unit('cavalry', CAMP.player1, cavTile, false);
        const archTile = gameState.tiles.find(t => t.q === -6 && t.r === 1);
        if (archTile) new Unit('archer', CAMP.player1, archTile, false);
    }

    // Player 2 — right pole (district 2)
    const p2City = gameState.tiles.find(t => t.isCity && t.districtId === 2);
    if (p2City) {
        new Unit('infantry', CAMP.player2, p2City, false);
        const cavTile = gameState.tiles.find(t => t.q === 5 && t.r === 0);
        if (cavTile) new Unit('cavalry', CAMP.player2, cavTile, false);
        const archTile = gameState.tiles.find(t => t.q === 6 && t.r === -1);
        if (archTile) new Unit('archer', CAMP.player2, archTile, false);
    }

    // Neutral — center (district 5)
    const centerCity = gameState.tiles.find(t => t.isCity && t.districtId === 5);
    if (centerCity) {
        new Unit('infantry', CAMP.neutral, centerCity, false);
        const adjTile = gameState.tiles.find(t => t.q === 0 && t.r === 1);
        if (adjTile) new Unit('infantry', CAMP.neutral, adjTile, false);
    }

    // Neutral — top (district 3)
    const topCity = gameState.tiles.find(t => t.isCity && t.districtId === 3);
    if (topCity) {
        new Unit('infantry', CAMP.neutral, topCity, false);
    }

    // Neutral — bottom (district 4)
    const bottomCity = gameState.tiles.find(t => t.isCity && t.districtId === 4);
    if (bottomCity) {
        new Unit('infantry', CAMP.neutral, bottomCity, false);
    }
}

// ===== 回合管理 =====================
export async function endTurn() {
    if (gameState.gameOver) return;

    const hasActionable = gameState.tiles.some(t =>
        t.unit && t.unit.camp === gameState.currentCamp && t.unit.canAct && !t.unit.isNewRecruit
    );
    if (hasActionable) {
        const confirmed = await showConfirm(
            `你仍有未行动的部队。\n确定要跳过行动，结束当前回合吗？`
        );
        if (!confirmed) return;
    }

    gameState.tiles.forEach(tile => {
        if (tile.unit) {
            tile.unit.canAct = true;
            tile.unit.movedThisTurn = false;
            tile.unit.counterAttackCount = 0;
            tile.unit.remainingMP = tile.unit.config.speed;
            tile.unit.isNewRecruit = false;

            if (tile.unit.type === 'infantry' && tile.isCity && tile.unit.camp === gameState.currentCamp) {
                const healAmount = tile.unit.maxHp * 0.1;
                const actualHeal = tile.unit.heal(healAmount);
                if (actualHeal > 0) {
                    logMessage(`${tile.unit.camp.name}的步兵驻守城市回复${Math.round(actualHeal)}生命值`);
                }
            }
        }
    });

    const currentPlayerKey = gameState.currentCamp === CAMP.player1 ? 'player1' : 'player2';
    const currentCampCities = gameState.tiles.filter(t => t.isCity && t.camp === gameState.currentCamp);
    const cityCount = currentCampCities.length;
    gameState.playerGold[currentPlayerKey] += cityCount * 15;
    logMessage(`${gameState.currentCamp.name}回合结束，本回合${gameState.currentCamp.name}城市产出共计${cityCount * 15}金币`);

    currentCampCities.forEach(cityTile => {
        gameState.goldTexts.push({
            x: cityTile.x, y: cityTile.y,
            value: 15, prefix: '+', color: '#ffff00',
            timeLeft: 1000, lastUpdate: Date.now()
        });
        spawnGoldParticles(cityTile.x, cityTile.y);
    });

    gameState.currentCamp = gameState.currentCamp === CAMP.player1 ? CAMP.player2 : CAMP.player1;
    gameState.turnCounter++;

    // Morale boost expiry
    gameState.tiles.forEach(tile => {
        if (!tile.unit) return;
        const u = tile.unit;
        if (u.morale === 'high' && u.moraleBoostUntil <= gameState.turnCounter) {
            u.morale = 'normal';
        }
    });
    applyFlankingMorale();

    playSound('turnEnd');
    triggerTurnFlash(gameState.currentCamp.color);
    updateUI();
    logMessage(`轮到${gameState.currentCamp.name}行动`);
    updateButtonColors();
    clearselection();
    gameState.undoStack = [];
    if (!isNetworkGame()) saveGame();
    broadcastAction('endTurn');
}

// ===== 招募 =====================
export function recruitUnit(type) {
    if (gameState.gameOver) return;
    const config = UNIT_CONFIG[type];
    const currentPlayerKey = gameState.currentCamp === CAMP.player1 ? 'player1' : 'player2';

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
    if (gameState.playerGold[currentPlayerKey] < config.cost) {
        notify('金币不足', 'error');
        return;
    }

    pushUndo();
    gameState.playerGold[currentPlayerKey] -= config.cost;
    new Unit(type, gameState.currentCamp, selectedCityTile, true);
    playSound('recruit');
    triggerRecruitFlash(selectedCityTile.x, selectedCityTile.y);
    spawnRecruitEffect(selectedCityTile.x, selectedCityTile.y);
    notify(`招募成功`);
    logMessage(`${gameState.currentCamp.name}成功招募${config.name}兵，金币-${config.cost}`);
    gameState.selectedCityTile = null;

    gameState.goldTexts.push({
        x: selectedCityTile.x, y: selectedCityTile.y,
        value: config.cost, prefix: '-', color: '#cccccc',
        timeLeft: 1000, lastUpdate: Date.now()
    });
    spawnGoldParticles(selectedCityTile.x, selectedCityTile.y);
    updateUI();
    broadcastAction('recruit', { x: selectedCityTile.x, y: selectedCityTile.y });
}

// ===== 移动范围计算 =====================

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
    if (unit.morale === 'chaos') return [];

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

            const stepCost = TERRAIN_CONFIG[neighbor.terrain].stepCost;
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
    const range = unit.config.range;
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
    unit.startMovePath(path);

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
    applyFlankingMorale();
    broadcastAction('move', { unitId: unit.id, fromX, fromY });
}

// ===== 攻击 =====================
export function attackUnit(attackerUnit, targetUnit) {
    if (gameState.gameOver) return;
    if (!attackerUnit.canAct || !gameState.attackableTiles.includes(targetUnit.tile)) {
        notify('无法攻击：超出射程或单位已行动', 'error');
        return;
    }

    pushUndo();
    const attackResult = attackerUnit.calculateDamage(targetUnit);
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

    if (!isTargetDead) {
        const counterResult = targetUnit.calculateCounterDamage(attackerUnit);
        if (counterResult.dmg > 0) attackerUnit.takeDamage(counterResult.dmg, targetUnit);
    } else {
        const targetTile = targetUnit.tile;
        if (attackerUnit.type !== 'archer') {
            attackerUnit.tile.unit = null;
            attackerUnit.tile = targetTile;
            targetTile.unit = attackerUnit;
            // Animate the kill-move step
            attackerUnit.startMovePath([{ x: fromX, y: fromY }, { x: toX, y: toY }]);
            // Only occupy city when actually moving in (melee)
            if (targetTile.isCity) updateDistrictColor(targetTile, attackerUnit.camp);
        }
        if (attackerUnit.morale !== 'chaos') {
            attackerUnit.morale = 'high';
            attackerUnit.moraleBoostUntil = gameState.turnCounter + 2;
            spawnMoraleEffect(attackerUnit);
        }
    }

    attackerUnit.canAct = false;
    gameState.attackableTiles = [];
    applyFlankingMorale();
    broadcastAction('attack', {
        x: toX, y: toY,
        fromX, fromY,
        isCrit: attackResult.isCrit,
        killed: isTargetDead
    });
}

// ===== 城市占领 =====================
function updateDistrictColor(cityTile, camp) {
    if (!cityTile.isCity) return;
    if (cityTile.camp === camp) return;

    const oldCamp = cityTile.camp;
    const cityUniqueKey = `${cityTile.q}-${cityTile.r}`;
    const attackerGoldKey = camp === CAMP.player1 ? 'player1' : 'player2';

    let plunderGold = 0;
    let defenderGoldKey = null;
    if (oldCamp === CAMP.player1 || oldCamp === CAMP.player2) {
        defenderGoldKey = oldCamp === CAMP.player1 ? 'player1' : 'player2';
        const defenderCityCount = gameState.tiles.filter(t => t.isCity && t.camp === oldCamp).length;
        if (defenderCityCount > 0) {
            plunderGold = Math.floor((1 / defenderCityCount) * 0.5 * gameState.playerGold[defenderGoldKey]);
        }
    }

    cityTile.setCampWithFade(camp);

    if (oldCamp === CAMP.neutral) {
        if (!gameState.capturedNeutralCities.has(cityUniqueKey)) {
            gameState.playerGold[attackerGoldKey] += 15;
            gameState.capturedNeutralCities.add(cityUniqueKey);
            logMessage(`${camp.name}占领中立城市(${cityTile.q},${cityTile.r})，金币+15`);
            gameState.goldTexts.push({
                x: cityTile.x, y: cityTile.y,
                value: 15, prefix: '+', color: '#ffff00',
                timeLeft: 1000, lastUpdate: Date.now()
            });
            spawnGoldParticles(cityTile.x, cityTile.y);
        } else {
            logMessage(`${camp.name}重新占领中立城市(${cityTile.q},${cityTile.r})`);
        }
    } else {
        if (plunderGold > 0) {
            gameState.playerGold[attackerGoldKey] += plunderGold;
            gameState.playerGold[defenderGoldKey] -= plunderGold;
            logMessage(`${camp.name}攻占了城市(${cityTile.q},${cityTile.r})，掠夺${oldCamp.name}${plunderGold}金币`);
            gameState.goldTexts.push({
                x: cityTile.x, y: cityTile.y,
                value: plunderGold, prefix: '+', color: '#ffff00',
                timeLeft: 1000, lastUpdate: Date.now()
            });
            spawnGoldParticles(cityTile.x, cityTile.y);
        } else {
            logMessage(`${camp.name}攻占了${oldCamp.name}的城市(${cityTile.q},${cityTile.r})`);
        }
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
    gameState.undoStack.push(snapshotState());
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
    restoreState(snapshot, HexTile, Unit);
    clearTransientEffects();
    logMessage('已撤销上一步操作');
}
