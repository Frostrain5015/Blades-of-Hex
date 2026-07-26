// 通用对局记录器。
//
// 目标不是保存可重放的完整 MatchState，而是生成一份面向复盘的大模型友好日志：
// - 初始地图/阵营/单位让模型理解战场；
// - 每次已执行动作保留当时可见信息、意图参数和前后状态差异；
// - 伤害、阵亡、占城等领域事件单独入时间线，兼容延迟弹着结算；
// - 结尾附机器汇总，玩家和 AI 使用同一份 JSON。

import { on } from './eventBus.js';
import { campToKey } from '../rules/camps.js';
import { getRound } from '../rules/turns.js';
import { buildMatchStats } from './matchStats.js';
import { resolveAiDifficultyProfile } from '../ai/difficulty.js';

export const MATCH_LOG_SCHEMA = 'blades-of-hex.match-log';
export const MATCH_LOG_SCHEMA_VERSION = 1;
export const MATCH_REVIEW_SCHEMA = 'blades-of-hex.match-review';
export const MATCH_REVIEW_SCHEMA_VERSION = 1;

let active = null;
let boundState = null;
let currentCauseActionId = null;

function nowIso() {
    return new Date().toISOString();
}

function elapsedMs() {
    return active ? Math.max(0, Math.round(performance.now() - active.startedAtMonotonic)) : 0;
}

function keyOfCamp(camp) {
    if (camp == null) return null;
    if (typeof camp === 'string') return camp;
    return campToKey(camp) || null;
}

function commanderSlots(state, campKey) {
    const suffix = campKey === 'player1' ? 'P1' : campKey === 'player2' ? 'P2' : campKey === 'player3' ? 'P3' : '';
    if (!suffix) return [];
    return [state[`commander${suffix}`], state[`commander${suffix}Secondary`]].filter(Boolean);
}

function actorKind(state, campKey, origin = 'local') {
    if (origin === 'server') return 'system';
    const faction = state.factions?.[campKey];
    if (origin === 'remote') {
        if (campKey === 'neutral') return 'remote-neutral-ai';
        return faction?.controller === 'ai' ? 'remote-player-ai' : 'remote-human';
    }
    if (campKey === 'neutral') return 'neutral-ai';
    if (state.aiActing) return campKey === 'neutral' ? 'neutral-ai' : 'player-ai';
    if (faction?.controller === 'scripted') return 'scripted';
    if (faction?.controller === 'ai') return 'player-ai';
    return 'human';
}

function compactUnit(unit, tile) {
    return {
        id: unit.id,
        type: unit.type,
        campKey: keyOfCamp(unit.camp),
        q: tile.q,
        r: tile.r,
        hp: unit.hp,
        maxHp: unit.maxHp,
        shield: Number(unit._shield || 0),
        shieldTurns: Number(unit._shieldTurns || 0),
        morale: unit.morale,
        canAct: !!unit.canAct,
        remainingMP: unit.remainingMP,
        rank: unit._rank || 0,
        specializationKey: unit.specializationKey || null,
        commanderId: unit.commander || null,
        isCommanderUnit: !!unit.isCommanderUnit,
        embarked: unit.isEmbarked === true,
        activeSkillCD: Number(unit.activeSkillCD || 0),
        activeSkillDur: Number(unit.activeSkillDur || 0),
        berserkerQixue: unit._berserkerQixue === true,
        faith: Number(unit._faith || 0),
        smiteReady: unit._smiteReady === true,
        smiteCharged: unit._smiteCharged === true,
        healingAura: Number(unit._healingAura || 0)
    };
}

function compactSite(tile) {
    let kind = null;
    if (tile.isCity) kind = 'city';
    else if (tile.isPort) kind = 'port';
    else if (tile.isVillage) kind = 'village';
    if (!kind) return null;
    return {
        key: `${kind}:${tile.q},${tile.r}`,
        kind,
        q: tile.q,
        r: tile.r,
        campKey: keyOfCamp(tile.camp),
        districtId: tile.districtId ?? null,
        hp: tile.isCity ? (tile.hp ?? null) : null,
        maxHp: tile.isCity ? (tile.maxHp ?? null) : null,
        fortification: tile.fortification || null,
        installation: tile.installation?.type || null,
        installationStatus: tile.installation?.status || null
    };
}

function captureState(state) {
    const units = {};
    const sites = {};
    for (const tile of state.tiles || []) {
        if (tile.unit) units[tile.unit.id] = compactUnit(tile.unit, tile);
        const site = compactSite(tile);
        if (site) sites[site.key] = site;
    }
    const camps = {};
    for (const [campKey, faction] of Object.entries(state.factions || {})) {
        if (faction?.active === false) continue;
        camps[campKey] = {
            gold: Number(state.playerGold?.[campKey] || 0),
            handSize: Array.isArray(state.playerHands?.[campKey]) ? state.playerHands[campKey].length : 0,
            cards: (state.playerHands?.[campKey] || []).map(card => typeof card === 'string' ? card : card?.id).filter(Boolean),
            kills: Number(state.killCount?.[campKey] || 0),
            surrendered: (state.surrenderedCamps || []).some(camp => keyOfCamp(camp) === campKey),
            controller: faction?.controller || 'unknown'
        };
    }
    const visibleByCamp = {};
    for (const [campKey, faction] of Object.entries(state.factions || {})) {
        if (faction?.active === false) continue;
        visibleByCamp[campKey] = state.skirmishFog
            ? [...(state.visibleTiles?.[campKey] || [])]
            : null;
    }
    return {
        units,
        sites,
        camps,
        visibleByCamp,
        weather: state.weather || 'clear',
        currentCampKey: keyOfCamp(state.currentCamp),
        turnCounter: Number(state.turnCounter || 0),
        round: getRound(state),
        gameOver: !!state.gameOver,
        victoryCampKey: state.victoryCamp === 'draw' ? 'draw' : keyOfCamp(state.victoryCamp)
    };
}

function initialBoard(state) {
    return (state.tiles || []).map(tile => ({
        q: tile.q,
        r: tile.r,
        surface: tile.surface || 'land',
        terrain: tile.terrain || 'plains',
        districtId: tile.districtId ?? null,
        city: !!tile.isCity,
        village: !!tile.isVillage,
        port: !!tile.isPort,
        fortification: tile.fortification || null,
        installation: tile.installation?.type || null
    }));
}

function initialParticipants(state) {
    return Object.entries(state.factions || {})
        .filter(([, faction]) => faction?.active !== false)
        .map(([campKey, faction]) => ({
        campKey,
        name: faction?.name || campKey,
        controller: faction?.controller || 'unknown',
        colorId: faction?.colorId || null,
        flagEmoji: faction?.flagEmoji || null,
        commanderIds: commanderSlots(state, campKey),
        participatesInTurns: faction?.participatesInTurns !== false,
        active: faction?.active !== false
    }));
}

function hasChanged(left, right, fields) {
    return fields.some(field => left?.[field] !== right?.[field]);
}

function diffStates(before, after) {
    const result = {
        unitsAdded: [], unitsRemoved: [], unitsMoved: [], unitHp: [], unitState: [],
        sitesChanged: [], resources: [], global: []
    };
    for (const [id, unit] of Object.entries(after.units)) {
        const old = before.units[id];
        if (!old) {
            result.unitsAdded.push(unit);
            continue;
        }
        if (old.q !== unit.q || old.r !== unit.r) {
            result.unitsMoved.push({ unitId: id, from: { q: old.q, r: old.r }, to: { q: unit.q, r: unit.r } });
        }
        if (old.hp !== unit.hp) {
            result.unitHp.push({ unitId: id, campKey: unit.campKey, before: old.hp, after: unit.hp, delta: unit.hp - old.hp });
        }
        const stateFields = [
            'campKey', 'shield', 'shieldTurns', 'morale', 'canAct', 'remainingMP',
            'rank', 'specializationKey', 'commanderId', 'isCommanderUnit', 'embarked',
            'activeSkillCD', 'activeSkillDur', 'berserkerQixue', 'faith',
            'smiteReady', 'smiteCharged', 'healingAura'
        ];
        if (hasChanged(old, unit, stateFields)) {
            const changes = {};
            for (const field of stateFields) {
                if (old[field] !== unit[field]) changes[field] = { before: old[field], after: unit[field] };
            }
            result.unitState.push({ unitId: id, changes });
        }
    }
    for (const [id, unit] of Object.entries(before.units)) {
        if (!after.units[id]) result.unitsRemoved.push(unit);
    }
    for (const [key, site] of Object.entries(after.sites)) {
        const old = before.sites[key];
        if (!old) continue;
        const fields = ['campKey', 'hp', 'fortification', 'installation', 'installationStatus'];
        if (!hasChanged(old, site, fields)) continue;
        const changes = {};
        for (const field of fields) {
            if (old[field] !== site[field]) changes[field] = { before: old[field], after: site[field] };
        }
        result.sitesChanged.push({ site: key, changes });
    }
    for (const campKey of new Set([...Object.keys(before.camps), ...Object.keys(after.camps)])) {
        const old = before.camps[campKey] || {};
        const next = after.camps[campKey] || {};
        const fields = ['gold', 'handSize', 'kills', 'surrendered'];
        const changes = {};
        for (const field of fields) {
            if (old[field] !== next[field]) changes[field] = { before: old[field], after: next[field] };
        }
        if (Object.keys(changes).length) result.resources.push({ campKey, changes });
    }
    for (const field of ['weather', 'currentCampKey', 'turnCounter', 'round', 'gameOver', 'victoryCampKey']) {
        if (before[field] !== after[field]) result.global.push({ field, before: before[field], after: after[field] });
    }
    for (const key of Object.keys(result)) if (Array.isArray(result[key]) && result[key].length === 0) delete result[key];
    return result;
}

function appendDeferredOutcome(state, actionId) {
    if (!active || !actionId || !state) return null;
    const action = active.log.timeline.find(entry => entry.kind === 'action' && entry.actionId === actionId);
    if (!action) return null;
    const after = captureState(state);
    const changes = diffStates(active.lastSnapshot, after);
    const messages = newMessages(active.lastLogs, state.logHistory || []);
    if (Object.keys(changes).length > 0 || messages.length > 0) {
        action.outcome.changed = true;
        action.outcome.deferredEffects ||= [];
        action.outcome.deferredEffects.push({
            resolvedAtSequence: active.log.timeline.length,
            elapsedMs: elapsedMs(),
            turnCounter: Number(state.turnCounter || 0),
            round: getRound(state),
            changes,
            engineMessages: messages
        });
    }
    active.lastSnapshot = after;
    active.lastLogs = [...(state.logHistory || [])];
    if (active.log.complete) {
        active.log.finalState = {
            units: Object.values(after.units),
            sites: Object.values(after.sites),
            resources: after.camps,
            weather: after.weather,
            round: after.round,
            turnCounter: after.turnCounter
        };
        active.log.summary = buildSummary(active.log);
    }
    return action;
}

/**
 * 在延迟弹着回调中恢复原动作的因果上下文。
 * 回调里的领域事件携带 causedByActionId，状态差异也回填原动作，
 * 从而不会串入随后执行的无关动作。
 */
export function withMatchActionCause(state, actionId, callback) {
    const previous = currentCauseActionId;
    currentCauseActionId = actionId || previous || null;
    try {
        return callback();
    } finally {
        if (actionId) appendDeferredOutcome(state, actionId);
        currentCauseActionId = previous;
    }
}

function decisionContext(snapshot, actorCampKey, state = null) {
    const ownUnits = Object.values(snapshot.units).filter(unit => unit.campKey === actorCampKey);
    const visible = snapshot.visibleByCamp?.[actorCampKey];
    const visibleSet = visible ? new Set(visible) : null;
    const knownOthers = Object.values(snapshot.units).filter(unit => unit.campKey !== actorCampKey
        && (!visibleSet || visibleSet.has(`${unit.q},${unit.r}`)));
    const ownSites = Object.values(snapshot.sites).filter(site => site.campKey === actorCampKey);
    const strategicTelemetry = state?._imperatorStrategicTelemetry?.[actorCampKey];
    const latestStrategicIntent = Array.isArray(strategicTelemetry)
        ? strategicTelemetry.at(-1) || null
        : null;
    return {
        weather: snapshot.weather,
        gold: snapshot.camps?.[actorCampKey]?.gold ?? 0,
        handSize: snapshot.camps?.[actorCampKey]?.handSize ?? 0,
        ownForce: {
            units: ownUnits.length,
            totalHp: ownUnits.reduce((sum, unit) => sum + unit.hp, 0),
            actionableUnits: ownUnits.filter(unit => unit.canAct).length,
            cities: ownSites.filter(site => site.kind === 'city').length,
            ports: ownSites.filter(site => site.kind === 'port').length
        },
        informationPolicy: visibleSet ? 'fog-limited' : 'full-board',
        strategicIntent: latestStrategicIntent ? {
            round: latestStrategicIntent.round,
            posture: latestStrategicIntent.posture,
            urgency: latestStrategicIntent.urgency,
            objective: latestStrategicIntent.objective,
            objectiveAssetValue: latestStrategicIntent.objectiveAssetValue,
            projectedIncome: latestStrategicIntent.projectedIncome,
            rivalProjectedIncome: latestStrategicIntent.rivalProjectedIncome,
            forceRatio: latestStrategicIntent.forceRatio,
            capitalThreat: latestStrategicIntent.capitalThreat,
            portThreat: latestStrategicIntent.portThreat,
            assaultCapacity: latestStrategicIntent.assaultCapacity,
            siegeMission: latestStrategicIntent.siegeMission,
            missions: latestStrategicIntent.missions
        } : null,
        knownOtherUnits: knownOthers.map(unit => ({
            id: unit.id, type: unit.type, campKey: unit.campKey,
            q: unit.q, r: unit.r, hp: unit.hp, maxHp: unit.maxHp,
            commanderId: unit.commanderId
        }))
    };
}

const OMIT_PAYLOAD_KEYS = new Set([
    'x', 'y', 'fromX', 'fromY', 'counterX', 'counterY', 'floatTexts',
    'cmdFxData', 'ctrCmdFxData', 'cmdFxExtra', 'goldenBeamDatas'
]);

function sanitize(value, depth = 0) {
    if (value == null || typeof value === 'string' || typeof value === 'boolean') return value;
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;
    if (depth > 5) return '[omitted]';
    if (Array.isArray(value)) return value.slice(0, 100).map(item => sanitize(item, depth + 1));
    if (typeof value !== 'object') return String(value);
    if ('id' in value && 'type' in value && 'camp' in value && 'tile' in value) {
        return { unitId: value.id, unitType: value.type, campKey: keyOfCamp(value.camp), q: value.tile?.q, r: value.tile?.r };
    }
    const out = {};
    for (const [key, item] of Object.entries(value)) {
        if (OMIT_PAYLOAD_KEYS.has(key) || typeof item === 'function') continue;
        if (key === 'camp' || key === 'attackerCamp' || key === 'defenderCamp' || key === 'killerCamp') {
            out[`${key}Key`] = keyOfCamp(item);
        } else if (key === 'unit' || key === 'sourceUnit' || key === 'attackerUnit' || key === 'cityTile' || key === 'targetTile') {
            out[key] = sanitize(item, depth + 1);
        } else {
            out[key] = sanitize(item, depth + 1);
        }
    }
    return out;
}

function newMessages(previous, next) {
    if (!Array.isArray(next) || next.length === 0) return [];
    if (!Array.isArray(previous) || previous.length === 0) return [...next];
    const maxOverlap = Math.min(previous.length, next.length);
    for (let overlap = maxOverlap; overlap >= 0; overlap--) {
        let matches = true;
        for (let i = 0; i < overlap; i++) {
            if (previous[previous.length - overlap + i] !== next[i]) { matches = false; break; }
        }
        if (matches) return next.slice(overlap);
    }
    return [...next];
}

function ensureRecording(state, metadata = {}) {
    if (!active) startMatchRecording(state, metadata);
    return active;
}

export function startMatchRecording(state, metadata = {}) {
    const snapshot = captureState(state);
    const aiCampKeys = Object.entries(state.factions || {})
        .filter(([campKey, faction]) => campKey !== 'neutral' && faction?.controller === 'ai')
        .map(([campKey]) => campKey);
    const opponentCampKey = keyOfCamp(state.aiOpponentCamp);
    if (opponentCampKey && !aiCampKeys.includes(opponentCampKey)) aiCampKeys.push(opponentCampKey);
    const resolvedDifficultyByCamp = Object.fromEntries(aiCampKeys.map(campKey => [
        campKey,
        resolveAiDifficultyProfile(state, campKey).id
    ]));
    const primaryAiCampKey = opponentCampKey || aiCampKeys[0] || null;
    const resolvedDifficultyId = primaryAiCampKey
        ? resolvedDifficultyByCamp[primaryAiCampKey]
        : (state.aiDifficulty != null || state.aiDifficultyId != null
            ? resolveAiDifficultyProfile(state).id
            : null);
    const matchId = metadata.matchId || [
        state.campaignMode ? (state.scenarioId || state.campaignId || 'campaign') : (state.standardMapId || 'standard'),
        Date.now().toString(36),
        Math.random().toString(36).slice(2, 8)
    ].join('-');
    active = {
        startedAtMonotonic: performance.now(),
        lastSnapshot: snapshot,
        lastLogs: [...(state.logHistory || [])],
        log: {
            schema: MATCH_LOG_SCHEMA,
            schemaVersion: MATCH_LOG_SCHEMA_VERSION,
            gameVersion: '5.1.0',
            matchId,
            layers: {
                reviewIndexFile: `${matchId}.match-review.json`,
                fullLogFile: `${matchId}.match-full.json`,
                sequenceLookup: 'review sequence ranges refer to fullLog.timeline[].sequence',
                actionLookup: 'review action references refer to fullLog.timeline[].actionId'
            },
            startedAt: nowIso(),
            endedAt: null,
            durationMs: null,
            complete: false,
            coverage: metadata.coverage || (snapshot.turnCounter > 0
                ? 'partial-from-current-state'
                : 'full-from-initial-state'),
            automation: metadata.automation || null,
            mode: {
                type: state.campaignMode ? 'campaign' : state.gameMode,
                campaignId: state.campaignId || null,
                scenarioId: state.scenarioId || null,
                standardMapId: state.standardMapId || null,
                playerCount: state.isThreePlayer ? 3 : 2,
                fogOfWar: !!state.skirmishFog,
                doubleCommander: !!state.doubleCommanderMode,
                aiDifficulty: state.aiDifficulty ?? null,
                aiDifficultyId: resolvedDifficultyId,
                aiDifficultyByCamp: Object.keys(resolvedDifficultyByCamp).length > 0
                    ? resolvedDifficultyByCamp
                    : (state.aiDifficultyByCamp ? { ...state.aiDifficultyByCamp } : null)
            },
            turnOrder: [...(state.turnOrder || [])],
            participants: initialParticipants(state),
            initialState: {
                boardLayout: state.boardLayout || 'hex',
                board: initialBoard(state),
                units: Object.values(snapshot.units),
                sites: Object.values(snapshot.sites),
                resources: snapshot.camps,
                weather: snapshot.weather,
                firstCampKey: snapshot.currentCampKey
            },
            timeline: [],
            finalState: null,
            result: null,
            summary: null,
            reviewGuide: [
                '按 action sequence 或 event sequence 引用证据，不要只凭最终胜负下结论。',
                '判断决策时以 action.decisionContext 为当时可用信息；fog-limited 表示不能使用隐藏单位批评玩家。',
                '区分决策质量、随机伤害、规则自动结算和执行失败。',
                '分别总结有效战术、关键转折、典型失误和可操作的下一局建议。',
                '若用于改 AI，先归纳重复出现的决策模式，再提出最小代码改动和验证指标。'
            ]
        }
    };
    return active.log;
}

export function recordCommittedAction(state, {
    actionType,
    payload = null,
    actorCampKey = null,
    origin = 'local',
    originRole = null,
    accepted = null
} = {}) {
    const session = ensureRecording(state);
    const after = captureState(state);
    const actorKey = actorCampKey || (actionType === 'endTurn' ? session.lastSnapshot.currentCampKey : keyOfCamp(state.currentCamp));
    const changes = diffStates(session.lastSnapshot, after);
    const messages = newMessages(session.lastLogs, state.logHistory || []);
    const item = {
        kind: 'action',
        actionId: `${session.log.matchId}:a${session.log.timeline.filter(entry => entry.kind === 'action').length + 1}`,
        sequence: session.log.timeline.length + 1,
        elapsedMs: elapsedMs(),
        turnCounter: session.lastSnapshot.turnCounter,
        round: session.lastSnapshot.round,
        actorCampKey: actorKey,
        actorKind: actorKind(state, actorKey, origin),
        origin,
        originRole,
        accepted,
        actionType: actionType || 'unknown',
        payload: sanitize(payload || {}),
        decisionContext: decisionContext(session.lastSnapshot, actorKey, state),
        outcome: {
            changed: Object.keys(changes).length > 0,
            changes,
            engineMessages: messages
        }
    };
    session.log.timeline.push(item);
    session.lastSnapshot = after;
    session.lastLogs = [...(state.logHistory || [])];
    if (state.gameOver) finalizeMatchRecording(state);
    return item;
}

export function resolvePendingLocalAction(actionType, accepted, details = {}) {
    if (!active) return null;
    const item = active.log.timeline.find(entry => entry.kind === 'action'
        && entry.origin === 'local'
        && entry.accepted == null
        && (!actionType || entry.actionType === actionType));
    if (!item) return null;
    item.accepted = !!accepted;
    item.network = {
        ...(item.network || {}),
        revision: details.revision ?? null,
        resolution: accepted ? 'server-accepted' : 'server-rejected',
        reason: details.reason || null
    };
    return item;
}

export function recordMatchEvent(state, eventType, payload = {}) {
    if (!active) return null;
    const item = {
        kind: 'event',
        sequence: active.log.timeline.length + 1,
        elapsedMs: elapsedMs(),
        turnCounter: Number(state.turnCounter || 0),
        round: getRound(state),
        eventType,
        causedByActionId: payload?.causedByActionId || currentCauseActionId || null,
        payload: sanitize(payload)
    };
    active.log.timeline.push(item);
    if (active.log.complete) active.log.summary = buildSummary(active.log);
    return item;
}

function buildSummary(log) {
    const byCamp = Object.fromEntries(log.participants.map(participant => [participant.campKey, {
        actions: 0, moves: 0, attacks: 0, recruits: 0, reinforcements: 0,
        cards: 0, constructions: 0, noStateChangeActions: 0, rejectedActions: 0,
        damageDealt: 0, healing: 0, unitsLost: 0, kills: 0, attributedKills: 0, citiesCaptured: 0
    }]));
    const keyEvents = [];
    for (const item of log.timeline) {
        if (item.kind === 'action') {
            const stats = byCamp[item.actorCampKey] ||= {};
            stats.actions = (stats.actions || 0) + 1;
            if (item.accepted === false) {
                stats.rejectedActions = (stats.rejectedActions || 0) + 1;
                continue;
            }
            if (!item.outcome.changed) stats.noStateChangeActions = (stats.noStateChangeActions || 0) + 1;
            const buckets = {
                move: 'moves', attack: 'attacks', recruit: 'recruits', reinforce: 'reinforcements',
                repairShip: 'reinforcements', tacticalCard: 'cards', drawCard: 'cards',
                buildFortification: 'constructions', buildBunker: 'constructions', buildAirfield: 'constructions',
                engineerTrench: 'constructions', engineerFlak: 'constructions', engineerBunkerStart: 'constructions'
            };
            if (buckets[item.actionType]) stats[buckets[item.actionType]] = (stats[buckets[item.actionType]] || 0) + 1;
        } else if (item.eventType === 'unitHpChanged') {
            const delta = Number(item.payload.delta || 0);
            const sourceCampKey = item.payload.sourceCampKey || null;
            const targetCampKey = item.payload.campKey || null;
            if (delta < 0 && sourceCampKey && byCamp[sourceCampKey]) byCamp[sourceCampKey].damageDealt += -delta;
            if (delta > 0 && targetCampKey && byCamp[targetCampKey]) byCamp[targetCampKey].healing += delta;
        } else if (item.eventType === 'unitKilled') {
            const lostKey = item.payload.campKey;
            const killerKey = item.payload.killerCampKey;
            if (byCamp[lostKey]) byCamp[lostKey].unitsLost++;
            if (byCamp[killerKey]) byCamp[killerKey].attributedKills++;
            keyEvents.push({ sequence: item.sequence, type: 'unitKilled', ...item.payload });
        } else if (item.eventType === 'cityCaptured') {
            if (byCamp[item.payload.campKey]) byCamp[item.payload.campKey].citiesCaptured++;
            keyEvents.push({ sequence: item.sequence, type: 'cityCaptured', ...item.payload });
        }
    }
    for (const [campKey, stats] of Object.entries(byCamp)) {
        stats.kills = Number(log.finalState?.resources?.[campKey]?.kills || 0);
    }
    return {
        totalTimelineItems: log.timeline.length,
        totalActions: log.timeline.filter(item => item.kind === 'action').length,
        acceptedActions: log.timeline.filter(item => item.kind === 'action' && item.accepted !== false).length,
        rounds: log.finalState?.round || 0,
        byCamp,
        keyEvents
    };
}

function inferResultReason(state) {
    const messages = Array.isArray(state.logHistory) ? state.logHistory : [];
    const latest = [...messages].reverse().find(message => typeof message === 'string') || '';
    if (latest.includes('回合限制')) return 'turnLimit';
    if (latest.includes('投降')) return 'surrender';
    if (latest.includes('失去所有行政区') || latest.includes('战败')) return 'districtElimination';
    return state.gameOver ? 'gameOver' : null;
}

export function finalizeMatchRecording(state, details = {}) {
    const session = ensureRecording(state);
    if (session.log.complete) {
        if (details.winnerCampKey !== undefined) session.log.result.winnerCampKey = details.winnerCampKey;
        if (details.victory !== undefined) session.log.result.victory = details.victory;
        if (details.reason !== undefined) session.log.result.reason = details.reason;
        if (details.stars !== undefined) session.log.result.stars = details.stars;
        session.log.summary = buildSummary(session.log);
        return session.log;
    }
    const finalSnapshot = captureState(state);
    session.log.endedAt = nowIso();
    session.log.durationMs = elapsedMs();
    session.log.complete = true;
    session.log.finalState = {
        units: Object.values(finalSnapshot.units),
        sites: Object.values(finalSnapshot.sites),
        resources: finalSnapshot.camps,
        weather: finalSnapshot.weather,
        round: finalSnapshot.round,
        turnCounter: finalSnapshot.turnCounter
    };
    session.log.result = {
        winnerCampKey: details.winnerCampKey || finalSnapshot.victoryCampKey || null,
        victory: details.victory ?? null,
        reason: details.reason || inferResultReason(state),
        stars: details.stars ?? null
    };
    session.log.summary = buildSummary(session.log);
    session.lastSnapshot = finalSnapshot;
    return session.log;
}

export function getCurrentMatchLog() {
    return active?.log || null;
}

function compactUnitHighlight(unit) {
    return {
        unitId: unit.id,
        unitType: unit.type,
        displayName: unit.displayName,
        campKey: unit.campKey,
        commanderId: unit.commanderId || null,
        survived: unit.survived,
        kills: unit.kills,
        damageDealt: unit.damageDealt,
        damageTaken: unit.damageTaken,
        healingReceived: unit.healingReceived,
        captures: unit.captures,
        actions: unit.actions,
        firstSequence: unit.firstSequence,
        lastSequence: unit.lastSequence
    };
}

export function buildMatchReview(log = active?.log || null) {
    const stats = buildMatchStats(log);
    if (!log || !stats) return null;
    const unitHighlights = [...stats.units]
        .sort((left, right) => {
            const score = unit => unit.damageDealt
                + unit.damageTaken * 0.35
                + unit.healingReceived * 0.5
                + unit.kills * 100
                + unit.captures * 80;
            return score(right) - score(left) || String(left.id).localeCompare(String(right.id));
        })
        .slice(0, 16)
        .map(compactUnitHighlight);
    return {
        schema: MATCH_REVIEW_SCHEMA,
        schemaVersion: MATCH_REVIEW_SCHEMA_VERSION,
        gameVersion: log.gameVersion,
        matchId: log.matchId,
        layer: {
            kind: 'review-index',
            fileName: log.layers?.reviewIndexFile || `${log.matchId}.match-review.json`,
            detailFile: log.layers?.fullLogFile || `${log.matchId}.match-full.json`,
            detailSchema: MATCH_LOG_SCHEMA,
            lookup: {
                sequence: 'roundIndex/keyEvents/battleEvents sequence values map to detailFile.timeline[].sequence',
                actionId: 'action references map to detailFile.timeline[].actionId'
            }
        },
        complete: log.complete,
        coverage: log.coverage,
        startedAt: log.startedAt,
        endedAt: log.endedAt,
        durationMs: log.durationMs,
        mode: log.mode,
        participants: log.participants,
        result: log.result,
        overview: {
            totalActions: stats.totalActions,
            totalDamage: stats.totalDamage,
            totalLosses: stats.totalLosses,
            rounds: Math.max(
                stats.rounds.at(-1)?.round || 0,
                stats.controlTimeline.at(-1)?.round || 0
            ),
            camps: stats.camps,
            leaders: Object.fromEntries(Object.entries(stats.leaders)
                .map(([metric, unit]) => [metric, unit ? compactUnitHighlight(unit) : null]))
        },
        controlTimeline: stats.controlTimeline,
        battleEvents: stats.battleEvents,
        factionSkillEvents: stats.factionSkillEvents,
        commanderDeathEvents: stats.commanderDeathEvents,
        roundIndex: stats.rounds,
        keyEvents: stats.keyEvents,
        unitHighlights,
        methodology: stats.methodology,
        reviewGuide: log.reviewGuide
    };
}

export function serializeCurrentMatchReview(state = null, details = {}) {
    if (state && active && !active.log.complete) finalizeMatchRecording(state, details);
    const review = buildMatchReview();
    return review ? JSON.stringify(review) : null;
}

export function serializeCurrentMatchLog(state = null, details = {}, { pretty = false } = {}) {
    if (state && active && !active.log.complete) finalizeMatchRecording(state, details);
    return active ? JSON.stringify(active.log, null, pretty ? 2 : 0) : null;
}

function downloadJson(json, fileName) {
    if (!json) return false;
    if (typeof document === 'undefined' || typeof URL === 'undefined' || typeof Blob === 'undefined') return json;
    const blob = new Blob([json], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = fileName;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
    return true;
}

export function downloadCurrentMatchReview(state = null, details = {}) {
    return downloadJson(
        serializeCurrentMatchReview(state, details),
        active ? (active.log.layers?.reviewIndexFile || `${active.log.matchId}.match-review.json`) : 'match-review.json'
    );
}

export function downloadCurrentMatchLog(state = null, details = {}) {
    return downloadJson(
        serializeCurrentMatchLog(state, details),
        active ? (active.log.layers?.fullLogFile || `${active.log.matchId}.match-full.json`) : 'match-full.json'
    );
}

export function clearMatchRecording() {
    active = null;
}

// 延迟伤害和脚本事件不一定紧贴某个动作完成点，单独记录才能保持正确时序。
on('match:unitHpChanged', payload => recordMatchEvent(boundState, 'unitHpChanged', {
    unitId: payload?.unitId,
    unitType: payload?.unit?.type,
    campKey: keyOfCamp(payload?.unit?.camp),
    oldHp: payload?.oldHp,
    newHp: payload?.newHp,
    delta: payload?.delta,
    source: payload?.source,
    sourceUnitId: payload?.sourceUnitId,
    sourceCampKey: keyOfCamp(payload?.sourceUnit?.camp)
}));

on('match:unitKilled', payload => recordMatchEvent(boundState, 'unitKilled', {
    unitId: payload?.unitId,
    unitType: payload?.unitType,
    commanderId: payload?.commanderId || null,
    isCommanderUnit: payload?.isCommanderUnit === true,
    campKey: keyOfCamp(payload?.camp),
    killerId: payload?.killerId,
    killerType: payload?.killerType,
    killerCommanderId: payload?.killerCommanderId || null,
    killerCampKey: keyOfCamp(payload?.killerCamp),
    reason: payload?.reason
}));

on('match:cityCaptured', payload => recordMatchEvent(boundState, 'cityCaptured', {
    q: payload?.cityTile?.q,
    r: payload?.cityTile?.r,
    districtId: payload?.cityTile?.districtId,
    campKey: payload?.campKey,
    attackerUnitId: payload?.attackerUnit?.id || null
}));

on('match:combatResolved', payload => recordMatchEvent(boundState, 'combatResolved', payload));
on('match:diplomacyChanged', payload => recordMatchEvent(boundState, 'diplomacyChanged', payload));
on('campaign:objectiveChanged', payload => recordMatchEvent(boundState, 'objectiveChanged', payload));
on('campaign:interactionCompleted', payload => recordMatchEvent(boundState, 'interactionCompleted', payload));
on('turn:started', payload => recordMatchEvent(boundState, 'turnStarted', payload));
on('turn:ended', payload => recordMatchEvent(boundState, 'turnEnded', payload));

function resolveFactionSkillCampKey(event) {
    if (event?.campKey) return event.campKey;
    const unitIds = [event?.rescuedUnitId, event?.rescuerUnitId].filter(Boolean);
    for (const tile of boundState?.tiles || []) {
        if (tile.unit && unitIds.includes(tile.unit.id)) return keyOfCamp(tile.unit.camp);
    }
    return null;
}

function recordFactionSkill(event, {
    synergyId,
    skillName,
    triggerKind = null,
    onlyWhen = true
}) {
    if (!onlyWhen || !active || !boundState) return null;
    const campKey = resolveFactionSkillCampKey(event);
    if (!campKey) return null;
    const presentationEventId = event?.presentationEventId
        || `${synergyId}:${campKey}:${event?.triggerIndex ?? event?.stage ?? event?.expiresAtRound ?? active.log.timeline.length + 1}`;
    const duplicate = active.log.timeline.some(item =>
        item.kind === 'event'
        && item.eventType === 'factionSkillActivated'
        && item.payload?.presentationEventId === presentationEventId
    );
    if (duplicate) return null;
    const participant = active.log.participants.find(candidate => candidate.campKey === campKey);
    return recordMatchEvent(boundState, 'factionSkillActivated', {
        campKey,
        synergyId,
        skillName,
        triggerKind,
        logoEmoji: participant?.flagEmoji || boundState.factions?.[campKey]?.flagEmoji || '⚑',
        presentationEventId
    });
}

on('fx:aureliaOath', event => recordFactionSkill(event, {
    synergyId: 'aurelia',
    skillName: '同一个誓言',
    triggerKind: 'rescue'
}));
on('fx:eagleSynergy', event => recordFactionSkill(event, {
    synergyId: 'eagle',
    skillName: '轨道补给',
    triggerKind: event?.kind || null,
    onlyWhen: event?.kind === 'orbitalSupply' && event?.goldAwarded > 0
}));
on('fx:celestineOracle', event => recordFactionSkill(event, {
    synergyId: 'celestine',
    skillName: '神谕',
    triggerKind: `stage-${event?.stage ?? 0}`
}));
on('fx:tianhengBorrowDay', event => recordFactionSkill(event, {
    synergyId: 'tianheng',
    skillName: '日月天衡',
    triggerKind: 'charged'
}));
on('fx:noctisBloodMoonBleed', event => recordFactionSkill(event, {
    synergyId: 'noctis',
    skillName: '血月降临',
    triggerKind: 'rising',
    onlyWhen: !!event?.rising
}));

export function bindMatchRecorderState(state) {
    // eventBus 事件没有统一携带 state；状态单例仅作为记录器的只读引用。
    boundState = state;
}
