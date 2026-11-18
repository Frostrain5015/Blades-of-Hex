// 录像回放纯规则与状态调度引擎。
//
// 负责两件事：
// 1. 根据完整对局日志（blades-of-hex.match-log）构建可观察的初始战场；
// 2. 按时间线复刻每个玩家（含 AI / 中立 / 脚本）的已提交动作与延迟结果，
//    并维护遭遇战各阵营实时视角与暂停/继续调度。
//
// 本模块不直接 import DOM/Audio/Pixi，便于在 Node 单元测试中直接验证，
// 视觉/音效表现由调用方注入的 hooks / fxCallback 承担。

import { campToKey, getPaletteEntry } from '../rules/camps.js';
import {
    campFromKey,
    createDefaultDiplomacy,
    createStandardFactions,
    getFlagPresetColor
} from '../rules/diplomacy.js';
import { isWaterSurface } from '../rules/surfaces.js';
import { normalizeFactionRuleMode } from '../rules/cultures.js';
import { getStandardMap } from '../rules/standardMaps.js';
import { applyHistoricalNeutralAppearance } from '../rules/historicalNeutral.js';
import { syncCityHpMirrors } from '../rules/citySiege.js';
import { ATTACK_PRESENTATION, classifyAttackPresentation, CARRIER_STRAFE_IMPACT_MS } from '../rules/attackPresentation.js';
import { TACTICAL_CARD_CONFIG } from '../rules/cards.js';
import { buildBoardFromConfig } from '../campaign/runtime/mapBuilder.js';
import { resetMatchState, restoreMatchState } from '../engine/matchState.js';
import { getCounter, setCounter } from './uid.js';
import { isReplayableMatchLog } from './matchStats.js';

export { isReplayableMatchLog };

export function extractReplaySteps(log) {
    if (!isReplayableMatchLog(log)) return [];
    const eventsByAction = new Map();
    for (const entry of log.timeline) {
        if (entry?.kind === 'event' && entry.causedByActionId) {
            let list = eventsByAction.get(entry.causedByActionId);
            if (!list) {
                list = [];
                eventsByAction.set(entry.causedByActionId, list);
            }
            list.push(entry);
        }
    }
    const steps = [];
    for (const entry of log.timeline) {
        if (entry?.kind !== 'action' || entry.accepted === false) continue;
        steps.push({
            ...entry,
            correlatedEvents: entry.actionId ? (eventsByAction.get(entry.actionId) || []) : []
        });
    }
    return steps;
}

function createReplayUnit(u, tile, state, UnitClass) {
    if (!u || !tile) return null;
    const camp = campFromKey(u.campKey, state) || state.factions?.[u.campKey] || state.currentCamp;
    const unit = new UnitClass(
        u.type,
        camp,
        tile,
        u.isNewRecruit === true,
        u.id,
        u.commanderId || null,
        { isEmbarked: u.embarked === true }
    );
    if (Number.isFinite(u.maxHp) && u.maxHp > 0) unit.maxHp = u.maxHp;
    if (Number.isFinite(u.hp)) {
        unit.hp = Math.max(0, u.hp);
        unit.displayHp = unit.hp;
    }
    unit._shield = Number(u.shield || 0);
    unit._displayShield = unit._shield;
    unit._shieldTurns = Number(u.shieldTurns || 0);
    if (Number.isFinite(u.morale)) unit.morale = u.morale;
    if (typeof u.canAct === 'boolean') unit.canAct = u.canAct;
    if (Number.isFinite(u.remainingMP)) unit.remainingMP = u.remainingMP;
    if (Number.isFinite(u.displaySpeed)) unit.displaySpeed = u.displaySpeed;
    if (u.specializationKey) unit.specializationKey = u.specializationKey;
    if (Number.isFinite(u.rank) && u.rank > 0 && typeof unit._applyRank === 'function') {
        unit._applyRank(u.rank, { silent: true, skipHeal: true });
        if (Number.isFinite(u.hp)) {
            unit.hp = Math.max(0, u.hp);
            unit.displayHp = unit.hp;
        }
        if (Number.isFinite(u.maxHp) && u.maxHp > 0) unit.maxHp = u.maxHp;
    }
    unit.activeSkillCD = Number(u.activeSkillCD || 0);
    unit.activeSkillDur = Number(u.activeSkillDur || 0);
    unit._berserkerQixue = u.berserkerQixue === true;
    unit._faith = Number(u.faith || 0);
    unit._smiteReady = u.smiteReady === true;
    unit._smiteCharged = u.smiteCharged === true;
    unit._healingAura = Number(u.healingAura || 0);
    unit.fireSea = Number(u.fireSea || 0);
    if (Number(u.poisonTurns || 0) > 0) unit._poison = { turns: Number(u.poisonTurns) };
    if (u.followsCity) unit._followsCity = { ...u.followsCity };
    if (u.guerrillaHiddenThroughRound !== undefined) unit._guerrillaHiddenThroughRound = u.guerrillaHiddenThroughRound;
    if (Number.isFinite(u.banzaiReadyRound)) unit._banzaiReadyRound = u.banzaiReadyRound;
    if (u.constructionScaffold) unit._constructionScaffold = { ...u.constructionScaffold };
    return unit;
}

function buildFactionsFromParticipants(participants, playerCount) {
    const base = createStandardFactions({ playerCount });
    if (!Array.isArray(participants) || participants.length === 0) return base;
    const factions = {};
    for (const p of participants) {
        if (!p?.campKey) continue;
        const fallback = base[p.campKey] || {};
        const resolvedColorId = p.colorId
            || (p.flagPreset ? getFlagPresetColor(p.flagPreset) : null)
            || fallback.colorId
            || null;
        const palette = getPaletteEntry(resolvedColorId || p.color);
        const colorId = palette?.id || resolvedColorId || fallback.colorId || null;
        const color = p.color || palette?.tile || fallback.color || '#8b8f96';
        factions[p.campKey] = {
            ...fallback,
            id: p.campKey,
            name: p.name || fallback.name || p.campKey,
            controller: p.controller || fallback.controller || (p.campKey === 'neutral' ? 'ai' : 'human'),
            colorId,
            color,
            flagEmoji: p.flagEmoji ?? fallback.flagEmoji ?? null,
            flagPreset: p.flagPreset ?? fallback.flagPreset ?? null,
            flagUrl: p.flagUrl ?? fallback.flagUrl ?? null,
            flagConfig: p.flagConfig ?? fallback.flagConfig ?? null,
            participatesInTurns: p.participatesInTurns !== false,
            active: p.active !== false,
            ...(p.neutralThemeId ? {
                neutralThemeId: p.neutralThemeId,
                neutralThemePeriod: p.neutralThemePeriod
            } : {})
        };
    }
    if (!factions.neutral) factions.neutral = base.neutral;
    return factions;
}

function syncFactionPaletteColors(state) {
    if (!state?.factions) return;
    for (const [campKey, faction] of Object.entries(state.factions)) {
        if (!faction) continue;
        const resolvedColorId = faction.colorId
            || (faction.flagPreset ? getFlagPresetColor(faction.flagPreset) : null)
            || null;
        const palette = getPaletteEntry(resolvedColorId || faction.color);
        if (palette) {
            faction.colorId = palette.id;
            faction.color = palette.tile;
        }
        if (campKey === 'neutral' && !faction.color) {
            faction.color = getPaletteEntry('gray')?.tile || '#b0b0b0';
        }
    }
}

function syncDeployedCommanderFlags(state) {
    const deployedByCamp = { player1: new Set(), player2: new Set(), player3: new Set() };
    for (const tile of state.tiles || []) {
        const u = tile?.unit;
        if (!u?.commander) continue;
        const ck = campToKey(u.camp);
        if (deployedByCamp[ck]) deployedByCamp[ck].add(u.commander);
    }
    const slots = [
        ['player1', 'commanderP1', 'commanderP1Secondary'],
        ['player2', 'commanderP2', 'commanderP2Secondary'],
        ['player3', 'commanderP3', 'commanderP3Secondary']
    ];
    for (const [ck, primaryKey, secondaryKey] of slots) {
        const set = deployedByCamp[ck];
        if (state[primaryKey] && set.has(state[primaryKey])) state[`${primaryKey}Deployed`] = true;
        if (state[secondaryKey] && set.has(state[secondaryKey])) state[`${primaryKey}SecondaryDeployed`] = true;
    }
}

function hydrateReplayHand(rawCards, campKey, state) {
    const list = Array.isArray(rawCards) ? rawCards : [];
    const primaryKey = campKey === 'player1' ? 'commanderP1'
        : campKey === 'player2' ? 'commanderP2'
        : campKey === 'player3' ? 'commanderP3'
        : null;
    if (!primaryKey || !state?.doubleCommanderMode) {
        return list.map(c => (c && typeof c === 'object' ? { ...c } : c)).filter(Boolean);
    }
    const candidates = [state[primaryKey], state[`${primaryKey}Secondary`]].filter(Boolean);
    if (candidates.length === 0) {
        return list.map(c => (c && typeof c === 'object' ? { ...c } : c)).filter(Boolean);
    }
    const explicitIds = new Set();
    for (const entry of list) {
        if (entry && typeof entry === 'object' && entry.id === 'commanderDeploy' && entry.commanderId) {
            explicitIds.add(entry.commanderId);
        }
    }
    const deployedSet = new Set();
    if (state[`${primaryKey}Deployed`] && state[primaryKey]) deployedSet.add(state[primaryKey]);
    if (state[`${primaryKey}SecondaryDeployed`] && state[`${primaryKey}Secondary`]) deployedSet.add(state[`${primaryKey}Secondary`]);
    for (const tile of state.tiles || []) {
        if (tile.unit?.commander && campToKey(tile.unit.camp) === campKey) {
            deployedSet.add(tile.unit.commander);
        }
    }
    const plainDeployCount = list.filter(entry => entry === 'commanderDeploy' || (entry && typeof entry === 'object' && entry.id === 'commanderDeploy' && !entry.commanderId)).length;
    let available = candidates.filter(id => !explicitIds.has(id) && !deployedSet.has(id));
    if (available.length < plainDeployCount) {
        available = [...available, ...candidates.filter(id => !explicitIds.has(id) && !available.includes(id))];
    }
    let idx = 0;
    return list.map(entry => {
        if (entry === 'commanderDeploy' || (entry && typeof entry === 'object' && entry.id === 'commanderDeploy' && !entry.commanderId)) {
            const cmdId = available[idx++] || candidates[0];
            return cmdId ? { id: 'commanderDeploy', commanderId: cmdId } : 'commanderDeploy';
        }
        return entry && typeof entry === 'object' ? { ...entry } : entry;
    }).filter(Boolean);
}

function applyCommandersFromParticipants(state, participants) {
    const slots = {
        player1: ['commanderP1', 'commanderP1Secondary'],
        player2: ['commanderP2', 'commanderP2Secondary'],
        player3: ['commanderP3', 'commanderP3Secondary']
    };
    for (const p of participants || []) {
        const pair = slots[p?.campKey];
        if (!pair || !Array.isArray(p.commanderIds)) continue;
        if (p.commanderIds[0]) {
            state[pair[0]] = p.commanderIds[0];
            state[`${pair[0]}Confirmed`] = true;
        }
        if (p.commanderIds[1]) {
            state[pair[1]] = p.commanderIds[1];
            state[`${pair[1]}Confirmed`] = true;
        }
    }
}

function findUnitInState(state, unitId) {
    if (unitId == null) return null;
    for (const tile of state.tiles || []) {
        if (tile.unit && String(tile.unit.id) === String(unitId)) return tile.unit;
    }
    return null;
}

export function buildReplayInitialState(log, state, deps) {
    if (!isReplayableMatchLog(log)) {
        throw new Error('无效的完整录像日志');
    }
    const {
        HexTileClass,
        UnitClass,
        computeCampBorders,
        computeDistrictBorders,
        updateAllFogOfWar,
        invalidateBoard
    } = deps;

    resetMatchState(state);
    const defaultViewCampKey = log.mode?.type === 'campaign'
        ? (log.initialState?.firstCampKey || state.localPlayerCampKey || 'player1')
        : 'neutral';

    if (log.initialState?.replaySnapshot) {
        restoreMatchState(state, log.initialState.replaySnapshot, {
            HexTileClass,
            UnitClass,
            computeCampBorders,
            computeDistrictBorders
        });
    } else {
        const playerCount = Number(log.mode?.playerCount) === 3 ? 3 : 2;
        state.gameMode = log.mode?.type === 'campaign' ? 'pve' : (log.mode?.type || 'local');
        state.campaignMode = log.mode?.type === 'campaign';
        state.campaignId = log.mode?.campaignId || null;
        state.scenarioId = log.mode?.scenarioId || null;
        state.standardMapId = log.mode?.standardMapId || state.standardMapId;
        state.isThreePlayer = playerCount === 3;
        state.skirmishFog = !!log.mode?.fogOfWar;
        state.factionRuleMode = normalizeFactionRuleMode(log.mode?.factionRuleMode);
        state.doubleCommanderMode = !!log.mode?.doubleCommander;
        if (log.mode?.aiDifficulty != null) state.aiDifficulty = log.mode.aiDifficulty;
        if (log.mode?.aiDifficultyId) state.aiDifficultyId = log.mode.aiDifficultyId;
        if (log.mode?.aiDifficultyByCamp) state.aiDifficultyByCamp = { ...log.mode.aiDifficultyByCamp };

        state.factions = buildFactionsFromParticipants(log.participants, playerCount);
        state.diplomacy = createDefaultDiplomacy({}, state.factions);
        state.turnOrder = Array.isArray(log.turnOrder) && log.turnOrder.length > 0
            ? [...log.turnOrder]
            : Object.keys(state.factions);
        state.localPlayerCampKey = log.initialState?.firstCampKey || 'player1';
        applyCommandersFromParticipants(state, log.participants);

        const standardMap = !state.campaignMode && log.mode?.standardMapId
            ? getStandardMap(playerCount, log.mode.standardMapId)
            : null;
        if (standardMap) {
            buildBoardFromConfig(standardMap, state);
        } else {
            state.tiles = [];
            state.tileMap = new Map();
            for (const entry of log.initialState?.board || []) {
                const tile = new HexTileClass(entry.q, entry.r);
                state.tiles.push(tile);
                state.tileMap.set(`${entry.q},${entry.r}`, tile);
            }
        }

        for (const entry of log.initialState?.board || []) {
            const tile = state.tileMap.get(`${entry.q},${entry.r}`);
            if (!tile) continue;
            tile.surface = entry.surface || tile.surface || 'land';
            tile.terrain = entry.terrain || tile.terrain || 'plains';
            if (entry.districtId != null) tile.districtId = entry.districtId;
            if (entry.city != null) tile.isCity = !!entry.city;
            if (entry.village != null) tile.isVillage = !!entry.village;
            if (entry.port != null) tile.isPort = !!entry.port;
            if (tile.isCity && tile.isUrban === undefined) tile.isUrban = true;
            tile.fortification = entry.fortification || null;
            tile.fieldFortification = tile.fortification
                ? { type: tile.fortification, campKey: null, ownerKnown: false }
                : null;
            if (entry.installation && !tile.installation) {
                tile.installation = { type: entry.installation, status: 'ready', airCommandReadyRound: {} };
            }
        }

        const districtCampById = new Map();
        for (const site of log.initialState?.sites || []) {
            const tile = state.tileMap.get(`${site.q},${site.r}`);
            if (!tile) continue;
            const camp = campFromKey(site.campKey, state) || state.factions.neutral;
            tile.camp = camp;
            if (site.kind === 'city') {
                tile.isCity = true;
                tile.isUrban = true;
                tile.urbanCenterKey ||= `${tile.q},${tile.r}`;
                if (Number.isFinite(site.maxHp) && site.maxHp > 0) tile.maxHp = site.maxHp;
                if (Number.isFinite(site.hp)) tile.hp = site.hp;
                if (tile.districtId != null) districtCampById.set(tile.districtId, camp);
            }
            if (site.fortification) {
                tile.fortification = site.fortification;
                tile.fieldFortification = { type: site.fortification, campKey: site.campKey || null, ownerKnown: !!site.campKey };
            }
            if (site.installation) {
                tile.installation = {
                    type: site.installation,
                    status: site.installationStatus || 'ready',
                    campKey: site.campKey || null,
                    airCommandReadyRound: {}
                };
            }
        }
        for (const tile of state.tiles) {
            if (tile.districtId != null && districtCampById.has(tile.districtId)) {
                const dc = districtCampById.get(tile.districtId);
                tile.camp = dc;
                if (typeof tile.startColor === 'string') {
                    tile.startColor = dc.color;
                    tile.targetColor = dc.color;
                    tile.currentColor = dc.color;
                }
            }
            if (tile.isCity) syncCityHpMirrors(tile, state.tileMap);
        }

        state.playerGold = {};
        state.playerHands = {};
        state.killCount = {};
        for (const [campKey, res] of Object.entries(log.initialState?.resources || {})) {
            state.playerGold[campKey] = Number(res?.gold || 0);
            state.playerHands[campKey] = Array.isArray(res?.cards) ? [...res.cards] : [];
            state.killCount[campKey] = Number(res?.kills || 0);
            state.previousGold[campKey] = state.playerGold[campKey];
        }
        state.weather = log.initialState?.weather || 'clear';
        const firstKey = log.initialState?.firstCampKey || state.turnOrder?.[0] || 'player1';
        state.currentCamp = campFromKey(firstKey, state) || state.factions[firstKey] || state.currentCamp;

        let maxNumericId = getCounter();
        for (const u of log.initialState?.units || []) {
            const tile = state.tileMap.get(`${u.q},${u.r}`);
            if (!tile) continue;
            createReplayUnit(u, tile, state, UnitClass);
            if (Number.isFinite(Number(u.id))) maxNumericId = Math.max(maxNumericId, Number(u.id));
        }
        setCounter(maxNumericId + 1);
    }

    state._replayMode = true;
    state._replayPaused = false;
    state._replayFinished = false;
    state._replayViewCampKey = defaultViewCampKey;
    state.commanderPhase = 'done';
    state.gameOver = false;
    state.victoryCamp = null;
    state.selectedUnit = null;
    state.selectedCityTile = null;
    state.selectedTile = null;
    state.movableTiles = [];
    state.attackableTiles = [];
    state.cardTargeting = null;

    applyHistoricalNeutralAppearance(state);
    syncFactionPaletteColors(state);
    for (const tile of state.tiles || []) {
        const water = isWaterSurface(tile.surface);
        if (water) {
            if (tile.isPort && tile.camp) {
                tile.camp = campFromKey(campToKey(tile.camp), state) || state.factions.neutral;
            } else {
                tile.camp = null;
            }
            continue;
        }
        tile.camp = campFromKey(campToKey(tile.camp), state) || state.factions.neutral;
        if (tile.camp?.color) {
            tile.startColor = tile.camp.color;
            tile.targetColor = tile.camp.color;
            tile.currentColor = tile.camp.color;
        }
        if (tile.unit) {
            tile.unit.camp = campFromKey(campToKey(tile.unit.camp), state) || state.factions.neutral;
        }
    }
    syncDeployedCommanderFlags(state);
    for (const ck of Object.keys(state.playerHands || {})) {
        state.playerHands[ck] = hydrateReplayHand(state.playerHands[ck], ck, state);
    }
    if (typeof computeCampBorders === 'function') state.campBorderEdges = computeCampBorders(state.tiles, state.tileMap);
    if (typeof computeDistrictBorders === 'function') state.districtBorderEdges = computeDistrictBorders(state.tiles, state.tileMap);
    updateAllFogOfWar?.(state);
    invalidateBoard?.();
    return state;
}

function syncUnitRankAndSpec(unit, changes) {
    if (!unit) return;
    if (changes.specializationKey) unit.specializationKey = changes.specializationKey.after;
    if (changes.rank && Number.isFinite(changes.rank.after) && changes.rank.after > (unit._rank || 0)) {
        const preservedHp = unit.hp;
        const preservedMax = unit.maxHp;
        unit._applyRank?.(changes.rank.after, { silent: true, skipHeal: true });
        if (Number.isFinite(preservedHp)) unit.hp = preservedHp;
        if (changes.maxHp && Number.isFinite(changes.maxHp.after)) unit.maxHp = changes.maxHp.after;
        else if (Number.isFinite(preservedMax) && preservedMax > unit.maxHp) unit.maxHp = preservedMax;
    }
    if (changes.maxHp && Number.isFinite(changes.maxHp.after)) {
        unit.maxHp = changes.maxHp.after;
    }
}

function getImpactDelayForStep(step, state) {
    const p = step?.payload || {};
    if (step.actionType === 'tacticalCard' && p.cardId && p.cardId !== 'airdrop') {
        if (p.cardId === 'diveStrafe' || p.cardId === 'carpetBomb') return 2800;
        if (p.cardId === 'forceMarch' && Array.isArray(p.heavyCannonVolleys) && p.heavyCannonVolleys.length > 0) {
            return 1600 + 700;
        }
        return 1600;
    }
    if (step.actionType === 'airCommand') {
        if (p.kind === 'stukaDiveBomb') return 1000;
        if (p.kind === 'strafe' || p.kind === 'bombing') return 1200;
        return 0;
    }
    if (step.actionType === 'attack') {
        const pres = classifyAttackPresentation(p);
        if (pres === ATTACK_PRESENTATION.FIRE_AIR_STRAFE) return CARRIER_STRAFE_IMPACT_MS;
        if (p.attackerType === 'fr_heavy_cannon') return 700;
        if (p.attackerType === 'ru_katyusha') return 750;
        if (pres === ATTACK_PRESENTATION.FIRE_TORPEDO) return 420;
        if (p.attackerType === 'us_marine') return 260;
        return 0;
    }
    if (step.actionType === 'banzaiCharge') return Number(p.impactDelay || 380);
    return 0;
}

function parseSiteCoord(siteKey) {
    const match = typeof siteKey === 'string' ? siteKey.match(/:(-?\d+),(-?\d+)$/) : null;
    if (!match) return null;
    return { q: Number(match[1]), r: Number(match[2]) };
}

function applyChangesBucket(changes, step, state, deps, preUnits, impactDelay, fxMeta, { isDeferred = false } = {}) {
    if (!changes) return;
    const { UnitClass, computeCampBorders, invalidateBoard, forceDistrictFade } = deps;
    const now = performance.now();
    const p = step.payload || {};
    let borderDirty = false;

    for (const move of changes.unitsMoved || []) {
        const unit = findUnitInState(state, move.unitId);
        const toTile = state.tileMap.get(`${move.to.q},${move.to.r}`);
        if (!unit || !toTile) continue;
        const oldTile = unit.tile;
        if (oldTile && oldTile.unit === unit) oldTile.unit = null;
        unit.tile = toTile;
        toTile.unit = unit;
        const animPath = Array.isArray(p.path) && p.path.length >= 2 && String(p.unitId) === String(unit.id)
            ? p.path.map(node => {
                const t = state.tileMap.get(`${node.q},${node.r}`);
                return { q: node.q, r: node.r, x: t?.x ?? node.x ?? oldTile?.x ?? 0, y: t?.y ?? node.y ?? oldTile?.y ?? 0 };
            })
            : (oldTile ? [{ q: oldTile.q, r: oldTile.r, x: oldTile.x, y: oldTile.y }, { q: toTile.q, r: toTile.r, x: toTile.x, y: toTile.y }] : null);
        if (animPath) {
            const moveDelayMs = step.actionType === 'attack'
                ? (p.attackerType === 'us_marine' ? 260 : 140)
                : 0;
            unit.startMovePath?.(animPath, moveDelayMs > 0 ? { delayMs: moveDelayMs } : undefined);
            const estDuration = Number.isFinite(unit.movePathDuration) && unit.movePathDuration > 0
                ? unit.movePathDuration
                : (animPath.length - 1) * 120;
            fxMeta.maxMoveMs = Math.max(fxMeta.maxMoveMs || 0, estDuration + moveDelayMs);
        }
        fxMeta.movedUnits.push({ unit, fromTile: oldTile, toTile });
    }

    for (const added of changes.unitsAdded || []) {
        if (findUnitInState(state, added.id)) continue;
        const tile = state.tileMap.get(`${added.q},${added.r}`);
        if (!tile) continue;
        const created = createReplayUnit(added, tile, state, UnitClass);
        if (created) {
            if (Number.isFinite(Number(created.id))) setCounter(Math.max(getCounter(), Number(created.id) + 1));
            fxMeta.addedUnits.push({ unit: created, tile });
        }
    }

    for (const hpChange of changes.unitHp || []) {
        const unit = findUnitInState(state, hpChange.unitId);
        if (!unit) continue;
        const prev = preUnits.get(String(unit.id));
        if (impactDelay > 0 && prev && hpChange.delta < 0) {
            unit.displayHp = prev.displayHp;
            unit._hpBarDelayUntil = now + impactDelay;
        } else {
            unit.displayHp = hpChange.after;
        }
        unit.hp = Math.max(0, hpChange.after);
        fxMeta.hpDeltas.push({
            unit,
            q: unit.tile?.q,
            r: unit.tile?.r,
            x: unit.tile?.x,
            y: unit.tile?.y,
            delta: hpChange.delta
        });
    }

    for (const stateChange of changes.unitState || []) {
        const unit = findUnitInState(state, stateChange.unitId);
        const c = stateChange.changes || {};
        if (!unit) continue;
        if (c.campKey) unit.camp = campFromKey(c.campKey.after, state) || state.factions?.[c.campKey.after] || unit.camp;
        syncUnitRankAndSpec(unit, c);
        if (c.shield) {
            unit._shield = Number(c.shield.after || 0);
            if (impactDelay > 0) unit._hpBarDelayUntil = Math.max(unit._hpBarDelayUntil || 0, now + impactDelay);
            else unit._displayShield = unit._shield;
        }
        if (c.shieldTurns) unit._shieldTurns = Number(c.shieldTurns.after || 0);
        if (c.morale) {
            unit.morale = c.morale.after;
            fxMeta.moraleChangedUnits.push(unit);
        }
        if (c.canAct) unit.canAct = !!c.canAct.after;
        if (c.remainingMP) unit.remainingMP = Number(c.remainingMP.after || 0);
        if (c.commanderId) unit.commander = c.commanderId.after || null;
        if (c.embarked) unit.setEmbarked?.(!!c.embarked.after);
        if (c.activeSkillCD) unit.activeSkillCD = Number(c.activeSkillCD.after || 0);
        if (c.activeSkillDur) unit.activeSkillDur = Number(c.activeSkillDur.after || 0);
        if (c.berserkerQixue) unit._berserkerQixue = !!c.berserkerQixue.after;
        if (c.faith) unit._faith = Number(c.faith.after || 0);
        if (c.smiteReady) unit._smiteReady = !!c.smiteReady.after;
        if (c.smiteCharged) unit._smiteCharged = !!c.smiteCharged.after;
        if (c.healingAura) unit._healingAura = Number(c.healingAura.after || 0);
        if (c.fireSea) unit.fireSea = Number(c.fireSea.after || 0);
        if (c.poisonTurns) unit._poison = c.poisonTurns.after > 0 ? { turns: c.poisonTurns.after } : null;
        if (c.isNewRecruit) unit.isNewRecruit = !!c.isNewRecruit.after;
        if (c.displaySpeed) unit.displaySpeed = Number(c.displaySpeed.after || unit.displaySpeed);
        if (c.guerrillaHiddenThroughRound) unit._guerrillaHiddenThroughRound = c.guerrillaHiddenThroughRound.after ?? null;
        if (c.banzaiReadyRound) unit._banzaiReadyRound = Number(c.banzaiReadyRound.after || 0);
        if (c.constructionScaffold) unit._constructionScaffold = c.constructionScaffold.after ? { ...c.constructionScaffold.after } : null;
    }

    const deathGhostMs = impactDelay > 0
        ? impactDelay
        : (['attack', 'banzaiCharge', 'droneSuicide', 'tacticalCard', 'airCommand'].includes(step.actionType) ? 180 : 0);
    for (const removed of changes.unitsRemoved || []) {
        const unit = findUnitInState(state, removed.id);
        const pre = preUnits.get(String(removed.id));
        if (unit && unit.tile?.unit === unit) unit.tile.unit = null;
        if (deathGhostMs > 0 && (unit || pre?.unit)) {
            const ghostUnit = unit || pre.unit;
            ghostUnit.hp = Math.max(1, Number(pre?.hp || ghostUnit.hp || 1));
            ghostUnit.displayHp = Number(pre?.displayHp || ghostUnit.hp || 1);
            (state.unitDeathGhosts ||= []).push({ unit: ghostUnit, until: now + deathGhostMs });
        }
        fxMeta.removedUnits.push({ removed, pre });
    }

    for (const siteChange of changes.sitesChanged || []) {
        const coord = parseSiteCoord(siteChange.site);
        const tile = coord ? state.tileMap.get(`${coord.q},${coord.r}`) : null;
        const c = siteChange.changes || {};
        if (!tile) continue;
        if (c.campKey) {
            const nextCamp = campFromKey(c.campKey.after, state) || state.factions?.[c.campKey.after] || state.factions.neutral;
            if (tile.isCity && tile.districtId != null) {
                for (const dt of state.tiles) {
                    if (dt.districtId === tile.districtId) dt.camp = nextCamp;
                }
                forceDistrictFade?.(tile, nextCamp);
                fxMeta.capturedCities.push({ tile, camp: nextCamp });
                borderDirty = true;
            } else {
                tile.camp = nextCamp;
            }
        }
        if (c.hp && tile.isCity) {
            const prevHp = Number(tile.hp || 0);
            tile.hp = Math.max(0, Number(c.hp.after || 0));
            syncCityHpMirrors(tile, state.tileMap);
            const hpDelta = tile.hp - prevHp;
            if (hpDelta !== 0) fxMeta.cityHpDeltas.push({ tile, delta: hpDelta });
        }
        if (c.fortification) {
            tile.fortification = c.fortification.after || null;
            tile.fieldFortification = tile.fortification
                ? { type: tile.fortification, campKey: campToKey(tile.camp), ownerKnown: true }
                : null;
            invalidateBoard?.();
        }
        if (c.installation || c.installationStatus) {
            const nextType = c.installation ? c.installation.after : tile.installation?.type;
            const nextStatus = c.installationStatus ? c.installationStatus.after : (tile.installation?.status || 'ready');
            tile.installation = nextType
                ? { ...(tile.installation || {}), type: nextType, status: nextStatus, campKey: campToKey(tile.camp) }
                : null;
        }
    }

    for (const fc of changes.fortificationsChanged || []) {
        const tile = state.tileMap.get(`${fc.q},${fc.r}`);
        if (!tile) continue;
        const next = fc.after;
        tile.fortification = next?.type || null;
        tile.fieldFortification = next?.type
            ? { type: next.type, campKey: next.campKey || null, ownerKnown: next.ownerKnown === true }
            : null;
        tile._minePlanted = !!next?.mine;
        tile._mineCampKey = next?.mineCampKey || null;
        tile._mineType = next?.mineType || null;
        invalidateBoard?.();
    }

    // 兼容旧版完整日志（当时 captureState 未记录非站点格上的工事变化）
    if ((!changes.fortificationsChanged || changes.fortificationsChanged.length === 0)
        && ['buildFortification', 'engineerTrench', 'engineerFlak'].includes(step.actionType)
        && Number.isFinite(p.q) && Number.isFinite(p.r)) {
        const fortTile = state.tileMap.get(`${p.q},${p.r}`);
        const fortKind = step.actionType === 'engineerTrench'
            ? 'trench'
            : step.actionType === 'engineerFlak'
                ? 'flak'
                : p.kind;
        if (fortTile && (fortKind === 'trench' || fortKind === 'flak')) {
            fortTile.fortification = fortKind;
            fortTile.fieldFortification = { type: fortKind, campKey: step.actorCampKey || null, ownerKnown: true };
            invalidateBoard?.();
        }
    }

    syncDeployedCommanderFlags(state);
    const applyLegacyHandDelta = (key) => {
        const hand = (state.playerHands[key] ||= []);
        if (!isDeferred && step.actionType === 'tacticalCard' && key === step.actorCampKey
            && p.cardId && !['diveStrafe', 'carpetBomb', 'airlift'].includes(p.cardId)) {
            let removeIdx = -1;
            if (p.cardId === 'commanderDeploy' && p.commander) {
                removeIdx = hand.findIndex(c => c && typeof c === 'object' && c.id === 'commanderDeploy' && c.commanderId === p.commander);
            }
            if (removeIdx === -1) {
                removeIdx = hand.findIndex(c => c === p.cardId || (c && typeof c === 'object' && c.id === p.cardId));
            }
            if (removeIdx !== -1) hand.splice(removeIdx, 1);
        }
        if (!isDeferred && step.actionType === 'drawCard' && key === step.actorCampKey && p.cardId) {
            hand.push(p.cardId);
        }
        const campName = state.factions?.[key]?.name;
        const msgSource = isDeferred ? [] : (step.outcome?.engineMessages || []);
        for (const msg of msgSource) {
            if (typeof msg !== 'string') continue;
            if (campName && !msg.includes(campName) && !msg.includes(key)) continue;
            const freeMatch = msg.match(/获得免费对策卡【([^】]+)】/);
            const copyMatch = msg.match(/获得【([^】]+)】的复制/);
            const cardName = freeMatch?.[1] || copyMatch?.[1];
            if (!cardName) continue;
            const entry = Object.entries(TACTICAL_CARD_CONFIG).find(([, cfg]) => cfg?.name === cardName);
            if (!entry) continue;
            hand.push(copyMatch ? { id: entry[0], _copy: true } : entry[0]);
        }
    };
    const seenResourceKeys = new Set();
    for (const res of changes.resources || []) {
        const key = res.campKey;
        seenResourceKeys.add(key);
        const c = res.changes || {};
        if (c.gold) state.playerGold[key] = Number(c.gold.after || 0);
        if (c.kills) state.killCount[key] = Number(c.kills.after || 0);
        if (c.cards && Array.isArray(c.cards.after)) {
            state.playerHands[key] = hydrateReplayHand(c.cards.after, key, state);
        } else {
            applyLegacyHandDelta(key);
            if (c.handSize && Number.isFinite(c.handSize.after)) {
                const hand = state.playerHands[key];
                while (hand && hand.length > c.handSize.after) hand.pop();
            }
        }
        if (c.surrendered) {
            const camp = campFromKey(key, state);
            if (camp) {
                if (c.surrendered.after && !state.surrenderedCamps.includes(camp)) state.surrenderedCamps.push(camp);
                else if (!c.surrendered.after) state.surrenderedCamps = state.surrenderedCamps.filter(item => item !== camp);
            }
        }
    }
    if (!isDeferred && step.actorCampKey && !seenResourceKeys.has(step.actorCampKey)
        && (step.actionType === 'tacticalCard' || step.actionType === 'drawCard')) {
        applyLegacyHandDelta(step.actorCampKey);
    }

    for (const g of changes.global || []) {
        if (g.field === 'weather') state.weather = g.after || 'clear';
        else if (g.field === 'currentCampKey') {
            state.currentCamp = campFromKey(g.after, state) || state.factions?.[g.after] || state.currentCamp;
        } else if (g.field === 'turnCounter') state.turnCounter = Number(g.after || 0);
        else if (g.field === 'riverGate') {
            state.riverGate = g.after ? { ...g.after } : null;
            invalidateBoard?.();
        } else if (g.field === 'colonelAirStacks') {
            state._colonelAirStacks = g.after ? { ...g.after } : {};
        } else if (g.field === 'gameOver') {
            state.gameOver = !!g.after;
        } else if (g.field === 'victoryCampKey') {
            state.victoryCamp = g.after === 'draw' ? 'draw' : (g.after ? campFromKey(g.after, state) : null);
        }
    }

    if (borderDirty) {
        if (typeof computeCampBorders === 'function') state.campBorderEdges = computeCampBorders(state.tiles, state.tileMap);
        if (typeof computeDistrictBorders === 'function') state.districtBorderEdges = computeDistrictBorders(state.tiles, state.tileMap);
        invalidateBoard?.();
    }
}

function resolveCoordXY(state, q, r, fx, fy) {
    if (Number.isFinite(fx) && Number.isFinite(fy)) return { x: fx, y: fy };
    const t = Number.isFinite(q) && Number.isFinite(r) ? state.tileMap.get(`${q},${r}`) : null;
    if (t && Number.isFinite(t.x) && Number.isFinite(t.y)) return { x: t.x, y: t.y };
    return null;
}

function enrichCoordList(state, list) {
    if (!Array.isArray(list)) return list;
    return list.map(item => {
        if (!item || typeof item !== 'object') return item;
        const t = Number.isFinite(item.q) && Number.isFinite(item.r) ? state.tileMap.get(`${item.q},${item.r}`) : null;
        if (!t) return item;
        return {
            ...item,
            x: Number.isFinite(item.x) ? item.x : t.x,
            y: Number.isFinite(item.y) ? item.y : t.y
        };
    });
}

function buildEnrichedPayload(step, state, preUnits, fxMeta, impactDelay) {
    const p = { ...(step.payload || {}) };
    const tile = Number.isFinite(p.q) && Number.isFinite(p.r) ? state.tileMap.get(`${p.q},${p.r}`) : null;
    if (tile) {
        if (p.x == null) p.x = tile.x;
        if (p.y == null) p.y = tile.y;
    }
    if (Number.isFinite(p.targetQ) && Number.isFinite(p.targetR)) {
        const targetPos = resolveCoordXY(state, p.targetQ, p.targetR, p.toX, p.toY);
        if (targetPos) {
            if (p.toX == null) p.toX = targetPos.x;
            if (p.toY == null) p.toY = targetPos.y;
            if (p.x == null) p.x = targetPos.x;
            if (p.y == null) p.y = targetPos.y;
        }
    }
    if (Number.isFinite(p.destQ) && Number.isFinite(p.destR)) {
        const destPos = resolveCoordXY(state, p.destQ, p.destR, p.destX, p.destY);
        if (destPos) {
            if (p.destX == null) p.destX = destPos.x;
            if (p.destY == null) p.destY = destPos.y;
        }
    }
    if (Number.isFinite(p.fromQ) && Number.isFinite(p.fromR)) {
        const fromTile = state.tileMap.get(`${p.fromQ},${p.fromR}`);
        if (fromTile) {
            if (p.fromX == null) p.fromX = fromTile.x;
            if (p.fromY == null) p.fromY = fromTile.y;
        }
    } else if ((p.attackerUnitId ?? p.unitId) != null && preUnits.has(String(p.attackerUnitId ?? p.unitId))) {
        const preAtt = preUnits.get(String(p.attackerUnitId ?? p.unitId));
        if (p.fromX == null) p.fromX = preAtt.x;
        if (p.fromY == null) p.fromY = preAtt.y;
    }
    if (Array.isArray(p.path) && p.path.length > 0) {
        p.path = enrichCoordList(state, p.path);
    }
    for (const listField of [
        'specializationSplashResults',
        'berserkerSplash',
        'katyushaCounterSplash',
        'airstrikeResults',
        'carpetBombResults',
        'orbitalStrikeResults',
        'results'
    ]) {
        if (Array.isArray(p[listField])) p[listField] = enrichCoordList(state, p[listField]);
    }
    if (Array.isArray(p.heavyCannonVolleys)) {
        p.heavyCannonVolleys = p.heavyCannonVolleys.map(hv => {
            if (!hv || typeof hv !== 'object') return hv;
            const ft = Number.isFinite(hv.fromQ) && Number.isFinite(hv.fromR) ? state.tileMap.get(`${hv.fromQ},${hv.fromR}`) : null;
            const tt = Number.isFinite(hv.toQ) && Number.isFinite(hv.toR) ? state.tileMap.get(`${hv.toQ},${hv.toR}`) : null;
            return {
                ...hv,
                fromX: Number.isFinite(hv.fromX) ? hv.fromX : (ft?.x ?? p.x),
                fromY: Number.isFinite(hv.fromY) ? hv.fromY : (ft?.y ?? p.y),
                toX: Number.isFinite(hv.toX) ? hv.toX : tt?.x,
                toY: Number.isFinite(hv.toY) ? hv.toY : tt?.y,
                splash: enrichCoordList(state, hv.splash)
            };
        });
    }
    if (p.counterDmg > 0 && p.fromX != null && p.fromY != null) {
        if (p.counterX == null) p.counterX = p.fromX;
        if (p.counterY == null) p.counterY = p.fromY;
    }

    const recordedFloats = step.outcome?.floatTexts;
    if (Array.isArray(recordedFloats) && recordedFloats.length > 0) {
        p.floatTexts = recordedFloats.map(ft => ({
            ...ft,
            timeLeft: Number.isFinite(ft.timeLeft) ? ft.timeLeft : (ft.kind === 'damage' || !ft.kind ? 900 : 1000)
        }));
    } else {
        const synthesized = [];
        const emittedUnitIds = new Set();
        const pushFloat = (entry) => {
            if (!Number.isFinite(entry.x) || !Number.isFinite(entry.y)) return;
            const kind = entry.kind || 'damage';
            synthesized.push({
                timeLeft: kind === 'damage' ? 900 : 1000,
                ...entry
            });
        };

        for (const hd of fxMeta.hpDeltas) {
            if (!Number.isFinite(hd.x) || !Number.isFinite(hd.y) || !hd.delta) continue;
            if (hd.unit?.id != null) emittedUnitIds.add(String(hd.unit.id));
            const isCounterTarget = hd.delta < 0
                && p.counterDmg > 0
                && p.attackerUnitId != null
                && String(hd.unit?.id) === String(p.attackerUnitId);
            const counterDelay = isCounterTarget
                ? (p.counterType === 'ru_katyusha' ? 750 : p.counterType === 'fr_heavy_cannon' ? 700 : p.counterType === 'us_marine' ? 260 : impactDelay)
                : impactDelay;
            pushFloat({
                kind: hd.delta > 0 ? 'heal' : 'damage',
                x: hd.x,
                y: hd.y,
                q: hd.q,
                r: hd.r,
                value: Math.round(Math.abs(hd.delta)),
                isCrit: isCounterTarget ? Boolean(p.counterIsCrit) : Boolean(p.isCrit || p.attackIsCrit),
                ...(counterDelay > 0 ? { delayMs: counterDelay } : {})
            });
        }

        // 阵亡单位不会出现在 changes.unitHp 中（diffStates 只写入 unitsRemoved），需从载荷与战前血量补回伤害数字
        for (const { removed, pre } of fxMeta.removedUnits) {
            const rid = String(removed?.id ?? pre?.unit?.id ?? '');
            if (rid && emittedUnitIds.has(rid)) continue;
            const pos = resolveCoordXY(state, removed?.q ?? pre?.q, removed?.r ?? pre?.r, pre?.x, pre?.y);
            if (!pos) continue;
            let dmgVal = null;
            let crit = false;
            let trueDmg = false;
            let dMs = impactDelay;
            if (step.actionType === 'attack') {
                if (p.targetUnitId != null && String(p.targetUnitId) === rid && Number(p.attackDmg) > 0) {
                    dmgVal = p.attackDmg;
                    crit = Boolean(p.attackIsCrit ?? p.isCrit);
                } else if (p.attackerUnitId != null && String(p.attackerUnitId) === rid && Number(p.counterDmg) > 0) {
                    dmgVal = p.counterDmg;
                    crit = Boolean(p.counterIsCrit);
                    dMs = p.counterType === 'ru_katyusha' ? 750 : p.counterType === 'fr_heavy_cannon' ? 700 : p.counterType === 'us_marine' ? 260 : impactDelay;
                } else {
                    const hitMatch = [
                        ...(p.specializationSplashResults || []),
                        ...(p.berserkerSplash || []),
                        ...(p.katyushaCounterSplash || [])
                    ].find(h => (h?.unitId != null && String(h.unitId) === rid) || (h?.q === (removed?.q ?? pre?.q) && h?.r === (removed?.r ?? pre?.r)));
                    if (hitMatch && Number(hitMatch.dmg) > 0) {
                        dmgVal = hitMatch.dmg;
                        crit = Boolean(hitMatch.isCrit);
                    }
                }
            } else if (step.actionType === 'tacticalCard') {
                const hitMatch = [
                    ...(p.airstrikeResults || []),
                    ...(p.carpetBombResults || []),
                    ...(p.orbitalStrikeResults || [])
                ].find(h => h?.q === (removed?.q ?? pre?.q) && h?.r === (removed?.r ?? pre?.r));
                if (hitMatch && Number(hitMatch.dmg) > 0) {
                    dmgVal = hitMatch.dmg;
                } else if (Number(p.dmg) > 0 && p.q === (removed?.q ?? pre?.q) && p.r === (removed?.r ?? pre?.r)) {
                    dmgVal = p.dmg;
                    trueDmg = p.cardId === 'lightning';
                }
            } else if (step.actionType === 'airCommand') {
                const hitMatch = (p.results || []).find(h => (h?.unitId != null && String(h.unitId) === rid) || (h?.q === (removed?.q ?? pre?.q) && h?.r === (removed?.r ?? pre?.r)));
                if (hitMatch && Number(hitMatch.dmg) > 0) dmgVal = hitMatch.dmg;
            }
            if (!(dmgVal > 0)) dmgVal = pre?.hp ?? removed?.hp ?? 0;
            if (dmgVal > 0) {
                emittedUnitIds.add(rid);
                pushFloat({
                    kind: 'damage',
                    x: pos.x,
                    y: pos.y,
                    q: removed?.q ?? pre?.q,
                    r: removed?.r ?? pre?.r,
                    value: Math.round(dmgVal),
                    isCrit: crit,
                    isTrueDmg: trueDmg,
                    ...(dMs > 0 ? { delayMs: dMs } : {})
                });
            }
        }

        // 若护盾完全吸收导致 HP 未变，但攻击造成了伤害，补出护盾受击伤害数字
        if (step.actionType === 'attack' && !p.dodged && Number(p.attackDmg) > 0
            && p.targetUnitId != null && !emittedUnitIds.has(String(p.targetUnitId))
            && Number.isFinite(p.x) && Number.isFinite(p.y)) {
            emittedUnitIds.add(String(p.targetUnitId));
            pushFloat({
                kind: 'damage',
                x: p.x,
                y: p.y,
                q: p.q,
                r: p.r,
                value: Math.round(p.attackDmg),
                isCrit: Boolean(p.attackIsCrit ?? p.isCrit),
                ...(impactDelay > 0 ? { delayMs: impactDelay } : {})
            });
        }
        if (step.actionType === 'attack' && Number(p.counterDmg) > 0
            && p.attackerUnitId != null && !emittedUnitIds.has(String(p.attackerUnitId))
            && Number.isFinite(p.counterX ?? p.fromX) && Number.isFinite(p.counterY ?? p.fromY)) {
            emittedUnitIds.add(String(p.attackerUnitId));
            pushFloat({
                kind: 'damage',
                x: p.counterX ?? p.fromX,
                y: p.counterY ?? p.fromY,
                q: p.fromQ,
                r: p.fromR,
                value: Math.round(p.counterDmg),
                isCrit: Boolean(p.counterIsCrit),
                ...(impactDelay > 0 ? { delayMs: impactDelay } : {})
            });
        }
        if (step.actionType === 'attack' && Number(p.smiteDmg) > 0 && Number.isFinite(p.x) && Number.isFinite(p.y)) {
            pushFloat({
                kind: 'damage',
                x: p.x,
                y: p.y,
                q: p.q,
                r: p.r,
                value: Math.round(p.smiteDmg),
                isTrueDmg: true,
                delayMs: impactDelay + 120
            });
        }

        for (const ch of fxMeta.cityHpDeltas) {
            pushFloat({
                kind: ch.delta > 0 ? 'heal' : 'damage',
                x: ch.tile.x,
                y: ch.tile.y,
                q: ch.tile.q,
                r: ch.tile.r,
                value: Math.round(Math.abs(ch.delta)),
                isCityDamage: ch.delta < 0,
                isCityHeal: ch.delta > 0,
                ...(impactDelay > 0 ? { delayMs: impactDelay } : {})
            });
        }
        if (p.dodged && Number.isFinite(p.x) && Number.isFinite(p.y)) {
            pushFloat({
                kind: 'damage', x: p.x, y: p.y, q: p.q, r: p.r, value: 0, text: '闪避',
                ...(impactDelay > 0 ? { delayMs: impactDelay } : {})
            });
        }
        if (synthesized.length > 0) p.floatTexts = synthesized;
    }
    return p;
}

export function applyReplayStep(step, state, deps) {
    if (!step || !state) return { step, effects: {}, delayMs: 400 };
    const { updateAllFogOfWar, logMessage, fxCallback } = deps;

    const preUnits = new Map();
    for (const tile of state.tiles || []) {
        if (!tile.unit) continue;
        preUnits.set(String(tile.unit.id), {
            unit: tile.unit,
            q: tile.q,
            r: tile.r,
            x: tile.x,
            y: tile.y,
            hp: tile.unit.hp,
            displayHp: tile.unit.displayHp ?? tile.unit.hp,
            _displayShield: tile.unit._displayShield ?? tile.unit._shield ?? 0
        });
    }

    const impactDelay = getImpactDelayForStep(step, state);
    const fxMeta = {
        movedUnits: [],
        addedUnits: [],
        removedUnits: [],
        hpDeltas: [],
        cityHpDeltas: [],
        moraleChangedUnits: [],
        capturedCities: [],
        maxMoveMs: 0
    };

    applyChangesBucket(step.outcome?.changes, step, state, deps, preUnits, impactDelay, fxMeta, { isDeferred: false });
    for (const deferred of step.outcome?.deferredEffects || []) {
        applyChangesBucket(deferred?.changes, step, state, deps, preUnits, impactDelay, fxMeta, { isDeferred: true });
    }

    if (typeof logMessage === 'function') {
        for (const msg of step.outcome?.engineMessages || []) logMessage(msg);
        for (const deferred of step.outcome?.deferredEffects || []) {
            for (const msg of deferred?.engineMessages || []) logMessage(msg);
        }
    }

    updateAllFogOfWar?.(state);
    const enrichedPayload = buildEnrichedPayload(step, state, preUnits, fxMeta, impactDelay);
    fxCallback?.(step, enrichedPayload, fxMeta);

    const counterDelay = step.actionType === 'attack' && enrichedPayload.counterDmg > 0
        ? (enrichedPayload.counterType === 'ru_katyusha' ? 750
            : enrichedPayload.counterType === 'fr_heavy_cannon' ? 700
            : enrichedPayload.counterType === 'us_marine' ? 260
            : 220)
        : 0;
    const minStepMs = step.actionType === 'tacticalCard' && step.payload?.cardId !== 'airdrop'
        ? 2100
        : step.actionType === 'endTurn'
            ? 850
            : step.actionType === 'attack' || step.actionType === 'banzaiCharge'
                ? 680
                : step.actionType === 'recruit' || step.actionType === 'reinforce'
                    ? 560
                    : 480;
    const delayMs = Math.max(
        minStepMs,
        Math.round((fxMeta.maxMoveMs || 0) + 220),
        impactDelay + 360,
        counterDelay + 360
    );

    return { step, effects: enrichedPayload, fxMeta, delayMs };
}

export function createReplaySession({
    log,
    gameState,
    deps,
    onBeforeStart,
    onAfterStep,
    onPlayFx,
    onStateChange,
    onComplete,
    onExit
} = {}) {
    if (!isReplayableMatchLog(log)) {
        throw new Error('请选择有效的完整录像文件');
    }
    const steps = extractReplaySteps(log);
    let currentIndex = 0;
    let timerId = null;
    let active = false;
    let paused = false;

    const clearTimer = () => {
        if (timerId != null) {
            clearTimeout(timerId);
            timerId = null;
        }
    };

    const canSwitchPerspective = () => Boolean(gameState?.skirmishFog && !gameState?.campaignMode);

    const getStatus = () => ({
        active,
        paused,
        finished: currentIndex >= steps.length,
        currentStep: currentIndex,
        totalSteps: steps.length,
        round: gameState?.turnCounter != null ? Math.floor(gameState.turnCounter / Math.max(1, (gameState.turnOrder || []).filter(k => k !== 'neutral').length)) + 1 : 1,
        viewCampKey: gameState?._replayViewCampKey || 'neutral',
        isCampaign: !!gameState?.campaignMode,
        canSwitchPerspective: canSwitchPerspective()
    });

    const emitChange = () => {
        onStateChange?.(getStatus());
    };

    const scheduleNext = (delayMs = 550) => {
        clearTimer();
        if (!active || paused) return;
        if (currentIndex >= steps.length) {
            gameState._replayFinished = true;
            emitChange();
            onComplete?.(getStatus());
            return;
        }
        timerId = setTimeout(() => {
            timerId = null;
            if (!active || paused) return;
            const step = steps[currentIndex++];
            const res = applyReplayStep(step, gameState, {
                ...deps,
                fxCallback: (s, fx, meta) => onPlayFx?.(s, fx, meta)
            });
            onAfterStep?.(res, getStatus());
            if (currentIndex >= steps.length) {
                gameState._replayFinished = true;
                emitChange();
                onComplete?.(getStatus());
                return;
            }
            emitChange();
            scheduleNext(res.delayMs);
        }, delayMs);
    };

    const start = () => {
        clearTimer();
        currentIndex = 0;
        active = true;
        paused = false;
        buildReplayInitialState(log, gameState, deps);
        onBeforeStart?.(getStatus());
        emitChange();
        scheduleNext(650);
        return getStatus();
    };

    const pause = () => {
        if (!active || paused) return getStatus();
        paused = true;
        gameState._replayPaused = true;
        clearTimer();
        emitChange();
        return getStatus();
    };

    const resume = () => {
        if (!active) return getStatus();
        if (currentIndex >= steps.length) {
            return start();
        }
        if (!paused) return getStatus();
        paused = false;
        gameState._replayPaused = false;
        emitChange();
        scheduleNext(260);
        return getStatus();
    };

    const togglePause = () => {
        if (!active) return getStatus();
        if (currentIndex >= steps.length) return start();
        return paused ? resume() : pause();
    };

    const setPerspective = (campKey) => {
        if (!active || !canSwitchPerspective()) return getStatus();
        const validKeys = new Set(['neutral', ...(gameState.turnOrder || []).filter(k => k !== 'neutral')]);
        if (!validKeys.has(campKey)) return getStatus();
        gameState._replayViewCampKey = campKey;
        deps.updateAllFogOfWar?.(gameState);
        deps.invalidateBoard?.();
        emitChange();
        return getStatus();
    };

    const togglePerspective = (campKey) => {
        if (!active || !canSwitchPerspective()) return getStatus();
        const current = gameState._replayViewCampKey || 'neutral';
        return setPerspective(current === campKey ? 'neutral' : campKey);
    };

    const stop = () => {
        clearTimer();
        active = false;
        paused = false;
        if (gameState) {
            gameState._replayMode = false;
            gameState._replayPaused = false;
            gameState._replayFinished = false;
            gameState._replayViewCampKey = null;
        }
        onExit?.();
    };

    return { start, pause, resume, togglePause, setPerspective, togglePerspective, stop, getStatus };
}
