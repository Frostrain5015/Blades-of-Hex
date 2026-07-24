// engine/matchState.js — 对局状态（MatchState）与客户端界面状态（ClientUiState）的边界。
//
// MatchState：规则结算所需、可序列化、跨端必须一致的字段（含确定性 RNG）。
// ClientUiState：本地选中、悬浮、动画与浮层字段，不参与联机同步与快照。
//
// 过渡期约定：两者仍合并在 js/state.js 的 gameState 单例上（对象身份不变，
// 旧代码不感知差异）；本模块是字段归属的唯一出处。后续引擎函数将只接收
// MatchState，客户端模块只读写 ClientUiState。
//
// 本模块不得 import DOM、Canvas、音频或 effects。

import { campToKey } from '../rules/camps.js';
import { createDefaultDiplomacy, createDefaultFactions, createStandardFactions } from '../rules/diplomacy.js';
import { createDefaultMechanics } from '../rules/mechanics.js';
import {
    SURFACE_KIND, buildCoastTopology, getSurfaceBaseColor,
    isLandTile, isWaterSurface, isWaterTile, normalizeSurfaceKind, tileCoordinateKey
} from '../rules/surfaces.js';
import { buildRiverTopology } from '../rules/hydrography.js';
import { HEX_NEIGHBORS } from '../rules/hex.js';
import { canUnitOccupyTile } from '../rules/movement.js';
import { CITY_SIEGE_CONFIG, syncCityHpMirrors } from '../rules/citySiege.js';
import { createRng } from '../core/rng.js';
import { getCounter, setCounter } from '../js/uid.js';
import { DEFAULT_STANDARD_MAP_ID } from '../rules/standardMaps.js';

let resetSeedCounter = 0;

function keyedRecord(factions, factory) {
    return Object.fromEntries(Object.keys(factions).map(key => [key, factory(key)]));
}

function createStandardRuntime(playerCount = 2) {
    const factions = createStandardFactions({ playerCount });
    const activePlayers = ['player1', 'player2', ...(playerCount === 3 ? ['player3'] : [])];
    const turnOrder = [...activePlayers, 'neutral'];
    return {
        factions,
        turnOrder,
        roleAssignments: Object.fromEntries(activePlayers.map(key => [key, key])),
        factionColorSelections: Object.fromEntries(activePlayers.map(key => [key, factions[key].colorId])),
        playerGold: keyedRecord(factions, () => 4),
        killCount: keyedRecord(factions, () => 0),
        factionMoraleBoost: keyedRecord(factions, () => 0),
        playerHands: keyedRecord(factions, () => []),
        playerDrawsThisTurn: keyedRecord(factions, () => 0),
        playerUsesThisTurn: keyedRecord(factions, () => 0),
        visibleTiles: keyedRecord(factions, () => new Set()),
        exploredTiles: keyedRecord(factions, () => new Set()),
        scoutReveals: keyedRecord(factions, () => new Map()),
        submarineReveals: keyedRecord(factions, () => ({}))
    };
}

/**
 * The single runtime entry point used by skirmish, network and editor-authored campaigns.
 * Authoring layers provide definitions; rules always consume the normalized state below.
 */
export function configureMatchFactions(match, {
    factionDefinitions = [],
    diplomacy = {},
    turnOrder = [],
    localPlayerCampKey = null,
    roleAssignments = {},
    defaultGold = 4
} = {}) {
    const factions = createDefaultFactions(factionDefinitions);
    const keys = Object.keys(factions);
    const eligible = keys.filter(key => factions[key]?.active !== false && factions[key]?.participatesInTurns !== false);
    const normalizedOrder = [...new Set((turnOrder || []).filter(key => eligible.includes(key)))];
    for (const key of eligible) if (!normalizedOrder.includes(key)) normalizedOrder.push(key);
    const humanKey = keys.find(key => factions[key]?.controller === 'human');
    const localKey = factions[localPlayerCampKey] ? localPlayerCampKey : humanKey || normalizedOrder[0] || keys[0];
    match.factions = factions;
    match.roleAssignments = Object.keys(roleAssignments).length
        ? { ...roleAssignments }
        : Object.fromEntries(keys.filter(key => /^player\d+$/.test(key)).map(key => [key, key]));
    match.factionColorSelections = Object.fromEntries(keys.filter(key => key !== 'neutral').map(key => [key, factions[key].colorId]));
    match.turnOrder = normalizedOrder.length ? normalizedOrder : [localKey];
    match.turnOrderRolls = {};
    match.diplomacy = createDefaultDiplomacy(diplomacy, factions);
    match.localPlayerCampKey = localKey;
    match.currentCamp = factions[match.turnOrder[0]] || factions[localKey];
    match.playerGold = keyedRecord(factions, () => defaultGold);
    match.killCount = keyedRecord(factions, () => 0);
    match.factionMoraleBoost = keyedRecord(factions, () => 0);
    match.playerHands = keyedRecord(factions, () => []);
    match.playerDrawsThisTurn = keyedRecord(factions, () => 0);
    match.playerUsesThisTurn = keyedRecord(factions, () => 0);
    match.visibleTiles = keyedRecord(factions, () => new Set());
    match.exploredTiles = keyedRecord(factions, () => new Set());
    match.scoutReveals = keyedRecord(factions, () => new Map());
    match.submarineReveals = keyedRecord(factions, () => ({}));
    return factions;
}

/** Configure a skirmish runtime. Seat IDs remain stable while colors and order stay mutable. */
export function configureStandardMatch(match, { playerCount = 2, colors = {}, flagEmojis = {}, controllers = {} } = {}) {
    const definitions = Object.values(createStandardFactions({ playerCount, colors, flagEmojis, controllers }));
    const players = ['player1', 'player2', ...(Number(playerCount) === 3 ? ['player3'] : [])];
    return configureMatchFactions(match, {
        factionDefinitions: definitions,
        turnOrder: [...players, 'neutral'],
        localPlayerCampKey: players.find(key => controllers[key] === 'human') || 'player1',
        roleAssignments: Object.fromEntries(players.map(key => [key, key]))
    });
}

// ===== MatchState =====================
export function createMatchState() {
    const standard = createStandardRuntime(2);
    return {
        tiles: [],
        tileMap: new Map(),
        boardLayout: 'hex',
        // Sparse authored surface/hydrography plus exact derived topology.
        // Maps and topology are rebuilt from serializable specs on restore.
        surfaceMap: new Map(),
        coastEdges: [],
        rivers: [],
        riverCrossings: [],
        riverTopology: buildRiverTopology(),
        ports: [],
        portTiles: new Map(),
        submarineReveals: standard.submarineReveals,
        shoreBatteryBuiltRound: {},
        currentCamp: standard.factions[standard.turnOrder[0]],
        playerGold: standard.playerGold,
        turnCounter: 0,
        gameOver: false,
        victoryCamp: null,
        logHistory: [],
        killCount: standard.killCount,
        _friendlyDeathCount: {},
        gameMode: 'local',      // 'local' | 'pve' | 'network'
        standardMapId: DEFAULT_STANDARD_MAP_ID,
        _trainingMode: false,
        // 教程是单机 PVE 的受限剧本；步骤数据留在状态上，供规则层阻止跳关。
        tutorialMode: false,
        tutorialStep: '',
        tutorialTargets: null,
        // 单人战役拥有独立的任务裁决；tutorialMode 仅可作为关卡前半段的输入引导锁。
        campaignMode: false,
        campaignId: null,
        scenarioId: null,
        campaignPhase: '',
        localPlayerCampKey: 'player1',
        factions: standard.factions,
        roleAssignments: standard.roleAssignments,
        factionColorSelections: standard.factionColorSelections,
        turnOrder: standard.turnOrder,
        turnOrderRolls: {},
        diplomacy: createDefaultDiplomacy({}, standard.factions),
        campaignVariables: {},
        levelVariables: {},
        objectiveStates: {},
        interactionStates: {},
        mechanics: createDefaultMechanics(),
        airfieldCapOverrides: {},
        aiOpponentCamp: null,   // PVE 模式下 AI 对手的运行时阵营对象
        isThreePlayer: false,   // 三人模式
        surrenderedCamps: [],   // 三人模式中已投降的阵营
        weather: 'clear',
        lastWeather: null,
        weatherLockUntil: 0,  // E1: 占星者星移锁定天气至该回合
        _starlightResume: false, // E1: 星移锁定结束后强制重新随机天气
        _cardOverrides: {},   // E3: 纵横家合纵卡牌覆盖 { campKey: { handSizeBonus, useBonus } }
        _soulMarks: [],       // E2: 亡灵法师亡魂标记 [{ q, r, campKey, bornAt }]
        _colonelDeployed: {},
        _droneDeployTurn: {},
        _droneDeployCount: {},
        _colonelAirStacks: {}, // E4: 上校【老练】空军伤害层数 { campKey: n }
        _aureliaOathUsed: {}, // 奥雷利亚阵营协同被动【同一个誓言】每阵营每局使用记录
        _pendingAureliaOathEvents: [], // 单次攻击广播前的瞬时表现事件，不参与快照
        _eagleSynergy: {},    // 天鹰阵营协同被动【天基支援协议】计量表 { campKey: { total, triggers, taken, takenTriggers, goldPaid } }
        _pendingEagleSynergyEvents: [], // 同步结算路径待广播的鹰链结算事件，不参与快照
        _celestineOracle: {}, // 塞莱斯廷圣国阵营协同【神谕】计量 { campKey: { activeRounds, stage } }
        _noctisBloodTide: {}, // 诺克提斯阵营协同【血月之夜】血潮计量 { campKey: { charge, moonsPending } }
        _sunMoonCharge: {}, // 天衡【日月天衡】充能 { campKey: charge }
        // 模拟用确定性 RNG(战斗/卡牌/将领/天气掷骰)。永不为 null;对局开始时由
        // seedMatchRng() 重新播种。装饰性随机不走这里。状态随 serialize 同步,
        // 使联机收方与重连保持一致。详见 core/rng.js。
        rng: createRng((Date.now() >>> 0) || 1),
        // 将领系统
        commanderPoolP1: [],
        commanderPoolP2: [],
        commanderPoolP3: [],
        commanderP1: null,
        commanderP2: null,
        commanderP3: null,
        commanderP1Secondary: null,
        commanderP2Secondary: null,
        commanderP3Secondary: null,
        commanderP1Confirmed: false,
        commanderP2Confirmed: false,
        commanderP3Confirmed: false,
        commanderP1SecondaryConfirmed: false,
        commanderP2SecondaryConfirmed: false,
        commanderP3SecondaryConfirmed: false,
        commanderP1Deployed: false,
        commanderP2Deployed: false,
        commanderP3Deployed: false,
        commanderP1SecondaryDeployed: false,
        commanderP2SecondaryDeployed: false,
        commanderP3SecondaryDeployed: false,
        doubleCommanderMode: false,
        // 洗牌换将：每名玩家一次性，消耗全部初始资金换 3 名未被占用的将领
        commanderRerolled: { player1: false, player2: false, player3: false },
        _rerollPenaltyApplied: { player1: false, player2: false, player3: false },
        commanderPhase: 'done',  // 'selection' | 'deployment' | 'done'
        factionMoraleBoost: standard.factionMoraleBoost,
        // 对策卡系统 v2
        cardDrawPile: [],
        cardDiscardPile: [],
        playerHands: standard.playerHands,
        playerDrawsThisTurn: standard.playerDrawsThisTurn,
        playerUsesThisTurn: standard.playerUsesThisTurn,
        // 战争迷雾（遭遇战模式）
        skirmishFog: false,
        visibleTiles: standard.visibleTiles,
        exploredTiles: standard.exploredTiles,
        // 侦察揭示：{ player1: Map("q,r" → expiresAt), ... }
        scoutReveals: standard.scoutReveals,
        // 国界线（阵营交界边集）/ 行政区界线 —— 由 tiles 派生的缓存
        campBorderEdges: [],
        districtBorderEdges: [],
        // 村庄：Map("q,r" → { districtId, q, r })
        villageTiles: new Map(),
        // PVE 难度：对手 AI 经济倍率（不影响中立 AI）
        aiDifficulty: 1.0,
        aiDifficultyId: 'easy',
        aiDifficultyByCamp: {},
        _aiFortificationsBuilt: {}
    };
}

// 重置对局字段（再来一局时调用）。
// 模式字段必须在新对局时归零；训练场与教程会在启动流程中显式恢复自身模式。
export function resetMatchState(match) {
    const standard = createStandardRuntime(2);
    match.tiles = [];
    match.tileMap = new Map();
    match.boardLayout = 'hex';
    match.surfaceMap = new Map();
    match.coastEdges = [];
    match.rivers = [];
    match.riverCrossings = [];
    match.riverTopology = buildRiverTopology();
    match.ports = [];
    match.portTiles = new Map();
    match.currentCamp = standard.factions[standard.turnOrder[0]];
    match.playerGold = standard.playerGold;
    match.turnCounter = 0;
    // 新对局重新播种模拟 RNG(联机模式随后会被 state-sync 对齐;可由
    // seedMatchRng 显式指定共享种子以做到开局即跨端确定)。
    const resetSalt = Math.imul(++resetSeedCounter, 0x9E3779B9);
    match.rng.setState(((Date.now() >>> 0) ^ resetSalt) >>> 0);
    match.gameOver = false;
    match.victoryCamp = null;
    match.logHistory = [];
    match.killCount = standard.killCount;
    match._friendlyDeathCount = {};
    match.gameMode = 'local';
    match.standardMapId = DEFAULT_STANDARD_MAP_ID;
    match._trainingMode = false;
    match.tutorialMode = false;
    match.tutorialStep = '';
    match.tutorialTargets = null;
    match.campaignMode = false;
    match.campaignId = null;
    match.scenarioId = null;
    match.campaignPhase = '';
    match.localPlayerCampKey = 'player1';
    match.factions = standard.factions;
    match.roleAssignments = standard.roleAssignments;
    match.factionColorSelections = standard.factionColorSelections;
    match.turnOrder = standard.turnOrder;
    match.turnOrderRolls = {};
    match.diplomacy = createDefaultDiplomacy({}, standard.factions);
    match.campaignVariables = {};
    match.levelVariables = {};
    match.objectiveStates = {};
    match.interactionStates = {};
    match.mechanics = createDefaultMechanics();
    match.aiOpponentCamp = null;
    match.isThreePlayer = false;
    match.surrenderedCamps = [];
    match.weather = 'clear';
    match.lastWeather = null;
    match.weatherLockUntil = 0;
    match._starlightResume = false;
    match._cardOverrides = {};
    match._soulMarks = [];
    match._colonelDeployed = {};
    match._droneDeployTurn = {};
    match._droneDeployCount = {};
    match._colonelAirStacks = {};
    match._aureliaOathUsed = {};
    match._pendingAureliaOathEvents = [];
    match._eagleSynergy = {};
    match._pendingEagleSynergyEvents = [];
    match._celestineOracle = {};
    match._noctisBloodTide = {};
    match._borrowDayImprison = {};
    match._sunMoonCharge = {};
    match.skirmishFog = false;
    match.visibleTiles = standard.visibleTiles;
    match.exploredTiles = standard.exploredTiles;
    match.scoutReveals = standard.scoutReveals;
    match.campBorderEdges = [];
    match.districtBorderEdges = [];
    match.villageTiles = new Map();
    match.aiDifficulty = 1.0;
    match.aiDifficultyId = 'easy';
    match.aiDifficultyByCamp = {};
    match._aiFortificationsBuilt = {};
    match.commanderPoolP1 = [];
    match.commanderPoolP2 = [];
    match.commanderPoolP3 = [];
    match.commanderP1 = null;
    match.commanderP2 = null;
    match.commanderP3 = null;
    match.commanderP1Secondary = null;
    match.commanderP2Secondary = null;
    match.commanderP3Secondary = null;
    match.commanderP1Confirmed = false;
    match.commanderP2Confirmed = false;
    match.commanderP3Confirmed = false;
    match.commanderP1SecondaryConfirmed = false;
    match.commanderP2SecondaryConfirmed = false;
    match.commanderP3SecondaryConfirmed = false;
    match.commanderP1Deployed = false;
    match.commanderP2Deployed = false;
    match.commanderP3Deployed = false;
    match.commanderP1SecondaryDeployed = false;
    match.commanderP2SecondaryDeployed = false;
    match.commanderP3SecondaryDeployed = false;
    match.doubleCommanderMode = false;
    match.commanderRerolled = { player1: false, player2: false, player3: false };
    match._rerollPenaltyApplied = { player1: false, player2: false, player3: false };
    match.commanderPhase = 'done';
    match.factionMoraleBoost = standard.factionMoraleBoost;
    match.cardDrawPile = [];
    match.cardDiscardPile = [];
    match.playerHands = standard.playerHands;
    match.playerDrawsThisTurn = standard.playerDrawsThisTurn;
    match.playerUsesThisTurn = standard.playerUsesThisTurn;
}

// ===== ClientUiState =====================
// 本地查看/选中/动画状态。阶段 3 会进一步拆出独立的查看目标持久化
export function createClientUiState() {
    return {
        selectedUnit: null,
        movableTiles: [],
        _fogSafeMovablePreview: null,
        moveParents: new Map(),
        attackableTiles: [],
        damageTexts: [],
        healTexts: [],
        shieldTexts: [],
        goldTexts: [],
        // 延迟/错峰浮字队列（js/floatTexts.js）：到期由渲染帧搬入活动数组
        floatTextPending: [],
        // 待广播浮字捕获（broadcastAction drain 进 effectData.floatTexts）
        _pendingFloatTexts: [],
        selectedCityTile: null,
        selectedTile: null,
        hoveredTile: null,
        selectionTime: 0,
        previousGold: { player1: 4, player2: 4, player3: 4, neutral: 4 },
        aiActing: false,
        deselecting: false,
        deselectionTime: 0,
        deselectMoveTiles: [],
        deselectAtkTiles: [],
        deselectOrigin: null,
        cardStackExpanded: false,
        cardTargeting: null,
        _prevVisibleTiles: { player1: new Set(), player2: new Set(), player3: new Set() },
        _fogTransitionStart: 0,
        _fogPresentationHolds: {},
        // 遭遇战胜利时保存的完整棋盘快照（用于查看完整棋局）
        _victoryBoardSnapshot: null,
        // 纯本地的查看目标；同步 MatchState 时按这个稳定标识重新解析。
        // unit 优先跟随移动后的单位，tile 用于查看空格、城市和村庄。
        inspectionTarget: null,
        // 联机：本地已确认但尚未被服务端快照收录的投降（revision 竞争时由 reconcile 重放）
        _localSurrenderPendingKey: null,
        _localSurrenderRetries: 0
    };
}

export function resetClientUiState(ui) {
    ui.selectedUnit = null;
    ui.movableTiles = [];
    ui._fogSafeMovablePreview = null;
    ui.moveParents = new Map();
    ui.attackableTiles = [];
    ui.damageTexts = [];
    ui.healTexts = [];
    ui.shieldTexts = [];
    ui.goldTexts = [];
    ui.floatTextPending = [];
    ui._pendingFloatTexts = [];
    ui.selectedCityTile = null;
    ui.selectedTile = null;
    ui.hoveredTile = null;
    ui.selectionTime = 0;
    // 重置后置 -1：跳过金币计数器动画的首帧差值飘字
    ui.previousGold = { player1: -1, player2: -1, player3: -1, neutral: -1 };
    ui.aiActing = false;
    ui.deselecting = false;
    ui.deselectionTime = 0;
    ui.deselectMoveTiles = [];
    ui.deselectAtkTiles = [];
    ui.deselectOrigin = null;
    ui.cardStackExpanded = false;
    ui.cardTargeting = null;
    ui._prevVisibleTiles = { player1: new Set(), player2: new Set(), player3: new Set() };
    ui._fogTransitionStart = 0;
    ui._fogPresentationHolds = {};
    ui._victoryBoardSnapshot = null;
    ui.inspectionTarget = null;
    ui._localSurrenderPendingKey = null;
    ui._localSurrenderRetries = 0;
}

// ===== 序列化 / 快照（联机同步 + 断线重连用） =====================
// 只处理 MatchState；选择、浮层、动画与 DOM 状态一概不进快照。

function _campToKey(c) {
    return campToKey(c);
}

export function serializeMatchState(match) {
    const tilesData = match.tiles.map(t => {
        const surface = normalizeSurfaceKind(t.surface);
        const waterTile = isWaterSurface(surface);
        return {
        id: t.id,
        q: t.q, r: t.r, s: t.s,
        campKey: waterTile && !t.isPort ? null : (t.camp ? _campToKey(t.camp) : null),
        surface,
        isCity: waterTile ? false : !!t.isCity,
        isUrban: waterTile ? false : (t.isUrban || false),
        urbanCenterKey: waterTile ? null : (t.urbanCenterKey || null),
        isVillage: waterTile ? false : !!t.isVillage,
        villageDistrictId: waterTile ? 0 : t.villageDistrictId,
        districtId: waterTile && !t.isPort ? null : t.districtId,
        terrain: waterTile ? 'plains' : t.terrain,
        fortification: waterTile ? null : (t.fortification || null),
        fieldFortification: waterTile ? null : (t.fieldFortification ? { ...t.fieldFortification } : null),
        installation: waterTile ? null : (t.installation ? structuredClone(t.installation) : null),
        isPort: !!t.isPort,
        portCapturedIndependent: !!t._portCapturedIndependent,
        portOperationalAtRound: t._portOperationalAtRound || 0,
        startColor: t.startColor,
        targetColor: t.targetColor,
        currentColor: t.currentColor,
        fadeStartTime: t.fadeStartTime,
        minePlanted: t._minePlanted || false,
        mineCampKey: t._mineCampKey || null,
        mineType: t._mineType || (t._minePlanted ? (waterTile ? 'water' : 'land') : null),
        hp: waterTile ? 0 : (t.hp ?? 0),
        maxHp: waterTile ? 0 : (t.maxHp ?? 0),
        citySiegeDamageRound: waterTile ? -1 : (Number.isFinite(t._citySiegeDamageRound) ? t._citySiegeDamageRound : -1),
        reinforcedThisTurn: (waterTile && !t.isPort) ? false : (t._reinforcedThisTurn || false),
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
            moralePenaltyUntil: t.unit.moralePenaltyUntil || 0,
            flankingMoraleBase: Number.isFinite(t.unit._flankingMoraleBase) ? t.unit._flankingMoraleBase : null,
            flankingMoralePenalty: Number(t.unit._flankingMoralePenalty) || 0,
            flankingMoraleActivePenalty: Number(t.unit._flankingMoraleActivePenalty) || 0,
            flankingMoraleRecoveryUntil: Number(t.unit._flankingMoraleRecoveryUntil) || 0,
            flankForcedIdle: t.unit._flankForcedIdle === true,
            remainingMP: t.unit.remainingMP,
              isEmbarked: t.unit.isEmbarked === true,
              transportTransitionedThisTurn: t.unit._transportTransitionedThisTurn === true,
            portGuardUntilRound: t.unit._portGuardUntilRound || 0,
            submarineAttackExposed: t.unit._submarineAttackExposed === true,
            submarinePortRevealUntilRound: t.unit._submarinePortRevealUntilRound || 0,
            commander: t.unit.commander,
            storyCommanderId: t.unit.storyCommanderId || null,
            commanderName: t.unit.commanderName || '',
            commanderPortrait: t.unit.commanderPortrait || null,
            _centurionTriggered: t.unit._centurionTriggered,
            _atkBonus: t.unit._atkBonus,
            rankModelVersion: 2,
            specializationKey: t.unit.specializationKey || null,
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
            berserkerQixue: t.unit._berserkerQixue || false,
            imprisoned: t.unit._imprisoned || false,
            isImmobile: t.unit._isImmobile || false,
            followsCity: t.unit._followsCity ? { ...t.unit._followsCity } : null,
            airdropWaiting: t.unit._airdropWaiting || false,
            soulRecallLandAt: t.unit._soulRecallLandAt || 0,
            airliftLandAt: t.unit._airliftLandAt || 0,
            martyrPrimed: t.unit._martyrPrimed || false,
            elegyBonus: t.unit._elegyBonus || 0,
            elegyProcessed: t.unit._elegyProcessed || 0,
            isSoulMinion: t.unit._isSoulMinion || false,
            shield: t.unit._shield || 0,
            shieldMax: t.unit._shieldMax || 0,
            shieldTurns: t.unit._shieldTurns || 0,
            poison: t.unit._poison ? { ...t.unit._poison } : null,
            faith: t.unit._faith || 0,
            oathGainTurn: t.unit._oathGainTurn ?? null,
            smiteReady: t.unit._smiteReady || false,
            smiteCharged: t.unit._smiteCharged || false,
            healingAura: t.unit._healingAura || 0,
            aureliaOathUntilRound: t.unit._aureliaOathUntilRound || 0,
            sunMoonOathUntilRound: t.unit._sunMoonOathUntilRound || 0,
            activeSkillBuffs: t.unit._activeSkillBuffs || null,
            isDrone: t.unit._isDrone || false,
            droneSignalDisabled: t.unit._droneSignalDisabled || false,
            droneCampKey: t.unit._droneCampKey || null,
            droneBornAt: t.unit._droneBornAt || 0,
            constructionScaffold: t.unit._constructionScaffold ? { ...t.unit._constructionScaffold } : null,
            fieldRepairCooldown: t.unit._fieldRepairCooldown || 0,
            engineerFieldRepairReadyRound: Number.isFinite(t.unit._engineerFieldRepairReadyRound)
                ? t.unit._engineerFieldRepairReadyRound
                : null
        } : null
        };
    });

    return {
        tiles: tilesData,
        boardLayout: match.boardLayout || 'hex',
        rivers: (match.rivers || []).map(river => ({
            ...river,
            points: (river?.points || []).map(point => ({ ...point }))
        })),
        riverCrossings: (match.riverCrossings || []).map(crossing => ({ ...crossing })),
        crossings: (match.riverCrossings || []).map(crossing => ({ ...crossing })),
        ports: (match.ports || []).map(port => ({
            q: port.q, r: port.r, districtId: port.districtId,
            landQ: port.landQ, landR: port.landR
        })),
        serializedAt: Date.now(),
        currentCampKey: _campToKey(match.currentCamp),
        playerGold: { ...match.playerGold },
        turnCounter: match.turnCounter,
        gameOver: match.gameOver,
        victoryCampKey: match.victoryCamp ? _campToKey(match.victoryCamp) : null,
        campaignMode: !!match.campaignMode,
        campaignId: match.campaignId || null,
        scenarioId: match.scenarioId || null,
        campaignPhase: match.campaignPhase || '',
        localPlayerCampKey: match.localPlayerCampKey || 'player1',
        factions: structuredClone(match.factions || createDefaultFactions()),
        roleAssignments: { ...(match.roleAssignments || {}) },
        factionColorSelections: { ...(match.factionColorSelections || {}) },
        turnOrder: [...(match.turnOrder || [])],
        turnOrderRolls: { ...(match.turnOrderRolls || {}) },
        diplomacy: structuredClone(match.diplomacy || createDefaultDiplomacy()),
        campaignVariables: structuredClone(match.campaignVariables || {}),
        levelVariables: structuredClone(match.levelVariables || {}),
        objectiveStates: structuredClone(match.objectiveStates || {}),
        interactionStates: structuredClone(match.interactionStates || {}),
        mechanics: { ...(match.mechanics || createDefaultMechanics()) },
        airfieldCapOverrides: { ...(match.airfieldCapOverrides || {}) },
        logHistory: [...match.logHistory],
        idCounter: getCounter(),
        weather: match.weather,
        lastWeather: match.lastWeather,
        weatherLockUntil: match.weatherLockUntil || 0,
        starlightResume: match._starlightResume || false,
        cardOverrides: match._cardOverrides || {},
        soulMarks: (match._soulMarks || []).map(m => ({ ...m })),
        colonelDeployed: { ...(match._colonelDeployed || {}) },
        droneDeployTurn: { ...(match._droneDeployTurn || {}) },
        droneDeployCount: { ...(match._droneDeployCount || {}) },
        colonelAirStacks: { ...(match._colonelAirStacks || {}) },
        aureliaOathUsed: { ...(match._aureliaOathUsed || {}) },
        eagleSynergy: Object.fromEntries(Object.entries(match._eagleSynergy || {})
            .map(([campKey, meter]) => [campKey, { ...meter }])),
        celestineOracle: Object.fromEntries(Object.entries(match._celestineOracle || {})
            .map(([campKey, oracle]) => [campKey, { ...oracle }])),
        noctisBloodTide: Object.fromEntries(Object.entries(match._noctisBloodTide || {})
            .map(([campKey, tide]) => [campKey, { ...tide }])),
        borrowDayImprison: { ...(match._borrowDayImprison || {}) },
        sunMoonCharge: { ...(match._sunMoonCharge || {}) },
        rngState: match.rng.getState(),
        killCount: { ...match.killCount },
        friendlyDeathCount: { ...(match._friendlyDeathCount || {}) },
        commanderPoolP1: [...match.commanderPoolP1],
        commanderPoolP2: [...match.commanderPoolP2],
        commanderPoolP3: [...match.commanderPoolP3],
        commanderP1: match.commanderP1,
        commanderP2: match.commanderP2,
        commanderP3: match.commanderP3,
        commanderP1Secondary: match.commanderP1Secondary,
        commanderP2Secondary: match.commanderP2Secondary,
        commanderP3Secondary: match.commanderP3Secondary,
        commanderP1Confirmed: match.commanderP1Confirmed,
        commanderP2Confirmed: match.commanderP2Confirmed,
        commanderP3Confirmed: match.commanderP3Confirmed,
        commanderP1SecondaryConfirmed: match.commanderP1SecondaryConfirmed,
        commanderP2SecondaryConfirmed: match.commanderP2SecondaryConfirmed,
        commanderP3SecondaryConfirmed: match.commanderP3SecondaryConfirmed,
        commanderP1Deployed: match.commanderP1Deployed,
        commanderP2Deployed: match.commanderP2Deployed,
        commanderP3Deployed: match.commanderP3Deployed,
        commanderP1SecondaryDeployed: match.commanderP1SecondaryDeployed,
        commanderP2SecondaryDeployed: match.commanderP2SecondaryDeployed,
        commanderP3SecondaryDeployed: match.commanderP3SecondaryDeployed,
        doubleCommanderMode: match.doubleCommanderMode || false,
        commanderRerolled: { ...(match.commanderRerolled || {}) },
        rerollPenaltyApplied: { ...(match._rerollPenaltyApplied || {}) },
        commanderPhase: match.commanderPhase,
        factionMoraleBoost: { ...match.factionMoraleBoost },
        cardDrawPile: [...match.cardDrawPile],
        cardDiscardPile: [...match.cardDiscardPile],
        playerHands: Object.fromEntries(Object.entries(match.playerHands || {}).map(([key, hand]) => [key, [...(hand || [])]])),
        playerDrawsThisTurn: { ...match.playerDrawsThisTurn },
        playerUsesThisTurn: { ...match.playerUsesThisTurn },
        gameMode: match.gameMode || 'local',
        standardMapId: match.standardMapId || DEFAULT_STANDARD_MAP_ID,
        trainingMode: match._trainingMode || false,
        isThreePlayer: match.isThreePlayer || false,
        aiOpponentCampKey: match.aiOpponentCamp ? _campToKey(match.aiOpponentCamp) : null,
        surrenderedCampKeys: match.surrenderedCamps.map(c => _campToKey(c)),
        skirmishFog: match.skirmishFog || false,
        aiDifficulty: match.aiDifficulty || 1.0,
        aiDifficultyId: match.aiDifficultyId || null,
        aiDifficultyByCamp: { ...(match.aiDifficultyByCamp || {}) },
        aiFortificationsBuilt: { ...(match._aiFortificationsBuilt || {}) },
        visibleTiles: Object.fromEntries(Object.entries(match.visibleTiles || {}).map(([key, tiles]) => [key, [...tiles]])),
        exploredTiles: Object.fromEntries(Object.entries(match.exploredTiles || {}).map(([key, tiles]) => [key, [...tiles]])),
        scoutReveals: Object.fromEntries(Object.entries(match.scoutReveals || {}).map(([key, reveals]) => [key, [...reveals]])),
        submarineReveals: structuredClone(match.submarineReveals || {}),
        shoreBatteryBuiltRound: { ...(match.shoreBatteryBuiltRound || {}) },
        villageTiles: [...match.villageTiles]
    };
}

/**
 * 从快照恢复 MatchState（不触碰任何 UI；调用方负责界面刷新）。
 * @param {object} match  对局状态（过渡期即 gameState 单例）
 * @param {object} data   serializeMatchState 的产物
 * @param {object} deps   { HexTileClass, UnitClass, computeCampBorders, computeDistrictBorders }
 */
export function restoreMatchState(match, data, deps) {
    const { HexTileClass, UnitClass, computeCampBorders, computeDistrictBorders } = deps;
    const fallbackFactions = createStandardFactions({ playerCount: data.isThreePlayer ? 3 : 2 });
    match.factions = data.factions ? structuredClone(data.factions) : fallbackFactions;
    const campMap = Object.fromEntries(Object.entries(match.factions));
    const resolveCamp = key => campMap[key] || null;
    const factionKeys = Object.keys(match.factions);
    const record = (value, fallbackFactory) => Object.fromEntries(factionKeys.map(key => [
        key,
        Object.prototype.hasOwnProperty.call(value || {}, key) ? value[key] : fallbackFactory(key)
    ]));

    setCounter(data.idCounter);
    match.gameOver = data.gameOver;
    match.campaignMode = !!data.campaignMode;
    match.campaignId = data.campaignId || null;
    match.scenarioId = data.scenarioId || null;
    match.campaignPhase = data.campaignPhase || '';
    match.localPlayerCampKey = data.localPlayerCampKey || 'player1';
    match.roleAssignments = data.roleAssignments
        ? { ...data.roleAssignments }
        : Object.fromEntries(['player1', 'player2', 'player3'].filter(key => match.factions[key]?.active !== false).map(key => [key, key]));
    match.factionColorSelections = data.factionColorSelections
        ? { ...data.factionColorSelections }
        : Object.fromEntries(factionKeys.filter(key => key !== 'neutral').map(key => [key, match.factions[key]?.colorId || null]));
    const restoredOrder = Array.isArray(data.turnOrder) ? data.turnOrder.filter(key => campMap[key]) : [];
    match.turnOrder = restoredOrder.length
        ? restoredOrder
        : factionKeys.filter(key => match.factions[key]?.active !== false && match.factions[key]?.participatesInTurns !== false);
    match.turnOrderRolls = { ...(data.turnOrderRolls || {}) };
    match.diplomacy = data.diplomacy ? structuredClone(data.diplomacy) : createDefaultDiplomacy({}, match.factions);
    match.campaignVariables = data.campaignVariables ? structuredClone(data.campaignVariables) : {};
    match.levelVariables = data.levelVariables ? structuredClone(data.levelVariables) : {};
    match.objectiveStates = data.objectiveStates ? structuredClone(data.objectiveStates) : {};
    match.interactionStates = data.interactionStates ? structuredClone(data.interactionStates) : {};
    match.mechanics = data.mechanics ? { ...data.mechanics } : createDefaultMechanics();
    match.airfieldCapOverrides = { ...(data.airfieldCapOverrides || {}) };
    match.boardLayout = data.boardLayout || 'hex';
    match.rivers = (data.rivers || []).map(river => ({
        ...river,
        points: (river?.points || []).map(point => ({ ...point }))
    }));
    const serializedCrossings = Array.isArray(data.crossings) ? data.crossings : data.riverCrossings;
    match.riverCrossings = (serializedCrossings || []).map(crossing => ({ ...crossing }));
    match.ports = (data.ports || []).map(port => ({
        q: port.q, r: port.r, districtId: port.districtId,
        landQ: port.landQ, landR: port.landR
    }));
    match.riverTopology = buildRiverTopology(match.rivers, match.riverCrossings);
    match.currentCamp = resolveCamp(data.currentCampKey) || campMap[match.turnOrder[0]] || Object.values(match.factions)[0];
    match.victoryCamp = data.victoryCampKey ? resolveCamp(data.victoryCampKey) : null;
    match.playerGold = record(data.playerGold, () => 4);
    // previousGold 不参与同步，保持本地值用于计数器动画
    match.turnCounter = data.turnCounter;
    match.logHistory = [...data.logHistory];
    match.weather = data.weather || 'clear';
    match.lastWeather = data.lastWeather || null;
    match.weatherLockUntil = data.weatherLockUntil || 0;
    match._starlightResume = data.starlightResume || false;
    match._cardOverrides = data.cardOverrides || {};
    match._soulMarks = data.soulMarks || [];
    match._colonelDeployed = data.colonelDeployed || {};
    match._droneDeployTurn = data.droneDeployTurn || {};
    match._droneDeployCount = data.droneDeployCount || {};
    match._colonelAirStacks = data.colonelAirStacks || {};
    match._aureliaOathUsed = data.aureliaOathUsed || {};
    match._pendingAureliaOathEvents = [];
    match._eagleSynergy = Object.fromEntries(Object.entries(data.eagleSynergy || {})
        .map(([campKey, meter]) => [campKey, {
            total: meter?.total || 0,
            triggers: meter?.triggers || 0,
            taken: meter?.taken || 0,
            takenTriggers: meter?.takenTriggers || 0,
            // 缺失/非有限值时留 undefined，由 ensureEagleMeter 按 triggers 推导兜底，
            // 不能兜底为 0——旧版快照的战功可能已即时拨付过，归 0 会重复拨付。
            goldPaid: Number.isFinite(meter?.goldPaid) ? meter.goldPaid : undefined
        }]));
    match._pendingEagleSynergyEvents = [];
    match._celestineOracle = Object.fromEntries(Object.entries(data.celestineOracle || {})
        .map(([campKey, oracle]) => [campKey, {
            activeRounds: oracle?.activeRounds || 0,
            stage: oracle?.stage || 1,
            _lastHeroStage: oracle?._lastHeroStage || 0
        }]));
    match._noctisBloodTide = Object.fromEntries(Object.entries(data.noctisBloodTide || {})
        .map(([campKey, tide]) => [campKey, {
            charge: tide?.charge || 0,
            moonsPending: tide?.moonsPending || 0
        }]));
    match._borrowDayImprison = data.borrowDayImprison || {};
    match._sunMoonCharge = { ...(data.sunMoonCharge || {}) };
    match.submarineReveals = record(data.submarineReveals, () => ({}));
    match.shoreBatteryBuiltRound = { ...(data.shoreBatteryBuiltRound || {}) };
    // 恢复模拟 RNG 状态(旧版本快照无此字段时保持当前 rng,不影响)
    if (data.rngState != null) match.rng.setState(data.rngState);
    match.killCount = record(data.killCount, () => 0);
    match._friendlyDeathCount = data.friendlyDeathCount || {};
    match.commanderPoolP1 = data.commanderPoolP1 || [];
    match.commanderPoolP2 = data.commanderPoolP2 || [];
    match.commanderPoolP3 = data.commanderPoolP3 || [];
    match.commanderP1 = data.commanderP1 || null;
    match.commanderP2 = data.commanderP2 || null;
    match.commanderP3 = data.commanderP3 || null;
    match.commanderP1Secondary = data.commanderP1Secondary || null;
    match.commanderP2Secondary = data.commanderP2Secondary || null;
    match.commanderP3Secondary = data.commanderP3Secondary || null;
    match.commanderP1Confirmed = data.commanderP1Confirmed || false;
    match.commanderP2Confirmed = data.commanderP2Confirmed || false;
    match.commanderP3Confirmed = data.commanderP3Confirmed || false;
    match.commanderP1SecondaryConfirmed = data.commanderP1SecondaryConfirmed || false;
    match.commanderP2SecondaryConfirmed = data.commanderP2SecondaryConfirmed || false;
    match.commanderP3SecondaryConfirmed = data.commanderP3SecondaryConfirmed || false;
    match.commanderP1Deployed = data.commanderP1Deployed || false;
    match.commanderP2Deployed = data.commanderP2Deployed || false;
    match.commanderP3Deployed = data.commanderP3Deployed || false;
    match.commanderP1SecondaryDeployed = data.commanderP1SecondaryDeployed || false;
    match.commanderP2SecondaryDeployed = data.commanderP2SecondaryDeployed || false;
    match.commanderP3SecondaryDeployed = data.commanderP3SecondaryDeployed || false;
    match.doubleCommanderMode = data.doubleCommanderMode || false;
    match.commanderRerolled = { player1: false, player2: false, player3: false, ...(data.commanderRerolled || {}) };
    match._rerollPenaltyApplied = { player1: false, player2: false, player3: false, ...(data.rerollPenaltyApplied || {}) };
    match.commanderPhase = data.commanderPhase || 'done';
    match.factionMoraleBoost = record(data.factionMoraleBoost, () => 0);
    const obsoleteAirCards = new Set(['diveStrafe', 'carpetBomb', 'airlift', 'airstrike', 'airdrop', 'scout']);
    const cardId = card => typeof card === 'object' && card ? card.id : card;
    if (data.cardDrawPile) match.cardDrawPile = data.cardDrawPile.filter(card => !obsoleteAirCards.has(cardId(card)));
    if (data.cardDiscardPile) match.cardDiscardPile = data.cardDiscardPile.filter(card => !obsoleteAirCards.has(cardId(card)));
    match.playerHands = record(data.playerHands, () => []);
    for (const key of factionKeys) {
        match.playerHands[key] = (match.playerHands[key] || []).filter(card => !obsoleteAirCards.has(cardId(card)));
    }
    match.playerDrawsThisTurn = record(data.playerDrawsThisTurn, () => 0);
    match.playerUsesThisTurn = record(data.playerUsesThisTurn, () => 0);
    match.gameMode = data.gameMode || 'local';
    match.standardMapId = data.standardMapId || DEFAULT_STANDARD_MAP_ID;
    match._trainingMode = data.trainingMode || false;
    match.isThreePlayer = data.isThreePlayer || false;
    match.aiOpponentCamp = data.aiOpponentCampKey ? resolveCamp(data.aiOpponentCampKey) : null;
    match.surrenderedCamps = (data.surrenderedCampKeys || []).map(resolveCamp).filter(Boolean);
    match.skirmishFog = data.skirmishFog || false;
    match.villageTiles = new Map(data.villageTiles || []);
    match.aiDifficulty = data.aiDifficulty || 1.0;
    match.aiDifficultyId = data.aiDifficultyId || null;
    match.aiDifficultyByCamp = { ...(data.aiDifficultyByCamp || {}) };
    match._aiFortificationsBuilt = { ...(data.aiFortificationsBuilt || {}) };
    match.visibleTiles = record(data.visibleTiles, () => []);
    match.exploredTiles = record(data.exploredTiles, () => []);
    match.scoutReveals = record(data.scoutReveals, () => []);
    for (const key of factionKeys) {
        match.visibleTiles[key] = new Set(match.visibleTiles[key] || []);
        match.exploredTiles[key] = new Set(match.exploredTiles[key] || []);
        match.scoutReveals[key] = new Map(match.scoutReveals[key] || []);
    }

    // Preserve displayHp & commander for units (prevents flicker & commander loss on sync)
    const oldDisplayHp = new Map();
    const oldCommander = new Map();
    for (const tile of match.tiles) {
        if (tile.unit) {
            oldDisplayHp.set(tile.unit.id, { hp: tile.unit.hp, displayHp: tile.unit.displayHp });
            if (tile.unit.isCommanderUnit) {
                oldCommander.set(tile.unit.id, {
                    commander: tile.unit.commander,
                    storyCommanderId: tile.unit.storyCommanderId,
                    commanderName: tile.unit.commanderName,
                    commanderPortrait: tile.unit.commanderPortrait,
                    _atkBonus: tile.unit._atkBonus,
                    displaySpeed: tile.unit.displaySpeed
                });
            }
        }
    }

    // 校准渐变动画时间戳，补偿网络延迟
    const timeDelta = data.serializedAt ? Date.now() - data.serializedAt : 0;
    // Validate ports against the incoming tile/surface snapshot before units
    // are reconstructed. Otherwise a stale `match.portTiles` entry (or an
    // invalid per-tile isPort flag) can make an inland warship survive restore
    // even though the derived port topology is discarded afterwards.
    const serializedTileKeys = new Set((data.tiles || []).map(tile => tileCoordinateKey(tile)));
    const serializedSurfaceMap = new Map((data.tiles || [])
        .filter(tile => isWaterSurface(normalizeSurfaceKind(tile?.surface)))
        .map(tile => [tileCoordinateKey(tile), normalizeSurfaceKind(tile.surface)]));
    const portCandidates = match.ports.length
        ? match.ports
        : (data.tiles || []).filter(tile => tile?.isPort === true)
            .map(tile => ({ q: tile.q, r: tile.r, districtId: tile.districtId }));
    const restoredPortKeys = new Set();
    const hasSerializedAdjacentLand = port => HEX_NEIGHBORS.some(([dq, dr]) => {
        const neighborKey = tileCoordinateKey(port.q + dq, port.r + dr);
        return serializedTileKeys.has(neighborKey) && !serializedSurfaceMap.has(neighborKey);
    });
    const restoredPorts = [];
    for (const port of portCandidates) {
        const key = tileCoordinateKey(port);
        if (restoredPortKeys.has(key)
            || !serializedTileKeys.has(key)
            || serializedSurfaceMap.get(key) !== SURFACE_KIND.SHALLOW_WATER
            || !hasSerializedAdjacentLand(port)
            || !Number.isInteger(port.districtId)) continue;
        restoredPortKeys.add(key);
        restoredPorts.push({
            q: port.q, r: port.r, districtId: port.districtId,
            landQ: port.landQ, landR: port.landR
        });
    }
    match.ports = restoredPorts;
    match.portTiles = new Map();

    match.tiles = data.tiles.map(td => {
        const tile = new HexTileClass(td.q, td.r, td.id);
        tile.s = td.s;
        tile.surface = normalizeSurfaceKind(td.surface);
        const waterTile = isWaterSurface(tile.surface);
        const restoredPort = waterTile && restoredPortKeys.has(tileCoordinateKey(td.q, td.r));
        tile.camp = waterTile && !restoredPort ? null : (campMap[td.campKey] || campMap.neutral || null);
        tile.isCity = waterTile ? false : !!td.isCity;
        tile.isUrban = waterTile ? false : (td.isUrban ?? !!td.isCity);
        tile.urbanCenterKey = waterTile ? null : (td.urbanCenterKey || (td.isCity ? tileCoordinateKey(td.q, td.r) : null));
        tile.isVillage = waterTile ? false : (td.isVillage || false);
        tile.villageDistrictId = waterTile ? 0 : (td.villageDistrictId || 0);
        tile.districtId = waterTile && !restoredPort ? null : td.districtId;
        tile.terrain = waterTile ? 'plains' : (td.terrain || 'plains');
        tile.fortification = waterTile ? null : (td.fieldFortification?.type || td.fortification || null);
        tile.fieldFortification = waterTile || !tile.fortification ? null : (td.fieldFortification
            ? { ...td.fieldFortification }
            : { type: tile.fortification, campKey: null, ownerKnown: false });
        tile.installation = waterTile || !td.installation ? null : structuredClone(td.installation);
        tile.isPort = restoredPort;
        tile._portCapturedIndependent = restoredPort && td.portCapturedIndependent === true;
        tile._portOperationalAtRound = restoredPort ? (td.portOperationalAtRound || 0) : 0;
        const surfaceColor = getSurfaceBaseColor(tile.surface);
        tile.startColor = waterTile ? surfaceColor : (td.startColor || tile.camp?.color);
        tile.targetColor = waterTile ? surfaceColor : (td.targetColor || tile.camp?.color);
        tile.currentColor = waterTile ? surfaceColor : (td.currentColor || tile.camp?.color);
        // 将主机时间戳校准为本地时间，若动画已过期则直接应用目标色
        if (td.fadeStartTime && !waterTile) {
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
        tile._mineType = td.mineType || (tile._minePlanted ? (waterTile ? 'water' : 'land') : null);
        // 旧存档缺少 hp/maxHp 字段时，城市地块按满血兜底，不崩溃、不误判瘫痪。
        tile.maxHp = waterTile ? 0 : (Number.isFinite(td.maxHp) && td.maxHp > 0
            ? td.maxHp
            : (tile.isCity ? CITY_SIEGE_CONFIG.baseMaxHp : 0));
        tile.hp = waterTile ? 0 : (Number.isFinite(td.hp) ? td.hp : tile.maxHp);
        tile._citySiegeDamageRound = waterTile ? -1 : (Number.isFinite(td.citySiegeDamageRound) ? td.citySiegeDamageRound : -1);
        tile._reinforcedThisTurn = (waterTile && !restoredPort) ? false : (td.reinforcedThisTurn || false);
        const unitType = td.unit ? (td.unit.isDrone ? 'drone' : td.unit.type) : null;
        if (td.unit && canUnitOccupyTile({ type: unitType, isEmbarked: td.unit.isEmbarked === true }, tile, match)) {
            const unit = new UnitClass(
                unitType,
                campMap[td.unit.campKey],
                tile,
                td.unit.isNewRecruit,
                td.unit.id,
                td.unit.commander || null,
                {
                    isEmbarked: td.unit.isEmbarked === true,
                    transitionedThisTurn: td.unit.transportTransitionedThisTurn === true
                }
            );
            unit._xp = Math.max(0, Number(td.unit.xp) || 0);
            unit._rank = unit._rankLocked ? 0 : Math.max(0, Math.min(4, Math.trunc(Number(td.unit.rank) || 0)));
            unit.specializationKey = td.unit.specializationKey || null;
            unit._rebuildRankProfile({ adjustResources: false });
            unit.hp = Math.max(0, Math.min(unit.maxHp, Number(td.unit.hp) || 0));
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
            unit.moralePenaltyUntil = td.unit.moralePenaltyUntil || 0;
            unit._flankingMoraleBase = Number.isFinite(td.unit.flankingMoraleBase) ? td.unit.flankingMoraleBase : null;
            const legacyFlankingPenalty = Number.isFinite(td.unit.flankingMoraleCap)
                && Number.isFinite(td.unit.flankingMoraleBase)
                ? Math.max(0, Math.min(2, td.unit.flankingMoraleBase - unit.morale))
                : 0;
            unit._flankingMoralePenalty = Math.max(0, Math.min(2,
                Number(td.unit.flankingMoralePenalty) || legacyFlankingPenalty));
            unit._flankingMoraleActivePenalty = Math.max(0, Math.min(2,
                Number.isFinite(td.unit.flankingMoraleActivePenalty)
                    ? td.unit.flankingMoraleActivePenalty
                    : unit._flankingMoralePenalty));
            unit._flankingMoraleRecoveryUntil = Math.max(0, Number(td.unit.flankingMoraleRecoveryUntil) || 0);
            unit._flankForcedIdle = td.unit.flankForcedIdle === true;
            unit.remainingMP = td.unit.remainingMP ?? unit.getEffectiveSpeed();
              unit.isEmbarked = td.unit.isEmbarked === true;
              unit._transportTransitionedThisTurn = td.unit.transportTransitionedThisTurn === true;
            unit._portGuardUntilRound = td.unit.portGuardUntilRound || 0;
            unit._submarineAttackExposed = td.unit.submarineAttackExposed === true;
            unit._submarinePortRevealUntilRound = td.unit.submarinePortRevealUntilRound || 0;
            unit.commander = td.unit.commander || null;
            unit.storyCommanderId = td.unit.storyCommanderId || null;
            unit.commanderName = td.unit.commanderName || '';
            unit.commanderPortrait = td.unit.commanderPortrait || unit.commander || null;
            unit._centurionTriggered = td.unit._centurionTriggered || false;
            const legacyRankAttack = !td.unit.rankModelVersion && unit._rank >= 2 ? 10 : 0;
            unit._atkBonus = Math.max(0, (Number(td.unit._atkBonus) || 0) - legacyRankAttack);
            unit.displaySpeed = unit.getEffectiveSpeed();
            unit._fallen = td.unit.fallen || false;
            unit.activeSkillCD = td.unit.activeSkillCD || 0;
            unit.activeSkillDur = td.unit.activeSkillDur || 0;
            unit._phantomStacks = td.unit.phantomStacks || 0;
            unit._berserkerQixue = td.unit.berserkerQixue || false;
            unit._imprisoned = td.unit.imprisoned || false;
            unit._isImmobile = td.unit.isImmobile || false;
            unit._followsCity = td.unit.followsCity ? { ...td.unit.followsCity } : null;
            unit._airdropWaiting = td.unit.airdropWaiting || false;
            unit._soulRecallLandAt = td.unit.soulRecallLandAt || 0;
            unit._airliftLandAt = td.unit.airliftLandAt || 0;
            unit._martyrPrimed = td.unit.martyrPrimed || false;
            unit._elegyBonus = td.unit.elegyBonus || 0;
            unit._elegyProcessed = td.unit.elegyProcessed || 0;
            unit._isSoulMinion = td.unit.isSoulMinion || false;
            unit._shield = td.unit.shield || 0;
            unit._shieldMax = td.unit.shieldMax || 0;
            unit._shieldTurns = td.unit.shieldTurns || 0;
            unit._poison = td.unit.poison ? { ...td.unit.poison } : null;
            unit._faith = td.unit.faith || 0;
            unit._oathGainTurn = td.unit.oathGainTurn ?? undefined;
            unit._smiteReady = td.unit.smiteReady || false;
            unit._smiteCharged = td.unit.smiteCharged || false;
            unit._healingAura = td.unit.healingAura || 0;
            unit._aureliaOathUntilRound = td.unit.aureliaOathUntilRound || 0;
            unit._sunMoonOathUntilRound = td.unit.sunMoonOathUntilRound || 0;
            unit._activeSkillBuffs = td.unit.activeSkillBuffs || null;
            unit._isDrone = td.unit.isDrone || false;
            unit._droneSignalDisabled = td.unit.droneSignalDisabled || false;
            unit._droneCampKey = td.unit.droneCampKey || null;
            unit._droneBornAt = td.unit.droneBornAt || 0;
            unit._engineerConstruction = td.unit.engineerConstruction ? { ...td.unit.engineerConstruction } : null;
            unit._engineerScaffold = td.unit.engineerScaffold ? { ...td.unit.engineerScaffold } : null;
            unit._engineerBunkerCD = td.unit.engineerBunkerCD || 0;
            unit._constructionScaffold = td.unit.constructionScaffold ? { ...td.unit.constructionScaffold } : null;
            unit._fieldRepairCooldown = td.unit.fieldRepairCooldown || 0;
            unit._engineerFieldRepairReadyRound = Number.isFinite(td.unit.engineerFieldRepairReadyRound)
                ? td.unit.engineerFieldRepairReadyRound
                : Number.isFinite(td.unit.fieldRepairReadyRound)
                    ? td.unit.fieldRepairReadyRound
                : undefined;
            // 保留本地已知的将领数据（对方状态同步中可能缺失我方部署的将领）
            if (!unit.isCommanderUnit) {
                const saved = oldCommander.get(unit.id);
                if (saved) {
                    unit.commander = saved.commander;
                    unit.storyCommanderId = saved.storyCommanderId || null;
                    unit.commanderName = saved.commanderName || '';
                    unit.commanderPortrait = saved.commanderPortrait || saved.commander || null;
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

    match.tileMap = new Map();
    for (const tile of match.tiles) {
        match.tileMap.set(tileCoordinateKey(tile), tile);
    }
    // 旧存档城内格缺少血池镜像时，以中心格血池为准回填。
    for (const tile of match.tiles) {
        if (tile.isCity) syncCityHpMirrors(tile, match.tileMap);
    }
    const snapshotHasInstallations = (data.tiles || []).some(tile =>
        Object.prototype.hasOwnProperty.call(tile || {}, 'installation')
    );
    if (!snapshotHasInstallations && !match.campaignMode) {
        for (const key of factionKeys.filter(key => key !== 'neutral')) {
            const city = match.tiles.find(tile => tile.isCity && _campToKey(tile.camp) === key);
            if (!city) continue;
            city.installation = {
                type: 'airfield', campKey: key, status: 'ready', turnsRemaining: 0,
                airCommandReadyRound: {}, cooldowns: {}
            };
        }
    }
    match.surfaceMap = new Map(match.tiles.filter(isWaterTile).map(tile => [tileCoordinateKey(tile), tile.surface]));
    match.coastEdges = buildCoastTopology(match.tiles, match.tileMap);
    match.portTiles = new Map();
    if (match.ports.length) {
        const validPorts = [];
        for (const port of match.ports) {
            const tile = match.tileMap.get(tileCoordinateKey(port));
            if (!tile || !isWaterTile(tile)) continue;
            const key = tileCoordinateKey(tile);
            if (match.portTiles.has(key)) continue;
            tile.isPort = true;
            tile.surface = SURFACE_KIND.SHALLOW_WATER;
            tile.districtId = port.districtId;
            match.portTiles.set(key, tile);
            validPorts.push({
                q: tile.q, r: tile.r, districtId: tile.districtId,
                landQ: port.landQ, landR: port.landR
            });
        }
        match.ports = validPorts;
    } else {
        // Transitional snapshots may contain per-tile port flags but no list.
        match.ports = match.tiles
            .filter(tile => tile.isPort && isWaterTile(tile))
            .map(tile => ({ q: tile.q, r: tile.r, districtId: tile.districtId }));
        for (const port of match.ports) {
            const tile = match.tileMap.get(tileCoordinateKey(port));
            if (!tile) continue;
            tile.isPort = true;
            tile.surface = SURFACE_KIND.SHALLOW_WATER;
            match.portTiles.set(tileCoordinateKey(port), tile);
        }
    }
    const landTiles = match.tiles.filter(isLandTile);
    const landTileMap = new Map(landTiles.map(tile => [tileCoordinateKey(tile), tile]));
    match.campBorderEdges = computeCampBorders(landTiles, landTileMap);
    match.districtBorderEdges = computeDistrictBorders(landTiles, landTileMap);
}
