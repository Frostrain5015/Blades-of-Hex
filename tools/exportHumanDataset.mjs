// 从 artifacts/human-replay/*.match-full.json 无损回放并导出人类行为训练数据集与 Imperator 交叉对比报告。
//
// 输出两份产物（默认落在 .gitignore 的 artifacts/datasets/ 下）：
//   1. JSONL 数据集：每条含 (observation, legalCandidates, humanChosenId, shadowImperator)
//   2. 交叉对比汇总 JSON：统计状态保真率、合法候选命中率、人类与 Imperator 的策略分歧分布
//
// 用法示例：
//   node tools/exportHumanDataset.mjs
//   node tools/exportHumanDataset.mjs --style=grandmaster --include-obs=false

import '../core/dom-shim.js';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { engine } from '../core/headless.js';
import { buildObservation } from './agentSdk.mjs';
import { buildAiHelpers } from '../js/ai.js';
import { planTurn } from '../ai/core/planner.js';
import { TIER_CAPABILITIES } from '../ai/core/weights.js';
import { getAiDifficultyProfile } from '../ai/difficulty.js';
import { computeCampBorders, computeDistrictBorders } from '../js/HexTile.js';
import { isTileVisible, updateFogOfWar } from '../js/fogOfWar.js';
import { canRecruitTypeAtSelectedSite, getRecruitmentOptionsForTile } from '../js/recruitmentUi.js';
import { getCommanderRecruitCost } from '../js/commanderInterface.js';
import { allCommanders, getCommander } from '../commander/index.js';
import { campToKey } from '../rules/camps.js';
import { canAttack } from '../rules/diplomacy.js';
import { hexDistance } from '../rules/hex.js';
import { UNIT_CONFIG, getSpecializationOptions } from '../rules/units.js';
import {
    CULTURE_CONFIG,
    getBanzaiCooldown,
    getGuerrillaConcealmentReason,
    getHeavyCannonStanceCooldown,
    getHistoricalCost,
    getHistoricalRecruitCost
} from '../rules/cultures.js';
import { canReinforceAtTile } from '../rules/healing.js';
import { canRepairShipAtPort } from '../rules/naval.js';
import { isCityDisabled } from '../rules/citySiege.js';
import { CARD_SYSTEM_CONFIG } from '../rules/constants.js';
import {
    TACTICAL_CARD_CONFIG,
    TACTICAL_CARD_DATA,
    getCardMeta
} from '../rules/cards.js';
import {
    AIR_COMMAND_CONFIG,
    getAirCommandAvailability,
    getAirCommandCost,
    getAirCommandRange,
    getVisibleAirCommandKinds,
    canAirCommandAirdropAt,
    canTargetWithSingleAirCommand
} from '../rules/airCommands.js';
import {
    CONSTRUCTION_CONFIG,
    canBuildAirfieldAt,
    canBuildBunkerAt,
    canBuildFieldFortification,
    constructionCost
} from '../rules/construction.js';
import { getBanzaiChargePath, resolveTargetingPreview } from '../rules/targeting.js';
import { isSubmarineTargetableBy, isUnitVisibleToCamp } from '../rules/visibility.js';
import { normalizeStandardMapFamilyId } from '../rules/standardMaps.js';
import { getRound } from '../rules/turns.js';

function readArgs(argv) {
    const out = {};
    for (const token of argv) {
        if (!token.startsWith('--')) continue;
        const [k, ...rest] = token.slice(2).split('=');
        out[k] = rest.length ? rest.join('=') : true;
    }
    return out;
}

const args = readArgs(process.argv.slice(2));
const inputPath = resolve(String(args.input || 'artifacts/human-replay'));
const outputPath = resolve(String(args.output || 'artifacts/datasets/human-behavior.jsonl'));
const reportPath = resolve(String(args.report || 'artifacts/datasets/human-vs-imperator-report.json'));
const imperatorStyle = typeof args.style === 'string' ? args.style.trim() : 'grandmaster';
const includeObs = args['include-obs'] !== 'false' && args['include-obs'] !== '0';

function collectMatchFiles(target) {
    const st = statSync(target);
    if (st.isFile()) return [target];
    return readdirSync(target)
        .filter(name => name.endsWith('.match-full.json'))
        .sort()
        .map(name => join(target, name));
}

function getSiteDefaultCityHp(state, tile) {
    return state.standardMapId === 'uncharted-passage' ? 250 : 200;
}

function findFlagPreset(participant) {
    if (participant?.flagPreset) return participant.flagPreset;
    return null;
}

function resolveCardId(card) {
    return typeof card === 'string' ? card : card?.id || null;
}

function resolveCardCommander(card) {
    return typeof card === 'object' && card ? (card.commanderId || null) : null;
}

function setUnitFieldsFromCompact(unit, data, state) {
    unit.hp = Number(data.hp ?? unit.hp);
    unit.maxHp = Number(data.maxHp ?? unit.maxHp);
    unit._shield = Number(data.shield ?? unit._shield ?? 0);
    unit._shieldTurns = Number(data.shieldTurns ?? unit._shieldTurns ?? 0);
    unit.morale = data.morale ?? unit.morale;
    unit.canAct = data.canAct !== undefined ? !!data.canAct : unit.canAct;
    unit.remainingMP = data.remainingMP !== undefined ? Number(data.remainingMP) : unit.remainingMP;
    unit._rank = Number(data.rank ?? unit._rank ?? 0);
    unit.specializationKey = data.specializationKey ?? unit.specializationKey ?? null;
    unit.commander = data.commanderId ?? unit.commander ?? null;
    unit.isEmbarked = data.embarked !== undefined ? !!data.embarked : !!unit.isEmbarked;
    unit.activeSkillCD = Number(data.activeSkillCD ?? unit.activeSkillCD ?? 0);
    unit.activeSkillDur = Number(data.activeSkillDur ?? unit.activeSkillDur ?? 0);
    unit._berserkerQixue = !!(data.berserkerQixue ?? unit._berserkerQixue);
    unit._faith = Number(data.faith ?? unit._faith ?? 0);
    unit._smiteReady = !!(data.smiteReady ?? unit._smiteReady);
    unit._smiteCharged = !!(data.smiteCharged ?? unit._smiteCharged);
    unit._healingAura = Number(data.healingAura ?? unit._healingAura ?? 0);
    if (unit.commander) {
        const key = campToKey(unit.camp);
        const suffix = key === 'player1' ? 'P1' : key === 'player2' ? 'P2' : key === 'player3' ? 'P3' : null;
        if (suffix) {
            if (state[`commander${suffix}`] === unit.commander) state[`commander${suffix}Deployed`] = true;
            if (state[`commander${suffix}Secondary`] === unit.commander) state[`commander${suffix}SecondaryDeployed`] = true;
        }
    }
}

function createHydratedUnit(state, u) {
    const tile = state.tileMap.get(`${u.q},${u.r}`);
    const camp = state.factions[u.campKey] || state.factions.neutral;
    if (!tile || !camp) return null;
    const unit = new engine.Unit(
        u.type,
        camp,
        tile,
        false,
        u.id,
        u.commanderId || null,
        u.embarked ? { isEmbarked: true } : null,
        u.specializationKey || null
    );
    setUnitFieldsFromCompact(unit, u, state);
    tile.unit = unit;
    return unit;
}

export function hydrateMatchInitialState(log) {
    const mode = log.mode || {};
    const participants = log.participants || [];
    const playerParticipants = participants.filter(p => p.campKey !== 'neutral');
    const playerCount = mode.playerCount || (playerParticipants.length >= 3 ? 3 : 2);
    const standardMapId = normalizeStandardMapFamilyId(mode.standardMapId || 'crown-ring');

    engine.resetGameState();
    engine.seedMatchRng(log.matchId || 'replay-export');
    const controllers = {};
    const flagPresets = {};
    for (const p of playerParticipants) {
        controllers[p.campKey] = p.controller === 'ai' ? 'ai' : 'human';
        const fp = findFlagPreset(p);
        if (fp) flagPresets[p.campKey] = fp;
    }
    engine.configureSkirmishState({ playerCount, controllers, flagPresets });

    const state = engine.gameState;
    state.gameMode = mode.type || 'pve';
    state.factionRuleMode = mode.factionRuleMode || 'none';
    state.standardMapId = standardMapId;
    state.skirmishFog = !!mode.fogOfWar;
    state.doubleCommanderMode = !!mode.doubleCommander;
    state.aiDifficulty = mode.aiDifficulty ?? 2;
    state.aiDifficultyId = mode.aiDifficultyId || 'hard';
    if (mode.aiDifficultyByCamp) state.aiDifficultyByCamp = { ...mode.aiDifficultyByCamp };
    state.commanderPhase = 'done';

    for (const p of playerParticipants) {
        const suffix = p.campKey === 'player1' ? 'P1' : p.campKey === 'player2' ? 'P2' : p.campKey === 'player3' ? 'P3' : null;
        if (!suffix) continue;
        const cmdIds = Array.isArray(p.commanderIds) ? p.commanderIds : [];
        state[`commander${suffix}`] = cmdIds[0] || null;
        state[`commander${suffix}Secondary`] = cmdIds[1] || null;
        state[`commander${suffix}Confirmed`] = !!cmdIds[0];
        state[`commander${suffix}SecondaryConfirmed`] = !!cmdIds[1];
        state[`commander${suffix}Deployed`] = false;
        state[`commander${suffix}SecondaryDeployed`] = false;
    }

    engine.initMap();

    // 使用 initialState 精确覆盖地形建筑、站点归属、单位与资源手牌，避免不同版本地图微调带来偏差。
    const init = log.initialState || {};
    state.boardLayout = init.boardLayout || state.boardLayout;
    for (const tile of state.tiles) {
        tile.unit = null;
        tile._reinforcedThisTurn = false;
        tile.airCommandUsed = {};
    }

    const boardByCoord = new Map((init.board || []).map(b => [`${b.q},${b.r}`, b]));
    for (const tile of state.tiles) {
        const b = boardByCoord.get(`${tile.q},${tile.r}`);
        if (!b) continue;
        if (b.districtId !== undefined) tile.districtId = b.districtId;
        tile.fortification = b.fortification || null;
        if (!b.installation) {
            tile.installation = null;
        }
    }

    const siteByCoord = new Map((init.sites || []).map(s => [`${s.q},${s.r}`, s]));
    for (const tile of state.tiles) {
        const s = siteByCoord.get(`${tile.q},${tile.r}`);
        if (!s) continue;
        tile.camp = s.campKey ? (state.factions[s.campKey] || state.factions.neutral) : tile.camp;
        if (s.districtId !== undefined) tile.districtId = s.districtId;
        if (tile.isCity) {
            tile.maxHp = s.maxHp ?? tile.maxHp ?? getSiteDefaultCityHp(state, tile);
            tile.hp = s.hp ?? tile.maxHp;
        }
        tile.fortification = s.fortification || null;
        if (s.installation) {
            tile.installation = {
                type: s.installation,
                status: s.installationStatus || 'ready'
            };
        } else {
            tile.installation = null;
        }
    }

    for (const u of init.units || []) {
        createHydratedUnit(state, u);
    }

    for (const [campKey, res] of Object.entries(init.resources || {})) {
        state.playerGold[campKey] = Number(res.gold ?? 0);
        state.killCount[campKey] = Number(res.kills ?? 0);
        state.playerDrawsThisTurn[campKey] = 0;
        state.playerUsesThisTurn[campKey] = 0;
        const rawCards = Array.isArray(res.cards) ? [...res.cards] : [];
        if (state.doubleCommanderMode) {
            const p = participants.find(x => x.campKey === campKey);
            const cmdQueue = [...(p?.commanderIds || [])];
            state.playerHands[campKey] = rawCards.map(c => {
                if (c === 'commanderDeploy' && cmdQueue.length > 0) {
                    return { id: 'commanderDeploy', commanderId: cmdQueue.shift() };
                }
                return c;
            });
        } else {
            state.playerHands[campKey] = rawCards;
        }
    }

    if (Array.isArray(log.turnOrder) && log.turnOrder.length) {
        state.turnOrder = [...log.turnOrder];
    }
    state.weather = init.weather || state.weather || 'clear';
    const firstKey = init.firstCampKey || state.turnOrder[0] || 'player1';
    state.currentCamp = state.factions[firstKey] || state.factions.player1;
    state.turnCounter = 0;
    state.gameOver = false;
    state.victoryCamp = null;
    computeDistrictBorders?.(state.tiles, state.tileMap);
    computeCampBorders?.(state.tiles, state.tileMap);
    if (state.skirmishFog) {
        for (const p of playerParticipants) {
            const camp = state.factions[p.campKey];
            if (camp) updateFogOfWar(state, camp);
        }
    }
    return state;
}

function findUnitById(state, unitId) {
    const targetId = Number(unitId);
    for (const tile of state.tiles) {
        if (tile.unit && Number(tile.unit.id) === targetId) return tile.unit;
    }
    return null;
}

export function applyChanges(state, changes, actionEntry = null) {
    if (!changes) return;
    let sitesCampChanged = false;
    let fogRefreshNeeded = false;

    for (const u of changes.unitsRemoved || []) {
        const unit = findUnitById(state, u.id);
        if (unit?.tile) unit.tile.unit = null;
        fogRefreshNeeded = true;
    }

    for (const mv of changes.unitsMoved || []) {
        const unit = findUnitById(state, mv.unitId);
        const dest = state.tileMap.get(`${mv.to.q},${mv.to.r}`);
        if (!unit || !dest) continue;
        if (unit.tile && unit.tile.unit === unit) unit.tile.unit = null;
        dest.unit = unit;
        unit.tile = dest;
        fogRefreshNeeded = true;
    }

    for (const u of changes.unitsAdded || []) {
        const existing = findUnitById(state, u.id);
        if (existing?.tile) existing.tile.unit = null;
        createHydratedUnit(state, u);
        fogRefreshNeeded = true;
    }

    for (const hpChange of changes.unitHp || []) {
        const unit = findUnitById(state, hpChange.unitId);
        if (unit) unit.hp = Number(hpChange.after);
    }

    for (const st of changes.unitState || []) {
        const unit = findUnitById(state, st.unitId);
        if (!unit) continue;
        const patch = {};
        for (const [k, v] of Object.entries(st.changes || {})) {
            if (k === 'campKey') {
                unit.camp = state.factions[v.after] || unit.camp;
            } else {
                patch[k] = v.after;
            }
        }
        setUnitFieldsFromCompact(unit, patch, state);
    }

    for (const sc of changes.sitesChanged || []) {
        const [, coords] = String(sc.site || '').split(':');
        const [qStr, rStr] = (coords || '').split(',');
        const tile = state.tileMap.get(`${Number(qStr)},${Number(rStr)}`);
        if (!tile) continue;
        for (const [k, v] of Object.entries(sc.changes || {})) {
            if (k === 'campKey') {
                tile.camp = v.after ? (state.factions[v.after] || state.factions.neutral) : null;
                sitesCampChanged = true;
                fogRefreshNeeded = true;
            } else if (k === 'hp') {
                tile.hp = v.after;
            } else if (k === 'fortification') {
                tile.fortification = v.after || null;
            } else if (k === 'installation') {
                tile.installation = v.after ? { ...(tile.installation || {}), type: v.after } : null;
            } else if (k === 'installationStatus') {
                if (v.after) tile.installation = { ...(tile.installation || { type: 'airfield' }), status: v.after };
                else if (tile.installation) tile.installation.status = null;
            }
        }
    }

    // 手牌增量跟随 actionType + resources.handSize 精确同步
    if (actionEntry?.kind === 'action') {
        const actorKey = actionEntry.actorCampKey;
        const hand = (state.playerHands[actorKey] ||= []);
        if (actionEntry.actionType === 'drawCard') {
            if (actionEntry.payload?.cardId) hand.push(actionEntry.payload.cardId);
            state.playerDrawsThisTurn[actorKey] = (state.playerDrawsThisTurn[actorKey] || 0) + 1;
        } else if (actionEntry.actionType === 'tacticalCard') {
            const playedId = actionEntry.payload?.cardId;
            const cmdId = actionEntry.payload?.commander || null;
            let idx = hand.findIndex(c => resolveCardId(c) === playedId
                && (!cmdId || !resolveCardCommander(c) || resolveCardCommander(c) === cmdId));
            if (idx < 0) idx = hand.findIndex(c => resolveCardId(c) === playedId);
            if (idx >= 0) hand.splice(idx, 1);
            if (playedId !== 'commanderDeploy') {
                state.playerUsesThisTurn[actorKey] = (state.playerUsesThisTurn[actorKey] || 0) + 1;
            }
        } else if (actionEntry.actionType === 'reinforce' || actionEntry.actionType === 'repairShip') {
            const unit = findUnitById(state, actionEntry.payload?.unitId);
            if (unit?.tile) unit.tile._reinforcedThisTurn = true;
        } else if (actionEntry.actionType === 'airCommand') {
            const launcher = state.tileMap.get(`${actionEntry.payload?.launcherQ},${actionEntry.payload?.launcherR}`);
            if (launcher) {
                launcher.airCommandUsed ||= {};
                launcher.airCommandUsed[actionEntry.payload?.kind] = getRound(state);
            }
        }
    }

    for (const rc of changes.resources || []) {
        const campKey = rc.campKey;
        const ch = rc.changes || {};
        if (ch.gold) state.playerGold[campKey] = Number(ch.gold.after);
        if (ch.kills) state.killCount[campKey] = Number(ch.kills.after);
        if (ch.surrendered?.after && !state.surrenderedCamps.includes(state.factions[campKey])) {
            if (state.factions[campKey]) state.surrenderedCamps.push(state.factions[campKey]);
        }
        if (ch.handSize && Array.isArray(state.playerHands[campKey])) {
            const targetLen = Number(ch.handSize.after);
            while (state.playerHands[campKey].length > targetLen) state.playerHands[campKey].pop();
            while (state.playerHands[campKey].length < targetLen) state.playerHands[campKey].push('unknown');
        }
    }

    let turnChanged = false;
    for (const g of changes.global || []) {
        if (g.field === 'weather') state.weather = g.after;
        else if (g.field === 'currentCampKey') {
            state.currentCamp = state.factions[g.after] || state.currentCamp;
            turnChanged = true;
        } else if (g.field === 'turnCounter') {
            state.turnCounter = Number(g.after);
            turnChanged = true;
        } else if (g.field === 'gameOver') state.gameOver = !!g.after;
        else if (g.field === 'victoryCampKey') {
            state.victoryCamp = g.after === 'draw' ? 'draw' : (state.factions[g.after] || null);
        }
    }

    if (turnChanged) {
        const activeKey = campToKey(state.currentCamp);
        state.playerDrawsThisTurn[activeKey] = 0;
        state.playerUsesThisTurn[activeKey] = 0;
        for (const tile of state.tiles) {
            tile._reinforcedThisTurn = false;
        }
        fogRefreshNeeded = true;
    }

    if (sitesCampChanged) computeCampBorders?.(state.tiles, state.tileMap);
    if (fogRefreshNeeded && state.skirmishFog) {
        for (const [ck, faction] of Object.entries(state.factions || {})) {
            if (ck !== 'neutral' && faction?.active !== false) updateFogOfWar(state, faction);
        }
    }
}

function getAllActiveCommandSkillKeys(unit, state) {
    if (!unit?.commander) return [];
    if (unit.commander === 'engineer') {
        const out = [];
        if (canBuildFieldFortification(unit, 'trench', state)) out.push('trench');
        if (canBuildFieldFortification(unit, 'flak', state)) out.push('flak');
        return out;
    }
    const cfg = getCommander(unit.commander);
    if (!cfg?.activeSkill) return [];
    if (Number(unit.activeSkillCD || 0) > 0 || Number(unit.activeSkillDur || 0) > 0) return [];
    return [cfg.activeSkill.id || ''];
}

export function enumerateLegalCandidates(state, camp, helpers) {
    const campKey = campToKey(camp);
    const gold = Number(state.playerGold?.[campKey] || 0);
    const candidates = [];
    const tileVisibleFn = tile => !state.skirmishFog || isTileVisible(tile, camp, state);
    const unitVisibleFn = unit => !!unit && isUnitVisibleToCamp(unit, camp, state) && isSubmarineTargetableBy(unit, camp, state);

    const units = state.tiles.filter(t => t.unit?.camp === camp && t.unit.hp > 0).map(t => t.unit);
    for (const unit of units) {
        if (unit.canAct && !unit.isNewRecruit) {
            const moves = helpers.getMovableTiles(unit) || [];
            for (const tile of moves) {
                candidates.push({
                    id: candidates.length,
                    key: `move:${unit.id}:${tile.q},${tile.r}`,
                    actionType: 'move',
                    unitId: unit.id,
                    unitType: unit.type,
                    q: tile.q,
                    r: tile.r
                });
            }
            const attacks = helpers.getAttackableTiles(unit) || [];
            for (const tile of attacks) {
                if (tile.unit && tile.unit.camp !== camp && unitVisibleFn(tile.unit) && canAttack(state, camp, tile.unit.camp)) {
                    candidates.push({
                        id: candidates.length,
                        key: `attack:${unit.id}:${tile.unit.id}`,
                        actionType: 'attack',
                        unitId: unit.id,
                        targetId: tile.unit.id,
                        q: tile.q,
                        r: tile.r
                    });
                } else if (!tile.unit && (tile.isCity || tile.isUrban) && tile.hp > 0 && canAttack(state, camp, tile.camp)) {
                    candidates.push({
                        id: candidates.length,
                        key: `attackCity:${unit.id}:${tile.q},${tile.r}`,
                        actionType: 'attack',
                        unitId: unit.id,
                        targetId: null,
                        q: tile.q,
                        r: tile.r
                    });
                }
            }
            if (canReinforceAtTile(unit, state) && !unit.tile?._reinforcedThisTurn && unit.hp < unit.maxHp) {
                candidates.push({
                    id: candidates.length,
                    key: `reinforce:${unit.id}`,
                    actionType: 'reinforce',
                    unitId: unit.id
                });
            }
            if (canRepairShipAtPort(unit, state) && !unit.tile?._reinforcedThisTurn && unit.hp < unit.maxHp) {
                candidates.push({
                    id: candidates.length,
                    key: `repairShip:${unit.id}`,
                    actionType: 'repairShip',
                    unitId: unit.id
                });
            }
            if (unit.type === 'fr_heavy_cannon' && getHeavyCannonStanceCooldown(unit, state) === 0) {
                candidates.push({
                    id: candidates.length,
                    key: `heavyCannonStance:${unit.id}`,
                    actionType: 'heavyCannonStance',
                    unitId: unit.id
                });
            }
            if (unit.type === 'jp_samurai' && getBanzaiCooldown(unit, state) === 0) {
                for (const tile of state.tiles) {
                    if (tile.unit && unitVisibleFn(tile.unit) && canAttack(state, camp, tile.unit.camp)
                        && getBanzaiChargePath(unit, tile, state)) {
                        candidates.push({
                            id: candidates.length,
                            key: `banzaiCharge:${unit.id}:${tile.q},${tile.r}`,
                            actionType: 'banzaiCharge',
                            unitId: unit.id,
                            q: tile.q,
                            r: tile.r
                        });
                    }
                }
            }
        }
        if (unit.pendingSpecialization) {
            for (const opt of getSpecializationOptions(unit)) {
                candidates.push({
                    id: candidates.length,
                    key: `spec:${unit.id}:${opt.key}`,
                    actionType: 'chooseSpecialization',
                    unitId: unit.id,
                    specializationKey: opt.key
                });
            }
        }
        if (unit.type === 'cpc_guerrilla' && !getGuerrillaConcealmentReason(unit, state)) {
            candidates.push({
                id: candidates.length,
                key: `conceal:${unit.id}`,
                actionType: 'guerrillaConcealment',
                unitId: unit.id
            });
        }
        if (unit.commander === 'engineer' && canBuildFieldFortification(unit, 'trench', state)) {
            candidates.push({
                id: candidates.length,
                key: `fort:trench:${unit.id}:${unit.tile.q},${unit.tile.r}`,
                actionType: 'buildFortification',
                unitId: unit.id,
                fortKind: 'trench',
                q: unit.tile.q,
                r: unit.tile.r
            });
        }
        if (unit.commander === 'engineer' && canBuildFieldFortification(unit, 'flak', state)) {
            candidates.push({
                id: candidates.length,
                key: `fort:flak:${unit.id}:${unit.tile.q},${unit.tile.r}`,
                actionType: 'buildFortification',
                unitId: unit.id,
                fortKind: 'flak',
                q: unit.tile.q,
                r: unit.tile.r
            });
        }
        if (!unit.commander && canBuildFieldFortification(unit, 'trench', state)
            && gold >= constructionCost('trench', unit, unit.tile, state)) {
            candidates.push({
                id: candidates.length,
                key: `fort:trench:${unit.id}:${unit.tile.q},${unit.tile.r}`,
                actionType: 'buildFortification',
                unitId: unit.id,
                fortKind: 'trench',
                q: unit.tile.q,
                r: unit.tile.r
            });
        }
        if (!unit.commander && canBuildFieldFortification(unit, 'flak', state)
            && gold >= constructionCost('flak', unit, unit.tile, state)) {
            candidates.push({
                id: candidates.length,
                key: `fort:flak:${unit.id}:${unit.tile.q},${unit.tile.r}`,
                actionType: 'buildFortification',
                unitId: unit.id,
                fortKind: 'flak',
                q: unit.tile.q,
                r: unit.tile.r
            });
        }
        for (const skillId of getAllActiveCommandSkillKeys(unit, state)) {
            candidates.push({
                id: candidates.length,
                key: `skill:${unit.id}:${skillId}`,
                actionType: 'activateSkill',
                unitId: unit.id,
                skillId
            });
        }
        if (unit._isDrone) {
            for (const tile of state.tiles) {
                if (tile.unit && tile.unit.camp !== camp && hexDistance(unit.tile, tile) <= 2 && unitVisibleFn(tile.unit)) {
                    candidates.push({
                        id: candidates.length,
                        key: `droneSuicide:${unit.id}:${tile.q},${tile.r}`,
                        actionType: 'droneSuicide',
                        unitId: unit.id,
                        q: tile.q,
                        r: tile.r
                    });
                }
            }
        }
        if (unit.commander === 'tianyan' && unit.tile && !unit._isDrone && unit.canAct && gold >= 5) {
            for (const tile of state.tiles) {
                if (!tile.unit && !tile.isCity && tile.terrain !== 'mountain' && hexDistance(unit.tile, tile) === 1) {
                    candidates.push({
                        id: candidates.length,
                        key: `droneDeploy:${unit.id}:${tile.q},${tile.r}`,
                        actionType: 'droneDeploy',
                        unitId: unit.id,
                        q: tile.q,
                        r: tile.r
                    });
                }
            }
        }
    }

    // 募兵 + 建机场
    for (const tile of state.tiles) {
        if (tile.camp !== camp || (!tile.isCity && !tile.isPort)) continue;
        if (tile.isCity && canBuildAirfieldAt(tile, camp, state) && gold >= CONSTRUCTION_CONFIG.airfield.cost) {
            candidates.push({
                id: candidates.length,
                key: `airfield:${tile.q},${tile.r}`,
                actionType: 'buildAirfield',
                q: tile.q,
                r: tile.r
            });
        }
        if (!tile.unit && !isCityDisabled(tile)) {
            for (const opt of getRecruitmentOptionsForTile(tile, state, camp)) {
                if (!canRecruitTypeAtSelectedSite(opt.type, tile, state, camp)) continue;
                const cost = getCommanderRecruitCost(
                    getHistoricalRecruitCost(UNIT_CONFIG[opt.type].cost, state, camp, opt.type),
                    state, camp
                );
                if (cost <= gold) {
                    candidates.push({
                        id: candidates.length,
                        key: `recruit:${opt.type}:${tile.q},${tile.r}`,
                        actionType: 'recruit',
                        unitType: opt.type,
                        q: tile.q,
                        r: tile.r
                    });
                }
            }
        }
    }

    // 航空指令
    for (const launcher of state.tiles) {
        if (!launcher.isCity || launcher.camp !== camp || launcher.installation?.status !== 'ready') continue;
        const range = getAirCommandRange(launcher);
        for (const kind of getVisibleAirCommandKinds(launcher, state)) {
            if (!getAirCommandAvailability(kind, launcher, state).available) continue;
            if (getAirCommandCost(kind, launcher, state) > gold) continue;
            for (const tile of state.tiles) {
                if (hexDistance(launcher, tile) > range) continue;
                if (kind !== 'recon' && !tileVisibleFn(tile)) continue;
                const ok = kind === 'airdrop'
                    ? canAirCommandAirdropAt(tile)
                    : (kind === 'strafe' || kind === 'stukaDiveBomb')
                        ? (!tile.unit || unitVisibleFn(tile.unit)) && canTargetWithSingleAirCommand(tile, camp, state, kind === 'stukaDiveBomb')
                        : true;
                if (ok) {
                    candidates.push({
                        id: candidates.length,
                        key: `air:${kind}:${launcher.q},${launcher.r}->${tile.q},${tile.r}`,
                        actionType: 'airCommand',
                        commandKind: kind,
                        fromQ: launcher.q,
                        fromR: launcher.r,
                        q: tile.q,
                        r: tile.r
                    });
                }
            }
        }
    }

    // 战术牌
    const hand = state.playerHands[campKey] || [];
    const usesDone = Number(state.playerUsesThisTurn?.[campKey] || 0);
    const seenCardKeys = new Set();
    for (const card of hand) {
        const cardId = resolveCardId(card);
        if (!cardId || cardId === 'unknown') continue;
        if (cardId !== 'commanderDeploy' && usesDone >= CARD_SYSTEM_CONFIG.maxUsesPerTurn) continue;
        const cfg = TACTICAL_CARD_CONFIG[cardId] || TACTICAL_CARD_DATA[cardId];
        if (!cfg) continue;
        const commanderId = resolveCardCommander(card);
        const preview = resolveTargetingPreview(state, {
            cardId,
            targeting: cfg.targeting,
            commanderId
        }, { myCamp: camp, isTileVisible: t => isTileVisible(t, camp, state) });
        for (const tile of preview.candidateTiles || []) {
            const key = `card:${cardId}:${commanderId || ''}:${tile.q},${tile.r}`;
            if (seenCardKeys.has(key)) continue;
            seenCardKeys.add(key);
            candidates.push({
                id: candidates.length,
                key,
                actionType: 'tacticalCard',
                cardId,
                commanderId,
                q: tile.q,
                r: tile.r
            });
        }
    }

    // 抽牌
    const drawsDone = Number(state.playerDrawsThisTurn?.[campKey] || 0);
    const drawCost = getHistoricalCost(CARD_SYSTEM_CONFIG.drawCost * (1 + drawsDone), state, camp);
    if (drawsDone < CARD_SYSTEM_CONFIG.maxDrawsPerTurn
        && hand.length < CARD_SYSTEM_CONFIG.maxHandSize
        && gold >= drawCost) {
        candidates.push({
            id: candidates.length,
            key: 'drawCard',
            actionType: 'drawCard'
        });
    }

    candidates.push({ id: candidates.length, key: 'endTurn', actionType: 'endTurn' });
    return candidates;
}

export function matchHumanActionToCandidate(entry, candidates, state) {
    const type = entry.actionType;
    const p = entry.payload || {};
    if (type === 'move') {
        return candidates.find(c => c.actionType === 'move' && c.unitId === p.unitId && c.q === p.q && c.r === p.r) || null;
    }
    if (type === 'attack' || type === 'siegeCityAttack') {
        const uid = p.attackerUnitId ?? p.unitId;
        const q = p.q ?? p.tileQ;
        const r = p.r ?? p.tileR;
        return candidates.find(c => c.actionType === 'attack' && c.unitId === uid && c.q === q && c.r === r) || null;
    }
    if (type === 'recruit') {
        return candidates.find(c => c.actionType === 'recruit' && c.unitType === p.type && c.q === p.q && c.r === p.r) || null;
    }
    if (type === 'airCommand') {
        return candidates.find(c => c.actionType === 'airCommand'
            && c.commandKind === p.kind && c.fromQ === p.launcherQ && c.fromR === p.launcherR
            && c.q === p.targetQ && c.r === p.targetR) || null;
    }
    if (type === 'tacticalCard') {
        return candidates.find(c => c.actionType === 'tacticalCard'
            && c.cardId === p.cardId && c.q === p.q && c.r === p.r
            && (!p.commander || !c.commanderId || c.commanderId === p.commander))
            || candidates.find(c => c.actionType === 'tacticalCard' && c.cardId === p.cardId && c.q === p.q && c.r === p.r)
            || null;
    }
    if (type === 'chooseSpecialization') {
        return candidates.find(c => c.actionType === 'chooseSpecialization'
            && c.unitId === p.unitId && c.specializationKey === p.specializationKey) || null;
    }
    if (type === 'reinforce' || type === 'repairShip' || type === 'guerrillaConcealment' || type === 'heavyCannonStance') {
        return candidates.find(c => c.actionType === type && c.unitId === p.unitId) || null;
    }
    if (type === 'banzaiCharge') {
        return candidates.find(c => c.actionType === 'banzaiCharge' && c.unitId === p.unitId && c.q === p.q && c.r === p.r) || null;
    }
    if (type === 'buildAirfield') {
        return candidates.find(c => c.actionType === 'buildAirfield' && c.q === p.q && c.r === p.r) || null;
    }
    if (type === 'buildFortification') {
        return candidates.find(c => c.actionType === 'buildFortification' && c.fortKind === p.kind && c.q === p.q && c.r === p.r) || null;
    }
    if (type === 'activateSkill') {
        return candidates.find(c => c.actionType === 'activateSkill' && c.unitId === p.unitId) || null;
    }
    if (type === 'droneSuicide' || type === 'droneDeploy') {
        const uid = p.unitId ?? p.tianyanUnitId;
        const q = p.q ?? p.tileQ;
        const r = p.r ?? p.tileR;
        return candidates.find(c => c.actionType === type && c.unitId === uid && c.q === q && c.r === r) || null;
    }
    if (type === 'drawCard' || type === 'endTurn') {
        return candidates.find(c => c.actionType === type) || null;
    }
    return null;
}

function summarizeImperatorAction(state, act) {
    if (!act) return null;
    if (act.type === 'tacticalCard' && act.targetId != null) {
        const unit = findUnitById(state, act.targetId);
        const tile = unit?.tile || state.tiles.find(t => t.id === act.targetId);
        return {
            actionType: 'tacticalCard',
            cardId: act.cardId,
            targetId: act.targetId,
            q: tile?.q ?? null,
            r: tile?.r ?? null
        };
    }
    if (act.type === 'siegeCityAttack') {
        return { actionType: 'attack', unitId: act.unitId, q: act.tileQ, r: act.tileR };
    }
    if (act.type === 'attack') {
        const target = findUnitById(state, act.targetId);
        return { actionType: 'attack', unitId: act.unitId, targetId: act.targetId, q: target?.tile?.q ?? null, r: target?.tile?.r ?? null };
    }
    if (act.type === 'move') {
        return { actionType: 'move', unitId: act.unitId, q: act.tileQ, r: act.tileR };
    }
    if (act.type === 'recruit') {
        return { actionType: 'recruit', unitType: act.unitType, q: act.tileQ, r: act.tileR };
    }
    return { actionType: act.type, ...act };
}

function sameSemanticDecision(state, impSum, humanCand) {
    if (!impSum || !humanCand) return false;
    if (impSum.actionType !== humanCand.actionType) return false;
    switch (impSum.actionType) {
        case 'move':
            return impSum.unitId === humanCand.unitId && impSum.q === humanCand.q && impSum.r === humanCand.r;
        case 'attack':
            return impSum.unitId === humanCand.unitId && impSum.q === humanCand.q && impSum.r === humanCand.r;
        case 'recruit':
            return impSum.unitType === humanCand.unitType && impSum.q === humanCand.q && impSum.r === humanCand.r;
        case 'tacticalCard':
            return impSum.cardId === humanCand.cardId && impSum.q === humanCand.q && impSum.r === humanCand.r;
        case 'reinforce':
        case 'repairShip':
        case 'guerrillaConcealment':
            return impSum.unitId === humanCand.unitId;
        case 'drawCard':
            return true;
        default:
            return false;
    }
}

function runShadowImperator(state, camp, shadowMemories) {
    const campKey = campToKey(camp);
    const savedAiActing = state.aiActing;
    const savedMemory = state._aiCoreMemory;
    const savedTelemetry = state._imperatorStrategicTelemetry;
    const savedPin = state._imperatorDoctrinePin;
    state.aiActing = true;
    state._aiCoreMemory = shadowMemories;
    state._imperatorStrategicTelemetry = {};
    if (imperatorStyle && imperatorStyle !== 'random') state._imperatorDoctrinePin = imperatorStyle;
    try {
        const helpers = buildAiHelpers(camp, getAiDifficultyProfile('hard'));
        const plan = planTurn(state, helpers, camp, TIER_CAPABILITIES.hard);
        const summarized = plan.map(act => summarizeImperatorAction(state, act)).filter(Boolean);
        // 若 planTurn 返回空且剩余动作可能已到收尾，隐含动作视为 endTurn
        if (summarized.length === 0) summarized.push({ actionType: 'endTurn' });
        return {
            actions: summarized,
            doctrine: shadowMemories[campKey]?.doctrine || imperatorStyle,
            posture: state._imperatorStrategicTelemetry?.[campKey]?.at(-1)?.posture || null
        };
    } catch (error) {
        return { actions: [], doctrine: imperatorStyle, error: String(error?.message || error) };
    } finally {
        state.aiActing = savedAiActing;
        state._aiCoreMemory = savedMemory;
        state._imperatorStrategicTelemetry = savedTelemetry;
        state._imperatorDoctrinePin = savedPin;
    }
}

const isCliMain = process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;

if (isCliMain) {
const files = collectMatchFiles(inputPath);
const datasetLines = [];
const report = {
    matchesProcessed: files.length,
    imperatorShadowStyle: imperatorStyle,
    totalHumanActions: 0,
    matchedCandidateCount: 0,
    unmatchedActions: {},
    stateSyncChecks: { goldChecked: 0, goldMatched: 0, unitChecked: 0, unitMatched: 0 },
    humanVsImperator: {
        comparedSamples: 0,
        exactInPlanCount: 0,
        exactFirstStepCount: 0,
        sameActionTypeFirstCount: 0,
        sameActionTypeInPlanCount: 0,
        byActionType: {},
        highSignalDivergences: {
            humanDrewCardImperatorDidNot: [],
            imperatorWantedDrawHumanDidNot: [],
            humanPlayedCardImperatorDidNot: [],
            humanBuiltOrSpecialAction: [],
            humanRecruitedDifferentType: []
        }
    }
};

for (const filePath of files) {
    const log = JSON.parse(readFileSync(filePath, 'utf8'));
    const humanCamps = new Set((log.participants || []).filter(p => p.controller === 'human').map(p => p.campKey));
    if (humanCamps.size === 0) continue;

    const state = hydrateMatchInitialState(log);
    const shadowMemories = {};
    const timeline = log.timeline || [];

    // 预处理全部延迟效果，按 resolvedAtSequence 排序以便精确落盘。
    const pendingDeferred = [];
    for (const item of timeline) {
        for (const def of item.outcome?.deferredEffects || []) {
            pendingDeferred.push(def);
        }
    }
    pendingDeferred.sort((a, b) => Number(a.resolvedAtSequence || 0) - Number(b.resolvedAtSequence || 0));
    let defCursor = 0;

    for (const item of timeline) {
        while (defCursor < pendingDeferred.length && Number(pendingDeferred[defCursor].resolvedAtSequence || 0) <= item.sequence) {
            applyChanges(state, pendingDeferred[defCursor].changes, null);
            defCursor++;
        }
        if (item.kind !== 'action') continue;

        if (humanCamps.has(item.actorCampKey) && !['stateCorrection', 'surrender'].includes(item.actionType)) {
            const camp = state.factions[item.actorCampKey];
            if (camp && state.currentCamp !== camp) state.currentCamp = camp;
            const goldCtx = item.decisionContext?.gold;
            const unitCtx = item.decisionContext?.ownForce?.units;
            if (goldCtx != null) {
                report.stateSyncChecks.goldChecked++;
                if (Math.abs(Number(state.playerGold[item.actorCampKey] || 0) - Number(goldCtx)) < 1e-6) {
                    report.stateSyncChecks.goldMatched++;
                }
            }
            if (unitCtx != null) {
                const living = state.tiles.filter(t => t.unit?.camp === camp && t.unit.hp > 0).length;
                report.stateSyncChecks.unitChecked++;
                if (living === unitCtx) report.stateSyncChecks.unitMatched++;
            }

            report.totalHumanActions++;
            const helpers = buildAiHelpers(camp, getAiDifficultyProfile('hard'));
            const candidates = enumerateLegalCandidates(state, camp, helpers);
            const matched = matchHumanActionToCandidate(item, candidates, state);
            if (matched) {
                report.matchedCandidateCount++;
            } else {
                report.unmatchedActions[item.actionType] = (report.unmatchedActions[item.actionType] || 0) + 1;
            }

            const shadow = runShadowImperator(state, camp, shadowMemories);
            const impFirst = shadow.actions[0] || null;
            const exactFirst = matched ? sameSemanticDecision(state, impFirst, matched) : false;
            const exactInPlan = matched ? shadow.actions.some(a => sameSemanticDecision(state, a, matched)) : false;
            const sameTypeFirst = !!(impFirst && impFirst.actionType === item.actionType);
            const sameTypeInPlan = shadow.actions.some(a => a.actionType === item.actionType);

            const byType = (report.humanVsImperator.byActionType[item.actionType] ||= {
                total: 0, exactInPlan: 0, exactFirst: 0, sameTypeFirst: 0, sameTypeInPlan: 0
            });
            byType.total++;
            if (exactInPlan) { report.humanVsImperator.exactInPlanCount++; byType.exactInPlan++; }
            if (exactFirst) { report.humanVsImperator.exactFirstStepCount++; byType.exactFirst++; }
            if (sameTypeFirst) { report.humanVsImperator.sameActionTypeFirstCount++; byType.sameTypeFirst++; }
            if (sameTypeInPlan) { report.humanVsImperator.sameActionTypeInPlanCount++; byType.sameTypeInPlan++; }
            report.humanVsImperator.comparedSamples++;

            // 采集典型高价值战略分歧案例
            const campKey = item.actorCampKey;
            const sampleMeta = {
                matchId: log.matchId,
                round: item.round,
                seq: item.sequence,
                campKey,
                gold: Number(state.playerGold[campKey] || 0),
                hand: [...(state.playerHands[campKey] || [])].map(resolveCardId),
                posture: shadow.posture
            };
            if (item.actionType === 'drawCard' && !sameTypeInPlan && report.humanVsImperator.highSignalDivergences.humanDrewCardImperatorDidNot.length < 30) {
                report.humanVsImperator.highSignalDivergences.humanDrewCardImperatorDidNot.push({
                    ...sampleMeta,
                    imperatorTop3: shadow.actions.slice(0, 3)
                });
            } else if (impFirst?.actionType === 'drawCard' && item.actionType !== 'drawCard' && report.humanVsImperator.highSignalDivergences.imperatorWantedDrawHumanDidNot.length < 30) {
                report.humanVsImperator.highSignalDivergences.imperatorWantedDrawHumanDidNot.push({
                    ...sampleMeta,
                    humanActionType: item.actionType,
                    humanPayload: matched
                });
            } else if (item.actionType === 'tacticalCard' && item.payload?.cardId !== 'commanderDeploy' && !exactInPlan
                && report.humanVsImperator.highSignalDivergences.humanPlayedCardImperatorDidNot.length < 30) {
                report.humanVsImperator.highSignalDivergences.humanPlayedCardImperatorDidNot.push({
                    ...sampleMeta,
                    humanCard: item.payload?.cardId,
                    humanTarget: [item.payload?.q, item.payload?.r],
                    imperatorCards: shadow.actions.filter(a => a.actionType === 'tacticalCard')
                });
            } else if (['buildAirfield', 'buildFortification', 'buildBunker', 'activateSkill', 'guerrillaConcealment'].includes(item.actionType)
                && report.humanVsImperator.highSignalDivergences.humanBuiltOrSpecialAction.length < 30) {
                report.humanVsImperator.highSignalDivergences.humanBuiltOrSpecialAction.push({
                    ...sampleMeta,
                    humanActionType: item.actionType,
                    humanCand: matched,
                    imperatorTop3: shadow.actions.slice(0, 3)
                });
            } else if (item.actionType === 'recruit' && !exactInPlan
                && report.humanVsImperator.highSignalDivergences.humanRecruitedDifferentType.length < 30) {
                report.humanVsImperator.highSignalDivergences.humanRecruitedDifferentType.push({
                    ...sampleMeta,
                    humanRecruit: matched?.unitType,
                    imperatorRecruits: shadow.actions.filter(a => a.actionType === 'recruit')
                });
            }

            if (matched) {
                const record = {
                    matchId: log.matchId,
                    map: log.mode?.standardMapId || state.standardMapId,
                    mode: log.mode?.factionRuleMode || 'none',
                    round: item.round,
                    turnCounter: item.turnCounter,
                    sequence: item.sequence,
                    campKey,
                    ...(includeObs ? { observation: buildObservation(camp) } : {}),
                    legalCandidates: candidates.map(({ id, actionType, unitId, unitType, targetId, q, r, cardId, commandKind, fromQ, fromR, specializationKey, fortKind, skillId }) => ({
                        id,
                        actionType,
                        ...(unitId != null ? { unitId } : {}),
                        ...(unitType ? { unitType } : {}),
                        ...(targetId != null ? { targetId } : {}),
                        ...(q != null ? { q, r } : {}),
                        ...(cardId ? { cardId } : {}),
                        ...(commandKind ? { commandKind, fromQ, fromR } : {}),
                        ...(specializationKey ? { specializationKey } : {}),
                        ...(fortKind ? { fortKind } : {}),
                        ...(skillId != null ? { skillId } : {})
                    })),
                    humanChosenId: matched.id,
                    humanAction: matched,
                    shadowImperator: {
                        doctrine: shadow.doctrine,
                        posture: shadow.posture,
                        top3: shadow.actions.slice(0, 3),
                        exactFirst,
                        exactInPlan,
                        sameTypeInPlan
                    }
                };
                datasetLines.push(JSON.stringify(record));
            }
        }

        applyChanges(state, item.outcome?.changes, item);
    }
}

await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, datasetLines.join('\n') + (datasetLines.length ? '\n' : ''), 'utf8');
await mkdir(dirname(reportPath), { recursive: true });
await writeFile(reportPath, JSON.stringify(report, null, 2), 'utf8');

console.log(JSON.stringify({
    outputPath,
    reportPath,
    exportedSamples: datasetLines.length,
    ...report,
    humanVsImperator: {
        ...report.humanVsImperator,
        highSignalDivergenceCounts: Object.fromEntries(
            Object.entries(report.humanVsImperator.highSignalDivergences).map(([k, v]) => [k, v.length])
        ),
        highSignalDivergences: undefined
    }
}, null, 2));
}
