import { CAMP, UNIT_CONFIG, hexDistance, invalidateBoard, HEX_NEIGHBORS, TERRAIN_CONFIG, calcIncome, WEATHER_CYCLE, TACTICAL_CARD_CONFIG, CARD_SYSTEM_CONFIG, DECK_COMPOSITION, SKIRMISH_EXTRAS, VILLAGE_GOLD, VILLAGE_MIN_DIST, HEX_SIZE, COLONEL_CARDS, COLONEL_CARD_GOLD, COMMANDER_REROLL_COST, getRound, getRoundIndex, getFactionCount } from './config.js';
import { allCommanders as COMMANDER_CONFIG } from '../commander/index.js';
import { DRONE_RANGE, DRONE_SUICIDE_RANGE, deployDrone, isTileInDroneSignal, isDroneInSignal, refreshDroneSignal } from '../commander/tianyan.js';
import { gameState, updateButtonColors, updateUI, logMessage, clearselection, serializeState, deserializeState, rebuildTileMap, notify, updateRecruitCostDisplay, showTargetingBanner, hideTargetingBanner, resetGameState } from './state.js';
import { isNetworkGame, sendAction, getMyRole, sendMessage, syncCommanderState, leaveRoom, listRooms, isMyTurn, getMyRoomId } from './network.js';
import { triggerCommanderTurnStart, triggerCommanderTurnEnd, getCommanderRecruitCost, triggerCommanderOnAttackEx, triggerCommanderOnAttack, triggerCommanderOnCounterAttack, triggerCommanderOnKill, triggerCommanderOnMoraleChange, getStallerSnareLayers, getCommanderRangeReduction, getCommanderWeatherImmunity, getCommanderWeatherDebuff, getCommander, setSpawnFxRef, setSpawnGoldenBeamRef, setSpawnBeamProjectilesRef, setLaunchOrbitSwordsRef, setSpawnHealingChainRef } from './commanderInterface.js';
import { HexTile, computeCampBorders, computeDistrictBorders } from './HexTile.js';
import { Unit, _pendingRankUps } from './Unit.js';
import {
    spawnExplosionParticles, spawnDirectionalParticles, spawnHealParticles, spawnGoldParticles, spawnRecruitEffect,
    triggerAttackFlash, triggerHealFlash, triggerRecruitFlash, triggerScreenShake,
    spawnMeleeSlash,
    spawnConfetti, triggerTurnFlash, clearTransientEffects,
    spawnMoraleEffect, spawnCommanderSkillEffect,
    triggerFactionMoraleFlash,
    spawnProjectile, spawnDroneProjectile, spawnDroneSuicideFlak, spawnDroneDive, triggerRecoil, triggerCharge,
    spawnLightningStrike,
    spawnGoldenFlame, spawnVictoryRipple,
    spawnCoinRain, spawnMinisterDominionRing,
    spawnCardUseEffect, spawnAirstrikeEffect, spawnAirliftEffect,
    spawnGoldenBeam, spawnPaladinBeamProjectiles, launchPaladinOrbitSwords, spawnPaladinOrbitBeams,
    spawnHealingChain,
    spawnReinforceEffect, spawnCardCopyEffect
} from './effects.js';
import { playSound } from './audio.js';
import { updateFogOfWar, isTileVisible, applyScoutReveal, expireScoutReveals } from './fogOfWar.js';

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
export function resetConfirmActive() {
    _confirmActive = false;
    const overlay = document.getElementById('confirmOverlay');
    if (overlay) overlay.classList.remove('show');
}
let _cityCapturedInAttack = false;
let _capturedCityOnMove = null;
let _moraleFxUnitId = null;
let _ctrMoraleFxUnitId = null; // 反击攻心目标士气特效
let _cmdFxData = null;     // 攻击将领特效 { x, y, glyph, label }
let _ctrCmdFxData = null;  // 反击将领特效 { x, y, glyph, label }
let _cmdFxExtra = null;    // 额外的将领特效（如尚书进驻城市）
let _endTurnCmdFxList = null; // 回合结束时的将领特效列表（联机同步用）
let _endTurnDmgTexts = null;  // 回合结束时的伤害数字列表（联机同步用）
let _attackDmg = 0, _attackIsCrit = false;
let _counterDmg = 0, _counterX = 0, _counterY = 0, _counterIsRanged = false, _counterIsCrit = false;
let _healAmtRemote = 0, _healX = 0, _healY = 0;
let _smiteDmgRemote = 0;
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

export function showInfo(message) {
    if (_confirmActive) return Promise.resolve();
    _confirmActive = true;
    return new Promise((resolve) => {
        const overlay = document.getElementById('confirmOverlay');
        const msgEl = document.getElementById('confirmMessage');
        const yesBtn = document.getElementById('confirmYes');
        const noBtn = document.getElementById('confirmNo');

        msgEl.textContent = message;
        noBtn.style.display = 'none';
        yesBtn.textContent = '知道了';
        overlay.classList.add('show');

        function cleanup() {
            overlay.classList.remove('show');
            yesBtn.removeEventListener('click', onOk);
            document.removeEventListener('keydown', onKey);
            noBtn.style.display = '';
            yesBtn.textContent = '确认';
            _confirmActive = false;
            resolve();
        }

        function onOk() { cleanup(); }
        function onKey(e) {
            if (e.key === 'Enter' || e.key === 'Escape') { e.preventDefault(); onOk(); }
        }

        yesBtn.addEventListener('click', onOk);
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

// 可播种的伪随机数生成器（mulberry32），保证联机时各地形/牌库一致
let _terrainSeed = 0;
function _createRNG(seed) {
    let s = seed | 0;
    return function () {
        s |= 0; s = s + 0x6D2B79F5 | 0;
        let t = Math.imul(s ^ s >>> 15, 1 | s);
        t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
        return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
}

function generateTerrain(tiles) {
    const nonCityTiles = tiles.filter(t => !t.isCity);
    const total = nonCityTiles.length;
    if (total === 0) return;

    // 联机模式使用房间号作为种子，保证所有客户端地形一致
    let rand;
    if (isNetworkGame()) {
        const roomId = getMyRoomId() || '0';
        _terrainSeed = 0;
        for (let i = 0; i < roomId.length; i++) _terrainSeed = (_terrainSeed * 31 + roomId.charCodeAt(i)) | 0;
        rand = _createRNG(_terrainSeed);
    } else {
        rand = Math.random;
    }

    const forestSeeds   = Math.floor(total * 0.08);
    const mountainSeeds = Math.floor(total * 0.04);

    for (let i = nonCityTiles.length - 1; i > 0; i--) {
        const j = Math.floor(rand() * (i + 1));
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
        } else if (fCount === 1 && rand() < 0.30) {
            tile.terrain = 'forest';
        } else if (mCount === 1 && rand() < 0.20) {
            tile.terrain = 'mountain';
        }
    }

    // 村庄：每个行政区 1 个，距本区城市 ≥ VILLAGE_MIN_DIST
    const villageEntries = [];
    const cities = tiles.filter(t => t.isCity);
    const districtCityMap = new Map();
    for (const c of cities) {
        if (!districtCityMap.has(c.districtId)) districtCityMap.set(c.districtId, []);
        districtCityMap.get(c.districtId).push(c);
    }
    for (const [districtId, districtCities] of districtCityMap) {
        const city = districtCities[0];
        const candidates = tiles.filter(t =>
            t.districtId === districtId &&
            !t.isCity &&
            !t.isVillage &&
            hexDistance(t, city) >= VILLAGE_MIN_DIST
        );
        if (candidates.length === 0) continue;
        const idx = Math.floor(rand() * candidates.length);
        const t = candidates[idx];
        t.isVillage = true;
        t.villageDistrictId = districtId;
        villageEntries.push([`${t.q},${t.r}`, { districtId, q: t.q, r: t.r }]);
    }
    gameState.villageTiles = new Map(villageEntries);
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
    // 圣骑士勇气灵光：范围内友军免疫夹击/包围士气下降
    function hasCourageAura(u) {
        for (const [dq, dr] of HEX_NEIGHBORS) {
            const nb = gameState.tileMap.get(`${u.tile.q + dq},${u.tile.r + dr}`);
            if (nb && nb.unit && nb.unit.commander === 'paladin' && nb.unit.camp === u.camp) {
                return true;
            }
        }
        return false;
    }

    gameState.tiles.forEach(tile => {
        if (!tile.unit) return;
        const u = tile.unit;
        const prev = u.morale;

        // 勇气灵光保护下免疫夹击/包围士气压制
        if (!hasCourageAura(u)) {
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
        }

        if (u.morale !== prev) {
            spawnMoraleEffect(u);
        }
    });

    // 圣骑士勇气灵光：范围内友军士气≥2
    for (const tile of gameState.tiles) {
        if (!tile.unit || tile.unit.morale >= 2) continue;
        for (const [dq, dr] of HEX_NEIGHBORS) {
            const nb = gameState.tileMap.get(`${tile.q + dq},${tile.r + dr}`);
            if (nb && nb.unit && nb.unit.commander === 'paladin' && nb.unit.camp === tile.unit.camp) {
                tile.unit.morale = 2;
                break;
            }
        }
    }
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
    gameState.campBorderEdges = computeCampBorders(gameState.tiles, gameState.tileMap);
    gameState.districtBorderEdges = computeDistrictBorders(gameState.tiles, gameState.tileMap);
    initInitialUnits();

    // 遭遇战迷雾：初始化（支持联机遭遇战与 PVE 遭遇战）
    if (gameState.skirmishFog) {
        updateFogOfWar(gameState, CAMP.player1);
        updateFogOfWar(gameState, CAMP.player2);
        if (is3P) updateFogOfWar(gameState, CAMP.player3);
    }

    logMessage(is3P ? '三人模式开始，红军先手' : '游戏开始，红军先手');

    // 绑定按钮事件（仅首次，避免重开时重复绑定）
    _bindGameButtons();

    initCardDeck();
    invalidateBoard();
}

// 游戏按钮/事件重绑定（联机重连后调用以恢复事件监听）
export function rebindGameEvents() {
    _initMapEventsBound = false;
    _bindGameButtons();
}

function _bindGameButtons() {
    if (_initMapEventsBound) return;
    _initMapEventsBound = true;
    const surrenderBtn = document.getElementById('surrenderBtn');
    if (surrenderBtn) {
        // 移除旧监听以防重复绑定
        surrenderBtn.removeEventListener('click', handleSurrender);
        surrenderBtn.addEventListener('click', handleSurrender);
    }
    const endTurnBtn = document.getElementById('endTurnBtn');
    if (endTurnBtn) {
        endTurnBtn.removeEventListener('click', endTurn);
        endTurnBtn.addEventListener('click', endTurn);
    }
    document.getElementById('recruitInfantry').addEventListener('click', _onRecruitInfantry);
    document.getElementById('recruitCavalry').addEventListener('click', _onRecruitCavalry);
    document.getElementById('recruitArcher').addEventListener('click', _onRecruitArcher);
}

const _onRecruitInfantry = () => recruitUnit('infantry');
const _onRecruitCavalry = () => recruitUnit('cavalry');
const _onRecruitArcher = () => recruitUnit('archer');

function initCardDeck() {
    const deck = [...DECK_COMPOSITION];
    if (gameState.skirmishFog) deck.push(...SKIRMISH_EXTRAS);
    const rand = isNetworkGame() ? _createRNG(_terrainSeed) : Math.random;
    for (let i = deck.length - 1; i > 0; i--) {
        const j = Math.floor(rand() * (i + 1));
        [deck[i], deck[j]] = [deck[j], deck[i]];
    }
    gameState.cardDrawPile = deck;
    gameState.cardDiscardPile = [];
    // E4 空军上校：替换牌库和手牌
    const colonels = {};
    for (const [key, cmdId] of [['player1', gameState.commanderP1], ['player2', gameState.commanderP2], ['player3', gameState.commanderP3]]) {
        if (cmdId === 'colonel') colonels[key] = true;
    }
    // 上校初始手牌仅部署卡；部署后通过 onDeploy 发放 3 张空军卡
    // 空军卡为金币门控、不消耗手牌（executeTacticalCard 不 splice），手牌固定为 3 张
    // 注意：cardDrawPile 为双方共享，切勿因上校清空，否则对手也抽不到牌。
    // 上校空军卡不占手牌上限，故使用独立计数，部署后再加入。
    const colonelHand = () => ['commanderDeploy'];
    // 仅非上校玩家从共享牌堆摸初始牌（上校不摸，避免白白消耗共享牌）
    const freeCard1 = colonels.player1 ? null : gameState.cardDrawPile.pop();
    const freeCard2 = colonels.player2 ? null : gameState.cardDrawPile.pop();
    const freeCard3 = (gameState.isThreePlayer && !colonels.player3) ? gameState.cardDrawPile.pop() : null;
    gameState.playerHands = {
        player1: colonels.player1 ? colonelHand() : ['commanderDeploy', freeCard1].filter(Boolean),
        player2: colonels.player2 ? colonelHand() : ['commanderDeploy', freeCard2].filter(Boolean),
        player3: gameState.isThreePlayer ? (colonels.player3 ? colonelHand() : ['commanderDeploy', freeCard3].filter(Boolean)) : []
    };
    gameState.playerDrawsThisTurn = { player1: 0, player2: 0, player3: 0 };
    gameState.playerUsesThisTurn = { player1: 0, player2: 0, player3: 0 };
    gameState.cardStackExpanded = false;
}

export function drawCard(camp) {
    const campKey = camp === CAMP.player1 ? 'player1' : camp === CAMP.player2 ? 'player2' : camp === CAMP.player3 ? 'player3' : 'neutral';
    if (campKey === 'neutral') return null;

    if (gameState.playerDrawsThisTurn[campKey] >= CARD_SYSTEM_CONFIG.maxDrawsPerTurn) {
        notify('本回合已达到抽牌上限（2次）', 'error'); return null;
    }
    // E3 纵横家合纵：手牌上限覆盖
    const handSizeBonus = (gameState._cardOverrides && gameState._cardOverrides[campKey]) ? gameState._cardOverrides[campKey].handSizeBonus || 0 : 0;
    const maxHand = CARD_SYSTEM_CONFIG.maxHandSize + handSizeBonus;
    if (gameState.playerHands[campKey].length >= maxHand) {
        notify(`手牌已满（最多${maxHand}张）`, 'error'); return null;
    }
    const drawCost = gameState.playerDrawsThisTurn[campKey] === 0 ? CARD_SYSTEM_CONFIG.drawCost : CARD_SYSTEM_CONFIG.drawCost * 2;
    if (gameState.playerGold[campKey] < drawCost) {
        notify(`资金不足（需$${drawCost}）`, 'error'); return null;
    }

    if (gameState.cardDrawPile.length === 0 && gameState.cardDiscardPile.length > 0) {
        gameState.cardDrawPile = [...gameState.cardDiscardPile];
        gameState.cardDiscardPile = [];
        for (let i = gameState.cardDrawPile.length - 1; i > 0; i--) {
            const j = gameState.rng ? gameState.rng.int(i + 1) : Math.floor(Math.random() * (i + 1));
            [gameState.cardDrawPile[i], gameState.cardDrawPile[j]] = [gameState.cardDrawPile[j], gameState.cardDrawPile[i]];
        }
        logMessage('弃牌堆已洗入抽牌堆');
    }
    if (gameState.cardDrawPile.length === 0) {
        notify('卡组已空，无法抽牌', 'error'); return null;
    }

    gameState.playerGold[campKey] -= drawCost;
    const cardId = gameState.cardDrawPile.pop();
    gameState.playerHands[campKey].push(cardId);
    gameState.playerDrawsThisTurn[campKey]++;

    const cfg = TACTICAL_CARD_CONFIG[cardId];
    logMessage(`${camp.name}花费$${drawCost}抽到了【${cfg ? cfg.name : cardId}】`);
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

function _updateSkirmishFogAll() {
    updateFogOfWar(gameState, CAMP.player1);
    updateFogOfWar(gameState, CAMP.player2);
    if (gameState.isThreePlayer) updateFogOfWar(gameState, CAMP.player3);
    if (_onFogUpdated) _onFogUpdated();
}

let _onFogUpdated = null;
export function setOnFogUpdated(cb) { _onFogUpdated = cb; }

function _showTurnTransition(camp) {
    return new Promise(resolve => {
        const overlay = document.getElementById('turnTransitionOverlay');
        const text = document.getElementById('turnTransitionText');
        const name = camp === CAMP.player1 ? '红军' : camp === CAMP.player2 ? '蓝军' : '绿军';
        const color = camp === CAMP.player1 ? '#ffaaaa' : camp === CAMP.player2 ? '#aaaaff' : '#aaffaa';
        text.textContent = `${name} 的回合`;
        text.style.color = color;
        overlay.classList.add('show');
        overlay.onclick = () => {
            overlay.classList.remove('show');
            overlay.onclick = null;
            resolve();
        };
    });
}

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
    // E1 占星者星移：锁定期间跳过天气循环
    if (gameState.weatherLockUntil > 0 && getRoundIndex(gameState) < gameState.weatherLockUntil) {
        return;
    }
    // E1 占星者星移锁定结束后首次更新：强制重新随机，避免 stale lastWeather
    if (gameState._starlightResume) {
        gameState._starlightResume = false;
        const pool = ['rain', 'fog', 'wind'].filter(w => w !== gameState.lastWeather);
        gameState.lastWeather = pool[gameState.rng ? gameState.rng.int(pool.length) : Math.floor(Math.random() * pool.length)];
        gameState.weather = gameState.lastWeather;
        return;
    }
    const round = getRoundIndex(gameState);  // 0-indexed full round
    if (round < WEATHER_CYCLE.warmupRounds) {
        gameState.weather = 'clear';
        return;
    }
    const cycleRound = round - WEATHER_CYCLE.warmupRounds;
    const cycleLen = WEATHER_CYCLE.weatherDuration + WEATHER_CYCLE.clearDuration;  // 3
    const position = cycleRound % cycleLen;  // 0,1,2
    if (position === 0) {
        const pool = ['rain', 'fog', 'wind'].filter(w => w !== gameState.lastWeather);
        gameState.lastWeather = pool[gameState.rng ? gameState.rng.int(pool.length) : Math.floor(Math.random() * pool.length)];
    }
    if (position < WEATHER_CYCLE.weatherDuration) {
        gameState.weather = gameState.lastWeather;
    } else {
        gameState.weather = 'clear';
    }
}

// 限时效果到期检查（每回合 P1 开始时调用一次）
function _expireTimedEffects() {
    // E2 亡灵法师：亡魂标记老化（3回合后消失）；bornAt 为回合数(0-indexed)
    // 全局一次性结算，不放进 per-unit 循环（避免 O(单位数×标记数) 且无单位时不老化）
    if (gameState._soulMarks && gameState._soulMarks.length > 0) {
        const soulRound = getRoundIndex(gameState);
        gameState._soulMarks = gameState._soulMarks.filter(m => soulRound - m.bornAt < 3);
    }
    gameState.tiles.forEach(tile => {
        if (!tile.unit) return;
        const u = tile.unit;

        // 击杀士气上升到期 → 恢复正常（全局处理）；moraleBoostUntil 为回合数(0-indexed)
        if (u.morale === 3 && u.moraleBoostUntil <= getRoundIndex(gameState)) {
            u.morale = 2; // setter 自动 triggerCommanderOnMoraleChange
            spawnMoraleEffect(u);
        }

        // 牧师治愈灵光 — 全局，不区分阵营
        if (u._healingAura > 0) {
            u.heal(Math.round(u.maxHp * 0.20));
            u._healingAura--;
        }

        // 雨天：守城单位每回合回复15%最大生命值
        if (gameState.weather === 'rain' && u.tile.isCity) {
            u.heal(Math.round(u.maxHp * 0.15));
        }

        // 全局每回合倒计时（不区分阵营，因为本函数每回合仅调用一次）
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
        if (u.activeSkillCD > 0) {
            u.activeSkillCD--;
        }
        if (u._rankRegenPct > 0 && u.hp < u.maxHp) {
            u.heal(Math.round(u.maxHp * u._rankRegenPct));
        }
    });
}

// 回合开始收入结算（城市产出 + 村庄产出 + 将领回合开始效果）
// 返回 damageTexts 快照长度，供 _doEndTurnPhase 收集殉道者等伤害数字
export function grantTurnStartIncome(camp) {
    const key = _campKey(camp);
    const cities = gameState.tiles.filter(t => t.isCity && t.camp === camp && !(t._cityDisabledUntil > 0 && t._cityDisabledUntil > getRoundIndex(gameState)));
    const cityCount = cities.length;
    let income = camp === CAMP.neutral ? Math.floor(calcIncome(cityCount) / 2) : calcIncome(cityCount);
    if (gameState.gameMode === 'pve' && camp === gameState.aiOpponentCamp) {
        income = Math.floor(income * gameState.aiDifficulty);
    }
    gameState.playerGold[key] += income;

    // 洗牌换将代价：该玩家首个回合收入结算时消耗全部初始资金（$10 封顶，不足则清零），仅结算一次
    if (gameState.commanderRerolled && gameState.commanderRerolled[key]
        && !(gameState._rerollPenaltyApplied && gameState._rerollPenaltyApplied[key])) {
        const spent = Math.min(gameState.playerGold[key], COMMANDER_REROLL_COST);
        gameState.playerGold[key] -= spent;
        if (!gameState._rerollPenaltyApplied) gameState._rerollPenaltyApplied = {};
        gameState._rerollPenaltyApplied[key] = true;
        if (spent > 0) logMessage(`${camp.name}洗牌换将，消耗初始资金$${spent}`);
    }

    if (income > 0) {
        logMessage(`${camp.name}回合开始，城市产出共计$${income}`);
        cities.forEach((cityTile, i) => {
            const cityValue = i === 0 ? 4 : i === 1 ? 3 : 2;
            gameState.goldTexts.push({
                x: cityTile.x, y: cityTile.y,
                value: cityValue, prefix: '+', color: '#ffff00',
                timeLeft: 1800, lastUpdate: performance.now()
            });
            spawnCoinRain(cityTile.x, cityTile.y, 2);
        });
    }

    // 村庄结算
    const _villageCounts = new Map();
    for (const [vk, v] of gameState.villageTiles) {
        const vTile = gameState.tileMap.get(vk);
        if (!vTile) continue;
        let beneficiaryCamp;
        if (vTile.unit) {
            beneficiaryCamp = vTile.unit.camp;
        } else {
            const cityTile = gameState.tiles.find(t => t.isCity && t.districtId === v.districtId);
            beneficiaryCamp = cityTile ? cityTile.camp : CAMP.neutral;
        }
        if (beneficiaryCamp !== camp) continue;
        const idx = _villageCounts.get(beneficiaryCamp) || 0;
        let villageGold = idx === 0 ? VILLAGE_GOLD : idx === 1 ? 1 : 0;
        _villageCounts.set(beneficiaryCamp, idx + 1);
        if (villageGold <= 0) continue;
        gameState.playerGold[_campKey(beneficiaryCamp)] += villageGold;
        gameState.goldTexts.push({
            x: vTile.x, y: vTile.y,
            value: villageGold, prefix: '+', color: '#ffcc00',
            timeLeft: 1800, lastUpdate: performance.now()
        });
        spawnCoinRain(vTile.x, vTile.y, 1);
    }

    // 将领回合开始效果
    const dmgTextsBefore = gameState.damageTexts.length;
    triggerCommanderTurnStart(gameState, camp);
    // 尚书屯田特效
    const ministerUnit = gameState.tiles.reduce((f, t) => f || (t.unit && t.unit.commander === 'minister' && t.unit.camp === camp ? t.unit : null), null);
    if (ministerUnit && ministerUnit.tile.isCity) {
        spawnMinisterDominionRing(ministerUnit.tile.x, ministerUnit.tile.y);
        spawnCoinRain(ministerUnit.tile.x, ministerUnit.tile.y, 5);
    }
    return dmgTextsBefore;
}

async function _doEndTurnPhase() {
    const camp = gameState.currentCamp;
    _endTurnCmdFxList = []; // 本回合将领特效收集
    const _healingChainDatas = []; // 牧师圣链特效收集

    // 包装 spawnFx 引用以收集特效坐标（不直接覆写 import binding）
    const origSpawn = spawnCommanderSkillEffect;
    setSpawnFxRef((x, y, glyph, label) => {
        _endTurnCmdFxList.push({ x, y, glyph: glyph || '🎖️', label: label || '' });
        origSpawn(x, y, glyph, label);
    });

    // 包装 spawnHealingChain 引用以收集治疗链特效
    const origHealingChain = spawnHealingChain;
    setSpawnHealingChainRef((fromX, fromY, toX, toY) => {
        _healingChainDatas.push({ fromX, fromY, toX, toY });
        origHealingChain(fromX, fromY, toX, toY);
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
            // 圣骑士至圣斩蓄力跨回合清除并返还誓言
            if (tile.unit.commander === 'paladin' && tile.unit._smiteReady) {
                const refund = tile.unit._smiteCharged ? 2 : 1;
                tile.unit._faith = Math.min(3, tile.unit._faith + refund);
                tile.unit._smiteReady = false;
                tile.unit._smiteCharged = false;
                spawnPaladinOrbitBeams(tile.unit.id, tile.x, tile.y, tile.unit._faith);
            }

            // E5：城市/村庄自动回血已移除，改为补员系统（主动按钮）
            // 主动技能持续/冷却倒计时 → 移至回合开始时统一处理
        }
    });

    // 将领回合结束效果（牧师圣疗链式群疗等）—— 在结束方阵营、治疗链特效收集窗口内触发
    triggerCommanderTurnEnd(gameState, camp, _campKey(camp));

    // Turn toggle（三人模式自动跳过已投降阵营）
    gameState.currentCamp = _nextActiveCamp(camp);
    gameState.turnCounter++;

    // ==== 回合开始：收入结算 ====================
    const dmgTextsBefore = grantTurnStartIncome(gameState.currentCamp);
    // E5：重置新回合阵营的城市/村庄补员标记（含占据的非己方村庄，与补员判定一致）
    for (const t of gameState.tiles) {
        if (t.camp === gameState.currentCamp
            || (t.isVillage && t.unit && t.unit.camp === gameState.currentCamp)) {
            t._reinforcedThisTurn = false;
        }
    }
    // 收集殉道者等将领产生的伤害数字，供远端重放
    _endTurnDmgTexts = gameState.damageTexts.slice(dmgTextsBefore);
    // 遭遇战迷雾：过期侦察揭示，然后更新全阵营视野
    // 必须在 turnStart 效果（殉道者自爆等）之后，因为殉道者可能击杀任意阵营单位
    if (gameState.skirmishFog) {
        expireScoutReveals(gameState, camp);
        _updateSkirmishFogAll();
    }

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
        checkTurnLimitVictory();
        if (gameState.gameOver) {
            broadcastAction('endTurn', {
                cmdFxList: _endTurnCmdFxList.length > 0 ? _endTurnCmdFxList : null,
                dmgTexts: (_endTurnDmgTexts && _endTurnDmgTexts.length > 0) ? _endTurnDmgTexts : null,
                healingChains: _healingChainDatas.length > 0 ? _healingChainDatas : null
            });
            return;
        }
        _updateWeather();
        _expireTimedEffects();
        // 每5回合：全员免费对策卡（第5/10/15…回合发放）
        const roundNum = getRound(gameState);  // 1-indexed 回合数
        if (roundNum % 5 === 0 && gameState.cardDrawPile.length > 0) {
            for (const key of ['player1', 'player2', 'player3']) {
                const h = gameState.playerHands[key];
                // E3 纵横家合纵：手牌上限覆盖
                const hBonus = (gameState._cardOverrides && gameState._cardOverrides[key]) ? gameState._cardOverrides[key].handSizeBonus || 0 : 0;
                if (!h || h.length >= CARD_SYSTEM_CONFIG.maxHandSize + hBonus) continue;
                if (gameState.cardDrawPile.length === 0) break;
                if (key === 'player3' && !gameState.isThreePlayer) continue;
                const card = gameState.cardDrawPile.pop();
                h.push(card);
                const cfg = TACTICAL_CARD_CONFIG[card];
                logMessage(`${key === 'player1' ? '红军' : key === 'player2' ? '蓝军' : '绿军'}获得免费对策卡【${cfg?.name || card}】`);
            }
        }
        // E4 空军上校：空军卡改为金币消耗，不再发放燃料
    }

    // 恢复 commanderInterface 引用
    setSpawnFxRef(origSpawn);
    setSpawnHealingChainRef(origHealingChain);

    // Common end-phase effects
    playSound('turnEnd');
    triggerTurnFlash(gameState.currentCamp.color);
    updateUI();
    logMessage(`轮到${gameState.currentCamp.name}行动`);
    updateButtonColors();
    if (gameState.cardTargeting) { gameState.cardTargeting = null; hideTargetingBanner(); }
    clearselection();
    broadcastAction('endTurn', {
        cmdFxList: _endTurnCmdFxList.length > 0 ? _endTurnCmdFxList : null,
        dmgTexts: (_endTurnDmgTexts && _endTurnDmgTexts.length > 0) ? _endTurnDmgTexts : null,
        healingChains: _healingChainDatas.length > 0 ? _healingChainDatas : null
    });
}

export async function endTurn() {
    if (gameState.gameOver || _turnProcessing) return;
    // 网络游戏中仅当前回合方可结束回合
    if (isNetworkGame() && !isMyTurn(gameState.currentCamp)) return;
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

        // 遭遇战热座模式：切换玩家时显示过渡遮罩
        const isLocalSkirmish = gameState.skirmishFog && !isNetworkGame() && gameState.gameMode !== 'pve';
        if (isLocalSkirmish) {
            const nextCamp = gameState.currentCamp;
            if (nextCamp !== CAMP.neutral) {
                await _showTurnTransition(nextCamp);
            }
        }

        // 链式处理 AI 回合（对手 AI → 中立 AI），直到人类回合
        for (let i = 0; i < 3; i++) {
            if (gameState.gameOver) break;

            const isAIOpponent = gameState.gameMode === 'pve' &&
                gameState.currentCamp === gameState.aiOpponentCamp &&
                !gameState.aiActing;
            const isNeutral = gameState.currentCamp === CAMP.neutral &&
                !gameState.aiActing && !_neutralAiLock;

            if (isAIOpponent) {
                // PVE 对手 AI（Grok 进攻型人格）
                gameState.aiActing = true;
                try {
                    const { processOpponentTurn } = await import('./ai.js');
                    await Promise.race([
                        processOpponentTurn(gameState.aiOpponentCamp),
                        new Promise((_, reject) => setTimeout(() => reject(new Error('AI_TIMEOUT')), 18000))
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
                const hasNeutralUnits = gameState.tiles.some(t => t.unit && t.unit.camp === CAMP.neutral && t.unit.canAct);
                const hasNeutralCities = gameState.tiles.some(t => t.isCity && t.camp === CAMP.neutral && !t.unit);
                if (hasNeutralUnits || hasNeutralCities) {
                    // 遭遇战热座：中立 AI 回合也遮罩，防止两边玩家偷看
                    let neutralOverlay = null;
                    if (isLocalSkirmish) {
                        const overlay = document.getElementById('turnTransitionOverlay');
                        const text = document.getElementById('turnTransitionText');
                        text.textContent = '中立回合';
                        text.style.color = '#888';
                        overlay.classList.add('show');
                        neutralOverlay = overlay;
                    }
                    _neutralAiLock = true;
                    gameState.aiActing = true;
                    try {
                        const { processNeutralTurn } = await import('./ai.js');
                        await Promise.race([
                            processNeutralTurn(),
                            new Promise((_, reject) => setTimeout(() => reject(new Error('AI_TIMEOUT')), 18000))
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
                        if (neutralOverlay) neutralOverlay.classList.remove('show');
                    }
                    notify('本轮行动完毕 即将进入下一轮...', 'info');
                    logMessage('本轮行动完毕 即将进入下一轮...');
                    if (isNetworkGame()) sendMessage({ type: 'toast', text: '本轮行动完毕 即将进入下一轮...', toastType: 'info' });
                    await new Promise(r => setTimeout(r, 2500));
                }
                // 无论如何都要推进回合
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
        notify('请先选中己方控制的空城市或村庄', 'error');
        return;
    }
    const selectedCityTile = gameState.selectedCityTile;
    if (selectedCityTile.camp !== gameState.currentCamp) {
        notify('该地块不属于当前阵营，无法招募', 'error');
        return;
    }
    if (!selectedCityTile.isCity) {
        notify('该兵种只能在城市招募', 'error');
        return;
    }
    if (selectedCityTile._cityDisabledUntil > 0 && selectedCityTile._cityDisabledUntil > getRoundIndex(gameState)) {
        notify('该城市遭到空袭，无法招募', 'error');
        return;
    }
    if (selectedCityTile.unit) {
        notify('该地块已有单位驻守，无法招募', 'error');
        return;
    }
    let effectiveCost = getCommanderRecruitCost(config.cost, gameState, gameState.currentCamp);
    if (gameState.playerGold[currentPlayerKey] < effectiveCost) {
        notify('资金不足', 'error');
        return;
    }

    gameState.playerGold[currentPlayerKey] -= effectiveCost;
    new Unit(type, gameState.currentCamp, selectedCityTile, true);
    triggerRecruitFlash(selectedCityTile.x, selectedCityTile.y);
    spawnRecruitEffect(selectedCityTile.x, selectedCityTile.y);
    logMessage(`${gameState.currentCamp.name}成功招募${config.name}兵，-$${effectiveCost}`);
    gameState.selectedCityTile = null;

    gameState.goldTexts.push({
        x: selectedCityTile.x, y: selectedCityTile.y,
        value: effectiveCost, prefix: '-', color: '#ff5555', shadowColor: '#661111',
        timeLeft: 1800, lastUpdate: performance.now()
    });
    spawnGoldParticles(selectedCityTile.x, selectedCityTile.y, '#cc5555');
    recalcAllFlankingMorale();
    if (gameState.skirmishFog) _updateSkirmishFogAll();
    updateUI();
    broadcastAction('recruit', { x: selectedCityTile.x, y: selectedCityTile.y });
}

// ===== E5 补员系统 =====================

export function reinforceUnit(unit) {
    if (!unit || !unit.tile || unit.hp >= unit.maxHp) return;
    const tile = unit.tile;
    if (!tile.isCity && !tile.isVillage) { notify('需在城市或村庄上补员', 'error'); return; }
    if (unit.camp !== gameState.currentCamp) { notify('只能为己方单位补员', 'error'); return; }
    // 城市占领会翻转归属，需属于当前阵营；村庄站上去即算占据，按占据单位归属判定（与村庄收入结算一致）
    if (tile.isCity && tile.camp !== gameState.currentCamp) { notify('该地块不属于当前阵营', 'error'); return; }
    if (tile._reinforcedThisTurn) { notify('该地块本回合已补员', 'error'); return; }
    if (isNetworkGame() && !isMyTurn(gameState.currentCamp)) { notify('对手回合', 'error'); return; }

    const healAmt = Math.min(Math.floor(unit.maxHp * 0.50), unit.maxHp - unit.hp);
    if (healAmt <= 0) return;
    const cost = Math.max(1, Math.ceil(unit.config.cost * (healAmt / unit.maxHp)));
    const currentPlayerKey = _campKey(gameState.currentCamp);
    if (gameState.playerGold[currentPlayerKey] < cost) { notify('资金不足', 'error'); return; }

    gameState.playerGold[currentPlayerKey] -= cost;
    const actualHeal = unit.heal(healAmt);
    tile._reinforcedThisTurn = true;
    spawnReinforceEffect(tile.x, tile.y, actualHeal);
    logMessage(`补充兵员：${unit.config.name}兵 +${actualHeal}HP，-$${cost}`);
    recalcAllFlankingMorale();
    updateUI();
    broadcastAction('reinforce', { unitId: unit.id, healAmt: actualHeal, cost, x: tile.x, y: tile.y });
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
    // 无人机：实时检查信号范围，同步本机混乱状态（不刷新其他无人机）
    if (unit._isDrone) {
        unit._disoriented = !isDroneInSignal(gameState, unit);
        if (unit._disoriented) return [];
    }
    if (unit.morale === 0 || unit._imprisoned || unit._isImmobile || unit._disoriented) return [];

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
            if (unit._isDrone && !isTileInDroneSignal(gameState, unit.camp, neighbor)) continue;

            let stepCost = unit._isDrone ? 2 : TERRAIN_CONFIG[neighbor.terrain].stepCost;
            // 雨天泥泞：骑兵步耗+1，末步豁免失效
            const _isMuddyTarget = gameState.weather === "rain" && unit.type === "cavalry"
                && !getCommanderWeatherImmunity(neighbor, friendlyCamp, gameState.tileMap);
            if (_isMuddyTarget) stepCost += 1;
            // 星移减益区：处于敌方占星者3格内的敌对方额外+1（此处用于敌方 AI 移动计算）
            if (_isMuddyTarget && getCommanderWeatherDebuff(neighbor, friendlyCamp, gameState)) stepCost += 1;
            // 停滞者【缚足】：每层行动消耗+2
            const snareLayers = _getStallerSnareLayers(neighbor, friendlyCamp);
            if (snareLayers > 0) stepCost += snareLayers * 2;
            if (curRem < 1) continue;
            // 末步豁免失效：泥泞/缚足下若行动力不足全额支付则无法到达
            if ((_isMuddyTarget || snareLayers > 0) && curRem < stepCost && cur !== startTile) continue;
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
    // 无人机：实时检查信号范围，同步本机混乱状态（不刷新其他无人机）
    if (unit._isDrone) {
        unit._disoriented = !isDroneInSignal(gameState, unit);
        if (unit._disoriented) return [];
    }
    if (unit.morale === 0 || unit._disoriented) return [];
    if (unit.commander === 'martyr' && unit._martyrPrimed) return [];
    let range = unit.config.range;
    // 无人机固定射程2
    if (unit._isDrone) range = DRONE_RANGE;
    // 雾天炮兵射程-1（占星者星光力场免疫）
    if (gameState.weather === 'fog' && unit.type === 'archer'
        && !getCommanderWeatherImmunity(unit.tile, unit.camp, gameState.tileMap)) {
        range = Math.min(range, 1);
    }
    if (unit.type === 'archer') {
        let bonus = 0;
        if (unit.tile.terrain === 'mountain') bonus = 1;
        if (gameState.weather === 'wind') bonus = Math.max(bonus, 1);
        range += bonus;
    }
    range = Math.max(1, Math.min(4, range));
    const startTile = unit.tile;
    const targets = gameState.tiles.filter(tile =>
        hexDistance(tile, startTile) <= range
        && tile.unit
        && tile.unit.camp !== unit.camp
    );
    // 遭遇战迷雾：只能攻击视野内的敌方单位
    if (gameState.skirmishFog && targets.length) {
        return targets.filter(tile => isTileVisible(tile, unit.camp, gameState));
    }
    return targets;
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
    if (unit._isDrone) refreshDroneSignal(gameState, unit.camp);

    // 迷雾模式下先更新视野，确保新发现的敌人出现在可攻击列表中
    if (gameState.skirmishFog) _updateSkirmishFogAll();

    gameState.movableTiles = [];
    gameState.attackableTiles = getAttackableTiles(unit);

    if (unit.remainingMP > 0) {
        gameState.movableTiles = getMovableTiles(unit);
        gameState.selectionTime = performance.now();
    } else if (gameState.attackableTiles.length === 0) {
        unit.canAct = false;
        clearselection();
    }
    if (unit._isDrone && unit._disoriented) {
        gameState.movableTiles = [];
        gameState.attackableTiles = [];
        clearselection();
        notify('无人机超出天眼信号范围，陷入混乱', 'warn');
    }

    // 地雷触发（特效对所有玩家广播）
    let _mineTrigger = null;
    if (targetTile._minePlanted) {
        const mineCampKey = targetTile._mineCampKey;
        const unitCampKey = unit.camp === CAMP.player1 ? 'p1' : unit.camp === CAMP.player2 ? 'p2' : unit.camp === CAMP.player3 ? 'p3' : 'neutral';
        if (mineCampKey !== unitCampKey) {
            const oldHp = unit.hp;
            unit.applyDamage(100, { source: 'true' });
            const mineDmg = unit.hp !== oldHp ? 100 : 0;
            gameState.damageTexts.push({
                x: targetTile.x, y: targetTile.y, value: mineDmg, isCrit: true,
                timeLeft: 900, lastUpdate: performance.now()
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

    if (targetTile.isCity && !unit._isDrone) {
        unit.remainingMP = 0; // entering city ends movement
        if (targetTile.camp !== unit.camp) {
            updateDistrictColor(targetTile, unit.camp, unit);
            _capturedCityOnMove = { q: targetTile.q, r: targetTile.r, campKey: _campKey(unit.camp) };
        }
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
    broadcastAction('move', { unitId: unit.id, fromX, fromY, path, cmdFx: _cmdFxForMove, rankUps: rankUpsMove.length ? rankUpsMove : null, mineTrigger: _mineTrigger, capturedCity: _capturedCityOnMove });
    _capturedCityOnMove = null;
}

// ===== 攻击 =====================
export function attackUnit(attackerUnit, targetUnit) {
    if (gameState.gameOver) return;
    if (attackerUnit.camp !== gameState.currentCamp) return;
    if (attackerUnit._isDrone) refreshDroneSignal(gameState, attackerUnit.camp);
    if (!attackerUnit.canAct || !gameState.attackableTiles.includes(targetUnit.tile)) {
        notify('无法攻击：超出射程或单位已行动', 'error');
        return;
    }

    const fromX = attackerUnit.tile.x, fromY = attackerUnit.tile.y;
    const toX = targetUnit.tile.x, toY = targetUnit.tile.y;
    const _hasSmite = attackerUnit._smiteReady;
    const _smiteLabel = _hasSmite ? (attackerUnit._smiteCharged ? '至圣斩·誓约' : '至圣斩') : '';

    const _executeAttack = () => {

    // 包装 spawnFx 引用以捕获将领特效的 glyph/label
    const _atkOrigSpawn = spawnCommanderSkillEffect;
    let _atkCmdFxCapture = null;
    setSpawnFxRef((x, y, glyph, label) => {
        _atkCmdFxCapture = { x, y, glyph: glyph || '🎖️', label: label || '' };
        _atkOrigSpawn(x, y, glyph, label);
    });

    // 捕获至圣斩特效数据用于联机广播
    const _atkOrigGoldenBeam = spawnGoldenBeam;
    const _goldenBeamDatas = [];
    setSpawnGoldenBeamRef((x, y) => {
        _goldenBeamDatas.push({ x, y });
        _atkOrigGoldenBeam(x, y);
    });

    const _atkOrigBeamProjectiles = spawnPaladinBeamProjectiles;
    let _paladinProjectileDatas = null;
    setSpawnBeamProjectilesRef((fromX, fromY, toX, toY, count) => {
        _atkOrigBeamProjectiles(fromX, fromY, toX, toY, count);
    });
    const _atkOrigLaunchOrbitSwords = launchPaladinOrbitSwords;
    setLaunchOrbitSwordsRef((unitId, targetX, targetY, count) => {
        const datas = _atkOrigLaunchOrbitSwords(unitId, targetX, targetY, count);
        _paladinProjectileDatas = datas;
        return datas;
    });

    _killerMoraleChanged = false;
    const attackResult = attackerUnit.calculateDamage(targetUnit);
    _attackDmg = attackResult.dmg; _attackIsCrit = attackResult.isCrit;
    if (attackResult.isCrit) attackerUnit.addXP(2);
    if (attackResult.dmg > 0) attackerUnit.addXP(1);
    if (attackerUnit._smiteReady) {
        setTimeout(() => playSound('lightning'), 500);
    } else {
        playSound(attackerUnit.type === 'archer' || attackerUnit.type === 'mgNest' || attackerUnit._isDrone ? 'cannon' : (attackResult.isCrit ? 'crit' : 'attack'));
    }
    const isCrit = attackResult.isCrit;

    // 核心状态修改：扣血、击杀判定（先于视觉效果，保证广播时状态正确）
    let isTargetDead = targetUnit.takeDamage(attackResult.dmg, attackerUnit);

    let atkCmdResult = null, ctrCmdResult = null;
    try {
        if (attackerUnit.type === 'archer') {
            spawnProjectile(fromX, fromY, toX, toY, isCrit, () => {
                triggerAttackFlash(toX, toY, isCrit);
                triggerRecoil(fromX, fromY, toX, toY);
                spawnDirectionalParticles(fromX, fromY, toX, toY, '#ff8844', isCrit ? 8 : 4);
                triggerScreenShake(isCrit ? 6 : 3, isCrit ? 200 : 120);
            });
        } else if (attackerUnit._isDrone || attackerUnit.type === 'mgNest') {
            spawnDroneProjectile(fromX, fromY, toX, toY, isCrit, () => {
                triggerAttackFlash(toX, toY, isCrit);
                spawnDirectionalParticles(fromX, fromY, toX, toY, '#ff8844', isCrit ? 4 : 2);
                // 无人机普攻不震屏，更贴合枪弹手感
            });
        } else {
            triggerAttackFlash(toX, toY, isCrit);
            spawnMeleeSlash(toX, toY, fromX, fromY, isCrit);
            triggerScreenShake(isCrit ? 6 : 3, isCrit ? 200 : 120);
        }
        // 近战突进特效（击杀时由 movePath 处理位移，不重复触发；碉堡/无人机不可移动，无突进）
        if (attackerUnit.type !== 'archer' && attackerUnit.type !== 'mgNest' && !attackerUnit._isDrone && !isTargetDead) {
            triggerCharge(attackerUnit.id, fromX, fromY, toX, toY);
        }
        logMessage(`${attackerUnit.camp.name}的${attackerUnit.config.name}兵攻击造成${Math.round(attackResult.dmg)}伤害${attackResult.isCrit ? '（强击）' : ''}`);

        // 将领攻击效果（吸血鬼嗜血、谋士攻心等）—— 视觉特效由 commander 钩子自行触发
        _atkCmdFxCapture = null;
        atkCmdResult = triggerCommanderOnAttackEx(attackerUnit, targetUnit, attackResult.dmg, attackResult.isCrit, isTargetDead);
        if (atkCmdResult) {
            if (atkCmdResult.healAmt) {
                _healAmtRemote = atkCmdResult.healAmt; _healX = attackerUnit.tile.x; _healY = attackerUnit.tile.y;
            }
            if (atkCmdResult.moraleDropped) {
                spawnMoraleEffect(targetUnit);
                _moraleFxUnitId = targetUnit.id;
            }
            if (atkCmdResult.smiteDmg) {
                // 至圣斩：三段递进动画
                // Phase 1: 剑从环绕轨道射出（paladin.js onAttack 已通过 launchOrbitSwords 发射）
                // Phase 2: 飞剑命中后金色光束降临（由 paladin/FX 的 drawBeamProjectiles 在 hit 时自动完成）
                // Phase 3: 真伤数字 + 强震
                const smiteDelay = 220;
                const smiteLabel = _smiteLabel || '至圣斩';
                setTimeout(() => {
                    // 金色光束从目标上方降落
                    spawnGoldenBeam(toX, toY);
                    playSound('lightning');
                }, smiteDelay);
                setTimeout(() => {
                    gameState.damageTexts.push({
                        x: toX, y: toY, value: atkCmdResult.smiteDmg, isTrueDmg: true,
                        timeLeft: 1200, lastUpdate: performance.now()
                    });
                    triggerAttackFlash(toX, toY, true);
                    spawnCommanderSkillEffect(toX, toY, '✝️', smiteLabel, true);
                    triggerScreenShake(_hasSmite && smiteLabel === '至圣斩·誓约' ? 12 : 9, 400);
                    _smiteDmgRemote = atkCmdResult.smiteDmg;
                    // 至圣斩为真实伤害：绕过护盾和全部乘区，不触发铁卫转移/誓言
                    const smiteKilled = targetUnit.applyDamage(atkCmdResult.smiteDmg, { source: 'true', attacker: attackerUnit });
                    targetUnit.displayHp = targetUnit.hp;
                    if (smiteKilled) isTargetDead = true;
                }, smiteDelay + 200);
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
                // 远程单位(炮/碉堡/无人机)反击 → 复用炮弹/子弹飞行动画（近战反击维持原本仅伤害数字）
                _counterIsCrit = counterResult.isCrit;
                _counterIsRanged = targetUnit.type === 'archer' || targetUnit.type === 'mgNest' || targetUnit._isDrone;
                if (_counterIsRanged) {
                    const _cfx = targetUnit.tile.x, _cfy = targetUnit.tile.y;
                    playSound('cannon');
                    if (targetUnit._isDrone || targetUnit.type === 'mgNest') {
                        spawnDroneProjectile(_cfx, _cfy, _counterX, _counterY, counterResult.isCrit, () => {
                            triggerAttackFlash(_counterX, _counterY, counterResult.isCrit);
                            spawnDirectionalParticles(_cfx, _cfy, _counterX, _counterY, '#ff8844', counterResult.isCrit ? 8 : 4);
                            triggerScreenShake(counterResult.isCrit ? 6 : 3, counterResult.isCrit ? 200 : 120);
                        });
                    } else {
                        spawnProjectile(_cfx, _cfy, _counterX, _counterY, counterResult.isCrit, () => {
                            triggerAttackFlash(_counterX, _counterY, counterResult.isCrit);
                            triggerRecoil(_cfx, _cfy, _counterX, _counterY);
                            spawnDirectionalParticles(_cfx, _cfy, _counterX, _counterY, '#ff8844', counterResult.isCrit ? 8 : 4);
                            triggerScreenShake(counterResult.isCrit ? 6 : 3, counterResult.isCrit ? 200 : 120);
                        });
                    }
                }
                _atkCmdFxCapture = null;
                ctrCmdResult = triggerCommanderOnCounterAttack(attackerUnit, targetUnit, counterResult.dmg);
                if (ctrCmdResult?.moraleDropped) {
                    spawnMoraleEffect(attackerUnit);
                    _ctrMoraleFxUnitId = attackerUnit.id;
                }
                _ctrCmdFxData = _atkCmdFxCapture;
            }
            if (!atkCmdResult || !atkCmdResult.canActAgain) {
                attackerUnit.canAct = false;
            }
        } else {
            const targetTile = targetUnit.tile;
            if (attackerUnit.type !== 'archer' && attackerUnit.type !== 'mgNest' && !attackerUnit._isDrone && !attackerUnit._imprisoned && !attackerUnit._isImmobile) {
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
                // 空军上校阵亡 → 禁用对应玩家的空军卡
                if (targetUnit.commander === 'colonel') {
                    const defKey = targetUnit.camp === CAMP.player1 ? 'player1' :
                                   targetUnit.camp === CAMP.player2 ? 'player2' : 'player3';
                    if (gameState._colonelDeployed) gameState._colonelDeployed[defKey] = false;
                }
                const killerKey = attackerUnit.camp === CAMP.player1 ? 'player1' :
                                  attackerUnit.camp === CAMP.player2 ? 'player2' :
                                  attackerUnit.camp === CAMP.player3 ? 'player3' : 'neutral';
                if (killerKey !== 'neutral') {
                    gameState.factionMoraleBoost[killerKey] = getRoundIndex(gameState) + 2;
                    for (const tile of gameState.tiles) {
                        const u = tile.unit;
                        if (u && u.camp === attackerUnit.camp && u.morale !== 0 && u.morale < 3) {
                            const oldM = u.morale;
                            u.morale = Math.min(3, u.morale + 1);
                            if (u.morale === 3) u.moraleBoostUntil = getRoundIndex(gameState) + 2;
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
                if (attackerUnit.morale === 3) attackerUnit.moraleBoostUntil = getRoundIndex(gameState) + 2;
                // morale setter 自动 triggerCommanderOnMoraleChange
                _killedThisAttack = attackerUnit;
                _killerMoraleChanged = attackerUnit.morale !== oldKillerM;
            }
            _atkCmdFxCapture = null;
            const killResult = triggerCommanderOnKill(attackerUnit, targetUnit);
            const canActAgain = (killResult && killResult.canActAgain) || (atkCmdResult && atkCmdResult.canActAgain);
            if (!canActAgain) {
                attackerUnit.canAct = false;
            } else {
                spawnGoldenFlame(fromX, fromY);
                spawnVictoryRipple(fromX, fromY);
            }
            if (_atkCmdFxCapture && !_cmdFxData) _cmdFxData = _atkCmdFxCapture;
            const rankExtra = [0, 2, 5, 12, 20];
            const killXp = 3 + (rankExtra[targetUnit._rank] || 0);
            const bonusXp = targetUnit.commander ? 10 : 0;
            attackerUnit.addXP(killXp + bonusXp);
        }

        // 恢复所有捕获引用
        setSpawnFxRef(_atkOrigSpawn);
        setSpawnGoldenBeamRef(_atkOrigGoldenBeam);
        setSpawnBeamProjectilesRef(_atkOrigBeamProjectiles);

        if (attackerUnit.canAct && attackerUnit.remainingMP > 0) {
            gameState.attackableTiles = getAttackableTiles(attackerUnit);
            gameState.movableTiles = getMovableTiles(attackerUnit);
            gameState.selectionTime = performance.now();
        } else {
            gameState.attackableTiles = [];
        }
        recalcAllFlankingMorale();
        if (gameState.skirmishFog) _updateSkirmishFogAll();
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
            q: targetUnit.tile.q, r: targetUnit.tile.r,
            fromX, fromY,
            attackerUnitId: attackerUnit.id,
            attackerType: attackerUnit.type,
            attackerIsDrone: !!attackerUnit._isDrone,
            isCrit: attackResult.isCrit,
            killed: isTargetDead,
            cityCaptured: _cityCapturedInAttack || false,
            moraleFxUnitId: _moraleFxUnitId || null,
            cmdFxData: _cmdFxData || null,
            ctrCmdFxData: _ctrCmdFxData || null,
            attackDmg: _attackDmg, attackIsCrit: _attackIsCrit,
            counterDmg: _counterDmg, counterX: _counterX, counterY: _counterY,
            counterIsRanged: _counterIsRanged, counterIsCrit: _counterIsCrit,
            counterIsDrone: !!targetUnit._isDrone,
            counterUsesDroneProjectile: !!(targetUnit._isDrone || targetUnit.type === 'mgNest'),
            healAmt: _healAmtRemote, healX: _healX, healY: _healY,
            smiteDmg: _smiteDmgRemote,
            goldenBeamDatas: _goldenBeamDatas.length ? _goldenBeamDatas : null,
            paladinProjectileDatas: _paladinProjectileDatas || null,
            smiteLabel: _smiteLabel || null,
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
        _counterDmg = 0; _counterIsRanged = false; _counterIsCrit = false; _healAmtRemote = 0; _smiteDmgRemote = 0;
    }
    };

    if (_hasSmite) {
        spawnCommanderSkillEffect(fromX, fromY, '✝️', _smiteLabel);
        attackerUnit.canAct = false;
        setTimeout(_executeAttack, 500);
    } else {
        _executeAttack();
    }
}

// ===== 城市占领 =====================
// 强制播放行政区渐变动画（用于远端同步，跳过 camp 相等检查）
export function forceDistrictFade(cityTile, camp) {
    if (!cityTile || !cityTile.isCity) return;
    const districtId = cityTile.districtId;
    gameState.tiles.forEach(tile => {
        if (tile.districtId === districtId && tile.camp === camp) {
            tile.startColor = tile.currentColor;
            tile.targetColor = camp.color;
            tile.fadeDuration = 1500;
            tile.fadeStartTime = performance.now();
        }
    });
}

export function updateDistrictColor(cityTile, camp, attackerUnit = null) {
    if (!cityTile.isCity) return;
    if (cityTile.camp === camp) return;

    const oldCamp = cityTile.camp;

    cityTile.setCampWithFade(camp);

    logMessage(`${camp.name}攻占了${oldCamp.name}的城市(${cityTile.q},${cityTile.r})`);

    const districtId = cityTile.districtId;
    gameState.tiles.forEach(tile => {
        if (tile.districtId === districtId) {
            tile.setCampWithFade(camp);
        }
    });

    gameState.campBorderEdges = computeCampBorders(gameState.tiles, gameState.tileMap);
    gameState.districtBorderEdges = computeDistrictBorders(gameState.tiles, gameState.tileMap);
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
        const districtMap = new Map([
            [CAMP.player1, player1Districts],
            [CAMP.player2, player2Districts],
            [CAMP.player3, player3Districts]
        ]);
        // 检测新被淘汰的玩家（尚未在 surrenderedCamps 中）
        for (const camp of [CAMP.player1, CAMP.player2, CAMP.player3]) {
            if (districtMap.get(camp).size === 0 && !gameState.surrenderedCamps.includes(camp)) {
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

// ===== 回合限制胜利检测 =====================
function checkTurnLimitVictory() {
    if (gameState.gameOver) return;

    const roundNum = getRound(gameState);
    const limitRound = gameState.isThreePlayer ? 26 : 19;
    if (roundNum < limitRound) return;

    // 统计各非中立阵营控制的城市数
    const cityCounts = {};
    for (const tile of gameState.tiles) {
        if (tile.isCity && tile.camp !== CAMP.neutral) {
            const key = _campKey(tile.camp);
            cityCounts[key] = (cityCounts[key] || 0) + 1;
        }
    }

    const players = gameState.isThreePlayer
        ? [CAMP.player1, CAMP.player2, CAMP.player3].filter(c => !gameState.surrenderedCamps.includes(c))
        : [CAMP.player1, CAMP.player2];

    const maxCities = Math.max(...players.map(c => cityCounts[_campKey(c)] || 0));
    const leaders = players.filter(c => (cityCounts[_campKey(c)] || 0) === maxCities);

    if (leaders.length === 1) {
        gameState.gameOver = true;
        gameState.victoryCamp = leaders[0];
        logMessage(`回合限制到达（第${roundNum}回合）！${leaders[0].name}控制最多城市（${maxCities}座），获得胜利`);
        setTimeout(() => triggerVictoryEffect(), 1500);
    } else {
        gameState.gameOver = true;
        gameState.victoryCamp = 'draw';
        const tieCounts = leaders.map(c => `${c.name}${cityCounts[_campKey(c)] || 0}座`).join('、');
        logMessage(`回合限制到达（第${roundNum}回合）！${tieCounts}，平局`);
        setTimeout(() => triggerVictoryEffect(), 1500);
    }
}

export function triggerVictoryEffect() {
    const overlay = document.getElementById('victoryOverlay');
    const panel = document.getElementById('victoryPanel');
    const gameOverText = document.getElementById('gameOverText');
    const victoryCampText = document.getElementById('victoryCampText');
    const viewBoardBtn = document.getElementById('viewFullBoardBtn');

    playSound('victory');
    spawnConfetti(150);

    document.body.style.pointerEvents = 'none';

    // 遭遇战模式：保存完整棋盘快照，显示"查看完整棋局"按钮
    if (gameState.skirmishFog) {
        gameState._victoryBoardSnapshot = serializeState();
        if (viewBoardBtn) viewBoardBtn.style.display = '';
    } else {
        if (viewBoardBtn) viewBoardBtn.style.display = 'none';
    }

    const vc = gameState.victoryCamp;
    gameOverText.textContent = '游戏结束';
    if (vc === 'draw') {
        victoryCampText.textContent = '平局';
        victoryCampText.style.color = '#e6c560';
        victoryCampText.style.textShadow = '0 0 24px rgba(230,197,96,0.55), 0 0 50px rgba(200,160,60,0.25)';
    } else if (vc === CAMP.player1) {
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

// ==== E4 空军上校：航程 + 防空火力 目标约束 =====================
export const COLONEL_AIR_RANGE = 6; // 上校空军卡最大航程（格）
export const ANTIAIR_RADIUS = 2;    // 防空火力覆盖半径（格）

// 找到某阵营在场的上校单位（无则 null）
export function getColonelUnit(camp) {
    for (const t of gameState.tiles) {
        if (t.unit && t.unit.commander === 'colonel' && t.unit.camp === camp && t.unit.hp > 0) return t.unit;
    }
    return null;
}

// 是否为防空火力单位：炮兵(archer)/碉堡(mgNest)/挂停滞者的单位
export function isAntiAirUnit(u) {
    return !!u && (u.type === 'archer' || u.type === 'mgNest' || u.commander === 'staller');
}

// 计算目标地块被敌方防空火力覆盖的层数（0~2，2格半径内每1个防空单位=1层）
export function getAALayers(tile, camp, tileMap) {
    if (!tile || !tileMap) return 0;
    let count = 0;
    for (const t of tileMap.values()) {
        if (!t || !t.unit || t.unit.camp === camp || !isAntiAirUnit(t.unit)) continue;
        if (hexDistance(t, tile) <= ANTIAIR_RADIUS) {
            count++;
            if (count >= 2) break;
        }
    }
    return Math.min(count, 2);
}

// ==== 通用防空接口 =====================
// 接口1：对空防御——所有空袭伤害卡（俯冲扫射/地毯轰炸/空袭）共用
// 每层防空提供+25%防御，伤害 = 原伤害 × (1 − 层数×0.25)
export function applyAADefense(dmg, tile, camp, tileMap) {
    const aa = getAALayers(tile, camp, tileMap);
    if (aa > 0) return Math.round(dmg * (1 - aa * 0.25));
    return dmg;
}

// 接口2：空降减血——所有空降/空运卡（空降步兵/上校空运）共用
// 每层防空降低25%最大生命值（不低于1），保持生命上限不变
export function applyAADropHP(unit, tile, camp, tileMap) {
    const aa = getAALayers(tile, camp, tileMap);
    if (aa > 0) {
        const hpLoss = Math.round(unit.maxHp * aa * 0.25);
        unit.hp = Math.max(1, unit.hp - hpLoss);
        unit.displayHp = unit.hp;
    }
}

// 目标地块是否超出上校航程（硬限制）。防空火力不在此阻挡——它只降低伤害(见 _resolveDamage)。
// 无上校在场时不做限制（理论上没有空军卡可用）
export function isColonelTargetBlocked(tile, camp) {
    const colonel = getColonelUnit(camp);
    if (!colonel || !colonel.tile || !tile) return false;
    return hexDistance(colonel.tile, tile) > COLONEL_AIR_RANGE;
}

// ==== 对策卡系统 =====================

export function cancelCardTargeting() {
    gameState.cardTargeting = null;
    gameState._airliftTarget = null; // E4: 空运取消时清理
    hideTargetingBanner();
}

// 上校空军卡击杀效果：攻击者士气+1（含视觉特效）、经验（含目标等级加成）、击杀将领时全军士气+1
export function reapColonelKill(colonel, targetUnit) {
    if (!colonel || !targetUnit) return;
    if (colonel.morale !== 0) {
        const oldM = colonel.morale;
        colonel.morale = Math.min(3, colonel.morale + 1);
        if (colonel.morale === 3) colonel.moraleBoostUntil = getRoundIndex(gameState) + 2;
        spawnMoraleEffect(colonel); // 士气上升视觉特效
    }
    // 击杀经验：基础3 + 目标等级加成（与普攻击杀一致）+ 将领额外10
    const rankExtra = [0, 2, 5, 12, 20];
    const rankBonus = rankExtra[targetUnit._rank] || 0;
    const cmdBonus = targetUnit.commander ? 10 : 0;
    colonel.addXP(3 + rankBonus + cmdBonus);
}


// 计算无人机自爆的三角穿刺区：主目标身后1格的左右2个目标
function _getSuicidePiercingTiles(fromTile, targetTile) {
    const tiles = [];
    // 找到从 targetTile 指向 fromTile 的六边形方向（即远离攻击者的方向）
    let bestDir = 0, bestDist = Infinity;
    for (let i = 0; i < 6; i++) {
        const [dq, dr] = HEX_NEIGHBORS[i];
        const neighbor = { q: targetTile.q + dq, r: targetTile.r + dr };
        const d = hexDistance(neighbor, fromTile);
        if (d < bestDist) { bestDist = d; bestDir = i; }
    }
    // 穿刺方向 = 远离攻击者的左右两个方向
    const awayDir = (bestDir + 3) % 6;
    const sideDirs = [(awayDir + 1) % 6, (awayDir + 5) % 6];
    for (const dir of sideDirs) {
        const [dq, dr] = HEX_NEIGHBORS[dir];
        const t = gameState.tileMap.get(`${targetTile.q + dq},${targetTile.r + dr}`);
        if (t) tiles.push(t);
    }
    return tiles;
}

export function executeDroneDeploy(tianyanUnit, targetTile) {
    if (!tianyanUnit || tianyanUnit.commander !== 'tianyan' || tianyanUnit.hp <= 0) {
        notify('天眼无效，无法部署无人机', 'error');
        return null;
    }
    if (tianyanUnit.camp !== gameState.currentCamp) {
        notify('只能在当前回合部署无人机', 'error');
        return null;
    }

    const drone = deployDrone(tianyanUnit, targetTile, {
        gameState,
        Unit,
        logMessage
    });
    if (!drone) return null;

    refreshDroneSignal(gameState, tianyanUnit.camp);
    if (gameState.skirmishFog) updateFogOfWar(gameState, tianyanUnit.camp);
    recalcAllFlankingMorale();
    updateRecruitCostDisplay();
    updateUI();
    broadcastAction('droneDeploy', {
        unitId: drone.id,
        commanderUnitId: tianyanUnit.id,
        x: targetTile.x,
        y: targetTile.y,
        q: targetTile.q,
        r: targetTile.r
    });
    return drone;
}

// 无人机自杀式袭击
export function executeDroneSuicide(droneUnit, targetTile) {
    if (!droneUnit || !droneUnit._isDrone) return false;
    refreshDroneSignal(gameState, droneUnit.camp);
    if (droneUnit._disoriented || !droneUnit.canAct) {
        notify('无人机当前无法行动', 'error');
        return false;
    }
    if (!targetTile || !targetTile.unit || targetTile.unit.camp === droneUnit.camp) {
        notify('请选择3格内敌方单位作为自爆目标', 'error');
        return false;
    }
    if (hexDistance(droneUnit.tile, targetTile) > DRONE_SUICIDE_RANGE) {
        notify('超出自爆射程（3格）', 'error');
        return false;
    }
    const gs = gameState;
    const fromTile = droneUnit.tile;

    const results = [];
    const applySuicideDamage = (tile, multiplier) => {
        if (!tile.unit || tile.unit.camp === droneUnit.camp) return null;
        const baseResult = droneUnit._resolveDamage(droneUnit, tile.unit, 1, 0, false, false, true);
        const dmg = Math.round(baseResult.dmg * multiplier);
        if (dmg <= 0) return null;
        const killed = tile.unit.applyDamage(dmg, { source: 'ranged', attacker: droneUnit });
        gs.damageTexts.push({
            x: tile.x,
            y: tile.y,
            value: dmg,
            isCrit: baseResult.isCrit,
            timeLeft: 900,
            lastUpdate: performance.now()
        });
        const result = { q: tile.q, r: tile.r, x: tile.x, y: tile.y, dmg, killed, isCrit: baseResult.isCrit };
        results.push(result);
        return result;
    };

    // 主目标
    const mainText = applySuicideDamage(targetTile, 3);

    // 穿刺目标（身后1格左右2个）
    const piercingTiles = _getSuicidePiercingTiles(fromTile, targetTile);
    for (const pt of piercingTiles) {
        applySuicideDamage(pt, 1.5);
    }

    // 视觉效果：无人机棋子飞向目标
    const dCampKey = droneUnit.camp === CAMP.player1 ? 'p1' : droneUnit.camp === CAMP.player2 ? 'p2' : 'p3';
    spawnDroneDive(fromTile.x, fromTile.y, targetTile.x, targetTile.y, dCampKey);

    const pierceTexts = results.filter(r => !(r.q === targetTile.q && r.r === targetTile.r));
    logMessage(`✈️💥 无人机自爆对主目标造成${mainText ? mainText.dmg : 0}伤害，穿刺造成${pierceTexts.length ? pierceTexts.map(r => r.dmg).join('/') : 0}伤害`);

    // 消耗全部行动力并坠毁
    droneUnit.remainingMP = 0;
    droneUnit.canAct = false;
    droneUnit.hp = 0;
    droneUnit.destroy(null);
    clearselection();
    recalcAllFlankingMorale();
    if (gameState.skirmishFog) _updateSkirmishFogAll();
    updateRecruitCostDisplay();
    updateUI();
    broadcastAction('droneSuicide', {
        fromX: fromTile.x,
        fromY: fromTile.y,
        x: targetTile.x,
        y: targetTile.y,
        q: targetTile.q,
        r: targetTile.r,
        campKey: dCampKey,
        results
    });
    return true;
}
export function executeTacticalCard(cardId, targetTile, _fromX = 0, _fromY = 0) {
    // E4 空运第二段：直接执行空运（跳过正常卡牌验证）
    if (cardId === 'airlift_dest') {
        _executeAirliftDest(targetTile);
        return;
    }
    const cfg = TACTICAL_CARD_CONFIG[cardId] || COLONEL_CARDS[cardId];
    if (!cfg) return;

    const myCamp = isNetworkGame() ? (getMyRole() === 'player1' ? CAMP.player1 : getMyRole() === 'player2' ? CAMP.player2 : CAMP.player3) : gameState.currentCamp;
    const campKey = myCamp === CAMP.player1 ? 'player1' : myCamp === CAMP.player2 ? 'player2' : 'player3';

    // validate targeting
    const tg = cfg.targeting;
    if (tg === 'enemyGlobal') {
        if (!targetTile || !targetTile.unit || targetTile.unit.camp === myCamp) { notify('无效目标'); return; }
    } else if (tg === 'friendlyAlive') {
        if (!targetTile || !targetTile.unit || targetTile.unit.camp !== myCamp) { notify('无效目标'); return; }
    } else if (tg === 'friendlyAny') {
        if (!targetTile || !targetTile.unit || targetTile.unit.camp !== myCamp) { notify('请选择友方单位'); return; }
        // E4 空运：被禁锢的单位不可被空运
        if (cardId === 'airlift' && targetTile.unit._imprisoned) { notify('被禁锢的单位无法空运'); return; }
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
    } else if (tg === 'anyUnit') {
        if (!targetTile || !targetTile.unit) { notify('请选择单位'); return; }
    } else if (tg === 'anyTileGlobal') {
        if (!targetTile) { notify('请选择目标地块'); return; }
    }

    // 遭遇战迷雾：对策卡只能对视野内目标释放（侦察卡除外）
    if (gameState.skirmishFog && tg !== 'anyTileGlobal' && targetTile && !isTileVisible(targetTile, myCamp, gameState)) {
        notify('目标不在视野范围内'); return;
    }

    // validate hand + capture card position for burn anim
    const hand = gameState.playerHands[campKey];
    const ct = gameState.cardTargeting;
    // 支持手牌中既有字符串 'cardId' 也有对象 { id: 'cardId', _copy: true }
    const idx = (ct && ct.handIndex != null && ct.handIndex < hand.length)
        ? (hand[ct.handIndex] === cardId || (typeof hand[ct.handIndex] === 'object' && hand[ct.handIndex].id === cardId) ? ct.handIndex : -1)
        : hand.findIndex(c => c === cardId || (typeof c === 'object' && c.id === cardId));
    if (idx === -1) { notify('手牌中没有该卡'); return; }
    const nBefore = hand.length;
    const fromI = nBefore - 1 - idx;
    const isCopyCard = typeof hand[idx] === 'object' && hand[idx]._copy;

    // E3 纵横家合纵：用卡次数上限覆盖
    const useBonus = (gameState._cardOverrides && gameState._cardOverrides[campKey]) ? gameState._cardOverrides[campKey].useBonus || 0 : 0;
    if (gameState.playerUsesThisTurn[campKey] >= CARD_SYSTEM_CONFIG.maxUsesPerTurn + useBonus) {
        notify('本回合已达到使用上限', 'error'); return;
    }

    // E4 空军上校：空军卡检查（金币/部署/雾天停飞）
    const isColonelCard = cardId === 'diveStrafe' || cardId === 'carpetBomb' || cardId === 'airlift';
    const isAirCard = isColonelCard || cardId === 'airstrike' || cardId === 'airdrop';
    if (isColonelCard) {
        // 部署前禁用
        if (!gameState._colonelDeployed || !gameState._colonelDeployed[campKey]) {
            notify('请先部署空军上校', 'error'); cancelCardTargeting(); return;
        }
        // 金币不足
        const goldCost = COLONEL_CARD_GOLD[cardId] || 0;
        if ((gameState.playerGold[campKey] || 0) < goldCost) {
            notify('金币不足', 'error'); cancelCardTargeting(); return;
        }
        // 空运两段式：金币延迟到第二段（选定目的地）才扣，避免取消白扣
        if (cardId !== 'airlift') {
            gameState.playerGold[campKey] -= goldCost;
            logMessage(`空军上校消耗${goldCost}$`);
        }
    }
    // 雾天停飞（所有空军卡）
    if (isAirCard && gameState.weather === 'fog') {
        notify('雾天停飞，无法使用空军卡', 'error');
        if (isColonelCard) cancelCardTargeting();
        return;
    }

    // for damage/spawn/shield cards: save state, undo visual, re-apply after burn
    const isDelayedCard = cardId === 'lightning' || cardId === 'airstrike' || cardId === 'mgNest' || cardId === 'shield';
    let _savedHPs = null;
    let _mgNestSaved = null;
    let _shieldSaved = null;
    let _cityDisabledSaved = null;
    if (isDelayedCard) {
        _savedHPs = [];
        if (cardId === 'lightning' && targetTile.unit) {
            _savedHPs.push({ tile: targetTile, hp: targetTile.unit.hp });
        } else if (cardId === 'airstrike') {
            const dirs = [[0,0],[1,0],[1,-1],[0,-1],[-1,0],[-1,1],[0,1]];
            for (const [dq, dr] of dirs) {
                const ht = gameState.tileMap.get(`${targetTile.q + dq},${targetTile.r + dr}`);
                if (ht && ht.unit) _savedHPs.push({ tile: ht, hp: ht.unit.hp, shield: ht.unit._shield });
            }
            _cityDisabledSaved = targetTile._cityDisabledUntil;
        } else if (cardId === 'mgNest') {
            _mgNestSaved = targetTile.unit;
        } else if (cardId === 'shield' && targetTile.unit) {
            const u = targetTile.unit;
            _shieldSaved = { unit: u, shield: u._shield, shieldMax: u._shieldMax, shieldTurns: u._shieldTurns };
        }
    }

    // execute
    const helpers = { getCommander, Unit, getMyCamp: () => myCamp, spawnOrbitBeams: spawnPaladinOrbitBeams, getAALayers, hexDistance, applyAADefense, applyAADropHP };
    let result;
    // E4 上校空军卡使用 COLONEL_CARDS 而非 TACTICAL_CARD_CONFIG
    if (isColonelCard) {
        const colCfg = COLONEL_CARDS[cardId];
        if (colCfg) result = colCfg.execute(targetTile, gameState, helpers);
    } else {
        result = cfg.execute(targetTile, gameState, helpers);
    }

    // E4 空军上校：伤害与将领本人攻击力挂钩，走三大乘区
    if (isColonelCard && (cardId === 'diveStrafe' || cardId === 'carpetBomb') && result) {
        let _colUnit = null;
        for (const _t of gameState.tiles) {
            if (_t.unit && _t.unit.commander === 'colonel' && _t.unit.camp === myCamp && _t.unit.hp > 0) {
                _colUnit = _t.unit; break;
            }
        }
        if (_colUnit) {
            // 通用空军增伤：每使用1张卡+10%（②增伤乘区，上限4层）
            if (gameState._colonelAirStacks) {
                if (gameState._colonelAirStacks[campKey] == null) gameState._colonelAirStacks[campKey] = 0;
                if (gameState._colonelAirStacks[campKey] < 4) {
                    gameState._colonelAirStacks[campKey]++;
                    logMessage(`✈️ 空军熟练度+1，当前增伤+${gameState._colonelAirStacks[campKey] * 10}%/上限40%`);
                }
            }
            const _stacks = gameState._colonelAirStacks?.[campKey] || 0;
            const airBonus = 0.10 * Math.min(_stacks, 4);
            if (cardId === 'diveStrafe' && targetTile && targetTile.unit) {
                // 扫射·弱点打击：目标HP<50%时无视其25%防御力（满血目标无破甲）
                const _hpRatio2 = targetTile.unit.hp / targetTile.unit.maxHp;
                const _pierce = _hpRatio2 < 0.5 ? 0.25 : 0;
                const _calc = _colUnit._resolveDamage(_colUnit, targetTile.unit, 1.0, airBonus, false, false, true, _pierce);
                result.dmg = Math.round(_calc.dmg);
                result.isCrit = _calc.isCrit;
                if (_pierce > 0) logMessage(`目标生命值低于50%，触发弱点打击（破甲25%）！`);
            } else if (cardId === 'carpetBomb' && result.results) {
                for (const _r of result.results) {
                    const _ht = gameState.tileMap ? gameState.tileMap.get(`${_r.q},${_r.r}`) : null;
                    if (_ht && _ht.unit) {
                        const _isCenter = _r.q === targetTile.q && _r.r === targetTile.r;
                        const _calc = _colUnit._resolveDamage(_colUnit, _ht.unit, 1.0, airBonus, false, false, true, 0.10);
                        _r.dmg = _isCenter ? Math.round(_calc.dmg) : Math.round(_calc.dmg * 0.6);
                        _r.isCrit = _calc.isCrit;
                    }
                }
            }
        }
    }

    // E4 空运第一段：选单位后进入第二段选目的地
    if (cardId === 'airlift' && targetTile && targetTile.unit) {
        gameState._airliftTarget = { unitId: targetTile.unit.id };
        showTargetingBanner('选择空降目的地（空地）', '再次点击卡片或按 Esc 取消');
        gameState.cardTargeting = { cardId: 'airlift_dest', targeting: 'emptyTile', handIndex: idx };
        updateUI();
        return;
    }

    gameState.cardTargeting = null;
    hideTargetingBanner();

    function _executeAirliftDest(targetTile) {
    if (!gameState._airliftTarget) { notify('请先选择空运单位', 'error'); return; }
    const myCamp = gameState.currentCamp;
    const aCampKey = _campKey(myCamp);
    const airUnit = gameState.tiles.reduce((f, t) => f || (t.unit?.id === gameState._airliftTarget.unitId ? t.unit : null), null);
    if (!airUnit || !airUnit.tile) { notify('空运单位已不存在', 'error'); gameState._airliftTarget = null; gameState.cardTargeting = null; hideTargetingBanner(); updateUI(); return; }
    if (targetTile.unit) { notify('目的地已有单位', 'error'); return; }
    if (gameState.skirmishFog && !isTileVisible(targetTile, myCamp, gameState)) { notify('目的地不在视野内', 'error'); return; }
    // 扣金币 + 计入本回合用卡次数（空军卡不消耗手牌，故在此统一结算）
    const aGoldCost = COLONEL_CARD_GOLD.airlift || 0;
    gameState.playerGold[aCampKey] = (gameState.playerGold[aCampKey] || 0) - aGoldCost;
    gameState.playerUsesThisTurn[aCampKey] = (gameState.playerUsesThisTurn[aCampKey] || 0) + 1;
    logMessage(`空军上校消耗${aGoldCost}$`);
    // 上校空军卡叠层
    if (gameState._colonelAirStacks) {
        if (gameState._colonelAirStacks[aCampKey] == null) gameState._colonelAirStacks[aCampKey] = 0;
        if (gameState._colonelAirStacks[aCampKey] < 4) {
            gameState._colonelAirStacks[aCampKey]++;
            logMessage(`✈️ 空军熟练度+1，当前增伤+${gameState._colonelAirStacks[aCampKey] * 10}%/上限40%`);
        }
    }
    const fromTile = airUnit.tile;
    fromTile.unit = null;
    targetTile.unit = airUnit;
    airUnit.tile = targetTile;
    airUnit.remainingMP = 0;
    airUnit.canAct = false;
    const hpLoss = Math.min(Math.round(airUnit.hp * 0.20), Math.round(airUnit.maxHp * 0.40));
    if (hpLoss > 0) airUnit.applyDamage(hpLoss, { source: 'true', minHp: 1 });
    // 通用防空接口：空运落入防空区 → 每层-20%最大生命值（上限不变）
    applyAADropHP(airUnit, targetTile, myCamp, gameState.tileMap);
    const aa = getAALayers(targetTile, myCamp, gameState.tileMap);
    if (aa > 0) logMessage(`🪂 空运落入防空火力：损失${aa * 25}%最大生命值`);
    // 空运动画：运输机自起点飞抵终点上空 → 降落伞投放 → 单位落地时才现身
    airUnit._airliftLandAt = spawnAirliftEffect(fromTile.x, fromTile.y, targetTile.x, targetTile.y, { color: airUnit.camp.color, q: targetTile.q, r: targetTile.r });
    logMessage(`🪂【空运】${airUnit.camp.name}${airUnit.config.name}兵传送至(${targetTile.q},${targetTile.r})`);
    gameState._airliftTarget = null;
    gameState.cardTargeting = null;
    hideTargetingBanner();
    updateUI();
    // 空降城市 → 占领
    if (targetTile.isCity && targetTile.camp !== myCamp) {
        updateDistrictColor(targetTile, myCamp, airUnit);
        spawnExplosionParticles(targetTile.x, targetTile.y, '#ffd700', 12);
    }
    recalcAllFlankingMorale();
    if (gameState.skirmishFog) _updateSkirmishFogAll();
    broadcastAction('tacticalCard', { cardId: 'airlift', unitId: airUnit.id, x: targetTile.x, y: targetTile.y, q: targetTile.q, r: targetTile.r, fromX: fromTile.x, fromY: fromTile.y });
}

    // 侦察卡：立即揭示目标区域
    if (cardId === 'scout' && result.scoutQ != null) {
        applyScoutReveal(gameState, myCamp, result.scoutQ, result.scoutR);
        updateFogOfWar(gameState, myCamp);
        logMessage(`${myCamp.name}使用了【侦察】卡，揭示了目标区域`);
    }

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
    // undo visual: restore city disabled state (re-applied after burn)
    if (_cityDisabledSaved !== null) {
        targetTile._cityDisabledUntil = _cityDisabledSaved;
    }
    // restore HP/shield for damage cards — re-apply in setTimeout
    if (_savedHPs) {
        for (const s of _savedHPs) {
            if (s.tile.unit) {
                s.tile.unit.hp = s.hp;
                if (s.shield !== undefined) s.tile.unit._shield = s.shield;
            }
        }
    }

    // remove from hand（空军上校专属卡为金币门控、可复用 → 保留手牌、不进弃牌堆）
    if (!isColonelCard) {
        hand.splice(idx, 1);
        // discard (except commanderDeploy and copy cards)
        if (cardId !== 'commanderDeploy' && !isCopyCard) {
            gameState.cardDiscardPile.push(cardId);
        }
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
                        timeLeft: 1000, lastUpdate: performance.now()
                    });
                    spawnHealParticles(x, y);
                    triggerHealFlash(x, y);
                }
            }, BURN_MS);
            break;
        }
        case 'lightning': {
            const dmg = result.dmg;
            logMessage(`⚡【雷击】对${targetTile.unit.camp.name}${targetTile.unit.config.name}兵造成${dmg}真实伤害`);
            setTimeout(() => {
                // 统一伤害入口：雷击为真实伤害（绕过护盾），击杀清理/殉道锁定由 applyDamage 处理
                if (_savedHPs && _savedHPs[0] && targetTile.unit) {
                    const victim = targetTile.unit;
                    const dc = victim.camp;
                    const killed = victim.applyDamage(dmg, { source: 'true' });
                    if (killed) {
                        const dck = dc === CAMP.player1 ? 'player1' : dc === CAMP.player2 ? 'player2' : dc === CAMP.player3 ? 'player3' : 'neutral';
                        gameState.killCount[dck]++;
                        logMessage(`${dc.name}${victim.config.name}兵被雷击消灭`);
                    }
                }
                gameState.damageTexts.push({
                    x, y, value: dmg, isTrueDmg: true,
                    timeLeft: 1000, lastUpdate: performance.now()
                });
                spawnLightningStrike(x, y);
                triggerScreenShake(10, 350);
                playSound('lightning');
            }, BURN_MS);
            break;
        }
        case 'mgNest': {
            logMessage(`${myCamp.name}在(${targetTile.q},${targetTile.r})部署了碉堡`);
            setTimeout(() => {
                if (_mgNestSaved) _mgNestSaved._airdropWaiting = false;
                spawnRecruitEffect(x, y);
                triggerRecruitFlash(x, y);
            }, BURN_MS);
            break;
        }
        case 'imprison': {
            logMessage(`🔗【禁锢】${targetTile.unit.camp.name}${targetTile.unit.config.name}兵下回合无法移动`);
            setTimeout(() => {
                spawnCommanderSkillEffect(x, y, '🔗', '禁锢');
            }, BURN_MS);
            break;
        }
        case 'forceMarch': {
            logMessage(`🏃【强行军】${targetTile.unit.camp.name}${targetTile.unit.config.name}兵回复2点行动力并可再次行动`);
            setTimeout(() => {
                spawnCommanderSkillEffect(x, y, '🏃', '强行军');
            }, BURN_MS);
            break;
        }
        case 'airstrike': {
            const results = result.results || [];
            const killedTiles = results.filter(r => r.killed).map(r => ({ q: r.q, r: r.r }));
            result.killedTiles = killedTiles;
            logMessage(`✈️【空袭】对${targetTile.camp.name}城市(${targetTile.q},${targetTile.r})及周边造成轰炸伤害`);
            setTimeout(() => {
                // airstrike visual AFTER card burn animation
                spawnAirstrikeEffect(x, y, results, 'airstrike', targetTile.q, targetTile.r);
                playSound('airstrike');
                // damage/HP/particles delayed to match bomb impact timing (~1200ms into flight)
                setTimeout(() => {
                    // 统一伤害入口：空袭为远程攻击，吸收护盾，触发铁卫转移/誓言
                    for (const r of results) {
                        const tile = gameState.tileMap.get(`${r.q},${r.r}`);
                        if (!tile) continue;
                        if (tile.unit) {
                            tile.unit.applyDamage(r.dmg, { source: 'ranged' });
                        }
                        spawnExplosionParticles(tile.x, tile.y, '#ff4400', 20);
                        spawnExplosionParticles(tile.x, tile.y, '#ffaa00', 12);
                        spawnExplosionParticles(tile.x, tile.y, '#886644', 8);
                        triggerAttackFlash(tile.x, tile.y, true);
                        gameState.damageTexts.push({
                            x: tile.x, y: tile.y, value: r.dmg, isCrit: false,
                            timeLeft: 900, lastUpdate: performance.now()
                        });
                    }
                    targetTile._cityDisabledUntil = getRoundIndex(gameState) + 2;
                    triggerScreenShake(8, 350);
                }, 1400);
            }, BURN_MS);
            break;
        }
        case 'diveStrafe': {
            // 俯冲扫射：单发伤害
            logMessage(`💥【俯冲扫射】对${targetTile.camp?.name}${targetTile.unit?.config?.name}兵造成${result.dmg}伤害`);
            setTimeout(() => {
                spawnAirstrikeEffect(x, y, [{ q: targetTile.q, r: targetTile.r, dmg: result.dmg }], 'diveStrafe', targetTile.q, targetTile.r);
                playSound('airstrike');
                setTimeout(() => {
                    if (targetTile.unit) {
                        // result.dmg 已在 execute() 走完标准管线（含防御），此处直接结算；source 'air' 不触发铁卫转移
                        const colonel = gameState.tiles.reduce((f, t) => f || (t.unit && t.unit.commander === 'colonel' && t.unit.camp === myCamp && t.unit.hp > 0 ? t.unit : null), null);
                        const targetUnit = targetTile.unit;
                        const killed = targetUnit.applyDamage(result.dmg, { source: 'air', attacker: colonel });
                        if (colonel) {
                            // 命中经验（与普攻一致）：基础 1 XP + 暴击额外 2 XP
                            if (result.dmg > 0) {
                                colonel.addXP(1);
                                if (result.isCrit) colonel.addXP(2);
                            }
                            // 击杀：士气+1 + 击杀经验
                            if (killed) reapColonelKill(colonel, targetUnit);
                            // 将领钩子（上校当前未实现 onAttack/onKill，供未来扩展）
                            triggerCommanderOnAttack(colonel, targetUnit, result.dmg, result.isCrit);
                            if (killed) triggerCommanderOnKill(colonel, targetUnit);
                        }
                    }
                    spawnExplosionParticles(x, y, '#ff4400', 20);
                    spawnExplosionParticles(x, y, '#ffaa00', 12);
                    spawnExplosionParticles(x, y, '#886644', 8);
                    triggerAttackFlash(x, y, true);
                    gameState.damageTexts.push({ x, y, value: result.dmg, isCrit: false, timeLeft: 900, lastUpdate: performance.now() });
                    triggerScreenShake(10, 400);
                }, 1000);
            }, BURN_MS);
            break;
        }
        case 'carpetBomb': {
            const cResults = result.results || [];
            logMessage(`💣【地毯轰炸】对目标区域造成AOE伤害`);
            setTimeout(() => {
                spawnAirstrikeEffect(x, y, cResults, 'carpetBomb', targetTile.q, targetTile.r);
                playSound('airstrike');
                setTimeout(() => {
                    const colonel = gameState.tiles.reduce((f, t) => f || (t.unit && t.unit.commander === 'colonel' && t.unit.camp === myCamp && t.unit.hp > 0 ? t.unit : null), null);
                    for (const r of cResults) {
                        const tile = gameState.tileMap.get(`${r.q},${r.r}`);
                        if (!tile) continue;
                        const _isCenterTile = tile === targetTile || (tile.q === targetTile.q && tile.r === targetTile.r);
                        if (_isCenterTile) {
                            spawnExplosionParticles(tile.x, tile.y, '#ff2200', 28);
                            spawnExplosionParticles(tile.x, tile.y, '#ff8800', 16);
                            spawnExplosionParticles(tile.x, tile.y, '#886644', 10);
                            triggerAttackFlash(tile.x, tile.y, true);
                        } else {
                            spawnExplosionParticles(tile.x, tile.y, '#ff6600', 14);
                            spawnExplosionParticles(tile.x, tile.y, '#ffaa00', 8);
                            spawnExplosionParticles(tile.x, tile.y, '#886644', 5);
                        }
                        // 仅对有单位的地块结算伤害并显示伤害数字（空地不显示）；dmg 已走完管线
                        if (tile.unit) {
                            const _target = tile.unit;
                            const _killed = _target.applyDamage(r.dmg, { source: 'air', attacker: colonel });
                            if (colonel) {
                                // AOE 命中经验：每击中一个存活单位 1 XP（AOE 效率已由范围体现，不另加暴击加成）
                                if (r.dmg > 0) colonel.addXP(1);
                                // 击杀：士气+1 + 击杀经验（含目标等级加成）
                                if (_killed) reapColonelKill(colonel, _target);
                                // 将领钩子（上校当前未实现 onAttack/onKill，供未来扩展）
                                triggerCommanderOnAttack(colonel, _target, r.dmg, r.isCrit || false);
                                if (_killed) triggerCommanderOnKill(colonel, _target);
                            }
                            gameState.damageTexts.push({ x: tile.x, y: tile.y, value: r.dmg, isCrit: false, timeLeft: 900, lastUpdate: performance.now() });
                        }
                    }
                    triggerScreenShake(8, 400);
                }, 1400);
            }, BURN_MS);
            break;
        }
        // 注：'airlift' 为两段式，第一段已在上方 early-return，不会进入本 switch
        case 'airdrop': {
            logMessage(`🪂【空降】${myCamp.name}在(${targetTile.q},${targetTile.r})空降了步兵`);
            // hide unit until parachute lands
            targetTile.unit._airdropWaiting = true;
            setTimeout(() => {
                // airdrop visual AFTER card burn animation
                spawnAirstrikeEffect(x, y, [], 'airdrop', targetTile.q, targetTile.r);
                playSound('airstrike');
                // reveal unit & recruit effect delayed to match parachute landing (~1500ms into flight)
                setTimeout(() => {
                    targetTile.unit._airdropWaiting = false;
                    if (targetTile.isCity && targetTile.camp !== myCamp) {
                        updateDistrictColor(targetTile, myCamp, targetTile.unit);
                        spawnExplosionParticles(x, y, '#ffd700', 12);
                        spawnGoldParticles(x, y);
                    }
                    spawnRecruitEffect(x, y);
                    triggerRecruitFlash(x, y);
                }, 1500);
            }, BURN_MS);
            break;
        }
        case 'shield': {
            logMessage(`🛡️【护盾】${targetTile.unit.camp.name}${targetTile.unit.config.name}兵获得50点护盾（3回合）`);
            setTimeout(() => {
                if (_shieldSaved && _shieldSaved.unit) {
                    _shieldSaved.unit._shield += 50;
                    _shieldSaved.unit._shieldMax = Math.max(_shieldSaved.unit._shieldMax, _shieldSaved.unit._shield);
                    _shieldSaved.unit._shieldTurns = 3;
                }
                spawnCommanderSkillEffect(x, y, '🛡️', '护盾');
            }, BURN_MS);
            break;
        }
        case 'landmine': {
            logMessage(`💣【地雷】${myCamp.name}在(${targetTile.q},${targetTile.r})埋设了地雷`);
            setTimeout(() => {
                spawnCommanderSkillEffect(x, y, '💣', '地雷');
            }, BURN_MS);
            break;
        }
        case 'scout': {
            // 侦察卡本地特效：望远镜 emoji + 金色辉光边框
            // 数据逻辑（applyScoutReveal / updateFogOfWar）已在 switch 之前执行
            logMessage(`🔭【侦察】${myCamp.name}揭示了目标区域`);
            setTimeout(() => {
                spawnCommanderSkillEffect(x, y, '🔭', '侦察');
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
    if (gameState.skirmishFog) _updateSkirmishFogAll();
    updateUI();
    // 烧牌动画 — 人类玩家从手牌飞到中央；AI/中立/远端在中央直接出现
    const isAI = gameState.gameMode === 'pve' && gameState.currentCamp === gameState.aiOpponentCamp;
    const isHumanLocal = !isAI && gameState.currentCamp !== CAMP.neutral;
    // 部署将领的烧牌动画显示所选将领名（遭遇战模式下不广播将领名）
    const burnDisplayName = (cardId === 'commanderDeploy' && result.commander && !gameState.skirmishFog)
        ? (COMMANDER_CONFIG[result.commander]?.name || null) : null;
    // E3 纵横家连横：对方用卡后尝试复制（必须在 broadcastAction 之前执行，确保序列化状态含拷贝）
    if (gameState.tileMap && gameState._cardOverrides && !isCopyCard) {
        for (const [ck, co] of Object.entries(gameState._cardOverrides)) {
            if (!co) continue;
            const dipCamp = ck === 'player1' ? CAMP.player1 : ck === 'player2' ? CAMP.player2 : CAMP.player3;
            if (!dipCamp || dipCamp === gameState.currentCamp) continue;
            for (const t of gameState.tiles) {
                if (!t.unit || t.unit.commander !== 'diplomat' || t.unit.camp !== dipCamp || t.unit.hp <= 0) continue;
                if (t.camp === dipCamp) continue;
                if (!(gameState.rng ? gameState.rng.chance(0.50) : Math.random() < 0.50)) continue;
                const hand = gameState.playerHands[ck] || [];
                const hBonus = co.handSizeBonus || 0;
                if (hand.length >= CARD_SYSTEM_CONFIG.maxHandSize + hBonus) continue;
                // 连横不可复制"部署将领"卡
                if (cardId === 'commanderDeploy' || cardId === 'diveStrafe' || cardId === 'carpetBomb' || cardId === 'airlift') continue;
                hand.push({ id: cardId, _copy: true });
                logMessage(`纵横家【连横】：${ck}获得${cardId}的复制`);
                spawnCardCopyEffect(targetTile.x, targetTile.y, 500, 375, cardId);
                spawnCommanderSkillEffect(t.x, t.y, '✨', '连横');
                break;
            }
        }
    }

    spawnCardUseEffect(cardId, 500, 375, isHumanLocal, _fromX || 900, _fromY || 600, burnDisplayName);
    const airstrikeResults = (cardId === 'airstrike') ? (result.results || []) : null;
    // E4 空军上校：diveStrafe/carpetBomb 伤害在本地 setTimeout 内结算，广播时状态尚未含伤害，
    // 故携带 result 供远端在自己的 setTimeout 内同样结算（对齐 lightning 的延迟结算模式）
    const carpetBombResults = (cardId === 'carpetBomb') ? (result.results || []).map(r => ({ q: r.q, r: r.r, dmg: r.dmg, isCrit: r.isCrit })) : null;
    broadcastAction('tacticalCard', { cardId, x, y, q: targetTile.q, r: targetTile.r, dmg: result.dmg, isCrit: result.isCrit, deployed: result.deployed, commander: result.commander, healAmt: result.healAmt, imprisoned: result.imprisoned, killedTiles: result.killedTiles, airstrikeResults, carpetBombResults, burnDisplayName, scoutQ: result.scoutQ, scoutR: result.scoutR });
}
