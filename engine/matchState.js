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

import { CAMP } from '../rules/camps.js';
import { createDefaultDiplomacy, createDefaultFactions } from '../rules/diplomacy.js';
import { createDefaultMechanics } from '../rules/mechanics.js';
import { createRng } from '../core/rng.js';
import { getCounter, setCounter } from '../js/uid.js';

let resetSeedCounter = 0;

// ===== MatchState =====================
export function createMatchState() {
    return {
        tiles: [],
        tileMap: new Map(),
        currentCamp: CAMP.player1,
        playerGold: { player1: 4, player2: 4, player3: 4, neutral: 4 },
        turnCounter: 0,
        gameOver: false,
        victoryCamp: null,
        logHistory: [],
        killCount: { player1: 0, player2: 0, player3: 0, neutral: 0 },
        _friendlyDeathCount: {},
        gameMode: 'local',      // 'local' | 'pve' | 'network'
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
        factions: createDefaultFactions(),
        diplomacy: createDefaultDiplomacy(),
        campaignVariables: {},
        levelVariables: {},
        objectiveStates: {},
        interactionStates: {},
        mechanics: createDefaultMechanics(),
        aiOpponentCamp: null,   // PVE 模式下 AI 对手的阵营（CAMP.player1 或 CAMP.player2）
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
        factionMoraleBoost: { player1: 0, player2: 0, player3: 0 },
        // 对策卡系统 v2
        cardDrawPile: [],
        cardDiscardPile: [],
        playerHands: { player1: [], player2: [], player3: [] },
        playerDrawsThisTurn: { player1: 0, player2: 0, player3: 0 },
        playerUsesThisTurn: { player1: 0, player2: 0, player3: 0 },
        // 战争迷雾（遭遇战模式）
        skirmishFog: false,
        visibleTiles: { player1: new Set(), player2: new Set(), player3: new Set() },
        exploredTiles: { player1: new Set(), player2: new Set(), player3: new Set() },
        // 侦察揭示：{ player1: Map("q,r" → expiresAt), ... }
        scoutReveals: { player1: new Map(), player2: new Map(), player3: new Map() },
        // 国界线（阵营交界边集）/ 行政区界线 —— 由 tiles 派生的缓存
        campBorderEdges: [],
        districtBorderEdges: [],
        // 村庄：Map("q,r" → { districtId, q, r })
        villageTiles: new Map(),
        // PVE 难度：对手 AI 经济倍率（不影响中立 AI）
        aiDifficulty: 1.0
    };
}

// 重置对局字段（再来一局时调用）。
// 模式字段必须在新对局时归零；训练场与教程会在启动流程中显式恢复自身模式。
// 【老练】是单局叠层，绝不能跨对局保留。
export function resetMatchState(match) {
    match.tiles = [];
    match.tileMap = new Map();
    match.currentCamp = CAMP.player1;
    match.playerGold = { player1: 4, player2: 4, player3: 4, neutral: 4 };
    match.turnCounter = 0;
    // 新对局重新播种模拟 RNG(联机模式随后会被 state-sync 对齐;可由
    // seedMatchRng 显式指定共享种子以做到开局即跨端确定)。
    const resetSalt = Math.imul(++resetSeedCounter, 0x9E3779B9);
    match.rng.setState(((Date.now() >>> 0) ^ resetSalt) >>> 0);
    match.gameOver = false;
    match.victoryCamp = null;
    match.logHistory = [];
    match.killCount = { player1: 0, player2: 0, player3: 0, neutral: 0 };
    match._friendlyDeathCount = {};
    match.gameMode = 'local';
    match._trainingMode = false;
    match.tutorialMode = false;
    match.tutorialStep = '';
    match.tutorialTargets = null;
    match.campaignMode = false;
    match.campaignId = null;
    match.scenarioId = null;
    match.campaignPhase = '';
    match.localPlayerCampKey = 'player1';
    match.factions = createDefaultFactions();
    match.diplomacy = createDefaultDiplomacy();
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
    match.skirmishFog = false;
    match.visibleTiles = { player1: new Set(), player2: new Set(), player3: new Set() };
    match.exploredTiles = { player1: new Set(), player2: new Set(), player3: new Set() };
    match.scoutReveals = { player1: new Map(), player2: new Map(), player3: new Map() };
    match.campBorderEdges = [];
    match.districtBorderEdges = [];
    match.villageTiles = new Map();
    match.aiDifficulty = 1.0;
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
    match.factionMoraleBoost = { player1: 0, player2: 0, player3: 0 };
    match.cardDrawPile = [];
    match.cardDiscardPile = [];
    match.playerHands = { player1: [], player2: [], player3: [] };
    match.playerDrawsThisTurn = { player1: 0, player2: 0, player3: 0 };
    match.playerUsesThisTurn = { player1: 0, player2: 0, player3: 0 };
}

// ===== ClientUiState =====================
// 本地查看/选中/动画状态。阶段 3 会进一步拆出独立的查看目标持久化
// （联机观察态 HUD 不丢失需求）；当前先固定字段归属。
export function createClientUiState() {
    return {
        selectedUnit: null,
        movableTiles: [],
        moveParents: new Map(),
        attackableTiles: [],
        damageTexts: [],
        healTexts: [],
        goldTexts: [],
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
        // 遭遇战胜利时保存的完整棋盘快照（用于查看完整棋局）
        _victoryBoardSnapshot: null,
        // 纯本地的查看目标；同步 MatchState 时按这个稳定标识重新解析。
        // unit 优先跟随移动后的单位，tile 用于查看空格、城市和村庄。
        inspectionTarget: null
    };
}

export function resetClientUiState(ui) {
    ui.selectedUnit = null;
    ui.movableTiles = [];
    ui.moveParents = new Map();
    ui.attackableTiles = [];
    ui.damageTexts = [];
    ui.healTexts = [];
    ui.goldTexts = [];
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
    ui._victoryBoardSnapshot = null;
    ui.inspectionTarget = null;
}

// ===== 序列化 / 快照（联机同步 + 断线重连用） =====================
// 只处理 MatchState；选择、浮层、动画与 DOM 状态一概不进快照。

function _campToKey(c) { return c === CAMP.player1 ? 'p1' : c === CAMP.player2 ? 'p2' : c === CAMP.player3 ? 'p3' : 'neutral'; }

export function serializeMatchState(match) {
    const tilesData = match.tiles.map(t => ({
        id: t.id,
        q: t.q, r: t.r, s: t.s,
        campKey: _campToKey(t.camp),
        isCity: t.isCity,
        isVillage: t.isVillage,
        villageDistrictId: t.villageDistrictId,
        districtId: t.districtId,
        terrain: t.terrain,
        fortification: t.fortification || null,
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
            moralePenaltyUntil: t.unit.moralePenaltyUntil || 0,
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
            berserkerQixue: t.unit._berserkerQixue || false,
            imprisoned: t.unit._imprisoned || false,
            isImmobile: t.unit._isImmobile || false,
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
            faith: t.unit._faith || 0,
            oathGainTurn: t.unit._oathGainTurn ?? null,
            smiteReady: t.unit._smiteReady || false,
            smiteCharged: t.unit._smiteCharged || false,
            healingAura: t.unit._healingAura || 0,
            activeSkillBuffs: t.unit._activeSkillBuffs || null,
            isDrone: t.unit._isDrone || false,
            droneSignalDisabled: t.unit._droneSignalDisabled || false,
            droneCampKey: t.unit._droneCampKey || null,
            droneBornAt: t.unit._droneBornAt || 0,
            engineerConstruction: t.unit._engineerConstruction ? { ...t.unit._engineerConstruction } : null,
            engineerScaffold: t.unit._engineerScaffold ? { ...t.unit._engineerScaffold } : null,
            engineerBunkerCD: t.unit._engineerBunkerCD || 0
        } : null
    }));

    return {
        tiles: tilesData,
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
        diplomacy: structuredClone(match.diplomacy || createDefaultDiplomacy()),
        campaignVariables: structuredClone(match.campaignVariables || {}),
        levelVariables: structuredClone(match.levelVariables || {}),
        objectiveStates: structuredClone(match.objectiveStates || {}),
        interactionStates: structuredClone(match.interactionStates || {}),
        mechanics: { ...(match.mechanics || createDefaultMechanics()) },
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
        playerHands: { player1: [...match.playerHands.player1], player2: [...match.playerHands.player2], player3: [...match.playerHands.player3] },
        playerDrawsThisTurn: { ...match.playerDrawsThisTurn },
        playerUsesThisTurn: { ...match.playerUsesThisTurn },
        gameMode: match.gameMode || 'local',
        trainingMode: match._trainingMode || false,
        isThreePlayer: match.isThreePlayer || false,
        aiOpponentCampKey: match.aiOpponentCamp ? _campToKey(match.aiOpponentCamp) : null,
        surrenderedCampKeys: match.surrenderedCamps.map(c => _campToKey(c)),
        skirmishFog: match.skirmishFog || false,
        aiDifficulty: match.aiDifficulty || 1.0,
        visibleTiles: match.visibleTiles ? {
            player1: [...match.visibleTiles.player1],
            player2: [...match.visibleTiles.player2],
            player3: [...match.visibleTiles.player3]
        } : { player1: [], player2: [], player3: [] },
        exploredTiles: match.exploredTiles ? {
            player1: [...match.exploredTiles.player1],
            player2: [...match.exploredTiles.player2],
            player3: [...match.exploredTiles.player3]
        } : { player1: [], player2: [], player3: [] },
        scoutReveals: match.scoutReveals ? {
            player1: [...match.scoutReveals.player1],
            player2: [...match.scoutReveals.player2],
            player3: [...match.scoutReveals.player3]
        } : { player1: [], player2: [], player3: [] },
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
    const campMap = { p1: CAMP.player1, p2: CAMP.player2, p3: CAMP.player3, neutral: CAMP.neutral };

    setCounter(data.idCounter);
    match.gameOver = data.gameOver;
    match.victoryCamp = data.victoryCampKey ? campMap[data.victoryCampKey] : null;
    match.campaignMode = !!data.campaignMode;
    match.campaignId = data.campaignId || null;
    match.scenarioId = data.scenarioId || null;
    match.campaignPhase = data.campaignPhase || '';
    match.localPlayerCampKey = data.localPlayerCampKey || 'player1';
    match.factions = data.factions ? structuredClone(data.factions) : createDefaultFactions();
    match.diplomacy = data.diplomacy ? structuredClone(data.diplomacy) : createDefaultDiplomacy();
    match.campaignVariables = data.campaignVariables ? structuredClone(data.campaignVariables) : {};
    match.levelVariables = data.levelVariables ? structuredClone(data.levelVariables) : {};
    match.objectiveStates = data.objectiveStates ? structuredClone(data.objectiveStates) : {};
    match.interactionStates = data.interactionStates ? structuredClone(data.interactionStates) : {};
    match.mechanics = data.mechanics ? { ...data.mechanics } : createDefaultMechanics();
    match.currentCamp = campMap[data.currentCampKey] || CAMP.player1;
    match.playerGold = { player1: 4, player2: 4, player3: 4, neutral: 4, ...data.playerGold };
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
    // 恢复模拟 RNG 状态(旧版本快照无此字段时保持当前 rng,不影响)
    if (data.rngState != null) match.rng.setState(data.rngState);
    if (data.killCount) match.killCount = { player1: 0, player2: 0, player3: 0, neutral: 0, ...data.killCount };
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
    if (data.factionMoraleBoost) {
        match.factionMoraleBoost = { player1: 0, player2: 0, player3: 0, ...data.factionMoraleBoost };
    } else {
        match.factionMoraleBoost = { player1: 0, player2: 0, player3: 0 };
    }
    if (data.cardDrawPile) match.cardDrawPile = [...data.cardDrawPile];
    if (data.cardDiscardPile) match.cardDiscardPile = [...data.cardDiscardPile];
    if (data.playerHands) {
        match.playerHands = {
            player1: [...(data.playerHands.player1 || [])],
            player2: [...(data.playerHands.player2 || [])],
            player3: [...(data.playerHands.player3 || [])]
        };
    }
    if (data.playerDrawsThisTurn) match.playerDrawsThisTurn = { player1: 0, player2: 0, player3: 0, ...data.playerDrawsThisTurn };
    if (data.playerUsesThisTurn) match.playerUsesThisTurn = { player1: 0, player2: 0, player3: 0, ...data.playerUsesThisTurn };
    match.gameMode = data.gameMode || 'local';
    match._trainingMode = data.trainingMode || false;
    match.isThreePlayer = data.isThreePlayer || false;
    match.aiOpponentCamp = data.aiOpponentCampKey ? campMap[data.aiOpponentCampKey] : null;
    match.surrenderedCamps = (data.surrenderedCampKeys || []).map(k => campMap[k]).filter(Boolean);
    match.skirmishFog = data.skirmishFog || false;
    match.villageTiles = new Map(data.villageTiles || []);
    match.aiDifficulty = data.aiDifficulty || 1.0;
    if (data.visibleTiles) {
        match.visibleTiles = {
            player1: new Set(data.visibleTiles.player1 || []),
            player2: new Set(data.visibleTiles.player2 || []),
            player3: new Set(data.visibleTiles.player3 || [])
        };
    }
    if (data.exploredTiles) {
        match.exploredTiles = {
            player1: new Set(data.exploredTiles.player1 || []),
            player2: new Set(data.exploredTiles.player2 || []),
            player3: new Set(data.exploredTiles.player3 || [])
        };
    }
    if (data.scoutReveals) {
        match.scoutReveals = {
            player1: new Map(data.scoutReveals.player1 || []),
            player2: new Map(data.scoutReveals.player2 || []),
            player3: new Map(data.scoutReveals.player3 || [])
        };
    }

    // Preserve displayHp & commander for units (prevents flicker & commander loss on sync)
    const oldDisplayHp = new Map();
    const oldCommander = new Map();
    for (const tile of match.tiles) {
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

    match.tiles = data.tiles.map(td => {
        const tile = new HexTileClass(td.q, td.r, td.id);
        tile.s = td.s;
        tile.camp = campMap[td.campKey];
        tile.isCity = td.isCity;
        tile.isVillage = td.isVillage || false;
        tile.villageDistrictId = td.villageDistrictId || 0;
        tile.districtId = td.districtId;
        tile.terrain = td.terrain || 'plains';
        tile.fortification = td.fortification || null;
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
            const unitType = td.unit.isDrone ? 'drone' : td.unit.type;
            const unit = new UnitClass(unitType, campMap[td.unit.campKey], tile, td.unit.isNewRecruit, td.unit.id);
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
            unit.moralePenaltyUntil = td.unit.moralePenaltyUntil || 0;
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
            unit._berserkerQixue = td.unit.berserkerQixue || false;
            unit._imprisoned = td.unit.imprisoned || false;
            unit._isImmobile = td.unit.isImmobile || false;
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
            unit._faith = td.unit.faith || 0;
            unit._oathGainTurn = td.unit.oathGainTurn ?? undefined;
            unit._smiteReady = td.unit.smiteReady || false;
            unit._smiteCharged = td.unit.smiteCharged || false;
            unit._healingAura = td.unit.healingAura || 0;
            unit._activeSkillBuffs = td.unit.activeSkillBuffs || null;
            unit._isDrone = td.unit.isDrone || false;
            unit._droneSignalDisabled = td.unit.droneSignalDisabled || false;
            unit._droneCampKey = td.unit.droneCampKey || null;
            unit._droneBornAt = td.unit.droneBornAt || 0;
            unit._engineerConstruction = td.unit.engineerConstruction ? { ...td.unit.engineerConstruction } : null;
            unit._engineerScaffold = td.unit.engineerScaffold ? { ...td.unit.engineerScaffold } : null;
            unit._engineerBunkerCD = td.unit.engineerBunkerCD || 0;
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

    match.tileMap = new Map();
    for (const tile of match.tiles) {
        match.tileMap.set(`${tile.q},${tile.r}`, tile);
    }
    match.campBorderEdges = computeCampBorders(match.tiles, match.tileMap);
    match.districtBorderEdges = computeDistrictBorders(match.tiles, match.tileMap);
}
