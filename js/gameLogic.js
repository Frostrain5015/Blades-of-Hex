import { UNIT_CONFIG, hexDistance, invalidateBoard, HEX_NEIGHBORS, TERRAIN_CONFIG, calcIncome, WEATHER_CYCLE, TACTICAL_CARD_CONFIG, CARD_SYSTEM_CONFIG, DECK_COMPOSITION, SKIRMISH_EXTRAS, VILLAGE_GOLD, VILLAGE_MIN_DIST, HEX_SIZE, COLONEL_CARDS, COLONEL_CARD_GOLD, COMMANDER_REROLL_COST, getRound, getRoundIndex, getFactionCount } from './config.js';
import { allCommanders as COMMANDER_CONFIG } from '../commander/index.js';
import { campToKey } from '../rules/camps.js';
import { DRONE_RANGE, deployDrone, isTileInDroneSignal, isDroneInSignal, refreshDroneSignal } from '../commander/tianyan.js';
import { digEngineerTrench, digEngineerFlak, beginEngineerBunkerConstruction, completeEngineerBunkerConstructions } from '../commander/engineer.js';
import { gameState, updateButtonColors, updateUI, logMessage, clearselection, serializeState, deserializeState, rebuildTileMap, notify, updateRecruitCostDisplay, showTargetingBanner, hideTargetingBanner, resetGameState, seedMatchRng } from './state.js';
import { isNetworkGame, sendAction, getMyRole, syncCommanderState, leaveRoom, listRooms, isMyTurn, getMyRoomId, getMatchSeed } from './network.js';
import { neutralDriverRole } from '../protocol/messages.js';
import { stopCampaignRuntime } from './campaignController.js';
import { triggerCommanderTurnStart, triggerCommanderTurnEnd, getCommanderRecruitCost, triggerCommanderOnAttackEx, triggerCommanderOnAttack, triggerCommanderOnCounterAttack, triggerCommanderOnKill, triggerCommanderOnMoraleChange, getStallerSnareLayers, getCommanderRangeReduction, getCommanderWeatherImmunity, getCommanderWeatherDebuff, getCommander, getCommanderDefenseBonus, getCommanderAuraDefenseBonus, setSpawnFxRef, setSpawnGoldenBeamRef, setSpawnBeamProjectilesRef, setLaunchOrbitSwordsRef, setSpawnHealingChainRef } from './commanderInterface.js';
import { HexTile, computeCampBorders, computeDistrictBorders } from './HexTile.js';
import { buildBoardFromConfig } from '../campaign/runtime/mapBuilder.js';
import { getStandardMap } from '../rules/standardMaps.js';
import { Unit, _pendingRankUps } from './Unit.js';
import {
    spawnExplosionParticles, spawnDirectionalParticles, spawnHealParticles, spawnGoldParticles, spawnRecruitEffect,
    triggerAttackFlash, triggerHealFlash, triggerRecruitFlash, triggerScreenShake,
    spawnMeleeSlash,
    spawnConfetti, triggerTurnFlash, clearTransientEffects,
    spawnMoraleEffect, spawnCommanderSkillEffect,
    triggerFactionMoraleFlash,
    spawnProjectile, spawnTorpedo, spawnDroneProjectile, spawnStrafeTracer, spawnDroneSuicideFlak, spawnDroneDive, triggerRecoil, triggerCharge,
    spawnLightningStrike,
    spawnGoldenFlame, spawnVictoryRipple,
    spawnCoinRain, spawnMinisterDominionRing,
    spawnCardUseEffect, spawnAirstrikeEffect, spawnAirliftEffect,
    spawnGoldenBeam, spawnPaladinBeamProjectiles, launchPaladinOrbitSwords, spawnPaladinOrbitBeams,
    spawnHealingChain,
    spawnReinforceEffect, spawnCardCopyEffect
} from './effects.js';
import { playSound } from './audio.js';
import {
    applyScoutReveal,
    beginFogPresentationHold,
    expireScoutReveals,
    getPresentedTileVisibilityState,
    isTileVisible,
    updateAllFogOfWar,
    updateFogOfWar
} from './fogOfWar.js';
import { COLONEL_CARD_DATA } from '../rules/cards.js';
import { COMBAT_BALANCE } from '../rules/constants.js';
import { MORALE_CONFIG } from '../rules/terrain.js';
import { COMMANDER_CONFIG as COMMANDER_BALANCE_CONFIG } from '../rules/commanders.js';
import { emit } from './eventBus.js';
import { canAttack, getRelation, isFriendly, isHostile, setRelation } from '../rules/diplomacy.js';
import { campFromKey, getFactionKeys, getRoleCamp } from '../rules/diplomacy.js';
import { isMechanicEnabled } from '../rules/mechanics.js';
import { ATTACK_PRESENTATION, classifyAttackPresentation } from '../rules/attackPresentation.js';
import { resolveTargetingPreview, isResolvedTargetingCandidate } from '../rules/targeting.js';
import {
    ANTI_AIR_RADIUS,
    getAntiAirReduction,
    isAntiAirUnit as isAntiAirUnitRule
} from '../rules/antiAir.js';
import {
    areCommanderMechanicsSuppressed,
    canUnitAssaultOccupiedTile,
    canUnitOccupyTile,
    getTransportBaseDefense,
    isEmbarkableLandUnit,
    isLandDeploymentTile,
    resolveMovementStep
} from '../rules/movement.js';
import { isLandTile, isWaterTile } from '../rules/surfaces.js';
import { getActivePlayerKeys, getSurvivingPlayerKeys, hasFactionSurrendered } from '../rules/matchOutcome.js';
import { setResultFlagPreview } from './resultFlagPreview.js';
import {
    CONSTRUCTION_CONFIG,
    canBuildAirfieldAt,
    canBuildBunkerAt,
    canBuildFieldFortification,
    canBuildShoreBatteryAt,
    canFieldRepair,
    constructionCost
} from '../rules/construction.js';
import {
    AIR_COMMAND_CONFIG,
    AIRFIELD_BASE_POWER,
    AIR_COMMAND_IMPACT_DELAY_MS,
    COLONEL_AIR_DAMAGE_BONUS,
    COLONEL_AIR_MAX_STACKS,
    COLONEL_AIR_STACK_BONUS,
    COLONEL_ANTI_AIR_PIERCE,
    getAirCommandAvailability,
    getAirCommandRange,
    getAirfieldColonel,
    getMountedCommanderAirAttackBonus,
    buildAirCommandDamageTexts,
    markAirCommandUsed
} from '../rules/airCommands.js';
import {
    canBuildShoreBattery,
    canUnitTargetUnit,
    capturePort,
    clearExpiredSubmarineReveals,
    clearPortDepartureState,
    isCoastalLandTile,
    isPortGuarded,
    isPortOperationalFor,
    isRegularNavalUnit,
    isSubmarineTargetableBy,
    markSubmarinesRevealedInArea,
    recordShoreBatteryBuilt,
    repairShipsAtTurnStart,
    restoreSurrenderedPorts
} from '../rules/naval.js';

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

function _getActiveDiplomatOverride(campKey) {
    const override = gameState._cardOverrides?.[campKey];
    if (!override) return null;
    const diplomat = gameState.tiles.find(tile => tile.unit?.commander === 'diplomat'
        && campToKey(tile.unit.camp) === campKey
        && tile.unit.hp > 0);
    return diplomat && !areCommanderMechanicsSuppressed(diplomat.unit) ? override : null;
}
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

/**
 * 阵营选择器：弹出一组按钮让用户选择要投降的阵营。
 * 只在热座等共享屏幕模式下使用。返回选中的 camp 或 null（取消）。
 */
function _showCampPicker(message, camps) {
    if (camps.length === 0) return Promise.resolve(null);
    if (camps.length === 1) return showConfirm(message + '\n\n' + camps[0].name).then(ok => ok ? camps[0] : null);
    return new Promise((resolve) => {
        const overlay = document.getElementById('confirmOverlay');
        const msgEl = document.getElementById('confirmMessage');
        const yesBtn = document.getElementById('confirmYes');
        const noBtn = document.getElementById('confirmNo');
        const btnBox = yesBtn.parentElement;

        // 隐藏原有按钮，改放阵营选择按钮
        yesBtn.style.display = 'none';
        noBtn.style.display = 'none';
        msgEl.textContent = message;

        const pickerBtns = camps.map(camp => {
            const btn = document.createElement('button');
            btn.textContent = '投降 · ' + camp.name;
            btn.style.cssText = 'display:block;width:100%;padding:10px;margin:6px 0;border-radius:6px;border:1px solid rgba(255,255,255,0.15);background:rgba(200,50,40,0.7);color:#fff;font:600 15px/1.4 sans-serif;cursor:pointer;';
            btn.addEventListener('click', () => {
                cleanup();
                resolve(camp);
            });
            btnBox.appendChild(btn);
            return btn;
        });
        const cancelBtn = document.createElement('button');
        cancelBtn.textContent = '取消';
        cancelBtn.style.cssText = 'display:block;width:100%;padding:8px;margin:4px 0;border-radius:6px;border:1px solid rgba(255,255,255,0.1);background:rgba(255,255,255,0.08);color:#aaa;font:600 14px/1.4 sans-serif;cursor:pointer;';
        cancelBtn.addEventListener('click', () => { cleanup(); resolve(null); });
        btnBox.appendChild(cancelBtn);

        overlay.classList.add('show');

        function cleanup() {
            overlay.classList.remove('show');
            yesBtn.style.display = '';
            noBtn.style.display = '';
            for (const b of pickerBtns) b.remove();
            cancelBtn.remove();
            document.removeEventListener('keydown', onKey);
            _confirmActive = false;
        }
        function onKey(e) {
            if (e.key === 'Escape') { e.preventDefault(); cleanup(); resolve(null); }
        }
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

function generateTerrain(tiles) {
    const nonCityTiles = tiles.filter(t => isLandTile(t) && !t.isCity && !t.isVillage);
    const total = nonCityTiles.length;
    if (total === 0) return;

    const rng = gameState.rng;

    const forestSeeds   = Math.floor(total * 0.08);
    const mountainSeeds = Math.floor(total * 0.04);

    for (let i = nonCityTiles.length - 1; i > 0; i--) {
        const j = rng.int(i + 1);
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
        } else if (fCount === 1 && rng.chance(0.30)) {
            tile.terrain = 'forest';
        } else if (mCount === 1 && rng.chance(0.20)) {
            tile.terrain = 'mountain';
        }
    }

    // 镜像对称：非战役模式下，确保各玩家地形公平
    if (!gameState.campaignMode) {
        if (gameState.isThreePlayer) {
            // 三人 120° 旋转对称：以 P1 所在楔形（右上 120° 扇区）为源，旋转生成其他两翼
            function rot120(q, r) { return { q: -q - r, r: q }; }
            function canonical(q, r) {
                // 定义 P1 的楔形：从 P1(6,0) 到 P2(-6,6) 之间的区域
                // 即 angle(q,r) 在 [0°, 120°) 区间；使用 kv 比较
                const k1 = (q * 10000 + r) | 0;
                const r1 = rot120(q, r); const k2 = (r1.q * 10000 + r1.r) | 0;
                const r2 = rot120(r1.q, r1.r); const k3 = (r2.q * 10000 + r2.r) | 0;
                if (k2 < k1 && k2 < k3) return r1;
                if (k3 < k1 && k3 < k2) return r2;
                return { q, r };
            }
            for (const tile of tiles) {
                const src = canonical(tile.q, tile.r);
                if (src.q !== tile.q || src.r !== tile.r) {
                    const srcTile = map.get(`${src.q},${src.r}`);
                    if (srcTile) tile.terrain = srcTile.terrain;
                }
            }
        } else {
            // 双人 180° 点对称
            for (const tile of tiles) {
                if (tile.q < 0 || (tile.q === 0 && tile.r < 0)) continue;
                const mirror = map.get(`${-tile.q},${-tile.r}`);
                if (mirror) tile.terrain = mirror.terrain;
            }
        }
    }

}

function countAdjacentNonFriendlies(unit, tileMap) {
    let count = 0;
    for (const [dq, dr] of HEX_NEIGHBORS) {
        const nb = tileMap.get(`${unit.tile.q + dq},${unit.tile.r + dr}`);
        if (nb && nb.unit && isHostile(gameState, unit.camp, nb.unit.camp)) count++;
    }
    return count;
}

function isFlanked(unit, tileMap) {
    for (const [[dq1, dr1], [dq2, dr2]] of HEX_AXES) {
        const nb1 = tileMap.get(`${unit.tile.q + dq1},${unit.tile.r + dr1}`);
        const nb2 = tileMap.get(`${unit.tile.q + dq2},${unit.tile.r + dr2}`);
        if (nb1 && nb1.unit && isHostile(gameState, unit.camp, nb1.unit.camp) &&
            nb2 && nb2.unit && isHostile(gameState, unit.camp, nb2.unit.camp)) {
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
            if (nb && nb.unit && nb.unit.commander === 'paladin' && !areCommanderMechanicsSuppressed(nb.unit) && isFriendly(gameState, nb.unit.camp, u.camp)) {
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
            if (nb && nb.unit && nb.unit.commander === 'paladin' && !areCommanderMechanicsSuppressed(nb.unit) && isFriendly(gameState, nb.unit.camp, tile.unit.camp)) {
                tile.unit.morale = 2;
                break;
            }
        }
    }
}

export function initMap() {
    // 联机对局使用服务端逐局种子；旧服务端降级为房间号，保证兼容现有房间。
    if (isNetworkGame()) seedMatchRng(getMatchSeed() ?? `room:${getMyRoomId() || '0'}`);
    gameState.tiles = [];

    const is3P = gameState.isThreePlayer;
    const standardMap = getStandardMap(is3P ? 3 : 2);
    // 直接从编辑器导出的配置嵌入（JSON字符串，保证与文件完全一致）
    const boardJSON = is3P
        ? '{"radius":7,"cities":[{"q":0,"r":0,"districtId":5,"camp":"neutral"},{"q":-3,"r":-3,"districtId":1,"camp":"player1"},{"q":-6,"r":3,"districtId":3,"camp":"player2"},{"q":-3,"r":6,"districtId":4,"camp":"player2"},{"q":3,"r":3,"districtId":6,"camp":"player3"},{"q":6,"r":-3,"districtId":7,"camp":"player3"},{"q":3,"r":-6,"districtId":2,"camp":"player1"}],"terrain":[],"villages":[{"q":1,"r":-6,"districtId":2},{"q":-6,"r":5,"districtId":3},{"q":-1,"r":6,"districtId":4},{"q":5,"r":1,"districtId":6},{"q":0,"r":2,"districtId":5},{"q":2,"r":-2,"districtId":5},{"q":-2,"r":0,"districtId":5},{"q":-4,"r":-2,"districtId":1},{"q":6,"r":-4,"districtId":7}],"fortifications":[],"districts":[{"q":-4,"r":0,"districtId":1},{"q":-5,"r":0,"districtId":1},{"q":-6,"r":0,"districtId":1},{"q":-7,"r":0,"districtId":1},{"q":0,"r":-7,"districtId":2},{"q":1,"r":-7,"districtId":2},{"q":0,"r":-6,"districtId":2},{"q":1,"r":-6,"districtId":2},{"q":0,"r":-5,"districtId":2},{"q":1,"r":-5,"districtId":2},{"q":0,"r":-4,"districtId":2},{"q":1,"r":-4,"districtId":2},{"q":-3,"r":2,"districtId":5},{"q":-3,"r":1,"districtId":5},{"q":-3,"r":0,"districtId":5},{"q":-1,"r":-1,"districtId":5},{"q":-1,"r":-2,"districtId":5},{"q":0,"r":-3,"districtId":5},{"q":1,"r":-3,"districtId":5},{"q":2,"r":-3,"districtId":5},{"q":3,"r":-3,"districtId":5},{"q":3,"r":-2,"districtId":5},{"q":3,"r":-1,"districtId":5},{"q":3,"r":0,"districtId":5},{"q":2,"r":1,"districtId":5},{"q":1,"r":1,"districtId":5},{"q":1,"r":2,"districtId":5},{"q":-2,"r":3,"districtId":5},{"q":-1,"r":3,"districtId":5},{"q":0,"r":3,"districtId":5},{"q":4,"r":-4,"districtId":7},{"q":5,"r":-5,"districtId":7},{"q":6,"r":-6,"districtId":7},{"q":7,"r":-7,"districtId":7}]}'
        : '{"radius":7,"cities":[{"q":0,"r":0,"districtId":5,"camp":"neutral"},{"q":-5,"r":0,"districtId":1,"camp":"player1"},{"q":5,"r":0,"districtId":2,"camp":"player2"},{"q":-2,"r":4,"districtId":4,"camp":"neutral"},{"q":2,"r":-4,"districtId":3,"camp":"neutral"}],"terrain":[],"villages":[{"q":-5,"r":6,"districtId":4},{"q":-1,"r":6,"districtId":4},{"q":-1,"r":-1,"districtId":5},{"q":1,"r":1,"districtId":5},{"q":1,"r":-6,"districtId":3},{"q":5,"r":-6,"districtId":3},{"q":-6,"r":3,"districtId":1},{"q":-3,"r":-3,"districtId":1},{"q":6,"r":-3,"districtId":2},{"q":3,"r":3,"districtId":2}],"fortifications":[],"districts":[{"q":2,"r":5,"districtId":2},{"q":4,"r":-2,"districtId":2},{"q":5,"r":-2,"districtId":2},{"q":6,"r":-3,"districtId":2}]}';

    // 标准地图池优先使用海岛竞技图；旧纯陆配置保留为兼容降级入口。
    buildBoardFromConfig(standardMap || { board: JSON.parse(boardJSON) }, gameState);
    updateButtonColors();
    generateTerrain(gameState.tiles);
    initInitialUnits();

    // 遭遇战迷雾：初始化（支持联机遭遇战与 PVE 遭遇战）
    if (gameState.skirmishFog) {
        for (const key of (gameState.turnOrder || []).filter(key => key !== 'neutral')) {
            updateFogOfWar(gameState, campFromKey(key, gameState));
        }
    }

    logMessage(`${is3P ? '三人模式' : '游戏'}开始，${gameState.factions?.[gameState.turnOrder?.[0]]?.name || '首个阵营'}先手`);

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
    document.getElementById('recruitDestroyer').addEventListener('click', _onRecruitDestroyer);
    document.getElementById('recruitWarship').addEventListener('click', _onRecruitWarship);
    document.getElementById('recruitSubmarine').addEventListener('click', _onRecruitSubmarine);
}

const _onRecruitInfantry = () => recruitUnit('infantry');
const _onRecruitCavalry = () => recruitUnit('cavalry');
const _onRecruitArcher = () => recruitUnit('archer');
const _onRecruitDestroyer = () => recruitUnit('destroyer');
const _onRecruitWarship = () => recruitUnit('warship');
const _onRecruitSubmarine = () => recruitUnit('submarine');

function initCardDeck() {
    const deck = [...DECK_COMPOSITION];
    if (gameState.skirmishFog) deck.push(...SKIRMISH_EXTRAS);
    const rng = gameState.rng;
    for (let i = deck.length - 1; i > 0; i--) {
        const j = rng.int(i + 1);
        [deck[i], deck[j]] = [deck[j], deck[i]];
    }
    gameState.cardDrawPile = deck;
    gameState.cardDiscardPile = [];
    // E4 空军上校：替换牌库和手牌
    const commanderIds = {
        player1: [gameState.commanderP1, gameState.commanderP1Secondary].filter(Boolean),
        player2: [gameState.commanderP2, gameState.commanderP2Secondary].filter(Boolean),
        player3: [gameState.commanderP3, gameState.commanderP3Secondary].filter(Boolean)
    };
    const deploymentCards = (campKey) => {
        const ids = commanderIds[campKey];
        if (!gameState.doubleCommanderMode) return ['commanderDeploy'];
        return ids.map(commanderId => ({ id: 'commanderDeploy', commanderId }));
    };
    // 上校与其他将领一样使用标准对策牌；空军能力完全由机场/航母提供。
    const freeCard1 = gameState.cardDrawPile.pop();
    const freeCard2 = gameState.cardDrawPile.pop();
    const freeCard3 = gameState.isThreePlayer ? gameState.cardDrawPile.pop() : null;
    gameState.playerHands = {
        player1: [...deploymentCards('player1'), freeCard1].filter(Boolean),
        player2: [...deploymentCards('player2'), freeCard2].filter(Boolean),
        player3: gameState.isThreePlayer ? [...deploymentCards('player3'), freeCard3].filter(Boolean) : []
    };
    gameState.playerDrawsThisTurn = { player1: 0, player2: 0, player3: 0 };
    gameState.playerUsesThisTurn = { player1: 0, player2: 0, player3: 0 };
    gameState.cardStackExpanded = false;
}

export function drawCard(camp) {
    if (gameState.campaignMode && !isMechanicEnabled(gameState, 'tacticalCards')) { notify('本关尚未开放对策卡', 'info'); return false; }
    const campKey = _campKey(camp);
    if (campKey === 'neutral') return null;

    if (gameState.playerDrawsThisTurn[campKey] >= CARD_SYSTEM_CONFIG.maxDrawsPerTurn) {
        notify('本回合已达到抽牌上限', 'error'); return null;
    }
    // E3 纵横家合纵：手牌上限覆盖
    const handSizeBonus = _getActiveDiplomatOverride(campKey)?.handSizeBonus || 0;
    const maxHand = CARD_SYSTEM_CONFIG.maxHandSize + handSizeBonus;
    if (gameState.playerHands[campKey].length >= maxHand) {
        notify(`当前手牌队列已满`, 'error'); return null;
    }
    const drawCost = gameState.playerDrawsThisTurn[campKey] === 0 ? CARD_SYSTEM_CONFIG.drawCost : CARD_SYSTEM_CONFIG.drawCost * 2;
    if (gameState.playerGold[campKey] < drawCost) {
        notify(`资金不足`, 'error'); return null;
    }

    if (gameState.cardDrawPile.length === 0 && gameState.cardDiscardPile.length > 0) {
        gameState.cardDrawPile = [...gameState.cardDiscardPile];
        gameState.cardDiscardPile = [];
        for (let i = gameState.cardDrawPile.length - 1; i > 0; i--) {
            const j = gameState.rng.int(i + 1);
            [gameState.cardDrawPile[i], gameState.cardDrawPile[j]] = [gameState.cardDrawPile[j], gameState.cardDrawPile[i]];
        }
        logMessage('弃牌堆已洗入抽牌堆');
    }
    if (gameState.cardDrawPile.length === 0) {
        notify('当前无法抽牌', 'error'); return null;
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
        const runtimeCamp = campFromKey(campToKey(camp), gameState);
        if (tile && !tile.unit) new Unit(type, runtimeCamp, tile, false);
    }
    const standardMap = getStandardMap(gameState.isThreePlayer ? 3 : 2);
    if (Array.isArray(standardMap?.initialUnits)) {
        for (const unit of standardMap.initialUnits) spawn(unit.type, unit.camp, unit.q, unit.r);
        return;
    }
    if (gameState.isThreePlayer) {
        // 三个稳定席位的初始部署；外观颜色由运行时阵营配置决定。
        spawn('infantry', 'player1', -3, -3);
        spawn('infantry', 'player1', 3, -6);
        spawn('infantry', 'player1', 2, -6);
        spawn('infantry', 'player1', -2, -4);
        spawn('archer',   'player1', -3, -4);
        spawn('archer',   'player1', 3, -7);
        spawn('cavalry',  'player1', 2, -5);
        spawn('cavalry',  'player1', -2, -3);
        spawn('infantry', 'player2', -6, 3);
        spawn('infantry', 'player2', -3, 6);
        spawn('infantry', 'player2', -2, 6);
        spawn('infantry', 'player2', -6, 4);
        spawn('archer',   'player2', -7, 4);
        spawn('archer',   'player2', -3, 7);
        spawn('cavalry',  'player2', -5, 3);
        spawn('cavalry',  'player2', -2, 5);
        spawn('infantry', 'player3', 3, 3);
        spawn('infantry', 'player3', 6, -3);
        spawn('infantry', 'player3', 6, -2);
        spawn('infantry', 'player3', 4, 2);
        spawn('archer',   'player3', 4, 3);
        spawn('archer',   'player3', 7, -3);
        spawn('cavalry',  'player3', 3, 2);
        spawn('cavalry',  'player3', 5, -2);
        // 中立
        spawn('infantry', 'neutral', 0, 0);
        spawn('infantry', 'neutral', 2, -2);
        spawn('infantry', 'neutral', 0, 2);
        spawn('infantry', 'neutral', -2, 0);
        spawn('archer',   'neutral', 0, -1);
        spawn('cavalry',  'neutral', -1, 1);
        spawn('cavalry',  'neutral', 1, 0);
    } else {
        // 双方席位的镜像部署；席位不再暗含阵营色。
        spawn('infantry', 'player1', -5, 0);
        spawn('infantry', 'player1', -4, 0);
        spawn('infantry', 'player1', -6, 3);
        spawn('infantry', 'player1', -3, -3);
        spawn('cavalry',  'player1', -4, -1);
        spawn('cavalry',  'player1', -5, 1);
        spawn('archer',   'player1', -5, -1);
        spawn('archer',   'player1', -6, 1);

        spawn('infantry', 'player2', 5, 0);
        spawn('infantry', 'player2', 4, 0);
        spawn('infantry', 'player2', 6, -3);
        spawn('infantry', 'player2', 3, 3);
        spawn('cavalry',  'player2', 5, -1);
        spawn('cavalry',  'player2', 4, 1);
        spawn('archer',   'player2', 6, -1);
        spawn('archer',   'player2', 5, 1);

        // 中立
        spawn('infantry', 'neutral', 0, 0);
        spawn('infantry', 'neutral', 2, -4);
        spawn('infantry', 'neutral', -2, 4);
        spawn('infantry', 'neutral', 2, -5);
        spawn('infantry', 'neutral', -2, 5);
        spawn('infantry', 'neutral', 1, 1);
        spawn('infantry', 'neutral', -1, -1);
        spawn('archer',   'neutral', 3, -5);
        spawn('archer',   'neutral', -3, 5);
        spawn('cavalry',  'neutral', -2, 1);
        spawn('cavalry',  'neutral', 2, -1);
    }
}

// ===== 回合管理 =====================
let _turnProcessing = false;
let _neutralAiLock = false; // 防止AI在非中立回合异常触发

function _campKey(camp) {
    return campToKey(camp);
}

function _updateSkirmishFogAll() {
    updateAllFogOfWar(gameState);
    if (_onFogUpdated) _onFogUpdated();
}

let _onFogUpdated = null;
export function setOnFogUpdated(cb) { _onFogUpdated = cb; }

function _showTurnTransition(camp) {
    return new Promise(resolve => {
        const overlay = document.getElementById('turnTransitionOverlay');
        const text = document.getElementById('turnTransitionText');
        const name = camp?.name || _campKey(camp);
        const color = camp?.color || '#ffffff';
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
    gameState.currentCamp = _nextActiveCamp(fromCamp);
}

// 获取下一个未投降的阵营（用于回合轮转）
function _nextActiveCamp(camp) {
    const order = gameState.turnOrder?.length ? gameState.turnOrder : getFactionKeys(gameState)
        .filter(key => gameState.factions[key]?.active !== false && gameState.factions[key]?.participatesInTurns !== false);
    const idx = order.indexOf(_campKey(camp));
    for (let i = 1; i <= order.length; i++) {
        const key = order[((idx < 0 ? -1 : idx) + i) % order.length];
        const faction = gameState.factions[key];
        const next = campFromKey(key, gameState);
        if (faction?.active !== false && faction?.participatesInTurns !== false && !gameState.surrenderedCamps.includes(next)) return next;
    }
    return camp;
}

function _updateWeather() {
    const previousWeather = gameState.weather;
    const refreshVision = () => {
        if (gameState.weather !== previousWeather && gameState.skirmishFog) {
            _updateSkirmishFogAll();
        }
    };
    // E1 占星者星移：锁定期间跳过天气循环
    if (gameState.weatherLockUntil > 0 && getRoundIndex(gameState) < gameState.weatherLockUntil) {
        return;
    }
    // E1 占星者星移锁定结束后首次更新：强制重新随机，避免 stale lastWeather
    if (gameState._starlightResume) {
        gameState._starlightResume = false;
        const pool = ['rain', 'fog', 'wind'].filter(w => w !== gameState.lastWeather);
        gameState.lastWeather = pool[gameState.rng.int(pool.length)];
        gameState.weather = gameState.lastWeather;
        refreshVision();
        return;
    }
    const round = getRoundIndex(gameState);  // 0-indexed full round
    if (round < WEATHER_CYCLE.warmupRounds) {
        gameState.weather = 'clear';
        refreshVision();
        return;
    }
    const cycleRound = round - WEATHER_CYCLE.warmupRounds;
    const cycleLen = WEATHER_CYCLE.weatherDuration + WEATHER_CYCLE.clearDuration;  // 3
    const position = cycleRound % cycleLen;  // 0,1,2
    if (position === 0) {
        const pool = ['rain', 'fog', 'wind'].filter(w => w !== gameState.lastWeather);
        gameState.lastWeather = pool[gameState.rng.int(pool.length)];
    }
    if (position < WEATHER_CYCLE.weatherDuration) {
        gameState.weather = gameState.lastWeather;
    } else {
        gameState.weather = 'clear';
    }
    refreshVision();
}

// 限时效果到期检查（每回合 P1 开始时调用一次）
function _expireTimedEffects() {
    // E2 亡灵法师：亡魂标记老化（3回合后消失）；bornAt 为回合数(0-indexed)
    // 全局一次性结算，不放进 per-unit 循环（避免 O(单位数×标记数) 且无单位时不老化）
    if (gameState._soulMarks && gameState._soulMarks.length > 0) {
        const soulRound = getRoundIndex(gameState);
        gameState._soulMarks = gameState._soulMarks.filter(m => soulRound - m.bornAt < COMMANDER_BALANCE_CONFIG.necromancer.balance.soulMarkRounds);
    }
    gameState.tiles.forEach(tile => {
        if (!tile.unit) return;
        const u = tile.unit;

        // 击杀士气上升到期 → 恢复正常（全局处理）；moraleBoostUntil 为回合数(0-indexed)
        if (u.morale === 3 && u.moraleBoostUntil <= getRoundIndex(gameState)) {
            u.morale = 2; // setter 自动 triggerCommanderOnMoraleChange
            spawnMoraleEffect(u);
        }

        // 谋士攻心的士气下降/混乱到期 → 恢复正常（全局处理）
        if (u.moralePenaltyUntil > 0 && u.moralePenaltyUntil <= getRoundIndex(gameState)) {
            if (u.morale < 2) {
                u.morale = 2;
                spawnMoraleEffect(u);
            }
            u.moralePenaltyUntil = 0;
        }

        // 牧师治愈灵光 — 全局，不区分阵营
        if (u._healingAura > 0) {
            u.heal(Math.round(u.maxHp * COMMANDER_BALANCE_CONFIG.priest.balance.auraHealPct));
            u._healingAura--;
        }

        // 雨天：守城单位每回合回复15%最大生命值
        if (isMechanicEnabled(gameState, 'weatherEffects') && gameState.weather === 'rain' && u.tile.isCity) {
            u.heal(Math.round(u.maxHp * COMBAT_BALANCE.weather.rainCityHealPct));
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
        if (Array.isArray(u._campaignEffects) && u._campaignEffects.length > 0) {
            const previousSpeed = u.getEffectiveSpeed?.() ?? u.remainingMP;
            u._campaignEffects = u._campaignEffects
                .map(effect => effect.duration > 0 ? { ...effect, duration: effect.duration - 1 } : effect)
                .filter(effect => effect.duration == null || effect.duration > 0);
            u.refreshCampaignEffectState?.();
            const nextSpeed = u.getEffectiveSpeed?.() ?? previousSpeed;
            u.remainingMP = Math.max(0, u.remainingMP + nextSpeed - previousSpeed);
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
    let income = _campKey(camp) === 'neutral' ? Math.floor(calcIncome(cityCount) / 2) : calcIncome(cityCount);
    const isCampaignAi = gameState.campaignMode && gameState.factions?.[key]?.controller === 'ai';
    if (isCampaignAi || (gameState.gameMode === 'pve' && camp === gameState.aiOpponentCamp)) {
        income = Math.floor(income * gameState.aiDifficulty);
    }
    gameState.playerGold[key] += income;

    // 洗牌换将代价已直接在选将阶段计提（初始资金 $4→$1），此处不再重复扣减

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
    for (const [vk, v] of gameState.villageTiles) {
        const vTile = gameState.tileMap.get(vk);
        if (!vTile) continue;
        let beneficiaryCamp;
        if (vTile.unit) {
            beneficiaryCamp = vTile.unit.camp;
        } else {
            const cityTile = gameState.tiles.find(t => t.isCity && t.districtId === v.districtId);
            beneficiaryCamp = cityTile ? cityTile.camp : campFromKey('neutral', gameState);
        }
        if (beneficiaryCamp !== camp) continue;
        gameState.playerGold[_campKey(beneficiaryCamp)] += VILLAGE_GOLD;
        gameState.goldTexts.push({
            x: vTile.x, y: vTile.y,
            value: VILLAGE_GOLD, prefix: '+', color: '#ffcc00',
            timeLeft: 1800, lastUpdate: performance.now()
        });
        spawnCoinRain(vTile.x, vTile.y, 1);
    }

    const engineerResults = completeEngineerBunkerConstructions(gameState, camp, { Unit, logMessage });
    for (const result of engineerResults) {
        if (!result.ok || !result.targetTile) continue;
        spawnRecruitEffect(result.targetTile.x, result.targetTile.y);
        triggerRecruitFlash(result.targetTile.x, result.targetTile.y);
        spawnCommanderSkillEffect(result.targetTile.x, result.targetTile.y, '🏰', '碉堡完工');
    }
    for (const tile of gameState.tiles) {
        const unit = tile.unit;
        if (unit?.camp === camp && unit._constructionScaffold?.type === 'bunker') {
            const scaffold = unit._constructionScaffold;
            if (!Number.isFinite(scaffold.readyRound)) {
                // 旧快照在本次回合开始本应先减 1，因此 remaining=1 需立即完工。
                scaffold.readyRound = getRoundIndex(gameState) + Math.max(0, (scaffold.turnsRemaining || 0) - 1);
            }
            if (scaffold.readyRound <= getRoundIndex(gameState)) {
                unit._constructionScaffold = null;
                unit.canAct = false;
                spawnRecruitEffect(tile.x, tile.y);
                spawnCommanderSkillEffect(tile.x, tile.y, '🏰', '碉堡完工');
            }
        }
        if (unit?.camp === camp && unit.commander === 'engineer' && !Number.isFinite(unit._engineerFieldRepairReadyRound)) {
            unit._engineerFieldRepairReadyRound = getRoundIndex(gameState) + Math.max(0, unit._fieldRepairCooldown || 0);
            unit._fieldRepairCooldown = 0;
        }
        const installation = tile.installation;
        if (!tile.isCity || tile.camp !== camp || installation?.type !== 'airfield') continue;
        installation.campKey = _campKey(camp);
        installation.airCommandUsedThisTurn = false;
        // 新模型以绝对 readyRound 判定；仅把旧倒计时快照一次性迁移为绝对回合。
        for (const key of Object.keys(installation.cooldowns || {})) {
            const remaining = Math.max(0, installation.cooldowns[key] || 0);
            if (remaining > 0 && !Number.isFinite(installation.airCommandReadyRound?.[key])) {
                installation.airCommandReadyRound ||= {};
                installation.airCommandReadyRound[key] = getRoundIndex(gameState) + remaining;
            }
            installation.cooldowns[key] = 0;
        }
        if (installation.status === 'constructing') {
            if (!Number.isFinite(installation.constructionReadyRound)) {
                installation.constructionReadyRound = getRoundIndex(gameState)
                    + Math.max(0, (installation.turnsRemaining || 0) - 1);
            }
            if (installation.constructionReadyRound <= getRoundIndex(gameState)) {
                installation.status = 'ready';
                installation.turnsRemaining = 0;
                spawnCommanderSkillEffect(tile.x, tile.y, '🛫', '机场完工');
            }
        }
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

/** 在所属阵营回合开始时按快照结算毒素；新感染单位不会在本次继续传播。
 *  每个单位每回合只处理一次，传播仅限相邻地块不分阵营，避免二次传染。 */
export function resolvePoisonAtTurnStart(camp) {
    const poisonBalance = TACTICAL_CARD_CONFIG.poison.balance;
    const snapshot = gameState.tiles
        .map(tile => tile.unit)
        .filter(unit => unit?.camp === camp && unit._poison && unit.hp > 0);
    const newlyInfected = [];
    const processedIds = new Set();
    for (const unit of snapshot) {
        if (!unit.tile || processedIds.has(unit.id)) continue;
        if (unit._poison?.lastResolvedTurnCounter === gameState.turnCounter) continue;
        processedIds.add(unit.id);
        const poison = unit._poison;
        poison.lastResolvedTurnCounter = gameState.turnCounter;
        const originTile = unit.tile;
        const damage = Math.max(1, Math.round(unit.maxHp * poisonBalance.damageMaxHpPct));
        const killed = unit.applyDamage(damage, { source: 'true', attacker: null });
        gameState.damageTexts.push({
            x: originTile.x, y: originTile.y, value: damage, isCrit: false, isPoison: true,
            timeLeft: 1000, lastUpdate: performance.now()
        });
        spawnCommanderSkillEffect(originTile.x, originTile.y, '☣️', '毒发');
        logMessage(`☣️ ${unit.camp.name}${unit.config.name}毒发，流失${damage}生命`);
        if (!killed && originTile.unit === unit) {
            for (const [dq, dr] of HEX_NEIGHBORS) {
                const target = gameState.tileMap.get(`${originTile.q + dq},${originTile.r + dr}`)?.unit;
                if (!target || target.hp <= 0) continue;
                // 不分阵营传播给相邻的未中毒单位，且同一回合不会二次感染
                if (target._poison) continue;
                target._poison = {
                    remainingTicks: poisonBalance.ticks,
                    sourceCampKey: poison.sourceCampKey,
                    infectedAtTurnCounter: gameState.turnCounter,
                    lastResolvedTurnCounter: null
                };
                newlyInfected.push({ from: originTile, to: target.tile });
            }
            poison.remainingTicks -= 1;
            if (poison.remainingTicks <= 0) unit._poison = null;
        }
    }
    for (const spread of newlyInfected) {
        spawnDirectionalParticles(spread.from.x, spread.from.y, spread.to.x, spread.to.y, '#8fd14f', 8);
        spawnCommanderSkillEffect(spread.to.x, spread.to.y, '☣️', '感染');
    }
    return { resolved: snapshot.length, infected: newlyInfected.length };
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
            tile.unit.canAct = tile.unit._campaignCanAct !== false
                && (!isMechanicEnabled(gameState, 'morale') || tile.unit.morale !== 0);
            // 工程师脚手架：建造中始终不能行动（既不能攻击也不能移动）
            if (tile.unit._engineerScaffold || tile.unit._constructionScaffold) tile.unit.canAct = false;
            if (tile.unit._imprisoned) {
                tile.unit.canAct = false;
            }
            // mgNest: disable if no enemies in range
            if (tile.unit._isImmobile && tile.unit.canAct) {
                const atk = getAttackableTiles(tile.unit);
                if (atk.length === 0) tile.unit.canAct = false;
            }
            tile.unit.movedThisTurn = false;
            tile.unit.moveDistance = 0;
            tile.unit.counterAttackCount = 0;
            tile.unit._timesAttackedThisTurn = 0;
            tile.unit._specializationAttackSpent = false;
            tile.unit._transportTransitionedThisTurn = false;
            tile.unit.remainingMP = tile.unit.getEffectiveSpeed?.() ?? tile.unit.config.speed;
            if (tile.unit._imprisoned) tile.unit.remainingMP = 0;
            tile.unit.displaySpeed = tile.unit.remainingMP;
            tile.unit.isNewRecruit = false;
            // 百夫长标记重置
            tile.unit._centurionTriggered = false;
            // 圣骑士至圣斩蓄力跨回合清除并返还誓言
            if (tile.unit.commander === 'paladin' && tile.unit._smiteReady) {
                const refund = tile.unit._smiteCharged ? 2 : 1;
                tile.unit._faith = Math.min(COMMANDER_BALANCE_CONFIG.paladin.balance.faithMax, tile.unit._faith + refund);
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
    emit('turn:ended', { camp, campKey: _campKey(camp), turnCounter: gameState.turnCounter });

    // Turn toggle（三人模式自动跳过已投降阵营）
    gameState.currentCamp = _nextActiveCamp(camp);
    gameState.turnCounter++;

    // A submarine that attacked stays exposed through every enemy action and
    // submerges again only when its own next turn begins.
    for (const tile of gameState.tiles) {
        if (tile.unit?.type === 'submarine' && tile.unit.camp === gameState.currentCamp) {
            tile.unit._submarineAttackExposed = false;
        }
    }
    clearExpiredSubmarineReveals(gameState);

    // ==== 回合开始：收入结算 ====================
    // 毒素先于收入与所有回合开始治疗结算。
    const dmgTextsBefore = gameState.damageTexts.length;
    resolvePoisonAtTurnStart(gameState.currentCamp);
    grantTurnStartIncome(gameState.currentCamp);
    for (const repair of repairShipsAtTurnStart(gameState, gameState.currentCamp)) {
        gameState.healTexts.push({
            x: repair.tile.x, y: repair.tile.y, value: repair.amount,
            timeLeft: 1000, lastUpdate: performance.now()
        });
        spawnHealParticles(repair.tile.x, repair.tile.y);
        logMessage(`${repair.unit.camp.name}${repair.unit.config.name}在港口维修 +${repair.amount}HP`);
    }
    for (const tile of gameState.tiles) {
        const unit = tile.unit;
        if (!unit || unit.camp !== gameState.currentCamp || !tile.isCity || unit.hp >= unit.maxHp) continue;
        const cityRegen = unit.getSpecializationAbility?.('cityRegen') || 0;
        if (cityRegen <= 0) continue;
        const amount = unit.heal(Math.round(unit.maxHp * cityRegen));
        if (amount > 0) logMessage(`${unit.camp.name}${unit.config.name}固守城市恢复${amount}HP`);
    }
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
    const isRoundAnchor = _campKey(gameState.currentCamp) === (gameState.turnOrder?.[0] || gameState.localPlayerCampKey);
    if (isRoundAnchor) {
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
            const cardRecipients = (gameState.turnOrder || []).filter(key => key !== 'neutral');
            for (const key of cardRecipients) {
                const h = gameState.playerHands[key];
                // E3 纵横家合纵：手牌上限覆盖
                const hBonus = _getActiveDiplomatOverride(key)?.handSizeBonus || 0;
                if (!h || h.length >= CARD_SYSTEM_CONFIG.maxHandSize + hBonus) continue;
                if (gameState.cardDrawPile.length === 0) break;
                const card = gameState.cardDrawPile.pop();
                h.push(card);
                const cfg = TACTICAL_CARD_CONFIG[card];
                logMessage(`${gameState.factions?.[key]?.name || key}获得免费对策卡【${cfg?.name || card}】`);
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
    emit('turn:started', { camp: gameState.currentCamp, campKey: _campKey(gameState.currentCamp), turnCounter: gameState.turnCounter });
    updateButtonColors();
    if (gameState.cardTargeting) { gameState.cardTargeting = null; hideTargetingBanner(); }
    clearselection();
    broadcastAction('endTurn', {
        cmdFxList: _endTurnCmdFxList.length > 0 ? _endTurnCmdFxList : null,
        dmgTexts: (_endTurnDmgTexts && _endTurnDmgTexts.length > 0) ? _endTurnDmgTexts : null,
        healingChains: _healingChainDatas.length > 0 ? _healingChainDatas : null
    });
}

export async function endTurn(options = {}) {
    if (gameState.gameOver || _turnProcessing) return;
    // 网络游戏中仅当前回合方可结束回合
    if (isNetworkGame() && !isMyTurn(gameState.currentCamp)) return;
    _turnProcessing = true;

    try {
        const currentFaction = gameState.factions?.[_campKey(gameState.currentCamp)];
        const isAITurn = _campKey(gameState.currentCamp) === 'neutral' ||
            (gameState.gameMode === 'pve' && gameState.currentCamp === gameState.aiOpponentCamp) ||
            (gameState.campaignMode && currentFaction?.controller !== 'human');
        const hasActionable = gameState.tiles.some(t =>
            t.unit && t.unit.camp === gameState.currentCamp && t.unit.canAct && !t.unit.isNewRecruit
        );
        if (hasActionable && !isAITurn && !options.skipConfirmation) {
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
            if (_campKey(nextCamp) !== 'neutral') {
                await _showTurnTransition(nextCamp);
            }
        }

        // 链式处理 AI 回合（对手 AI → 中立 AI），直到人类回合
        for (let i = 0; i < Math.max(3, (gameState.turnOrder?.length || 0) + 1); i++) {
            if (gameState.gameOver) break;

            const currentKey = _campKey(gameState.currentCamp);
            const currentFaction = gameState.factions?.[currentKey];
            const isAIOpponent = currentKey !== 'neutral' && !gameState.aiActing && (
                (gameState.gameMode === 'pve' && gameState.currentCamp === gameState.aiOpponentCamp)
                || (gameState.campaignMode && currentFaction?.controller === 'ai')
            );
            const isNeutral = currentKey === 'neutral' &&
                !gameState.aiActing && !_neutralAiLock;
            const isScripted = gameState.campaignMode && currentFaction?.controller === 'scripted';

            if (isAIOpponent) {
                // PVE 对手 AI（Grok 进攻型人格）
                gameState.aiActing = true;
                try {
                    const { processOpponentTurn } = await import('./ai.js');
                    await Promise.race([
                        processOpponentTurn(gameState.currentCamp),
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
                await _processNeutralTurn(isLocalSkirmish);

            } else if (isScripted) {
                await new Promise(resolve => setTimeout(resolve, 300));
                if (!gameState.gameOver) await _doEndTurnPhase();

            } else {
                break; // 人类回合
            }
        }
    } finally {
        _turnProcessing = false;
    }
}

/** 战役可由作者把任意 AI/剧情阵营排在回合队列首位；启动时完整处理该首回合。 */
export async function runCampaignOpeningTurn() {
    if (!gameState.campaignMode || gameState.gameOver || _turnProcessing) return;
    const faction = gameState.factions?.[_campKey(gameState.currentCamp)];
    if (!faction || faction.controller === 'human') return;

    if (faction.controller === 'ai') {
        gameState.aiActing = true;
        try {
            const { processOpponentTurn } = await import('./ai.js');
            await Promise.race([
                processOpponentTurn(gameState.currentCamp),
                new Promise((_, reject) => setTimeout(() => reject(new Error('AI_TIMEOUT')), 18000))
            ]);
        } catch (error) {
            logMessage(error?.message === 'AI_TIMEOUT' ? 'AI 对手超时，跳过回合' : 'AI 对手执行出错，跳过回合');
            console.warn('Campaign opening AI error:', error);
        } finally {
            gameState.aiActing = false;
        }
    } else {
        await new Promise(resolve => setTimeout(resolve, 300));
    }
    if (!gameState.gameOver) await endTurn({ skipConfirmation: true });
}

// 中立 AI 回合（Claude 防御型人格）：执行 AI 行动后推进回合。
// 调用方负责 _turnProcessing 互斥（endTurn 链 / resumeNeutralTurnIfNeeded）。
async function _processNeutralTurn(isLocalSkirmish) {
    const neutralCamp = campFromKey('neutral', gameState);
    const neutUnits = gameState.tiles.filter(t => t.unit && t.unit.camp === neutralCamp);
    const hasNeutralUnits = neutUnits.some(t => t.unit.canAct);
    const hasNeutralCities = gameState.tiles.some(t => t.isCity && t.camp === neutralCamp && !t.unit);
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
                logMessage('中立AI超时 强制结束回合');
            } else {
                logMessage('中立AI执行出错 跳过回合');
            }
            console.warn('Neutral AI error:', e);
        } finally {
            gameState.aiActing = false;
            _neutralAiLock = false;
            if (neutralOverlay) neutralOverlay.classList.remove('show');
        }
        notify('本轮行动完毕 即将进入下一轮', 'info');
        logMessage('本轮行动完毕 即将进入下一轮');
        await new Promise(r => setTimeout(r, 2500));
    }
    // 无论如何都要推进回合
    if (!gameState.gameOver) await _doEndTurnPhase();
}

// 本机是否为中立回合驱动方。本地模式恒为真；联机时中立 AI 没有自己的客户端，
// 由回合序上最后一名存活玩家的客户端代理执行（与服务器校验规则一致）。
function _isNeutralDriverClient() {
    if (!isNetworkGame()) return true;
    const surrenderedKeys = gameState.surrenderedCamps.map(_campKey);
    return getMyRole() === neutralDriverRole({
        turnOrder: gameState.turnOrder,
        roleAssignments: gameState.roleAssignments,
        surrenderedCampKeys: surrenderedKeys
    });
}

// 中立回合接管兜底：投降把回合直切中立、联机重连/状态同步后落在中立回合时调用。
// 正常结束回合的 AI 链在 endTurn 内部完成；此入口只在“无人驱动”时接手，
// 由 _turnProcessing / aiActing / _neutralAiLock 三重互斥防止与 endTurn 链并跑。
export async function resumeNeutralTurnIfNeeded() {
    if (gameState.gameOver || _turnProcessing) return;
    if (_campKey(gameState.currentCamp) !== 'neutral') return;
    if (gameState.aiActing || _neutralAiLock) return;
    if (!_isNeutralDriverClient()) return;
    _turnProcessing = true;
    try {
        await _processNeutralTurn(false);
    } finally {
        _turnProcessing = false;
    }
}

// ===== 招募 =====================
export function recruitUnit(type) {
    if (gameState.campaignMode && !isMechanicEnabled(gameState, 'recruitment')) { notify('本关尚未开放招募', 'info'); return; }
    if (gameState.gameOver) return;
    if (type === 'carrier') { notify('航母暂不开放港口招募', 'info'); return; }
    const config = UNIT_CONFIG[type];
    const currentPlayerKey = _campKey(gameState.currentCamp);

    if (!gameState.selectedCityTile) {
        notify('请先选中己方控制的空城市或港口', 'error');
        return;
    }
    const selectedCityTile = gameState.selectedCityTile;
    if (selectedCityTile.camp !== gameState.currentCamp) {
        notify('该地块不属于当前阵营 无法招募', 'error');
        return;
    }
    const navalRecruit = isRegularNavalUnit(type);
    const shoreBatteryRecruit = type === 'shoreBattery';
    const validRecruitSite = navalRecruit
        ? selectedCityTile.isPort && isWaterTile(selectedCityTile)
            && isPortOperationalFor(selectedCityTile, gameState.currentCamp, gameState)
        : shoreBatteryRecruit
            ? isCoastalLandTile(selectedCityTile, gameState)
                && !selectedCityTile.isCity && !selectedCityTile.isVillage
                && !selectedCityTile.isPort && !selectedCityTile.fortification
                && canBuildShoreBattery(gameState, gameState.currentCamp)
            : selectedCityTile.isCity;
    if (!validRecruitSite) {
        notify(navalRecruit
            ? '舰船只能在已启用的己方港口招募'
            : shoreBatteryRecruit
                ? '岸防炮只能部署在己方空沿海陆地，且建造冷却必须结束'
                : '陆军只能在城市招募', 'error');
        return;
    }
    if (!canUnitOccupyTile({ type, config }, selectedCityTile, gameState)) {
        notify(navalRecruit ? '舰船只能在港口招募' : '该兵种无法部署在此地形', 'error');
        return;
    }
    if (selectedCityTile.isCity && selectedCityTile._cityDisabledUntil > 0 && selectedCityTile._cityDisabledUntil > getRoundIndex(gameState)) {
        notify('该城市遭到空袭 无法招募', 'error');
        return;
    }
    if (selectedCityTile.unit) {
        notify('该地块已有单位驻守', 'error');
        return;
    }
    let effectiveCost = getCommanderRecruitCost(config.cost, gameState, gameState.currentCamp);
    if (gameState.playerGold[currentPlayerKey] < effectiveCost) {
        notify('资金不足', 'error');
        return;
    }

    gameState.playerGold[currentPlayerKey] -= effectiveCost;
    new Unit(type, gameState.currentCamp, selectedCityTile, true);
    if (shoreBatteryRecruit) recordShoreBatteryBuilt(gameState, gameState.currentCamp);
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
    broadcastAction('recruit', { type, x: selectedCityTile.x, y: selectedCityTile.y, q: selectedCityTile.q, r: selectedCityTile.r });
}

// ===== E5 补员系统 =====================

export function reinforceUnit(unit) {
    if (gameState.campaignMode && !isMechanicEnabled(gameState, 'reinforcement')) { notify('本关尚未开放补员', 'info'); return; }
    if (!unit || !unit.tile || unit.hp >= unit.maxHp) return;
    const tile = unit.tile;
    if (!tile.isCity && !tile.isVillage) { notify('需在城市或村庄上补员', 'error'); return; }
    if (unit.camp !== gameState.currentCamp) { notify('只能为己方单位补员', 'error'); return; }
    // 城市占领会翻转归属，需属于当前阵营；村庄站上去即算占据，按占据单位归属判定（与村庄收入结算一致）
    if (tile.isCity && tile.camp !== gameState.currentCamp) { notify('该地块不属于当前阵营', 'error'); return; }
    if (tile._reinforcedThisTurn) { notify('该地块本回合已补员', 'error'); return; }
    // aiActing：联机中立回合由驱动方客户端代理 AI 补员，需绕过“非本方回合”拦截；人类点击不受影响
    if (isNetworkGame() && !gameState.aiActing && !isMyTurn(gameState.currentCamp)) { notify('对手回合', 'error'); return; }

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

// Check if a tile is in enemy Zone of Control (adjacent to a unit that can
// actually threaten this movement surface).
function _isInEnemyZoC(tile, friendlyCamp, movingUnit = null, ignoreHiddenEnemies = false) {
    const map = gameState.tileMap;
    for (const [dq, dr] of HEX_NEIGHBORS) {
        const neighbor = map.get(`${tile.q + dq},${tile.r + dr}`);
        const enemy = neighbor?.unit;
        if (!enemy || !canAttack(gameState, enemy.camp, friendlyCamp)) continue;
        if (ignoreHiddenEnemies
            && getPresentedTileVisibilityState(neighbor, friendlyCamp, gameState) !== 'visible') continue;
        if (!movingUnit
            || classifyAttackPresentation(enemy) !== ATTACK_PRESENTATION.ASSAULT
            || canUnitOccupyTile(enemy, tile, gameState)) return true;
    }
    return false;
}

// BFS pathfinding. The fog-safe presentation pass ignores information supplied
// only by unseen units so the range silhouette cannot disclose an ambush.
function _computeMovableTiles(unit, fogSafePreview = false) {
    // 无人机：实时检查信号范围，同步士气状态（不刷新其他无人机）
    if (unit._isDrone) {
        const inSignal = isDroneInSignal(gameState, unit);
        if (!fogSafePreview) unit.morale = inSignal ? 2 : 0;
        if (!inSignal) return { tiles: [], parents: new Map() };
    }
    if (unit.morale === 0 || unit._imprisoned || unit._isImmobile || isPortGuarded(unit, gameState)) {
        return { tiles: [], parents: new Map() };
    }

    const speed = unit.remainingMP;
    const startTile = unit.tile;
    const friendlyCamp = unit.camp;
    const map = gameState.tileMap;
    if (!startTile || !canUnitOccupyTile(unit, startTile, gameState)) {
        return { tiles: [], parents: new Map() };
    }

    // BFS queue: [tile, remainingMP, cameFromZoC]
    const startInZoC = _isInEnemyZoC(startTile, friendlyCamp, unit, fogSafePreview);
    const queue = [{ tile: startTile, remaining: speed, fromZoC: startInZoC }];
    const visited = new Map();
    visited.set(startTile, { remaining: speed, fromZoC: startInZoC, parent: null });
    const result = [];

    let head = 0;
    while (head < queue.length) {
        const { tile: cur, remaining: curRem, fromZoC: curFromZoC } = queue[head++];
        if (cur !== startTile) result.push(cur);

        for (const [dq, dr] of HEX_NEIGHBORS) {
            const neighbor = map.get(`${cur.q + dq},${cur.r + dr}`);
            if (!neighbor) continue;
            if (unit._specializationAttackSpent && neighbor.isCity) continue;
            if (neighbor.unit
                && (!fogSafePreview
                    || getPresentedTileVisibilityState(neighbor, friendlyCamp, gameState) === 'visible')) continue;
            if (unit._isDrone && !isTileInDroneSignal(gameState, unit.camp, neighbor)) continue;

            let stepCost = unit._isDrone ? 2 : (TERRAIN_CONFIG[neighbor.terrain]?.stepCost ?? 1);
            const movementStep = resolveMovementStep(unit, cur, neighbor, gameState, { baseCost: stepCost });
            if (!movementStep.allowed) continue;
            stepCost = movementStep.cost;
            // 雨天泥泞：骑兵步耗+1，末步豁免失效
            const _isMuddyTarget = isMechanicEnabled(gameState, 'weatherEffects') && gameState.weather === "rain" && unit.type === "cavalry"
                && !getCommanderWeatherImmunity(neighbor, friendlyCamp, gameState.tileMap);
            if (_isMuddyTarget) stepCost += 1;
            // 星移减益区：处于敌方占星者3格内的敌对方额外+1（此处用于敌方 AI 移动计算）
            if (_isMuddyTarget && !fogSafePreview && getCommanderWeatherDebuff(neighbor, friendlyCamp, gameState)) stepCost += 1;
            // 停滞者【缚足】：每层行动消耗+2
            const snareLayers = fogSafePreview ? 0 : _getStallerSnareLayers(neighbor, friendlyCamp);
            if (snareLayers > 0) stepCost += snareLayers * 2;
            if (curRem < 1) continue;
            // 末步豁免失效：泥泞/缚足下若行动力不足全额支付则无法到达
            if ((movementStep.requiresFullCost || _isMuddyTarget || snareLayers > 0)
                && curRem < stepCost) continue;
            let newRem = curRem >= stepCost ? curRem - stepCost : 0;
            if (Number.isFinite(movementStep.transportSpeedCap)) {
                newRem = Math.min(newRem, movementStep.transportSpeedCap);
            }
            // 渡河（无桥梁/浅滩）消耗所有剩余行动力
            if (movementStep.drainRemaining) newRem = 0;

            // Zone of Control: entering a ZoC tile costs all remaining MP (must stop)
            const neighborInZoC = _isInEnemyZoC(neighbor, friendlyCamp, unit, fogSafePreview);
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

    return { tiles: result, parents: visited };
}

export function getFogSafeMovableTiles(unit) {
    return _computeMovableTiles(unit, true).tiles;
}

export function getMovableTiles(unit) {
    const exact = _computeMovableTiles(unit, false);
    gameState.moveParents = exact.parents;
    if (gameState.skirmishFog && unit?.id != null) {
        gameState._fogSafeMovablePreview = {
            unitId: unit.id,
            tiles: getFogSafeMovableTiles(unit)
        };
    } else {
        gameState._fogSafeMovablePreview = null;
    }
    return exact.tiles;
}

export function getAttackableTiles(unit) {
    // 无人机：实时检查信号范围，同步士气状态（不刷新其他无人机）
    if (unit._isDrone) {
        unit.morale = isDroneInSignal(gameState, unit) ? 2 : 0;
        if (unit.morale === 0) return [];
    }
    if (unit.morale === 0 || unit._constructionScaffold || unit._engineerScaffold) return [];
    if (unit._transportTransitionedThisTurn) return [];
    if (unit.commander === 'martyr' && unit._martyrPrimed) return [];
    if (unit.type === 'carrier' && (!isMechanicEnabled(gameState, 'airCommands') || gameState.weather === 'fog')) return [];
    if (unit.getSpecializationAbility?.('cannotAttack') === true) return [];
    if (unit._specializationAttackSpent) return [];
    let range = unit.getEffectiveRange?.() ?? unit.config.range;
    // 无人机固定射程2
    if (unit._isDrone) range = DRONE_RANGE;
    // 雾天炮兵射程-1（占星者星光力场免疫）
    if (!unit.isEmbarked && isMechanicEnabled(gameState, 'weatherEffects') && gameState.weather === 'fog' && unit.type === 'archer'
        && !getCommanderWeatherImmunity(unit.tile, unit.camp, gameState.tileMap)) {
        range = Math.min(range, 1);
    }
    if (!unit.isEmbarked && unit.type === 'archer'
        && isMechanicEnabled(gameState, 'weatherEffects') && gameState.weather === 'wind') {
        range += 1;
    }
    range = Math.max(1, Math.min(unit.type === 'carrier' ? 6 : 4, range));
    const startTile = unit.tile;
    const isRanged = classifyAttackPresentation(unit) !== ATTACK_PRESENTATION.ASSAULT;
    const surfaceLegal = isRanged || canUnitOccupyTile(unit, startTile, gameState);
    const targets = surfaceLegal ? gameState.tiles.filter(tile =>
        hexDistance(tile, startTile) <= range
        && tile.unit
        && canAttack(gameState, unit.camp, tile.unit.camp)
        && tile.unit._campaignTargetable !== false
        && canUnitTargetUnit(unit, tile.unit, gameState)
        && (isRanged || canUnitAssaultOccupiedTile(unit, tile))
    ) : [];
    // 遭遇战迷雾：只能攻击视野内的敌方单位
    if (gameState.skirmishFog && targets.length) {
        return targets.filter(tile => isTileVisible(tile, unit.camp, gameState));
    }
    return targets;
}

// ===== 移动+攻击预演（连招） =====================

/**
 * 假想单位站在 fromTile 上时的合法攻击目标。临时换位后复用
 * getAttackableTiles，保证射程加成（山地炮兵/天气）、上舰形态、
 * 阵营视野过滤等规则永不与真实攻击分叉。fromTile 必须为空地块。
 */
export function getAttackableTilesFrom(unit, fromTile) {
    if (!unit?.tile || !fromTile || fromTile.unit) return [];
    if (fromTile === unit.tile) return getAttackableTiles(unit);
    const realTile = unit.tile;
    const realEmbarked = unit.isEmbarked;
    unit.tile = fromTile;
    if (isEmbarkableLandUnit(unit)) unit.isEmbarked = isWaterTile(fromTile);
    try {
        return getAttackableTiles(unit);
    } finally {
        unit.tile = realTile;
        unit.isEmbarked = realEmbarked;
    }
}

// 路径 A→B 上是否发生了登陆（水→陆）。登陆后本回合禁止攻击，
// 与 moveUnit 设置 _transportTransitionedThisTurn 的判定保持一致。
function _pathDisembarks(parents, startTile, endTile) {
    let cursor = endTile;
    while (cursor && cursor !== startTile) {
        const parent = parents.get(cursor)?.parent || null;
        if (parent && isWaterTile(parent) && !isWaterTile(cursor)) return true;
        cursor = parent;
    }
    return false;
}

/**
 * 计算「先移动到 B、再攻击 C」的连招预演方案。
 * 只纳入从当前位置无法直接攻击的目标；目标可见性由 getAttackableTiles
 * 内部的阵营视野过滤保证（视野基于移动前的真实局面，不含移动后新开视野）。
 * 每个目标绑定行动力花费最小的落点，同费优先保持更远的攻击距离。
 * 依赖 gameState.movableTiles / moveParents / attackableTiles 已按该单位刷新。
 */
export function computeChainAttackPlans(unit) {
    const empty = { tiles: [], plans: new Map() };
    if (!unit?.tile || !unit.canAct || unit.isNewRecruit) return empty;
    // 无人机的攻击合法性依赖信号区并伴随士气副作用，不做假想位评估
    if (unit._isDrone) return empty;
    if (unit._campaignCanAttack === false || unit._campaignCanMove === false) return empty;
    const movable = gameState.movableTiles;
    const parents = gameState.moveParents;
    if (!movable?.length || !(parents instanceof Map)) return empty;

    const directTargets = new Set(gameState.attackableTiles || []);
    const embarkable = isEmbarkableLandUnit(unit);
    const best = new Map(); // targetTile -> { via, cost, dist }
    for (const via of movable) {
        if (via.unit) continue;
        const entry = parents.get(via);
        if (!entry) continue;
        if (embarkable && _pathDisembarks(parents, unit.tile, via)) continue;
        const cost = unit.remainingMP - entry.remaining;
        for (const targetTile of getAttackableTilesFrom(unit, via)) {
            if (directTargets.has(targetTile)) continue;
            const dist = hexDistance(via, targetTile);
            const prev = best.get(targetTile);
            if (!prev || cost < prev.cost || (cost === prev.cost && dist > prev.dist)) {
                best.set(targetTile, { via, cost, dist });
            }
        }
    }
    const plans = new Map();
    for (const [targetTile, choice] of best) plans.set(targetTile, choice.via);
    return { tiles: [...plans.keys()], plans };
}

/** 刷新连招预演状态；传 null 清空。选中、部分移动、乘胜续动后调用。 */
export function refreshChainAttackPlans(unit) {
    const result = unit ? computeChainAttackPlans(unit) : { tiles: [], plans: new Map() };
    gameState.chainAttackTiles = result.tiles;
    gameState.chainAttackPlans = result.plans;
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
    const legalMoves = unit?.tile ? getMovableTiles(unit) : [];
    gameState.movableTiles = legalMoves;
    if (unit._campaignCanMove === false || unit.isNewRecruit || !unit.canAct || !legalMoves.includes(targetTile) || targetTile.unit
        || (unit._specializationAttackSpent && targetTile.isCity)) {
        notify('该单位本回合无法移动', 'error');
        return;
    }

    const fromX = unit.tile.x;
    const fromY = unit.tile.y;
    const fromQ = unit.tile.q;
    const fromR = unit.tile.r;

    // Reconstruct path for step-by-step animation
    const startTile = unit.tile;
    const path = _reconstructPath(gameState.moveParents, startTile, targetTile);
    let crossedSurface = false;
    let embarkedDuringMove = false;
    let disembarkedDuringMove = false;
    let cursor = targetTile;
    while (cursor && cursor !== startTile) {
        const parent = gameState.moveParents.get(cursor)?.parent || null;
        if (parent && isWaterTile(parent) !== isWaterTile(cursor)) {
            crossedSurface = true;
            if (!isWaterTile(parent) && isWaterTile(cursor)) embarkedDuringMove = true;
            if (isWaterTile(parent) && !isWaterTile(cursor)) disembarkedDuringMove = true;
        }
        cursor = parent;
    }
    const departureTile = unit.tile;
    unit.tile.unit = null;
    unit.tile = targetTile;
    targetTile.unit = unit;
    unit.movedThisTurn = true;
    unit.moveDistance += path.length - 1;
    unit.startMovePath?.(path);
    playSound('move');

    const mpEntry = gameState.moveParents.get(targetTile);
    if (mpEntry) unit.remainingMP = mpEntry.remaining;
    if (isEmbarkableLandUnit(unit)) {
        // Boarding only spends movement. Landing keeps the existing no-attack
        // transition lock for the remainder of the current round.
        if (disembarkedDuringMove) unit._transportTransitionedThisTurn = true;
        if (embarkedDuringMove) {
            unit._berserkerQixue = false;
            if (unit.commander === 'paladin' && unit._smiteReady) {
                const refund = unit._smiteCharged ? 2 : 1;
                unit._faith = Math.min(COMMANDER_BALANCE_CONFIG.paladin.balance.faithMax, (unit._faith || 0) + refund);
                unit._smiteReady = false;
                unit._smiteCharged = false;
                spawnPaladinOrbitBeams(unit.id, targetTile.x, targetTile.y, unit._faith);
            }
        }
        unit.isEmbarked = isWaterTile(targetTile);
        if (!unit.isEmbarked && unit.commander === 'fallenAngel') {
            unit._fallen = COMMANDER_BALANCE_CONFIG.fallenAngel.balance.blackMoraleLevels.includes(unit.morale);
        }
    }
    clearPortDepartureState(unit, departureTile, targetTile);
    if (unit._isDrone || unit.commander === 'tianyan') refreshDroneSignal(gameState, unit.camp);

    // Simulation vision updates immediately so combat legality/network state
    // stay deterministic. Presentation keeps the old fog until the badge has
    // physically reached its destination, revealing terrain and occupants in
    // one coherent transition instead of flashing an empty tile first.
    if (gameState.skirmishFog) {
        const moveAnimationEndsAt = (unit.movePathStart || performance.now())
            + (unit.movePathDuration || 0);
        beginFogPresentationHold(
            gameState,
            unit.camp,
            Math.max(0, moveAnimationEndsAt - performance.now())
        );
        _updateSkirmishFogAll();
    }

    gameState.movableTiles = [];
    gameState.attackableTiles = getAttackableTiles(unit);

    if (unit.remainingMP > 0) {
        gameState.movableTiles = getMovableTiles(unit);
        gameState.selectionTime = performance.now();
    } else if (gameState.attackableTiles.length === 0) {
        unit.canAct = false;
        clearselection();
    }
    if (unit._isDrone && unit.morale === 0) {
        gameState.movableTiles = [];
        gameState.attackableTiles = [];
        clearselection();
        notify('天眼哨机超出信号范围', 'warn');
    }

    // 地雷触发（特效对所有玩家广播）
    let _mineTrigger = null;
    if (targetTile._minePlanted) {
        const mineCampKey = targetTile._mineCampKey;
        const unitCampKey = _campKey(unit.camp);
        if (mineCampKey !== unitCampKey) {
            const terrainDefense = unit.isEmbarked
                ? getTransportBaseDefense(unit)
                : (TERRAIN_CONFIG[targetTile.terrain]?.defenseBonus || 0);
            const moraleDefense = isMechanicEnabled(gameState, 'morale')
                ? (MORALE_CONFIG[unit.morale]?.defBonus || 0)
                : 0;
            const totalDefense = terrainDefense
                + (unit.config.defense || 0)
                + (unit._rankPanelDefenseBonus || 0)
                + moraleDefense
                + getCommanderDefenseBonus(unit)
                + getCommanderAuraDefenseBonus(unit)
                + (unit.getCampaignDefenseBonus?.() || 0);
            const multiplier = Math.max(
                COMBAT_BALANCE.defense.minimumMultiplier,
                1 - Math.min(COMBAT_BALANCE.defense.maximumReduction, totalDefense)
            );
            const rawMineDmg = Math.round(100 * multiplier);
            const oldHp = unit.hp;
            unit.applyDamage(rawMineDmg, { source: 'effect', attacker: null, skipAura: true });
            const mineDmg = Math.max(0, oldHp - unit.hp);
            gameState.damageTexts.push({
                x: targetTile.x, y: targetTile.y, value: mineDmg, isCrit: true,
                timeLeft: 900, lastUpdate: performance.now()
            });
            spawnDirectionalParticles(targetTile.x, targetTile.y + 10, targetTile.x, targetTile.y - 50, '#ff4400', 20);
            spawnDirectionalParticles(targetTile.x, targetTile.y + 10, targetTile.x, targetTile.y - 50, '#ffaa00', 12);
            spawnExplosionParticles(targetTile.x, targetTile.y, '#664400', 8);
            triggerScreenShake(6, 250);
            playSound('attack');
            const mineName = targetTile._mineType === 'water' ? '水雷' : '地雷';
            logMessage(`💣 ${mineName}触发！${unit.camp.name}${unit.config.name}兵受到${mineDmg}伤害`);
            _mineTrigger = { x: targetTile.x, y: targetTile.y, dmg: mineDmg, mineType: targetTile._mineType || 'land' };
            targetTile._minePlanted = false;
            targetTile._mineCampKey = null;
            targetTile._mineType = null;
        }
    }

    if (targetTile.isCity && !unit._isDrone) {
        unit.remainingMP = 0; // entering city ends movement
        if (targetTile.camp !== unit.camp) {
            updateDistrictColor(targetTile, unit.camp, unit);
            _capturedCityOnMove = { q: targetTile.q, r: targetTile.r, campKey: _campKey(unit.camp) };
        }
    }
    if (targetTile.isPort && !unit._isDrone && capturePort(gameState, targetTile, unit)) {
        gameState.movableTiles = [];
        gameState.attackableTiles = getAttackableTiles(unit);
        logMessage(`${unit.camp.name}占领了港口(${targetTile.q},${targetTile.r})`);
    }
    // 部分移动后仍可行动：以新位置重算连招预演（AI/远端回合 selectedUnit 为空则清空）
    refreshChainAttackPlans(gameState.selectedUnit === unit && unit.canAct ? unit : null);
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
    broadcastAction('move', { unitId: unit.id, fromX, fromY, q: targetTile.q, r: targetTile.r, path, cmdFx: _cmdFxForMove, rankUps: rankUpsMove.length ? rankUpsMove : null, mineTrigger: _mineTrigger, capturedCity: _capturedCityOnMove });
    _capturedCityOnMove = null;
    emit('match:unitMoved', { unit, targetTile, fromX, fromY, fromQ, fromR });
}

// ===== 攻击 =====================
export function attackUnit(attackerUnit, targetUnit) {
    if (gameState.gameOver) return;
    if (attackerUnit.camp !== gameState.currentCamp) return;
    if (attackerUnit._campaignCanAttack === false || targetUnit._campaignTargetable === false) {
        notify('当前剧情状态不允许攻击该目标', 'error');
        return;
    }
    if (!canAttack(gameState, attackerUnit.camp, targetUnit.camp)) {
        notify('不能攻击自身或盟军单位', 'error');
        return;
    }
    if (attackerUnit._isDrone) refreshDroneSignal(gameState, attackerUnit.camp);
    const legalTargets = attackerUnit?.tile ? getAttackableTiles(attackerUnit) : [];
    gameState.attackableTiles = legalTargets;
    if (!attackerUnit.canAct || !legalTargets.includes(targetUnit.tile)) {
        notify('无法攻击：超出射程或单位已行动', 'error');
        return;
    }
    if (attackerUnit.type === 'submarine') {
        attackerUnit._submarineChargedAttack = attackerUnit._rank >= 1 && attackerUnit._submarineAttackExposed !== true;
        attackerUnit._submarineAttackExposed = true;
    }

    const fromX = attackerUnit.tile.x, fromY = attackerUnit.tile.y;
    const toX = targetUnit.tile.x, toY = targetUnit.tile.y;
    const primaryTargetTile = targetUnit.tile;
    const _hasSmite = attackerUnit.type !== 'carrier' && attackerUnit._smiteReady;
    const _smiteLabel = _hasSmite ? (attackerUnit._smiteCharged ? '至圣斩·誓约' : '至圣斩') : '';
    const qixueActive = attackerUnit.type !== 'carrier' && !areCommanderMechanicsSuppressed(attackerUnit)
        && attackerUnit.commander === 'berserker' && attackerUnit._berserkerQixue;
    const qixueAttackCamp = attackerUnit.camp;

    // 战役模式才允许攻击触发外交变更（标准对局外交关系固定）
    if (gameState.campaignMode) {
        const relationBeforeAttack = getRelation(gameState, attackerUnit.camp, targetUnit.camp);
        if (relationBeforeAttack === 'neutral') {
            const change = setRelation(gameState, attackerUnit.camp, targetUnit.camp, 'enemy');
            if (change) {
                clearselection();
                emit('match:diplomacyChanged', { ...change, reason: 'provokedByAttack' });
            }
        }
    }
    emit('match:combatStarted', {
        attackerId: attackerUnit.id, defenderId: targetUnit.id,
        attackerCamp: attackerUnit.camp, defenderCamp: targetUnit.camp
    });

    const _executeAttack = () => {
    const isCarrierStrafe = attackerUnit.type === 'carrier';

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
    attackerUnit._submarineChargedAttack = false;
    _attackDmg = attackResult.dmg; _attackIsCrit = attackResult.isCrit;
    if (attackResult.isCrit) attackerUnit.addXP(2);
    if (attackResult.dmg > 0) attackerUnit.addXP(1);
    if (isCarrierStrafe && attackerUnit.commander === 'colonel' && !areCommanderMechanicsSuppressed(attackerUnit)) {
        const carrierCampKey = _campKey(attackerUnit.camp);
        if (!gameState._colonelAirStacks) gameState._colonelAirStacks = {};
        gameState._colonelAirStacks[carrierCampKey] = Math.min(
            COLONEL_AIR_MAX_STACKS,
            (gameState._colonelAirStacks[carrierCampKey] || 0) + 1
        );
    }
    if (attackerUnit._smiteReady) {
        setTimeout(() => playSound('lightning'), 500);
    } else {
        const soundPresentation = classifyAttackPresentation(attackerUnit);
        // 鱼雷发射阶段保持安静，explosion 只在弹体抵达目标时播放。
        if (soundPresentation !== ATTACK_PRESENTATION.FIRE_TORPEDO) {
            playSound(soundPresentation === ATTACK_PRESENTATION.FIRE_AIR_STRAFE
                ? 'airstrike'
                : soundPresentation === ATTACK_PRESENTATION.FIRE_TRACER
                ? 'machinegun'
                : soundPresentation === ATTACK_PRESENTATION.FIRE_CANNON
                    ? 'cannon'
                    : (attackResult.isCrit ? 'crit' : 'attack'));
        }
    }
    const isCrit = attackResult.isCrit;

    // 核心状态修改：扣血、击杀判定（先于视觉效果，保证广播时状态正确）
    let isTargetDead = targetUnit.takeDamage(attackResult.dmg, attackerUnit);
    const specializationSplashResults = [];
    let extraSalvoResult = null;
    if (!isTargetDead && attackerUnit.specializationKey === 'fleetCruiser'
        && targetUnit.config?.movementDomain === 'naval' && !targetUnit.isEmbarked) {
        const chance = attackerUnit.getSpecializationAbility('extraSalvo') || 0;
        if (chance > 0 && gameState.rng.chance(chance)) {
            const damage = Math.max(1, Math.round(attackResult.dmg * 0.5));
            const killed = targetUnit.applyDamage(damage, { source: 'ranged', attacker: attackerUnit });
            extraSalvoResult = { q: targetUnit.tile.q, r: targetUnit.tile.r, damage, killed };
            isTargetDead ||= killed;
            gameState.damageTexts.push({
                x: toX, y: toY, value: damage, isCrit: false,
                timeLeft: 900, lastUpdate: performance.now()
            });
        }
    }
    const rocketSplash = attackerUnit.getSpecializationAbility('splash') || 0;
    const supportSplashChance = attackerUnit.getSpecializationAbility('shoreSplashChance') || 0;
    const supportSplashEligible = attackerUnit.specializationKey === 'supportCruiser'
        && (targetUnit.tile?.isCity || targetUnit.config?.building || targetUnit.tile?.fortification)
        && isLandTile(targetUnit.tile)
        && supportSplashChance > 0
        && gameState.rng.chance(supportSplashChance);
    const splashMultiplier = rocketSplash > 0 ? rocketSplash : supportSplashEligible ? 0.30 : 0;
    if (splashMultiplier > 0) {
        let remainingSplashDamage = Math.max(0, Math.round(attackResult.dmg));
        for (const [dq, dr] of HEX_NEIGHBORS) {
            if (remainingSplashDamage <= 0) break;
            const splashTile = gameState.tileMap.get(`${primaryTargetTile.q + dq},${primaryTargetTile.r + dr}`);
            const splashUnit = splashTile?.unit;
            if (!splashUnit || !canAttack(gameState, attackerUnit.camp, splashUnit.camp) || splashUnit.hp <= 0) continue;
            const resolved = attackerUnit._resolveDamage(
                attackerUnit, splashUnit, splashMultiplier, 0,
                false, false, false, 0, 0, true
            );
            const damage = Math.max(1, Math.min(remainingSplashDamage, Math.round(resolved.dmg)));
            const killed = splashUnit.applyDamage(damage, { source: 'ranged', attacker: attackerUnit });
            remainingSplashDamage -= damage;
            specializationSplashResults.push({
                q: splashTile.q, r: splashTile.r, x: splashTile.x, y: splashTile.y,
                damage, killed
            });
            gameState.damageTexts.push({
                x: splashTile.x, y: splashTile.y, value: damage, isCrit: false,
                timeLeft: 900, lastUpdate: performance.now()
            });
        }
    }
    const qixueSplashResults = [];
    if (qixueActive) {
        for (const [dq, dr] of HEX_NEIGHBORS) {
            const splashTile = gameState.tileMap.get(`${primaryTargetTile.q + dq},${primaryTargetTile.r + dr}`);
            const splashUnit = splashTile?.unit;
            if (!splashUnit || splashUnit.camp === qixueAttackCamp || splashUnit.hp <= 0) continue;
            const splashResult = attackerUnit._resolveDamage(attackerUnit, splashUnit, 0.40);
            const splashDmg = Math.round(splashResult.dmg);
            if (splashDmg <= 0) continue;
            const killed = splashUnit.applyDamage(splashDmg, { source: 'ranged', attacker: attackerUnit });
            qixueSplashResults.push({
                x: splashTile.x, y: splashTile.y, q: splashTile.q, r: splashTile.r,
                dmg: splashDmg, isCrit: splashResult.isCrit, killed
            });
            gameState.damageTexts.push({
                x: splashTile.x, y: splashTile.y, value: splashDmg, isCrit: splashResult.isCrit,
                timeLeft: 900, lastUpdate: performance.now()
            });
            logMessage(`狂战士【泣血】溅射对${splashUnit.camp.name}${splashUnit.config.name}兵造成${splashDmg}伤害`);
        }
        attackerUnit._berserkerQixue = false;
    }

    let atkCmdResult = null, ctrCmdResult = null;
    const attackPresentation = classifyAttackPresentation(attackerUnit);
    try {
        if (attackPresentation === ATTACK_PRESENTATION.FIRE_TORPEDO) {
            spawnTorpedo(fromX, fromY, toX, toY, isCrit);
        } else if (attackPresentation === ATTACK_PRESENTATION.FIRE_AIR_STRAFE) {
            spawnAirstrikeEffect(toX, toY, [{ q: targetUnit.tile.q, r: targetUnit.tile.r, dmg: attackResult.dmg }], 'diveStrafe', targetUnit.tile.q, targetUnit.tile.r);
            setTimeout(() => {
                playSound('machinegun');
                for (let i = 0; i < 12; i++) {
                    setTimeout(() => spawnStrafeTracer(fromX, fromY, toX, toY), i * 24);
                }
            }, 500);
        } else if (attackPresentation === ATTACK_PRESENTATION.FIRE_CANNON) {
            const impact = () => {
                triggerAttackFlash(toX, toY, isCrit);
                triggerRecoil(fromX, fromY, toX, toY);
                spawnDirectionalParticles(fromX, fromY, toX, toY, '#ff8844', isCrit ? 8 : 4);
                triggerScreenShake(isCrit ? 6 : 3, isCrit ? 200 : 120);
            };
            if (attackerUnit.type === 'warship') {
                spawnProjectile(fromX, fromY, toX, toY, isCrit);
                setTimeout(() => {
                    playSound('cannon');
                    spawnProjectile(fromX, fromY, toX, toY, isCrit, impact);
                }, 140);
            } else {
                spawnProjectile(fromX, fromY, toX, toY, isCrit, impact);
            }
        } else if (attackPresentation === ATTACK_PRESENTATION.FIRE_TRACER) {
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
        if (extraSalvoResult) {
            setTimeout(() => {
                playSound('cannon');
                spawnProjectile(fromX, fromY, toX, toY, false);
            }, 140);
        }
        for (const splash of specializationSplashResults) {
            spawnDirectionalParticles(toX, toY, splash.x, splash.y, '#ffb35c', 8);
            spawnExplosionParticles(splash.x, splash.y, '#ff8a3d', 8);
        }
        if (qixueActive) {
            spawnCommanderSkillEffect(fromX, fromY, '🩸', '泣血');
            spawnExplosionParticles(toX, toY, '#b71c1c', 24);
            spawnExplosionParticles(toX, toY, '#ff6b4a', 14);
            for (const splash of qixueSplashResults) {
                spawnDirectionalParticles(toX, toY, splash.x, splash.y, '#d63c3c', splash.isCrit ? 12 : 8);
                spawnExplosionParticles(splash.x, splash.y, '#b71c1c', splash.isCrit ? 16 : 10);
                spawnExplosionParticles(splash.x, splash.y, '#ff8a65', splash.isCrit ? 8 : 5);
            }
            if (qixueSplashResults.length > 0) playSound('explosion');
            triggerScreenShake(8, 260);
        }
        // 近战突进特效（击杀时由 movePath 处理位移，不重复触发；碉堡/无人机不可移动，无突进）
        if (attackPresentation === ATTACK_PRESENTATION.ASSAULT && !isTargetDead) {
            triggerCharge(attackerUnit.id, fromX, fromY, toX, toY);
        }
        logMessage(`${attackerUnit.camp.name}的${attackerUnit.config.name}兵攻击造成${Math.round(attackResult.dmg)}伤害${attackResult.isCrit ? '（强击）' : ''}`);

        // 将领攻击效果（吸血鬼嗜血、谋士攻心等）—— 视觉特效由 commander 钩子自行触发
        _atkCmdFxCapture = null;
        atkCmdResult = isCarrierStrafe
            ? null
            : triggerCommanderOnAttackEx(attackerUnit, targetUnit, attackResult.dmg, attackResult.isCrit, isTargetDead);
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
                // 真实伤害必须同步执行，否则 isTargetDead 无法正确阻止反击
                const smiteKilled = targetUnit.applyDamage(atkCmdResult.smiteDmg, { source: 'true', attacker: attackerUnit });
                targetUnit.displayHp = targetUnit.hp;
                if (smiteKilled) isTargetDead = true;
                _smiteDmgRemote = atkCmdResult.smiteDmg;
                setTimeout(() => {
                    gameState.damageTexts.push({
                        x: toX, y: toY, value: atkCmdResult.smiteDmg, isTrueDmg: true,
                        timeLeft: 1200, lastUpdate: performance.now()
                    });
                    triggerAttackFlash(toX, toY, true);
                    spawnCommanderSkillEffect(toX, toY, '✝️', smiteLabel, true);
                    triggerScreenShake(_hasSmite && smiteLabel === '至圣斩·誓约' ? 12 : 9, 400);
                }, smiteDelay + 200);
            }
        }
        _cmdFxData = _atkCmdFxCapture;

        const targetConverted = !!atkCmdResult?.converted;
        if (!isTargetDead && !targetConverted) {
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
                const counterPresentation = classifyAttackPresentation(targetUnit);
                _counterIsRanged = counterPresentation !== ATTACK_PRESENTATION.ASSAULT;
                if (_counterIsRanged) {
                    const _cfx = targetUnit.tile.x, _cfy = targetUnit.tile.y;
                    if (counterPresentation === ATTACK_PRESENTATION.FIRE_TORPEDO) {
                        spawnTorpedo(_cfx, _cfy, _counterX, _counterY, counterResult.isCrit);
                    } else if (counterPresentation === ATTACK_PRESENTATION.FIRE_TRACER) {
                        playSound('machinegun');
                        spawnDroneProjectile(_cfx, _cfy, _counterX, _counterY, counterResult.isCrit, () => {
                            triggerAttackFlash(_counterX, _counterY, counterResult.isCrit);
                            spawnDirectionalParticles(_cfx, _cfy, _counterX, _counterY, '#ff8844', counterResult.isCrit ? 8 : 4);
                            triggerScreenShake(counterResult.isCrit ? 6 : 3, counterResult.isCrit ? 200 : 120);
                        });
                    } else {
                        playSound('cannon');
                        const counterImpact = () => {
                            triggerAttackFlash(_counterX, _counterY, counterResult.isCrit);
                            triggerRecoil(_cfx, _cfy, _counterX, _counterY);
                            spawnDirectionalParticles(_cfx, _cfy, _counterX, _counterY, '#ff8844', counterResult.isCrit ? 8 : 4);
                            triggerScreenShake(counterResult.isCrit ? 6 : 3, counterResult.isCrit ? 200 : 120);
                        };
                        if (targetUnit.type === 'warship') {
                            spawnProjectile(_cfx, _cfy, _counterX, _counterY, counterResult.isCrit);
                            setTimeout(() => {
                                playSound('cannon');
                                spawnProjectile(_cfx, _cfy, _counterX, _counterY, counterResult.isCrit, counterImpact);
                            }, 140);
                        } else {
                            spawnProjectile(_cfx, _cfy, _counterX, _counterY, counterResult.isCrit, counterImpact);
                        }
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
                const canLightCavalryWithdraw = attackerUnit.specializationKey === 'lightCavalry' && attackerUnit.remainingMP > 0;
                attackerUnit.canAct = canLightCavalryWithdraw;
                if (canLightCavalryWithdraw) attackerUnit._specializationAttackSpent = true;
            }
        } else if (!isTargetDead) {
            // 攻心感化后的目标已改投同阵营，本次攻击不触发反击。
            attackerUnit.canAct = false;
        } else {
            const targetTile = targetUnit.tile;
            if (classifyAttackPresentation(attackerUnit) === ATTACK_PRESENTATION.ASSAULT
                && !attackerUnit._imprisoned && !attackerUnit._isImmobile
                && canUnitAssaultOccupiedTile(attackerUnit, targetTile)
                && canUnitOccupyTile(attackerUnit, targetTile, gameState)) {
                attackerUnit.tile.unit = null;
                attackerUnit.tile = targetTile;
                targetTile.unit = attackerUnit;
                attackerUnit.moveDistance++;
                attackerUnit.startMovePath?.([{ x: fromX, y: fromY }, { x: toX, y: toY }]);
                if (targetTile.isCity) { updateDistrictColor(targetTile, attackerUnit.camp, attackerUnit); _cityCapturedInAttack = true; }
                if (targetTile.isPort && capturePort(gameState, targetTile, attackerUnit)) {
                    logMessage(`${attackerUnit.camp.name}占领了港口(${targetTile.q},${targetTile.r})`);
                }
                if (targetTile.isCity && attackerUnit.commander === 'minister') {
                    spawnCommanderSkillEffect(targetTile.x, targetTile.y, '🎖️', '屯田');
                    _cmdFxExtra = { x: targetTile.x, y: targetTile.y, glyph: '🎖️', label: '屯田' };
                }
            }
            if (targetUnit.isCommanderUnit ?? Boolean(targetUnit.commander)) {
                // 空军上校阵亡 → 禁用对应玩家的空军卡
                if (targetUnit.commander === 'colonel') {
                    const defKey = _campKey(targetUnit.camp);
                    if (gameState._colonelDeployed) gameState._colonelDeployed[defKey] = false;
                }
                const killerKey = _campKey(attackerUnit.camp);
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
            const killResult = isCarrierStrafe ? null : triggerCommanderOnKill(attackerUnit, targetUnit);
            const specializationKillHeal = attackerUnit.getSpecializationAbility?.('killHeal') || 0;
            if (specializationKillHeal > 0) attackerUnit.heal(Math.round(attackerUnit.maxHp * specializationKillHeal));
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
            const bonusXp = (targetUnit.isCommanderUnit ?? Boolean(targetUnit.commander)) ? 10 : 0;
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
            refreshChainAttackPlans(gameState.selectedUnit === attackerUnit ? attackerUnit : null);
        } else {
            gameState.attackableTiles = [];
            refreshChainAttackPlans(null);
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
            counterType: targetUnit.type,
            counterIsDrone: !!targetUnit._isDrone,
            counterUsesDroneProjectile: !!(targetUnit._isDrone || targetUnit.type === 'mgNest'),
            healAmt: _healAmtRemote, healX: _healX, healY: _healY,
            smiteDmg: _smiteDmgRemote,
            goldenBeamDatas: _goldenBeamDatas.length ? _goldenBeamDatas : null,
            paladinProjectileDatas: _paladinProjectileDatas || null,
            smiteLabel: _smiteLabel || null,
            cmdFxExtra: _cmdFxExtra || null,
            rankUps: rankUps.length ? rankUps : null,
            bloodDrain: attackerUnit.type !== 'carrier' && attackerUnit.commander === 'vampire' ? {
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
            ctrMoraleFxUnitId: _ctrMoraleFxUnitId || null,
            specializationSplashResults: specializationSplashResults.length ? specializationSplashResults : null,
            extraSalvoResult,
            berserkerQixue: qixueActive,
            berserkerSplash: qixueSplashResults.length ? qixueSplashResults : null
        });
        emit('match:combatResolved', {
            attackerId: attackerUnit.id,
            defenderId: targetUnit.id,
            attackerCamp: attackerUnit.camp,
            defenderCamp: targetUnit.camp,
            damage: _attackDmg,
            counterDamage: _counterDmg,
            killedIds: isTargetDead ? [targetUnit.id] : []
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
    if (cityTile.installation) cityTile.installation.campKey = _campKey(camp);

    logMessage(`${camp.name}攻占了${oldCamp.name}的城市(${cityTile.q},${cityTile.r})`);

    const districtId = cityTile.districtId;
    gameState.tiles.forEach(tile => {
        if (tile.districtId === districtId) {
            if (tile.isPort && tile._portCapturedIndependent) return;
            tile.setCampWithFade(camp);
        }
    });

    const landTiles = gameState.tiles.filter(isLandTile);
    const landTileMap = new Map(landTiles.map(tile => [`${tile.q},${tile.r}`, tile]));
    gameState.campBorderEdges = computeCampBorders(landTiles, landTileMap);
    gameState.districtBorderEdges = computeDistrictBorders(landTiles, landTileMap);
    logMessage(`${camp.name}占领的(${cityTile.q},${cityTile.r})城市所属行政区已归属${camp.name}`);
    if (attackerUnit) attackerUnit.addXP(5);
    invalidateBoard();
    emit('match:cityCaptured', { cityTile, camp, campKey: _campKey(camp), attackerUnit });
    checkVictory();
}

// ===== 胜利检测 =====================
function checkVictory() {
    if (gameState.gameOver) return;
    // 战役由 ObjectiveManager/关卡控制器裁决，常规行政区歼灭不能提前截断剧情阶段。
    if (gameState.campaignMode) return;
    const playerKeys = getActivePlayerKeys(gameState);
    const districtMap = new Map(playerKeys.map(key => [key, new Set()]));
    for (const tile of gameState.tiles) districtMap.get(_campKey(tile.camp))?.add(tile.districtId);
    const neutral = campFromKey('neutral', gameState);

    if (playerKeys.length > 2) {
        for (const key of playerKeys) {
            const camp = campFromKey(key, gameState);
            if (districtMap.get(key).size !== 0 || hasFactionSurrendered(gameState, camp)) continue;
            gameState.surrenderedCamps.push(camp);
            restoreSurrenderedPorts(gameState, camp);
            let remainingUnits = 0;
            for (const tile of gameState.tiles) {
                if (tile.unit?.camp !== camp) continue;
                tile.unit.camp = neutral;
                remainingUnits++;
            }
            logMessage(`${camp.name}失去所有行政区，已被淘汰！剩余${remainingUnits}支部队移交中立AI`);
            notify(`${camp.name}已战败`, 'info');
        }
        const alive = getSurvivingPlayerKeys(gameState)
            .filter(key => districtMap.get(key)?.size > 0)
            .map(key => campFromKey(key, gameState));
        if (alive.length <= 1) {
            gameState.gameOver = true;
            gameState.victoryCamp = alive[0] || neutral;
            logMessage(`${gameState.victoryCamp.name}获得最终胜利`);
            setTimeout(() => triggerVictoryEffect(), 1500);
        }
        return;
    }

    const defeatedKey = playerKeys.find(key => districtMap.get(key).size === 0);
    if (!defeatedKey) return;
    const winnerKey = playerKeys.find(key => key !== defeatedKey);
    const defeated = campFromKey(defeatedKey, gameState);
    const winner = campFromKey(winnerKey, gameState);
    gameState.gameOver = true;
    gameState.victoryCamp = winner;
    logMessage(`${defeated.name}失去所有行政区，${winner.name}胜利`);
    if (!gameState._trainingMode) setTimeout(() => triggerVictoryEffect(), 1500);
}

// ===== 回合限制胜利检测 =====================
function checkTurnLimitVictory() {
    if (gameState.campaignMode) return;
    if (gameState.gameOver) return;

    const roundNum = getRound(gameState);
    const limitRound = gameState.isThreePlayer ? 26 : 19;
    if (roundNum < limitRound) return;

    // 统计各非中立阵营控制的城市数
    const cityCounts = {};
    for (const tile of gameState.tiles) {
        if (tile.isCity && _campKey(tile.camp) !== 'neutral') {
            const key = _campKey(tile.camp);
            cityCounts[key] = (cityCounts[key] || 0) + 1;
        }
    }

    const players = (gameState.turnOrder || []).filter(key => key !== 'neutral')
        .map(key => campFromKey(key, gameState))
        .filter(camp => !gameState.surrenderedCamps.includes(camp));

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
    const gameOverSub = document.getElementById('gameOverSub');
    const victoryFlag = document.getElementById('victoryFlagPreview');

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
    if (gameOverSub) gameOverSub.textContent = '对局结束';
    gameOverText.textContent = '游戏结束';
    if (vc === 'draw') {
        setResultFlagPreview(victoryFlag, null);
        victoryCampText.textContent = '平局';
        victoryCampText.style.color = '#e6c560';
        victoryCampText.style.textShadow = '0 0 24px rgba(230,197,96,0.55), 0 0 50px rgba(200,160,60,0.25)';
    } else {
        const winner = vc && typeof vc === 'object' ? vc : campFromKey(String(vc || 'neutral'), gameState);
        setResultFlagPreview(victoryFlag, winner);
        victoryCampText.textContent = `${winner?.name || '中立'}胜利`;
        victoryCampText.style.color = winner?.color || '#aaaaaa';
        victoryCampText.style.textShadow = `0 0 24px ${winner?.color || 'rgba(180,180,180,0.55)'}`;
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
        const fromEditor = gameState.campaignId === '__editor__';
        if (gameState.campaignMode) stopCampaignRuntime();
        gameState.gameOver = true;
        resetGameState();
        const gameWrapper = document.getElementById('gameWrapper');
        if (gameWrapper) gameWrapper.style.display = 'none';
        if (fromEditor) {
            // 编辑器测试 → 返回编辑器
            const editor = await import('../campaign/editor/editor.js');
            editor.reopenEditorAfterPlaytest();
        } else {
            const lobby = document.getElementById('lobbyOverlay');
            if (lobby) lobby.style.display = '';
            const lobbyHome = document.getElementById('lobbyHome');
            if (lobbyHome) lobbyHome.style.display = '';
            const multiplayerLobby = document.getElementById('multiplayerLobby');
            if (multiplayerLobby) multiplayerLobby.style.display = 'none';
            const roomWaiting = document.getElementById('roomWaiting');
            if (roomWaiting) roomWaiting.style.display = 'none';
            const lobbyReady = document.getElementById('lobbyReady');
            if (lobbyReady) lobbyReady.style.display = 'none';
        }
        return;
    }

    // 联机：根据角色判断投降方；本地热座：弹出阵营选择器
    const myRole = getMyRole();
    let surrenderCamp;
    if (isNetworkGame()) {
        surrenderCamp = getRoleCamp(gameState, myRole) || gameState.currentCamp;
    } else if (gameState.gameMode === 'pve') {
        // PVE 走上方退出分支，不会到达此处
        return;
    } else {
        // 热座 / 本地共享屏幕：让用户选择要投降的阵营
        const activeCamps = (gameState.turnOrder || getFactionKeys(gameState))
            .filter(key => key !== 'neutral')
            .map(key => campFromKey(key, gameState))
            .filter(Boolean)
            .filter(camp => !gameState.surrenderedCamps.includes(camp));
        surrenderCamp = await _showCampPicker('选择要投降的阵营：', activeCamps);
        if (!surrenderCamp) return;
    }

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

    // 只按稳定阵营 ID 与投降记录判断存活者；领地会在投降后转为中立，不能反过来参与胜者身份计算。
    const survivingKeys = getSurvivingPlayerKeys(gameState, surrenderCamp);
    const victoryCamp = survivingKeys.length === 1 ? campFromKey(survivingKeys[0], gameState) : null;

    if (gameState.isThreePlayer && victoryCamp === null) {
        // 三人投降：城市、行政区、部队全部归属中立AI
        const confirmed = await showConfirm(
            `确定要投降吗？\n${surrenderCamp.name}将退出战斗，领土与部队归属中立AI。`
        );
        if (!confirmed) return;
        logMessage(`${surrenderCamp.name}选择投降，领土与部队归属中立！`);
        if (!hasFactionSurrendered(gameState, surrenderCamp)) gameState.surrenderedCamps.push(surrenderCamp);
        const neutralCamp = campFromKey('neutral', gameState);
        restoreSurrenderedPorts(gameState, surrenderCamp);
        for (const tile of gameState.tiles) {
            if (tile.camp === surrenderCamp) tile.setCampWithFade(neutralCamp);
            if (tile.unit && tile.unit.camp === surrenderCamp) {
                tile.unit.camp = neutralCamp;
            }
        }
        // 跳过该阵营回合，切换到下一个未投降阵营
        if (gameState.currentCamp === surrenderCamp) {
            gameState.turnCounter++;
            _updateWeather();
            _skipToNextActiveCamp(surrenderCamp);
        }
        // 投降方显示观战横幅
        const banner = document.getElementById('opponentTurnBanner');
        if (banner && isNetworkGame()) {
            const myCamp = getRoleCamp(gameState, myRole);
            if (myCamp === surrenderCamp) {
                banner.innerHTML = '<span>👁</span><span>您已战败，观战中</span>';
                banner.classList.add('visible');
            }
        }
        checkVictory();
        updateUI();
        updateButtonColors();
        broadcastAction('surrender');
        // 投降可能把回合直接切到中立（未经过 endTurn 的 AI 链）：
        // 本地由本机立即接管；联机时非驱动方此调用为空操作，驱动方在收到广播后接管
        if (!gameState.gameOver && _campKey(gameState.currentCamp) === 'neutral') {
            resumeNeutralTurnIfNeeded().catch(e => console.warn('Neutral resume error:', e));
        }
        return;
    }

    const confirmed = await showConfirm(
        `确定要投降吗？\n${surrenderCamp.name}将立即战败，${victoryCamp.name}获得胜利。`
    );
    if (!confirmed) return;

    logMessage(`${surrenderCamp.name}选择投降，${victoryCamp.name}获得最终胜利！`);

    if (!hasFactionSurrendered(gameState, surrenderCamp)) gameState.surrenderedCamps.push(surrenderCamp);
    restoreSurrenderedPorts(gameState, surrenderCamp);
    gameState.gameOver = true;
    gameState.victoryCamp = victoryCamp;

    setTimeout(() => triggerVictoryEffect(), 1500);
    updateUI();
    updateButtonColors();
    broadcastAction('surrender');
}

// ==== E4 空军上校：航程 + 防空火力 目标约束 =====================
export const COLONEL_AIR_RANGE = COLONEL_CARD_DATA.range;
export const ANTIAIR_RADIUS = ANTI_AIR_RADIUS;

// 找到某阵营在场的上校单位（无则 null）
export function getColonelUnit(camp) {
    for (const t of gameState.tiles) {
        if (t.unit && t.unit.commander === 'colonel' && campToKey(t.unit.camp) === campToKey(camp) && t.unit.hp > 0) return t.unit;
    }
    return null;
}

// 兼容旧导入；实现来自 rules/antiAir.js 的单一规则源。
export const isAntiAirUnit = isAntiAirUnitRule;

// 兼容旧调用名；返回目标地块受到的敌方防空减伤百分比，而非“层数”。
export function getAALayers(tile, camp, tileMap, state = gameState) {
    return getAntiAirReduction(tile, camp, tileMap, { state });
}

// ==== 通用防空接口 =====================
// 接口1：对空防御——所有空袭伤害卡（俯冲扫射/地毯轰炸/空袭）共用
// 各防空来源按自身百分比累加，并与通用减伤共同遵守 85% 上限。
export function applyAADefense(dmg, tile, camp, tileMap, state = gameState) {
    const aa = getAALayers(tile, camp, tileMap, state);
    if (aa > 0) return Math.round(dmg * (1 - Math.min(COMBAT_BALANCE.defense.maximumReduction, aa)));
    return dmg;
}

// 接口2：空降减血——所有空降/空运卡（空降步兵/上校空运）共用
// 按累计防空百分比扣除最大生命值（不低于 1 HP），保持生命上限不变。
export function applyAADropHP(unit, tile, camp, tileMap, state = gameState) {
    const aa = getAALayers(tile, camp, tileMap, state);
    if (aa > 0) {
        const hpLoss = Math.round(unit.maxHp * Math.min(COMBAT_BALANCE.defense.maximumReduction, aa));
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
    const cmdBonus = (targetUnit.isCommanderUnit ?? Boolean(targetUnit.commander)) ? 10 : 0;
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
    if (!tianyanUnit || tianyanUnit.commander !== 'tianyan' || areCommanderMechanicsSuppressed(tianyanUnit) || tianyanUnit.hp <= 0) {
        notify('当前无法部署天眼哨机', 'error');
        return null;
    }
    if (tianyanUnit.camp !== gameState.currentCamp) {
        notify('当前不是你的回合', 'error');
        return null;
    }
    const targetingPreview = resolveTargetingPreview(gameState, {
        cardId: 'drone_deploy',
        targeting: 'emptyTile'
    }, { myCamp: tianyanUnit.camp, hoveredTile: targetTile, isTileVisible });
    if (!isResolvedTargetingCandidate(targetingPreview, targetTile)) {
        notify('该位置无法部署', 'error');
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

export function executeEngineerTrench(engineerUnit) {
    if (areCommanderMechanicsSuppressed(engineerUnit) || !isLandDeploymentTile(engineerUnit?.tile)) {
        notify('水域地块无法修筑工事', 'error');
        return false;
    }
    const result = digEngineerTrench(engineerUnit, { gameState, logMessage });
    if (!result.ok) {
        notify(result.message, 'error');
        return false;
    }

    invalidateBoard();
    recalcAllFlankingMorale();
    updateUI();
    broadcastAction('engineerTrench', {
        unitId: engineerUnit.id,
        q: result.tile.q,
        r: result.tile.r
    });
    return true;
}

export function executeEngineerFlak(engineerUnit) {
    if (areCommanderMechanicsSuppressed(engineerUnit) || !isLandDeploymentTile(engineerUnit?.tile)) {
        notify('水域地块无法修筑工事', 'error');
        return false;
    }
    const result = digEngineerFlak(engineerUnit, { gameState, logMessage });
    if (!result.ok) {
        notify(result.message, 'error');
        return false;
    }

    invalidateBoard();
    recalcAllFlankingMorale();
    updateUI();
    broadcastAction('engineerFlak', {
        unitId: engineerUnit.id,
        q: result.tile.q,
        r: result.tile.r
    });
    return true;
}

export function executeEngineerBunkerConstruction(engineerUnit, targetTile) {
    if (areCommanderMechanicsSuppressed(engineerUnit) || !isLandDeploymentTile(engineerUnit?.tile)) {
        notify('水域地块无法修筑工事', 'error');
        return false;
    }
    const targetingPreview = resolveTargetingPreview(gameState, {
        cardId: 'engineer_bunker',
        targeting: 'emptyTile',
        engineerUnitId: engineerUnit?.id
    }, { myCamp: engineerUnit?.camp, hoveredTile: targetTile, isTileVisible });
    if (!isResolvedTargetingCandidate(targetingPreview, targetTile)) {
        notify('无法建造在该位置', 'error');
        return false;
    }
    const result = beginEngineerBunkerConstruction(engineerUnit, targetTile, { gameState, logMessage, Unit });
    if (!result.ok) {
        notify(result.message, 'error');
        return false;
    }

    // 脚手架立即出现在目标格
    spawnRecruitEffect(targetTile.x, targetTile.y);
    triggerRecruitFlash(targetTile.x, targetTile.y);
    spawnCommanderSkillEffect(targetTile.x, targetTile.y, '🧱', '搭建脚手架');
    recalcAllFlankingMorale();
    updateUI();
    broadcastAction('engineerBunkerStart', {
        unitId: engineerUnit.id,
        q: targetTile.q,
        r: targetTile.r
    });
    return true;
}

export function executeFieldConstruction(unit, kind) {
    if (!canBuildFieldFortification(unit, kind, gameState)) {
        notify('当前地块不能修建该工事', 'error');
        return false;
    }
    const campKey = _campKey(unit.camp);
    const cost = constructionCost(kind, unit);
    if ((gameState.playerGold[campKey] || 0) < cost) {
        notify('金币不足', 'error');
        return false;
    }
    gameState.playerGold[campKey] -= cost;
    unit.tile.fortification = kind;
    unit.tile.fieldFortification = { type: kind, campKey, ownerKnown: true };
    unit.remainingMP = 0;
    unit.canAct = false;
    invalidateBoard();
    updateUI();
    logMessage(`${unit.camp.name}${unit.config.name}修建【${CONSTRUCTION_CONFIG[kind].name}】`);
    broadcastAction('buildFortification', {
        unitId: unit.id, kind, q: unit.tile.q, r: unit.tile.r,
        cost, engineerDiscount: unit.commander === 'engineer'
    });
    return true;
}

export function executeBunkerConstruction(unit, targetTile) {
    if (!canBuildBunkerAt(unit, targetTile, gameState)) {
        notify('无法在该位置建造碉堡', 'error');
        return false;
    }
    const campKey = _campKey(unit.camp);
    const cost = constructionCost('bunker', unit);
    if ((gameState.playerGold[campKey] || 0) < cost) {
        notify('金币不足', 'error');
        return false;
    }
    gameState.playerGold[campKey] -= cost;
    const bunker = new Unit('mgNest', unit.camp, targetTile, false);
    bunker._isImmobile = true;
    bunker.remainingMP = 0;
    bunker.canAct = false;
    if (unit.commander === 'engineer') {
        bunker._constructionScaffold = null;
    } else {
        bunker._constructionScaffold = {
            type: 'bunker', campKey,
            readyRound: getRoundIndex(gameState) + CONSTRUCTION_CONFIG.bunker.buildTurns
        };
    }
    unit.remainingMP = 0;
    unit.canAct = false;
    spawnRecruitEffect(targetTile.x, targetTile.y);
    updateUI();
    broadcastAction('buildBunker', {
        unitId: unit.id, bunkerId: bunker.id, q: targetTile.q, r: targetTile.r,
        cost, immediate: unit.commander === 'engineer',
        readyRound: bunker._constructionScaffold?.readyRound ?? getRoundIndex(gameState)
    });
    return true;
}

export function executeShoreBatteryConstruction(targetTile) {
    const camp = gameState.currentCamp;
    if (!canBuildShoreBatteryAt(targetTile, camp, gameState)) {
        notify('岸防炮只能建在己方空沿海陆地，且阵营建造冷却必须结束', 'error');
        return false;
    }
    const campKey = _campKey(camp);
    const cost = constructionCost('shoreBattery');
    if ((gameState.playerGold[campKey] || 0) < cost) {
        notify('金币不足', 'error');
        return false;
    }
    gameState.playerGold[campKey] -= cost;
    const battery = new Unit('shoreBattery', camp, targetTile, false);
    battery.remainingMP = 0;
    battery.canAct = false;
    recordShoreBatteryBuilt(gameState, camp);
    triggerRecruitFlash(targetTile.x, targetTile.y);
    spawnRecruitEffect(targetTile.x, targetTile.y);
    gameState.goldTexts.push({
        x: targetTile.x, y: targetTile.y,
        value: cost, prefix: '-', color: '#ff5555', shadowColor: '#661111',
        timeLeft: 1800, lastUpdate: performance.now()
    });
    spawnGoldParticles(targetTile.x, targetTile.y, '#cc5555');
    recalcAllFlankingMorale();
    if (gameState.skirmishFog) _updateSkirmishFogAll();
    updateUI();
    logMessage(`${camp.name}在沿海修建【岸防炮】`);
    broadcastAction('buildFortification', {
        kind: 'shoreBattery', unitId: battery.id, q: targetTile.q, r: targetTile.r, cost
    });
    return true;
}

export function executeAirfieldConstruction(cityTile) {
    const camp = gameState.currentCamp;
    if (!canBuildAirfieldAt(cityTile, camp, gameState)) {
        notify('当前城市不能建设机场，或已达到机场上限', 'error');
        return false;
    }
    const campKey = _campKey(camp);
    const cost = constructionCost('airfield', null, cityTile);
    if ((gameState.playerGold[campKey] || 0) < cost) {
        notify('金币不足', 'error');
        return false;
    }
    gameState.playerGold[campKey] -= cost;
    cityTile.installation = {
        type: 'airfield', campKey, status: 'constructing',
        constructionReadyRound: getRoundIndex(gameState) + CONSTRUCTION_CONFIG.airfield.buildTurns,
        airCommandUsedThisTurn: false, airCommandReadyRound: {}, cooldowns: {}
    };
    updateUI();
    broadcastAction('buildAirfield', {
        q: cityTile.q, r: cityTile.r, cost,
        readyRound: cityTile.installation.constructionReadyRound
    });
    return true;
}

export function executeFieldRepair(engineer, target) {
    if (!canFieldRepair(engineer, target, gameState)) {
        notify('没有可抢修的建筑目标', 'error');
        return false;
    }
    const campKey = _campKey(engineer.camp);
    const cost = CONSTRUCTION_CONFIG.fieldRepair.cost;
    if ((gameState.playerGold[campKey] || 0) < cost) {
        notify('金币不足', 'error');
        return false;
    }
    gameState.playerGold[campKey] -= cost;
    const amount = target.heal(Math.round(target.maxHp * CONSTRUCTION_CONFIG.fieldRepair.healPct));
    target._fieldRepairedAtTurn = gameState.turnCounter;
    engineer._fieldRepairCooldown = 0;
    engineer._engineerFieldRepairReadyRound = getRoundIndex(gameState) + CONSTRUCTION_CONFIG.fieldRepair.cooldown + 1;
    engineer.remainingMP = 0;
    engineer.canAct = false;
    updateUI();
    broadcastAction('fieldRepair', {
        unitId: engineer.id, targetId: target.id, amount, cost,
        readyRound: engineer._engineerFieldRepairReadyRound
    });
    return true;
}

function _resolveAirCommandDamage(basePower, multiplier, target, launcherTile, { centerBomb = false, missingHpBonus = false } = {}) {
    const colonel = getAirfieldColonel(launcherTile);
    const commanderAttackBonus = getMountedCommanderAirAttackBonus(launcherTile.unit, basePower);
    const campKey = _campKey(launcherTile.camp);
    const stacks = Math.min(COLONEL_AIR_MAX_STACKS, gameState._colonelAirStacks?.[campKey] || 0);
    const airBonus = colonel ? COLONEL_AIR_DAMAGE_BONUS + stacks * COLONEL_AIR_STACK_BONUS : 0;
    const missingBonus = missingHpBonus
        ? Math.min(15, Math.floor(((target.maxHp - target.hp) / target.maxHp) * 20))
        : 0;
    const power = basePower + commanderAttackBonus + missingBonus;
    // 有驻军/将领时按普通攻击浮动区间结算（阈值以上即暴击）；空城机场只有窄浮动、无暴击。
    const floatMultiplier = launcherTile.unit
        ? gameState.rng.range(COMBAT_BALANCE.float.attack.min, COMBAT_BALANCE.float.attack.max)
        : gameState.rng.range(0.95, 1.05);

    let ordinaryDefense = (TERRAIN_CONFIG[target.tile.terrain]?.defenseBonus || 0)
        + (target.config.defense || 0) + (target._rankPanelDefenseBonus || 0)
        + (isMechanicEnabled(gameState, 'morale') ? (MORALE_CONFIG[target.morale]?.defBonus || 0) : 0)
        + getCommanderDefenseBonus(target) + getCommanderAuraDefenseBonus(target)
        + (target.getCampaignDefenseBonus?.() || 0);
    if (centerBomb) ordinaryDefense = Math.max(0, ordinaryDefense - 0.10);
    let antiAir = getAntiAirReduction(target.tile, launcherTile.camp, gameState.tileMap, { state: gameState });
    if (colonel) antiAir = Math.max(0, antiAir - COLONEL_ANTI_AIR_PIERCE);
    const reduction = Math.min(COMBAT_BALANCE.defense.maximumReduction, ordinaryDefense + antiAir);
    return {
        damage: Math.max(1, Math.round(power * multiplier * (1 + airBonus) * floatMultiplier * (1 - reduction))),
        isCrit: !!launcherTile.unit && floatMultiplier > COMBAT_BALANCE.float.attack.critThreshold,
        antiAir
    };
}

export function executeAirCommand(kind, launcherTile, targetTile) {
    const config = AIR_COMMAND_CONFIG[kind];
    const availability = getAirCommandAvailability(kind, launcherTile, gameState);
    if (!config || !availability.available || !targetTile || hexDistance(launcherTile, targetTile) > getAirCommandRange(launcherTile)) {
        notify(availability.reason || '空军指令不可用', 'error');
        return false;
    }

    const results = [];
    let destroyedFortification = null;
    if (kind === 'strafe') {
        const target = targetTile.unit;
        if (!target || !canAttack(gameState, launcherTile.camp, target.camp)) return false;
        if (target.type === 'submarine' && !isSubmarineTargetableBy(target, launcherTile.camp, gameState)) return false;
        const result = _resolveAirCommandDamage(AIRFIELD_BASE_POWER, 1, target, launcherTile, { missingHpBonus: true });
        const killed = target.applyDamage(result.damage, { source: 'ranged', attacker: null });
        results.push({ q: targetTile.q, r: targetTile.r, damage: result.damage, killed, isCrit: result.isCrit });
        spawnStrafeTracer(launcherTile.x, launcherTile.y, targetTile.x, targetTile.y);
    } else if (kind === 'bombing') {
        const affected = [targetTile, ...HEX_NEIGHBORS.map(([dq, dr]) => gameState.tileMap.get(`${targetTile.q + dq},${targetTile.r + dr}`)).filter(Boolean)];
        for (let index = 0; index < affected.length; index++) {
            const tile = affected[index];
            const target = tile.unit;
            if (!target || !canAttack(gameState, launcherTile.camp, target.camp)) continue;
            const result = _resolveAirCommandDamage(AIRFIELD_BASE_POWER, index === 0 ? 1 : 0.5, target, launcherTile, { centerBomb: index === 0 });
            const killed = target.applyDamage(result.damage, { source: 'ranged', attacker: null });
            results.push({ q: tile.q, r: tile.r, damage: result.damage, killed, isCrit: result.isCrit });
        }
        const engineerProtectedAirfield = targetTile.isCity
            && targetTile.installation?.type === 'airfield'
            && targetTile.installation.status === 'ready'
            && targetTile.unit?.commander === 'engineer'
            && targetTile.unit.camp === targetTile.camp;
        if (targetTile.isCity && targetTile.camp !== launcherTile.camp && !engineerProtectedAirfield) {
            targetTile._cityFireStacks = (targetTile._cityFireStacks || 0) + 1;
            if (targetTile._cityFireStacks >= 2) {
                targetTile._cityFireStacks = 0;
                targetTile._cityDisabledUntil = getRoundIndex(gameState) + 2;
            }
        }
        if (!engineerProtectedAirfield && targetTile.fortification && gameState.rng.chance(0.30)) {
            destroyedFortification = targetTile.fieldFortification?.type || targetTile.fortification;
            targetTile.fortification = null;
            targetTile.fieldFortification = null;
            invalidateBoard();
        }
        spawnAirstrikeEffect(targetTile.x, targetTile.y, results, 'carpetBomb', targetTile.q, targetTile.r);
    } else if (kind === 'airdrop') {
        if (targetTile.unit || !isLandDeploymentTile(targetTile) || targetTile.isCity || targetTile.isPort) return false;
        const unit = new Unit('infantry', launcherTile.camp, targetTile, true);
        const colonel = getAirfieldColonel(launcherTile);
        let antiAir = getAntiAirReduction(targetTile, launcherTile.camp, gameState.tileMap, { state: gameState });
        if (colonel) antiAir = Math.max(0, antiAir - COLONEL_ANTI_AIR_PIERCE);
        // 落点防空只削减当前 HP，不混入地形等普通防御（验收标准13）。
        const landingReduction = Math.min(COMBAT_BALANCE.defense.maximumReduction, antiAir);
        unit.hp = Math.max(1, Math.round(unit.maxHp * (1 - landingReduction)));
        unit.displayHp = unit.hp;
        unit.canAct = false;
        unit.remainingMP = 0;
        results.push({ q: targetTile.q, r: targetTile.r, unitId: unit.id, hp: unit.hp });
        spawnAirstrikeEffect(targetTile.x, targetTile.y, [], 'airdrop', targetTile.q, targetTile.r);
    } else if (kind === 'recon') {
        if (!gameState.skirmishFog || gameState.campaignMode) return false;
        const antiAir = getAntiAirReduction(targetTile, launcherTile.camp, gameState.tileMap, { state: gameState });
        const radius = antiAir <= 0.25 ? 2 : 1;
        const duration = antiAir >= 0.50 ? 1 : 2;
        applyScoutReveal(gameState, launcherTile.camp, targetTile.q, targetTile.r, radius, duration);
        markSubmarinesRevealedInArea(gameState, launcherTile.camp, targetTile, 0, duration);
        updateFogOfWar(gameState, launcherTile.camp);
        results.push({ q: targetTile.q, r: targetTile.r, radius, duration });
    } else {
        return false;
    }

    const impactDelay = AIR_COMMAND_IMPACT_DELAY_MS[kind];
    if (Number.isFinite(impactDelay) && results.some(result => Number(result.damage) > 0)) {
        setTimeout(() => {
            gameState.damageTexts.push(...buildAirCommandDamageTexts(
                results,
                gameState.tileMap,
                performance.now()
            ));
        }, impactDelay);
    }

    markAirCommandUsed(kind, launcherTile, gameState);
    const colonel = getAirfieldColonel(launcherTile);
    if (colonel) {
        const campKey = _campKey(launcherTile.camp);
        gameState._colonelAirStacks ||= {};
        gameState._colonelAirStacks[campKey] = Math.min(COLONEL_AIR_MAX_STACKS, (gameState._colonelAirStacks[campKey] || 0) + 1);
    }
    recalcAllFlankingMorale();
    updateUI();
    broadcastAction('airCommand', {
        kind,
        launcherQ: launcherTile.q,
        launcherR: launcherTile.r,
        targetQ: targetTile.q,
        targetR: targetTile.r,
        cost: config.cost,
        readyRound: launcherTile.installation?.airCommandReadyRound?.[kind] ?? 0,
        destroyedFortification,
        results
    });
    return true;
}

// 无人机自杀式袭击
export function executeDroneSuicide(droneUnit, targetTile) {
    if (!droneUnit || !droneUnit._isDrone) return false;
    refreshDroneSignal(gameState, droneUnit.camp);
    if (droneUnit.morale === 0) {
        notify('哨机当前无法行动', 'error');
        return false;
    }
    const targetingPreview = resolveTargetingPreview(gameState, {
        cardId: 'drone_suicide',
        targeting: 'anyTileGlobal',
        droneId: droneUnit.id
    }, { myCamp: droneUnit.camp, hoveredTile: targetTile, isTileVisible });
    if (!isResolvedTargetingCandidate(targetingPreview, targetTile)) {
        notify('无法对该目标释放自爆', 'error');
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
    const dCampKey = _campKey(droneUnit.camp);
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
    if (gameState.campaignMode && !isMechanicEnabled(gameState, 'tacticalCards')) { notify('本关尚未开放对策卡', 'info'); return; }
    // E4 空运第二段：直接执行空运（跳过正常卡牌验证）
    if (cardId === 'airlift_dest') {
        _executeAirliftDest(targetTile);
        return;
    }
    const cfg = TACTICAL_CARD_CONFIG[cardId] || COLONEL_CARDS[cardId];
    if (!cfg) return;

    const myCamp = isNetworkGame() ? getRoleCamp(gameState, getMyRole()) : gameState.currentCamp;
    const campKey = _campKey(myCamp);

    // 候选集合是渲染、点击与执行终检的共同真源；执行层仍在扣牌/扣金前复核一次。
    const activeTargeting = gameState.cardTargeting?.cardId === cardId
        ? gameState.cardTargeting
        : null;
    const targetingPreview = resolveTargetingPreview(gameState, {
        ...(activeTargeting || {}),
        cardId,
        targeting: cfg.targeting
    }, {
        myCamp,
        hoveredTile: targetTile,
        isTileVisible
    });
    if (!isResolvedTargetingCandidate(targetingPreview, targetTile)) {
        if (targetingPreview.air?.grounded) notify('雾天停飞，无法使用空军卡', 'error');
        else notify('无效目标');
        return;
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
    const cardEntry = hand[idx];
    const isCopyCard = typeof cardEntry === 'object' && cardEntry._copy;
    const deployCommanderId = cardId === 'commanderDeploy' && typeof cardEntry === 'object'
        ? cardEntry.commanderId || null
        : null;

    // E3 纵横家合纵：用卡次数上限覆盖
    const useBonus = _getActiveDiplomatOverride(campKey)?.useBonus || 0;
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
    if (isAirCard && isMechanicEnabled(gameState, 'weatherEffects') && gameState.weather === 'fog') {
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
    const helpers = { getCommander, Unit, getMyCamp: () => myCamp, deployCommanderId, spawnOrbitBeams: spawnPaladinOrbitBeams, getAALayers, hexDistance, applyAADefense, applyAADropHP };
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
            // 通用空军增伤：每使用1张卡+5%（②增伤乘区，上限6层）
            if (gameState._colonelAirStacks) {
                if (gameState._colonelAirStacks[campKey] == null) gameState._colonelAirStacks[campKey] = 0;
                if (gameState._colonelAirStacks[campKey] < COLONEL_CARD_DATA.maxAirDamageStacks) {
                    gameState._colonelAirStacks[campKey]++;
                    logMessage(`✈️ 空军熟练度+1，当前增伤+${Math.round(gameState._colonelAirStacks[campKey] * COLONEL_CARD_DATA.airDamagePerStack * 100)}%/上限${Math.round(COLONEL_CARD_DATA.maxAirDamageStacks * COLONEL_CARD_DATA.airDamagePerStack * 100)}%`);
                }
            }
            const _stacks = gameState._colonelAirStacks?.[campKey] || 0;
            const airBonus = COLONEL_CARD_DATA.airDamagePerStack * Math.min(_stacks, COLONEL_CARD_DATA.maxAirDamageStacks);
            if (cardId === 'diveStrafe' && targetTile && targetTile.unit) {
                // 扫射·弱点打击：目标已损生命值的10%转化为攻击力，封顶+15，并在后续乘区前计入。
                const balance = COLONEL_CARD_DATA.diveStrafe.balance;
                const _missingHpBonus = Math.min(balance.maxMissingHpAttack, Math.floor((targetTile.unit.maxHp - targetTile.unit.hp) * balance.missingHpToAttackPct));
                const _calc = _colUnit._resolveDamage(_colUnit, targetTile.unit, 1.0, airBonus, false, false, true, 0, _missingHpBonus);
                result.dmg = Math.round(_calc.dmg);
                result.isCrit = _calc.isCrit;
                if (_missingHpBonus > 0) logMessage(`目标已损生命转化为+${_missingHpBonus}攻击力，触发弱点打击！`);
            } else if (cardId === 'carpetBomb' && result.results) {
                for (const _r of result.results) {
                    const _ht = gameState.tileMap ? gameState.tileMap.get(`${_r.q},${_r.r}`) : null;
                    if (_ht && _ht.unit) {
                        const _isCenter = _r.q === targetTile.q && _r.r === targetTile.r;
                        const balance = COLONEL_CARD_DATA.carpetBomb.balance;
                        const _calc = _colUnit._resolveDamage(_colUnit, _ht.unit, 1.0, airBonus, false, false, true, balance.ignoreDefense);
                        _r.dmg = _isCenter ? Math.round(_calc.dmg) : Math.round(_calc.dmg * (balance.splashMultiplier / balance.centerMultiplier));
                        _r.isCrit = _calc.isCrit;
                    }
                }
            }
        }
    }

    // E4 空运第一段：选单位后进入第二段选目的地
    if (cardId === 'airlift' && targetTile && targetTile.unit) {
        gameState._airliftTarget = { unitId: targetTile.unit.id };
        showTargetingBanner('请选择目标');
        gameState.cardTargeting = { cardId: 'airlift_dest', targeting: 'emptyTile', handIndex: idx, startedAt: performance.now() };
        updateUI();
        return;
    }

    gameState.cardTargeting = null;
    hideTargetingBanner();

    function _executeAirliftDest(targetTile) {
    if (!gameState._airliftTarget) { notify('请先选择空运单位', 'error'); return; }
    const myCamp = isNetworkGame() ? getRoleCamp(gameState, getMyRole()) : gameState.currentCamp;
    const aCampKey = _campKey(myCamp);
    const airUnit = gameState.tiles.reduce((f, t) => f || (t.unit?.id === gameState._airliftTarget.unitId ? t.unit : null), null);
    if (!airUnit || !airUnit.tile) { notify('空运单位已不存在', 'error'); gameState._airliftTarget = null; gameState.cardTargeting = null; hideTargetingBanner(); updateUI(); return; }
    const destinationPreview = resolveTargetingPreview(gameState, {
        cardId: 'airlift_dest',
        targeting: 'emptyTile'
    }, { myCamp, hoveredTile: targetTile, isTileVisible });
    if (!isResolvedTargetingCandidate(destinationPreview, targetTile)) {
        if (destinationPreview.air?.grounded) notify('雾天停飞，无法使用空运', 'error');
        else notify('空运目的地无效、不可见或超出上校航程', 'error');
        return;
    }
    // 扣金币 + 计入本回合用卡次数（空军卡不消耗手牌，故在此统一结算）
    const aGoldCost = COLONEL_CARD_GOLD.airlift || 0;
    if ((gameState.playerGold[aCampKey] || 0) < aGoldCost) {
        notify('金币不足', 'error');
        return;
    }
    const aUseBonus = _getActiveDiplomatOverride(aCampKey)?.useBonus || 0;
    if ((gameState.playerUsesThisTurn[aCampKey] || 0) >= CARD_SYSTEM_CONFIG.maxUsesPerTurn + aUseBonus) {
        notify('本回合已达到使用上限', 'error');
        return;
    }
    gameState.playerGold[aCampKey] = (gameState.playerGold[aCampKey] || 0) - aGoldCost;
    gameState.playerUsesThisTurn[aCampKey] = (gameState.playerUsesThisTurn[aCampKey] || 0) + 1;
    logMessage(`空军上校消耗${aGoldCost}$`);
    // 上校空军卡叠层
    if (gameState._colonelAirStacks) {
        if (gameState._colonelAirStacks[aCampKey] == null) gameState._colonelAirStacks[aCampKey] = 0;
        if (gameState._colonelAirStacks[aCampKey] < COLONEL_CARD_DATA.maxAirDamageStacks) {
            gameState._colonelAirStacks[aCampKey]++;
            logMessage(`✈️ 空军熟练度+1，当前增伤+${Math.round(gameState._colonelAirStacks[aCampKey] * COLONEL_CARD_DATA.airDamagePerStack * 100)}%/上限${Math.round(COLONEL_CARD_DATA.maxAirDamageStacks * COLONEL_CARD_DATA.airDamagePerStack * 100)}%`);
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
    // 通用防空接口：空运落入防空区 → 每层-25%最大生命值（上限不变）
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
        const scoutTile = gameState.tileMap.get(`${result.scoutQ},${result.scoutR}`);
        if (scoutTile) markSubmarinesRevealedInArea(gameState, myCamp, scoutTile, 1, 2);
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
    // 发射卡牌使用事件（供教程/战役触发器/UI 响应）
    const targetUnitId = targetTile?.unit?.id || null;
    emit('input:cardUsed', { cardId, targetUnitId, targetTile });

    const x = targetTile.x, y = targetTile.y;

    // VFX + 视觉反馈延迟至烧牌动画结束后播放（与远端同步）
    const BURN_MS = 1600;
    switch (cardId) {
        case 'heal': {
            const healAmt = result.healAmt;
            logMessage(`💚【疗愈】${targetTile.unit.camp.name}${targetTile.unit.config.name}兵回复${healAmt}生命值${result.purifiedPoison ? '并清除中毒' : ''}`);
            setTimeout(() => {
                if (targetTile.unit) {
                    targetTile.unit._poison = null;
                    if (healAmt > 0) targetTile.unit.hp = Math.min(targetTile.unit.maxHp, targetTile.unit.hp + healAmt);
                }
                if (healAmt > 0 && targetTile.unit) {
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
                        const dck = _campKey(dc);
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
                // damage/HP/particles delayed to match bomb impact timing (~1400ms into flight)
                setTimeout(() => {
                    playSound('explosion');
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
                    targetTile._cityDisabledUntil = getRoundIndex(gameState) + TACTICAL_CARD_CONFIG.airstrike.balance.cityDisableRounds;
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
                // 单条弹道持续射出~5发追踪曳光弹，每发单独计算飞机位置
                setTimeout(() => {
                    playSound('machinegun');
                    const tx = targetTile.x, ty = targetTile.y;
                    for (let i = 0; i < 20; i++) {
                        setTimeout(() => {
                            const fireTime = 600 + i * 20;
                            const p = Math.min(1, fireTime / 1350);
                            const px = tx - 380 + 720 * p, py = ty - 300 + 320 * p;
                            const ang = Math.atan2(320, 720);
                            spawnStrafeTracer(px + Math.cos(ang) * 22, py + Math.sin(ang) * 22, tx, ty);
                        }, i * 20);
                    }
                }, 600);
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
                    playSound('explosion');
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
            const mineName = result.mineType === 'water' ? '水雷' : '地雷';
            logMessage(`💣【${mineName}】${myCamp.name}在(${targetTile.q},${targetTile.r})完成布设`);
            setTimeout(() => {
                spawnCommanderSkillEffect(x, y, result.mineType === 'water' ? '⚓' : '💣', mineName);
            }, BURN_MS);
            break;
        }
        case 'poison': {
            logMessage(`☣️【投毒】${targetTile.unit.camp.name}${targetTile.unit.config.name}已中毒`);
            setTimeout(() => spawnCommanderSkillEffect(x, y, '☣️', '中毒'), BURN_MS);
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
                    _campKey(myCamp) === 'player1' ? targetTile.unit.id : null,
                    _campKey(myCamp) === 'player2' ? targetTile.unit.id : null,
                    gameState.commanderPoolP3, gameState.commanderP3,
                    gameState.commanderP3Confirmed, gameState.commanderP3Deployed,
                    _campKey(myCamp) === 'player3' ? targetTile.unit.id : null,
                    { campKey, unitId: targetTile.unit.id, commanderId: result.commander }
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
    const isHumanLocal = !isAI && _campKey(gameState.currentCamp) !== 'neutral';
    // 部署将领的烧牌动画显示所选将领名（遭遇战模式下不广播将领名）
    const burnDisplayName = (cardId === 'commanderDeploy' && result.commander && !gameState.skirmishFog)
        ? (COMMANDER_CONFIG[result.commander]?.name || null) : null;
    // E3 纵横家连横：对方用卡后尝试复制（必须在 broadcastAction 之前执行，确保序列化状态含拷贝）
    if (gameState.tileMap && gameState._cardOverrides && !isCopyCard) {
        for (const [ck, co] of Object.entries(gameState._cardOverrides)) {
            if (!co) continue;
            const dipCamp = campFromKey(ck, gameState);
            if (!dipCamp || dipCamp === gameState.currentCamp) continue;
            for (const t of gameState.tiles) {
                if (!t.unit || t.unit.commander !== 'diplomat' || areCommanderMechanicsSuppressed(t.unit) || t.unit.camp !== dipCamp || t.unit.hp <= 0) continue;
                if (!isLandTile(t)) continue;
                if (t.camp === dipCamp) continue;
                if (!gameState.rng.chance(0.50)) continue;
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
    broadcastAction('tacticalCard', { cardId, x, y, q: targetTile.q, r: targetTile.r, dmg: result.dmg, isCrit: result.isCrit, deployed: result.deployed, commander: result.commander, healAmt: result.healAmt, purifiedPoison: result.purifiedPoison, poisoned: result.poisoned, mineType: result.mineType, imprisoned: result.imprisoned, killedTiles: result.killedTiles, airstrikeResults, carpetBombResults, burnDisplayName, scoutQ: result.scoutQ, scoutR: result.scoutR });
}
