// Hybrid 评分与决策核心（浏览器安全）—— 融合 Imperator 完整规则规划与 91 维双层 GELU MLP 策略网络。
//
// 严格保持纯前端可打包：仅依赖 ai/models/policy-prototype.json、ai/core/* 与 rules/*，
// 不导入任何 node:* 或 tools/* 模块。

import policyModel from '../models/policy-prototype.json' with { type: 'json' };
import policyModel3p from '../models/policy-3p.json' with { type: 'json' };
import policyModelCr from '../models/policy-cr.json' with { type: 'json' };
import { buildWorld } from './perceive.js';
import { decideStrategy } from './strategize.js';
import { planTurn, planFollowupAttack } from './planner.js';
import { isFieldCapturer } from './roster.js';
import { shouldDrawCard } from './cards.js';
import { resolveHybridFusionProfile, TIER_CAPABILITIES } from './weights.js';
import { evaluateMicroBehaviorTree } from './behaviorTree.js';
import { computeBeamTacticalBonuses } from './beamSearch.js';
import { computeMinimaxAlphaBetaBonuses } from './minimaxSearch.js';
import { computeTurnJointRolloutBonuses } from './turnJointSearch.js';
import { shouldPlanActiveSkill } from '../doctrine.js';
import { hasFullAiIntelligence } from '../difficulty.js';
import { campToKey } from '../../rules/camps.js';
import { canAttack } from '../../rules/diplomacy.js';
import { getRound, getRoundIndex } from '../../rules/turns.js';
import { UNIT_CONFIG, canRecruitUniqueUnit, canUnitBeRecruitedAtSite, getSpecializationOptions } from '../../rules/units.js';
import { TACTICAL_CARD_DATA } from '../../rules/cards.js';
import { CARD_SYSTEM_CONFIG } from '../../rules/constants.js';
import { getBanzaiChargePath, resolveTargetingPreview } from '../../rules/targeting.js';
import { canReinforceAtTile, computeHealGoldCost, isHealingBlocked } from '../../rules/healing.js';
import { getKmtReinforceDeficit } from '../../rules/kmtStronghold.js';
import { canRepairShipAtPort, isRegularNavalUnit } from '../../rules/naval.js';
import { areCommanderMechanicsSuppressed } from '../../rules/movement.js';
import { CONSTRUCTION_CONFIG, canBuildAirfieldAt, canBuildFieldFortification, constructionCost } from '../../rules/construction.js';
import {
    getAirCommandAvailability,
    getAirCommandCost,
    getAirCommandRange,
    getVisibleAirCommandKinds,
    canAirCommandAirdropAt,
    canTargetWithSingleAirCommand
} from '../../rules/airCommands.js';
import { isCityDisabled } from '../../rules/citySiege.js';
import { getCulturalRecruitmentCandidate } from '../../rules/aiRecruitment.js';
import {
    getActiveCultureId,
    getBanzaiCooldown,
    getCulturalReinforceCostScale,
    getGuerrillaConcealmentReason,
    getHeavyCannonStanceCooldown,
    getHistoricalCost,
    getHistoricalRecruitCost
} from '../../rules/cultures.js';
import { getCommander } from '../../commander/index.js';
import { COMMANDER_CONFIG } from '../../rules/commanders.js';
import { HEX_NEIGHBORS } from '../../rules/hex.js';
import { isSubmarineTargetableBy, isUnitVisibleToCamp } from '../../rules/visibility.js';

export const POLICY_MODEL_META = Object.freeze({
    schema: policyModel.schema,
    featureDim: policyModel.featureDim,
    bestEpoch: policyModel.bestEpoch
});

const ACTION_TYPES = Object.freeze([
    'move',
    'attack',
    'tacticalCard',
    'recruit',
    'airCommand',
    'drawCard',
    'reinforce',
    'repairShip',
    'chooseSpecialization',
    'activateSkill',
    'buildAirfield',
    'buildFortification',
    'heavyCannonStance',
    'guerrillaConcealment',
    'droneSuicide',
    'endTurn'
]);
const ACTION_INDEX = Object.freeze(Object.fromEntries(ACTION_TYPES.map((type, idx) => [type, idx])));

const CAPTURER_TYPES = new Set([
    'infantry', 'cavalry', 'jp_samurai', 'us_marine', 'cpc_guerrilla', 'kmt_training_brigade', 'ru_guard'
]);
const NAVAL_TYPES = new Set(['warship', 'destroyer', 'submarine', 'carrier', 'gb_battleship']);
const UNIQUE_TYPES = new Set([
    'de_tiger', 'de_panzer', 'ru_katyusha', 'us_marine',
    'gb_battleship', 'fr_heavy_cannon', 'jp_samurai', 'kmt_training_brigade', 'cpc_guerrilla'
]);
const RARE_SPECIAL_TYPES = new Set([
    'droneDeploy', 'droneSuicide', 'heavyCannonStance', 'buildFortification',
    'buildAirfield', 'repairShip', 'banzaiCharge', 'guerrillaConcealment'
]);
const SPECIAL_COMMANDER_TYPES = new Set(['engineer', 'tianyan', 'minister', 'priest', 'astrologer']);
const DOCTRINE_STYLE_VECTORS = Object.freeze({
    grandmaster: [1.0, 0.0, 0.0, 0.0],
    blitz: [0.0, 1.0, 0.0, 0.0],
    armada: [0.0, 0.0, 1.0, 0.0],
    trickster: [0.0, 0.0, 0.0, 1.0],
    default: [0.4, 0.25, 0.15, 0.2]
});
const OFFENSIVE_CARDS = new Set(['lightning', 'poison', 'imprison', 'orbitalStrike']);

const LAND_RECRUIT_FALLBACK = Object.freeze(['infantry', 'cavalry', 'archer']);
const NAVAL_RECRUIT_FALLBACK = Object.freeze(['warship', 'destroyer', 'submarine']);

function resolveStyleVector(styleTag) {
    return DOCTRINE_STYLE_VECTORS[styleTag] || DOCTRINE_STYLE_VECTORS.default;
}

function resolveCardId(card) {
    if (!card) return null;
    if (typeof card === 'string') return card;
    return card.id || card.cardId || null;
}

function resolveCardCommander(card) {
    if (!card || typeof card !== 'object') return null;
    return card.commanderId || card.commander || null;
}

function hexDistCoords(q1, r1, q2, r2) {
    const dq = q1 - q2;
    const dr = r1 - r2;
    return (Math.abs(dq) + Math.abs(dq + dr) + Math.abs(dr)) >> 1;
}

function unitClassFlags(utype) {
    const base = utype || '';
    const isInf = (base.includes('infantry') || base === 'us_marine' || base === 'cpc_guerrilla' || base === 'kmt_training_brigade' || base === 'ru_guard') ? 1 : 0;
    const isCav = (base.includes('cavalry') || base === 'jp_samurai') ? 1 : 0;
    const isArc = (base.includes('archer') || base === 'ru_katyusha' || base === 'fr_heavy_cannon') ? 1 : 0;
    const isNav = NAVAL_TYPES.has(base) ? 1 : 0;
    const isCap = CAPTURER_TYPES.has(base) ? 1 : 0;
    const isUniq = UNIQUE_TYPES.has(base) ? 1 : 0;
    return [isInf, isCav, isArc, isNav, isCap, isUniq];
}

function getAllActiveCommandSkillKeys(unit, state) {
    if (!unit?.commander || !unit.canAct) return [];
    if (areCommanderMechanicsSuppressed(unit)) return [];
    const allowSecondSmite = unit.commander === 'paladin' && unit._smiteReady && !unit._smiteCharged && Number(unit._faith || 0) >= 1;
    if (state?._aiSkillPlanned?.has?.(unit.id) && !allowSecondSmite) return [];
    if (unit.commander === 'engineer') return [];
    const cfg = getCommander(unit.commander);
    if (!cfg?.activeSkill) return [];
    if (Number(unit.activeSkillCD || 0) > 0 || Number(unit.activeSkillDur || 0) > 0) return [];
    if (unit.commander === 'paladin' && !allowSecondSmite && (!shouldPlanActiveSkill(unit, { hasAttackTarget: true }))) return [];
    if (unit.commander === 'berserker' && (!shouldPlanActiveSkill(unit, { hasAttackTarget: true }))) return [];
    return [cfg.activeSkill.id || ''];
}

function fallbackRecruitOptions(tile, state, camp) {
    const base = tile.isPort ? NAVAL_RECRUIT_FALLBACK : LAND_RECRUIT_FALLBACK;
    const unique = getCulturalRecruitmentCandidate(state, camp);
    const list = [];
    if (unique && UNIT_CONFIG[unique] && canUnitBeRecruitedAtSite(unique, tile.isPort ? 'port' : 'city')) {
        list.push({ type: unique });
    }
    for (const type of base) {
        if (UNIT_CONFIG[type]) list.push({ type });
    }
    return list;
}

/**
 * 陆图海港防呆：非海图上仅当敌方舰艇逼近我方城市或港口 4 格内时，才允许建造正规海军单位，
 * 避免陆图港口停着无法支援陆战的闲置潜艇/军舰。
 */
export function shouldAllowLandMapNavalRecruit(state, camp, oceanMap, world = null) {
    if (oceanMap) return true;
    const hexDistance = (a, b) => hexDistCoords(a.q, a.r, b.q, b.r);
    const ownSites = world
        ? [...(world.myCities || []), ...(world.myPorts || [])]
        : (state.tiles || []).filter(t => t.camp === camp && (t.isCity || t.isPort));
    if (ownSites.length === 0) return false;
    const hostileShips = world
        ? (world.rivalUnits || []).filter(u => u.tile && isRegularNavalUnit(u.type))
        : (state.tiles || [])
            .map(t => t.unit)
            .filter(u => u && u.hp > 0 && u.camp !== camp && u.camp?.id !== 'neutral'
                && isRegularNavalUnit(u.type) && isUnitVisibleToCamp(u, camp, state));
    return hostileShips.some(ship => ownSites.some(site => hexDistance(ship.tile, site) <= 4));
}

export function enumerateHybridCandidates(state, camp, helpers, world = null) {
    const campKey = campToKey(camp);
    const gold = Number(state.playerGold?.[campKey] || 0);
    const candidates = [];
    const fullIntel = hasFullAiIntelligence(state, camp);
    const tileVisibleFn = tile => fullIntel || !state.skirmishFog || (helpers.isTileVisible ? helpers.isTileVisible(tile, camp) : true);
    const unitVisibleFn = unit => !!unit && (fullIntel || !helpers.isUnitVisibleToCamp || helpers.isUnitVisibleToCamp(unit, camp))
        && isSubmarineTargetableBy(unit, camp, state);

    const units = state.tiles.filter(t => t.unit?.camp === camp && t.unit.hp > 0).map(t => t.unit);
    for (const unit of units) {
        if (unit.canAct && !unit.isNewRecruit) {
            const moves = helpers.getMovableTiles ? helpers.getMovableTiles(unit) : [];
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
            const attacks = helpers.getAttackableTiles ? helpers.getAttackableTiles(unit) : [];
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
                        isCitySiege: true,
                        unitId: unit.id,
                        targetId: null,
                        q: tile.q,
                        r: tile.r
                    });
                }
            }
            if (canReinforceAtTile(unit, state) && !unit.tile?._reinforcedThisTurn
                && !isHealingBlocked(unit, state, { allowReinforce: true })) {
                const deficit = getKmtReinforceDeficit(unit, state);
                const healAmt = Math.min(Math.floor(unit.maxHp * 0.50), deficit);
                if (healAmt > 0) {
                    const scale = getCulturalReinforceCostScale(state, unit.tile, camp);
                    const reinforceCost = getHistoricalCost(
                        computeHealGoldCost(unit.config?.cost || 8, healAmt, unit.maxHp, scale),
                        state, camp
                    );
                    if (gold >= reinforceCost) {
                        candidates.push({
                            id: candidates.length,
                            key: `reinforce:${unit.id}`,
                            actionType: 'reinforce',
                            unitId: unit.id
                        });
                    }
                }
            }
            if (canRepairShipAtPort(unit, state) && !unit.tile?._reinforcedThisTurn && unit.hp < unit.maxHp
                && !isHealingBlocked(unit, state, { allowReinforce: true })) {
                const healAmt = Math.min(Math.floor(unit.maxHp * 0.50), unit.maxHp - unit.hp);
                if (healAmt > 0) {
                    const repairCost = getHistoricalCost(
                        computeHealGoldCost(unit.config?.cost || 10, healAmt, unit.maxHp),
                        state, camp
                    );
                    if (gold >= repairCost) {
                        candidates.push({
                            id: candidates.length,
                            key: `repairShip:${unit.id}`,
                            actionType: 'repairShip',
                            unitId: unit.id
                        });
                    }
                }
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
        if (unit.commander === 'engineer') {
            for (const fortKind of ['trench', 'flak']) {
                if (canBuildFieldFortification(unit, fortKind, state)) {
                    candidates.push({
                        id: candidates.length,
                        key: `fort:${fortKind}:${unit.id}:${unit.tile.q},${unit.tile.r}`,
                        actionType: 'buildFortification',
                        unitId: unit.id,
                        fortKind,
                        q: unit.tile.q,
                        r: unit.tile.r
                    });
                }
            }
        } else {
            for (const fortKind of ['trench', 'flak']) {
                if (canBuildFieldFortification(unit, fortKind, state)
                    && gold >= constructionCost(fortKind, unit, unit.tile, state)) {
                    candidates.push({
                        id: candidates.length,
                        key: `fort:${fortKind}:${unit.id}:${unit.tile.q},${unit.tile.r}`,
                        actionType: 'buildFortification',
                        unitId: unit.id,
                        fortKind,
                        q: unit.tile.q,
                        r: unit.tile.r
                    });
                }
            }
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
                if (tile.unit && tile.unit.camp !== camp && hexDistCoords(unit.tile.q, unit.tile.r, tile.q, tile.r) <= 2 && unitVisibleFn(tile.unit)) {
                    candidates.push({
                        id: candidates.length,
                        key: `droneSuicide:${unit.id}:${tile.q},${tile.r}`,
                        actionType: 'droneSuicide',
                        unitId: unit.id,
                        targetId: tile.unit.id,
                        q: tile.q,
                        r: tile.r
                    });
                }
            }
        }
        if (unit.commander === 'tianyan' && unit.tile && !unit._isDrone && unit.canAct) {
            const tianyanBal = COMMANDER_CONFIG.tianyan.balance;
            const livingDrones = state.tiles.filter(t => t.unit?._isDrone && t.unit.hp > 0
                && (t.unit._droneCampKey === campKey || t.unit.camp === camp)).length;
            const deployedThisTurn = state._droneDeployTurn?.[campKey] === state.turnCounter
                ? (state._droneDeployCount?.[campKey] || 0) : 0;
            if (livingDrones < tianyanBal.maxCount
                && deployedThisTurn < tianyanBal.deployLimitPerTurn
                && gold >= tianyanBal.deployGoldCost) {
                for (const [dq, dr] of HEX_NEIGHBORS) {
                    const tile = state.tileMap.get(`${unit.tile.q + dq},${unit.tile.r + dr}`);
                    if (!tile || tile.unit || tile.isCity || tile.terrain === 'mountain') continue;
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

    const oceanMap = world ? world.oceanMap : state.standardMapId === 'uncharted-passage';
    const allowLandMapNavy = shouldAllowLandMapNavalRecruit(state, camp, oceanMap, world);

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
            const opts = helpers.getRecruitmentOptionsForTile
                ? helpers.getRecruitmentOptionsForTile(tile)
                : fallbackRecruitOptions(tile, state, camp);
            for (const opt of opts) {
                if (!canRecruitUniqueUnit(state, camp, opt.type)) continue;
                const canAtSite = helpers.canRecruitTypeAtSite
                    ? helpers.canRecruitTypeAtSite(opt.type, tile)
                    : canUnitBeRecruitedAtSite(opt.type, tile.isPort ? 'port' : 'city');
                if (!canAtSite) continue;
                if (!oceanMap && isRegularNavalUnit(opt.type) && !allowLandMapNavy) continue;
                const histCost = getHistoricalRecruitCost(UNIT_CONFIG[opt.type].cost, state, camp, opt.type);
                const cost = helpers.getCommanderRecruitCost ? helpers.getCommanderRecruitCost(histCost, camp) : histCost;
                if (cost <= gold) {
                    candidates.push({
                        id: candidates.length,
                        key: `recruit:${opt.type}:${tile.q},${tile.r}`,
                        actionType: 'recruit',
                        unitType: opt.type,
                        cost,
                        q: tile.q,
                        r: tile.r
                    });
                }
            }
        }
    }

    for (const launcher of state.tiles) {
        if (!launcher.isCity || launcher.camp !== camp || launcher.installation?.status !== 'ready') continue;
        const range = getAirCommandRange(launcher);
        for (const kind of getVisibleAirCommandKinds(launcher, state)) {
            if (kind === 'stukaDiveBomb') continue; // 由 runAiAirCommands 统一按 stukaSorties 配额（每机场每回合最多 2 次）执行
            if (!getAirCommandAvailability(kind, launcher, state).available) continue;
            if (getAirCommandCost(kind, launcher, state) > gold) continue;
            for (const tile of state.tiles) {
                if (hexDistCoords(launcher.q, launcher.r, tile.q, tile.r) > range) continue;
                if (kind !== 'recon' && !tileVisibleFn(tile)) continue;
                const ok = kind === 'airdrop'
                    ? canAirCommandAirdropAt(tile)
                    : (kind === 'strafe' || kind === 'stukaDiveBomb')
                        ? (tile.unit
                            ? unitVisibleFn(tile.unit) && canTargetWithSingleAirCommand(tile, camp, state, true)
                            : (tile.isCity || tile.isUrban) && (Number(tile.hp) || 0) > 0 && canAttack(state, camp, tile.camp))
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

    const hand = state.playerHands?.[campKey] || [];
    const usesDone = Number(state.playerUsesThisTurn?.[campKey] || 0);
    const seenCardKeys = new Set();
    for (const card of hand) {
        const cardId = resolveCardId(card);
        if (!cardId || cardId === 'unknown') continue;
        if (cardId !== 'commanderDeploy' && usesDone >= CARD_SYSTEM_CONFIG.maxUsesPerTurn) continue;
        const cfg = TACTICAL_CARD_DATA[cardId];
        if (!cfg) continue;
        const commanderId = resolveCardCommander(card);
        const preview = resolveTargetingPreview(state, {
            cardId,
            targeting: cfg.targeting,
            commanderId
        }, { myCamp: camp, isTileVisible: tileVisibleFn });
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
                targetId: tile.unit?.id || tile.id || null,
                q: tile.q,
                r: tile.r
            });
        }
    }

    const drawsDone = Number(state.playerDrawsThisTurn?.[campKey] || 0);
    const drawCost = getHistoricalCost(CARD_SYSTEM_CONFIG.drawCost * (1 + drawsDone), state, camp);
    const hasDeckState = Array.isArray(state.cardDrawPile) || Array.isArray(state.cardDiscardPile);
    const deckCount = (state.cardDrawPile?.length || 0) + (state.cardDiscardPile?.length || 0);
    if ((!hasDeckState || deckCount > 0)
        && drawsDone < CARD_SYSTEM_CONFIG.maxDrawsPerTurn
        && hand.length < CARD_SYSTEM_CONFIG.maxHandSize
        && gold >= drawCost) {
        candidates.push({
            id: candidates.length,
            key: 'drawCard',
            actionType: 'drawCard',
            drawCost
        });
    }

    candidates.push({ id: candidates.length, key: 'endTurn', actionType: 'endTurn' });
    return candidates;
}

function gelu(x) {
    return 0.5 * x * (1.0 + Math.tanh(0.7978845608 * (x + 0.044715 * x * x * x)));
}

function forwardPolicyAndValueRow(rawFeatures, model = policyModel) {
    const mean = model.normMean;
    const std = model.normStd;
    const { W1, b1, W2, b2, W3, b3, Wv, bv } = model.weights;
    const dim = model.featureDim;
    const h1 = b1.length;
    const h2 = b2.length;

    const norm = new Float64Array(dim);
    for (let i = 0; i < dim; i++) {
        const z = (rawFeatures[i] - mean[i]) / std[i];
        norm[i] = z > 8.0 ? 8.0 : (z < -8.0 ? -8.0 : z);
    }

    const a1 = new Float64Array(h1);
    for (let j = 0; j < h1; j++) {
        let sum = b1[j];
        for (let i = 0; i < dim; i++) {
            sum += norm[i] * W1[i][j];
        }
        a1[j] = gelu(sum);
    }

    const a2 = new Float64Array(h2);
    for (let k = 0; k < h2; k++) {
        let sum = b2[k];
        for (let j = 0; j < h1; j++) {
            sum += a1[j] * W2[j][k];
        }
        a2[k] = gelu(sum);
    }

    let logit = b3;
    for (let k = 0; k < h2; k++) {
        logit += a2[k] * W3[k];
    }

    let value = 0;
    if (Array.isArray(Wv)) {
        let vRaw = Number(bv || 0);
        for (let k = 0; k < h2; k++) {
            vRaw += a2[k] * Wv[k];
        }
        value = Math.tanh(vRaw);
    }
    return { logit, value };
}

/**
 * 与 tools/trainPolicyPrototype.py 完全对齐的 112 维多单位协同 + 风格条件候选特征化，
 * 返回 { logits, values } 双头推理结果（logits: 动作优先级, values: 长期终局评估 [-1, 1]）。
 */
export function scorePolicyAndValueCandidates(state, camp, candidates, helpers, styleTag = null) {
    const campKey = campToKey(camp);
    const roundNum = Number(getRound(state) || 1);
    const gold = Number(state.playerGold?.[campKey] || 0);
    const hand = state.playerHands?.[campKey] || [];
    const handLen = hand.length;
    const cardIds = hand.map(resolveCardId).filter(Boolean);
    const isOcean = state.standardMapId === 'uncharted-passage' ? 1 : 0;
    const isCulture = state.factionRuleMode === 'culture' ? 1 : 0;
    const fullIntel = hasFullAiIntelligence(state, camp);
    const tileVisibleFn = tile => fullIntel || !state.skirmishFog || (helpers.isTileVisible ? helpers.isTileVisible(tile, camp) : true);
    const unitVisibleFn = unit => !!unit && (fullIntel || !helpers.isUnitVisibleToCamp || helpers.isUnitVisibleToCamp(unit, camp))
        && isSubmarineTargetableBy(unit, camp, state);

    const tileMap = new Map();
    const ownCities = [];
    const rivalCities = [];
    const neutralCities = [];
    const hostileReadyAirfields = [];
    for (const tile of state.tiles || []) {
        if (!tileVisibleFn(tile)) continue;
        tileMap.set(`${tile.q},${tile.r}`, tile);
        if (tile.isCity) {
            const owner = campToKey(tile.camp);
            if (owner === campKey) ownCities.push(tile);
            else if (owner === 'neutral') neutralCities.push(tile);
            else {
                rivalCities.push(tile);
                if (tile.installation?.status === 'ready') hostileReadyAirfields.push(tile);
            }
        }
    }
    const hostileCities = [...rivalCities, ...neutralCities];

    const unitMap = new Map();
    const unitAt = new Map();
    const ownUnits = [];
    const rivalUnits = [];
    const neutralUnits = [];
    for (const tile of state.tiles || []) {
        const unit = tile.unit;
        if (!unit || unit.hp <= 0 || !tileVisibleFn(tile) || !unitVisibleFn(unit)) continue;
        unitMap.set(unit.id, unit);
        unitAt.set(`${tile.q},${tile.r}`, unit);
        const owner = campToKey(unit.camp);
        if (owner === campKey) ownUnits.push(unit);
        else if (owner === 'neutral') neutralUnits.push(unit);
        else rivalUnits.push(unit);
    }
    const hostileUnits = [...rivalUnits, ...neutralUnits];

    const ownHpSum = ownUnits.reduce((s, u) => s + Number(u.hp || 0), 0);
    const rivalHpSum = rivalUnits.reduce((s, u) => s + Number(u.hp || 0), 0);
    const hpAdv = ownHpSum / Math.max(100.0, ownHpSum + rivalHpSum);

    const legalMovesByUnit = new Map();
    const legalAttacksByUnit = new Map();
    let nLegalMoves = 0;
    let nLegalAttacks = 0;
    let nActionable = 0;
    let hasPendingSpec = 0;
    for (const unit of ownUnits) {
        const moves = unit.canAct && !unit.isNewRecruit && helpers.getMovableTiles ? helpers.getMovableTiles(unit) : [];
        const attacks = unit.canAct && !unit.isNewRecruit && helpers.getAttackableTiles ? helpers.getAttackableTiles(unit) : [];
        legalMovesByUnit.set(unit.id, moves);
        legalAttacksByUnit.set(unit.id, attacks);
        nLegalMoves += moves.length;
        nLegalAttacks += attacks.length;
        if (moves.length || attacks.length || unit.pendingSpecialization) nActionable++;
        if (unit.pendingSpecialization) hasPendingSpec = 1;
    }

    const ownCmdInjured = ownUnits.some(u => u.commander && u.hp < u.maxHp * 0.65) ? 1 : 0;
    const ownCmdCritical = ownUnits.some(u => u.commander && u.hp < u.maxHp * 0.40) ? 1 : 0;
    const hasHealCard = cardIds.includes('heal') ? 1 : 0;
    const hasOffCard = cardIds.some(id => OFFENSIVE_CARDS.has(id)) ? 1 : 0;
    const hasDeployCard = cardIds.includes('commanderDeploy') ? 1 : 0;
    const hasEmptyOwnCity = ownCities.some(c => !unitAt.has(`${c.q},${c.r}`)) ? 1 : 0;
    const nOwnAssault = ownUnits.filter(u => CAPTURER_TYPES.has(u.type)).length;

    const minDistUnits = (q, r, list) => {
        let best = 20;
        for (const u of list) {
            const d = hexDistCoords(q, r, u.tile.q, u.tile.r);
            if (d < best) best = d;
        }
        return best;
    };
    const minDistCities = (q, r, list) => {
        let best = 20;
        for (const c of list) {
            const d = hexDistCoords(q, r, c.q, c.r);
            if (d < best) best = d;
        }
        return best;
    };

    const typeCounts = {};
    for (const c of candidates) {
        typeCounts[c.actionType] = (typeCounts[c.actionType] || 0) + 1;
    }

    const globalFeats = [
        Math.min(roundNum / 25.0, 1.5),
        Math.min(gold / 30.0, 2.0),
        Math.log1p(Math.max(0.0, gold)) / 4.0,
        handLen / 5.0,
        handLen === 0 ? 1.0 : 0.0,
        Math.min(ownUnits.length / 20.0, 1.5),
        Math.min(rivalUnits.length / 20.0, 1.5),
        hpAdv,
        ownCities.length / 10.0,
        rivalCities.length / 10.0,
        neutralCities.length / 10.0,
        Math.min(nActionable / 15.0, 1.5),
        Math.min(nLegalAttacks / 12.0, 1.5),
        Math.min(nLegalMoves / 60.0, 1.5),
        hasPendingSpec,
        ownCmdInjured,
        ownCmdCritical,
        isOcean,
        isCulture,
        hasHealCard,
        hasOffCard,
        hasDeployCard,
        hasEmptyOwnCity
    ];

    const gLen = globalFeats.length;
    const fBase = gLen + ACTION_TYPES.length;
    const extBase = fBase + 52;
    const styleVec = resolveStyleVector(styleTag);
    const ownCityShare = ownCities.length / Math.max(1.0, ownCities.length + rivalCities.length);
    const clockUrgency = Math.min(1.2, Math.max(0.0, roundNum - 11.0) / 8.0);
    const spendHeadroom = Math.min(1.5, Math.max(0.0, gold - 8.0) / 20.0);

    const p3Faction = state.factions?.player3;
    const is3pActive = Boolean(p3Faction && p3Faction.active !== false && p3Faction.participatesInTurns !== false);
    const activeModel = is3pActive ? policyModel3p : (!isOcean ? policyModelCr : policyModel);
    const logits = new Float64Array(candidates.length);
    const values = new Float64Array(candidates.length);
    const row = new Float64Array(Math.max(112, activeModel.featureDim));

    for (let idx = 0; idx < candidates.length; idx++) {
        row.fill(0);
        for (let g = 0; g < gLen; g++) row[g] = globalFeats[g];
        const c = candidates[idx];
        const atype = c.actionType;
        const aIdx = ACTION_INDEX[atype];
        if (aIdx !== undefined) row[gLen + aIdx] = 1.0;

        row[fBase + 0] = Math.log(Math.max(1, typeCounts[atype] || 1)) / 5.0;

        const u = c.unitId !== undefined ? unitMap.get(c.unitId) : null;
        let uq = 0;
        let ur = 0;
        let uhpRatio = 1.0;
        let uIsCmd = 0;
        let uatk = 0;
        let urng = 0;
        let isCap = 0;
        let dURival = 10;
        let dUHcity = 10;

        if (u && u.tile) {
            uq = u.tile.q;
            ur = u.tile.r;
            const uhp = Number(u.hp || 0);
            const umax = Math.max(1, Number(u.maxHp || 100));
            uhpRatio = uhp / umax;
            uIsCmd = u.commander ? 1 : 0;
            uatk = Number(u.getEffectiveAttack ? u.getEffectiveAttack() : (u.attack || 0));
            urng = Number(u.getEffectiveRange ? u.getEffectiveRange() : (u.range || 1));
            const ump = Number(u.remainingMP || 0);
            const uemb = u.isEmbarked ? 1 : 0;
            let isInf = 0;
            let isCav = 0;
            let isArc = 0;
            let isNav = 0;
            let isUniq = 0;
            [isInf, isCav, isArc, isNav, isCap, isUniq] = unitClassFlags(u.type);
            const uCanAtkNow = (legalAttacksByUnit.get(u.id) || []).length > 0 ? 1 : 0;
            dURival = minDistUnits(uq, ur, rivalUnits);
            const dUHostile = minDistUnits(uq, ur, hostileUnits);
            dUHcity = minDistCities(uq, ur, hostileCities);
            const enemiesNearU = hostileUnits.filter(e => hexDistCoords(uq, ur, e.tile.q, e.tile.r) <= 2).length;

            row[fBase + 1] = uhpRatio;
            row[fBase + 2] = uIsCmd;
            row[fBase + 3] = uatk / 80.0;
            row[fBase + 4] = urng / 4.0;
            row[fBase + 5] = Math.min(ump / 5.0, 1.5);
            row[fBase + 6] = uemb;
            row[fBase + 7] = isInf;
            row[fBase + 8] = isCav;
            row[fBase + 9] = isArc;
            row[fBase + 10] = isNav;
            row[fBase + 11] = isCap;
            row[fBase + 12] = isUniq;
            row[fBase + 13] = uCanAtkNow;
            row[fBase + 14] = dURival / 15.0;
            row[fBase + 15] = dUHostile / 15.0;
            row[fBase + 16] = dUHcity / 15.0;
            row[fBase + 17] = Math.min(enemiesNearU / 4.0, 1.5);
            if (SPECIAL_COMMANDER_TYPES.has(u.commander)) row[extBase + 13] = 1.0;
        }

        if (c.q !== undefined && c.r !== undefined) {
            const dt = tileMap.get(`${c.q},${c.r}`);
            let isCity = 0;
            let ownRiv = 0;
            let ownNeu = 0;
            let fortVal = null;
            if (dt) {
                const owner = campToKey(dt.camp);
                isCity = dt.isCity ? 1 : 0;
                const isPort = dt.isPort ? 1 : 0;
                const isVil = dt.isVillage ? 1 : 0;
                const isWater = String(dt.surface || '').includes('Water') ? 1 : 0;
                const isCover = (dt.terrain === 'forest' || dt.terrain === 'mountain') ? 1 : 0;
                const ownOwn = owner === campKey ? 1 : 0;
                ownRiv = (owner && owner !== campKey && owner !== 'neutral') ? 1 : 0;
                ownNeu = owner === 'neutral' ? 1 : 0;
                const cHpRatio = isCity ? Math.min(1.0, Number(dt.hp || 0) / 250.0) : 0.0;
                const hasAirf = dt.installation?.status === 'ready' ? 1 : 0;
                fortVal = dt.fortification || null;
                row[fBase + 18] = isCity;
                row[fBase + 19] = isPort;
                row[fBase + 20] = isVil;
                row[fBase + 21] = isWater;
                row[fBase + 22] = isCover;
                row[fBase + 23] = ownOwn;
                row[fBase + 24] = ownRiv;
                row[fBase + 25] = ownNeu;
                row[fBase + 26] = cHpRatio;
                row[fBase + 27] = hasAirf;
            }

            const dDestRival = minDistUnits(c.q, c.r, rivalUnits);
            const dDestHcity = minDistCities(c.q, c.r, hostileCities);
            const enemiesDest2 = hostileUnits.filter(e => hexDistCoords(c.q, c.r, e.tile.q, e.tile.r) <= 2).length;
            const alliesDest2 = ownUnits.filter(a => a.id !== c.unitId && hexDistCoords(c.q, c.r, a.tile.q, a.tile.r) <= 2).length;
            row[fBase + 28] = dDestRival / 15.0;
            row[fBase + 29] = dDestHcity / 15.0;
            row[fBase + 30] = Math.min(enemiesDest2 / 4.0, 1.5);
            row[fBase + 31] = Math.min(alliesDest2 / 4.0, 1.5);

            // Area 3B 多单位协同/掩护/交叉火力/敌机场空降警戒特征（93..102）
            const flankAllies1 = ownUnits.filter(a => a.id !== c.unitId && hexDistCoords(c.q, c.r, a.tile.q, a.tile.r) === 1).length;
            const assaultNear2 = ownUnits.filter(a => a.id !== c.unitId && CAPTURER_TYPES.has(a.type) && hexDistCoords(c.q, c.r, a.tile.q, a.tile.r) <= 2).length;
            const rangedNear2 = ownUnits.filter(a => a.id !== c.unitId
                && (String(a.type || '').includes('archer') || a.type === 'ru_katyusha' || a.type === 'fr_heavy_cannon' || NAVAL_TYPES.has(a.type))
                && hexDistCoords(c.q, c.r, a.tile.q, a.tile.r) <= 2).length;
            const fortScore = fortVal === 'trench' ? 1.0 : (fortVal === 'flak' ? 0.8 : 0.0);
            const crossfirePressure = Math.min(2.0, Math.max(-1.0, (enemiesDest2 - flankAllies1) / 2.0));
            const localSup = Math.min(1.0, ((alliesDest2 + 1.0) / (enemiesDest2 + 1.0)) / 3.0);
            const adjOwnCity = ownCities.some(oc => hexDistCoords(c.q, c.r, oc.q, oc.r) <= 1) ? 1.0 : 0.0;
            const inEnemyAirZone = hostileReadyAirfields.some(af => hexDistCoords(c.q, c.r, af.q, af.r) <= 8) ? 1.0 : 0.0;

            row[extBase + 2] = Math.min(flankAllies1 / 3.0, 1.5);
            row[extBase + 3] = Math.min(assaultNear2 / 4.0, 1.5);
            row[extBase + 4] = Math.min(rangedNear2 / 4.0, 1.5);
            row[extBase + 5] = fortScore;
            row[extBase + 6] = crossfirePressure;
            row[extBase + 7] = localSup;
            row[extBase + 10] = adjOwnCity;
            row[extBase + 11] = inEnemyAirZone;

            if (atype === 'move' && u) {
                const stepD = hexDistCoords(uq, ur, c.q, c.r);
                const effRange = Math.max(1.0, urng);
                const canAtkFromDest = hostileUnits.some(e => hexDistCoords(c.q, c.r, e.tile.q, e.tile.r) <= effRange) ? 1 : 0;
                const stepsOpenCity = (isCity && (ownRiv || ownNeu) && !unitAt.has(`${c.q},${c.r}`)) ? 1 : 0;
                row[fBase + 32] = stepD / 5.0;
                row[fBase + 33] = (dURival - dDestRival) / 5.0;
                row[fBase + 34] = (dUHcity - dDestHcity) / 5.0;
                row[fBase + 35] = canAtkFromDest;
                row[fBase + 36] = stepsOpenCity;
                row[fBase + 37] = uIsCmd * Math.min(enemiesDest2 / 3.0, 1.0) * (1.5 - uhpRatio);
                row[extBase + 8] = hostileCities.some(hc => hexDistCoords(c.q, c.r, hc.q, hc.r) === 1) ? 1.0 : 0.0;
                row[extBase + 9] = hostileUnits.some(e => hexDistCoords(c.q, c.r, e.tile.q, e.tile.r) <= effRange
                    && Number(e.hp || 0) < Number(e.maxHp || 100) * 0.70) ? 1.0 : 0.0;
            }

            if ((atype === 'attack' || atype === 'banzaiCharge') && u) {
                const tu = unitAt.get(`${c.q},${c.r}`);
                row[extBase + 8] = Math.min(1.5, alliesDest2 / 3.0);
                if (tu) {
                    const thp = Math.max(1.0, Number(tu.hp || 0) + Number(tu.activeShield || 0));
                    const tmax = Math.max(1.0, Number(tu.maxHp || 100));
                    const tuOwner = campToKey(tu.camp);
                    row[fBase + 32] = thp / tmax;
                    row[fBase + 33] = tu.commander ? 1 : 0;
                    row[fBase + 34] = tuOwner === 'neutral' ? 1 : 0;
                    row[fBase + 35] = (tuOwner && tuOwner !== campKey && tuOwner !== 'neutral') ? 1 : 0;
                    row[fBase + 36] = Math.min(2.0, uatk / thp);
                    row[fBase + 37] = uatk >= thp * 0.95 ? 1 : 0;
                    row[extBase + 9] = (isCap > 0.5 && uatk >= thp) ? 1.0 : 0.0;
                } else {
                    row[fBase + 38] = 1.0;
                }
            }
        }

        if (atype === 'recruit') {
            const [rInf, rCav, rArc, rNav, , rUniq] = unitClassFlags(c.unitType);
            row[fBase + 39] = rInf;
            row[fBase + 40] = rCav;
            row[fBase + 41] = rArc;
            row[fBase + 42] = rNav;
            row[fBase + 43] = rUniq;
            row[fBase + 44] = nOwnAssault / 10.0;
        }

        if (atype === 'tacticalCard') {
            const cid = c.cardId || '';
            const tu = (c.q !== undefined && c.r !== undefined) ? unitAt.get(`${c.q},${c.r}`) : null;
            row[fBase + 39] = cid === 'commanderDeploy' ? 1 : 0;
            row[fBase + 40] = cid === 'heal' ? 1 : 0;
            row[fBase + 41] = cid === 'shield' ? 1 : 0;
            row[fBase + 42] = (cid === 'lightning' || cid === 'imprison' || cid === 'poison') ? 1 : 0;
            row[fBase + 43] = (cid === 'forceMarch' || cid === 'airdrop') ? 1 : 0;
            if (tu) {
                const tuOwner = campToKey(tu.camp);
                row[fBase + 44] = Number(tu.hp || 0) / Math.max(1.0, Number(tu.maxHp || 100));
                row[fBase + 45] = tu.commander ? 1 : 0;
                row[fBase + 46] = tuOwner === campKey ? 1 : 0;
                row[fBase + 47] = tuOwner === 'neutral' ? 1 : 0;
            }
        }

        if (atype === 'airCommand') {
            const ck = c.commandKind || '';
            row[fBase + 39] = ck === 'bombing' ? 1 : 0;
            row[fBase + 40] = (ck === 'strafe' || ck === 'stukaDiveBomb') ? 1 : 0;
            row[fBase + 41] = ck === 'airdrop' ? 1 : 0;
            if (c.q !== undefined && c.r !== undefined) {
                const splash = hostileUnits.filter(e => hexDistCoords(c.q, c.r, e.tile.q, e.tile.r) <= 1).length;
                row[fBase + 42] = Math.min(splash / 4.0, 1.5);
            }
        }

        if (atype === 'drawCard') {
            row[fBase + 48] = handLen === 0 ? 1 : 0;
            row[fBase + 49] = Math.min(gold / 15.0, 2.0);
        }

        if (atype === 'endTurn') {
            row[fBase + 48] = nActionable === 0 ? 1 : 0;
            row[fBase + 49] = nLegalAttacks === 0 ? 1 : 0;
            row[fBase + 50] = gold < 8.0 ? 1 : 0;
            row[fBase + 51] = Math.min(nLegalMoves / 30.0, 1.5);
        }

        if (atype === 'droneDeploy') row[extBase + 0] = 1.0;
        if (atype === 'banzaiCharge') row[extBase + 1] = 1.0;
        if (RARE_SPECIAL_TYPES.has(atype)) row[extBase + 12] = 1.0;
        row[extBase + 14] = styleVec[0];
        row[extBase + 15] = styleVec[1];
        row[extBase + 16] = styleVec[2];
        row[extBase + 17] = styleVec[3];
        row[extBase + 18] = ownCityShare;
        row[extBase + 19] = clockUrgency;
        row[extBase + 20] = spendHeadroom;

        const out = forwardPolicyAndValueRow(row, activeModel);
        logits[idx] = out.logit;
        values[idx] = out.value;
    }
    return { logits, values };
}

/**
 * 兼容旧单头调用签名：仅返回每条候选的 MLP 策略 logit 向量。
 */
export function scorePolicyCandidates(state, camp, candidates, helpers, styleTag = null) {
    return scorePolicyAndValueCandidates(state, camp, candidates, helpers, styleTag).logits;
}

function plannedActionKey(action, state) {
    if (!action) return null;
    if (action.type === 'move') return `move:${action.unitId}:${action.tileQ},${action.tileR}`;
    if (action.type === 'attack') return `attack:${action.unitId}:${action.targetId}`;
    if (action.type === 'siegeCityAttack') return `attackCity:${action.unitId}:${action.tileQ},${action.tileR}`;
    if (action.type === 'recruit') return `recruit:${action.unitType}:${action.tileQ},${action.tileR}`;
    if (action.type === 'reinforce') return `reinforce:${action.unitId}`;
    if (action.type === 'repairShip') return `repairShip:${action.unitId}`;
    if (action.type === 'heavyCannonStance') return `heavyCannonStance:${action.unitId}`;
    if (action.type === 'guerrillaConcealment') return `conceal:${action.unitId}`;
    if (action.type === 'activateSkill') return `skill:${action.unitId}:${action.skillId || ''}`;
    if (action.type === 'banzaiCharge') return `banzaiCharge:${action.unitId}:${action.targetQ},${action.targetR}`;
    if (action.type === 'droneDeploy') return `droneDeploy:${action.unitId}:${action.tileQ},${action.tileR}`;
    if (action.type === 'droneSuicide') {
        const target = state.tiles.find(t => t.unit?.id === action.targetId);
        return target ? `droneSuicide:${action.unitId}:${target.q},${target.r}` : null;
    }
    if (action.type === 'tacticalCard') {
        let q = action.tileQ;
        let r = action.tileR;
        if (q === undefined && action.targetId) {
            const tile = state.tiles.find(t => t.unit?.id === action.targetId || t.id === action.targetId);
            q = tile?.q;
            r = tile?.r;
        }
        return (q !== undefined && r !== undefined)
            ? `card:${action.cardId}:${action.commanderId || ''}:${q},${r}`
            : null;
    }
    if (action.type === 'drawCard') return 'drawCard';
    return null;
}

function computeStats(values, vetoFlags = null) {
    let count = 0;
    let sum = 0;
    for (let i = 0; i < values.length; i++) {
        if (vetoFlags && vetoFlags[i]) continue;
        sum += values[i];
        count++;
    }
    if (count === 0) {
        if (vetoFlags) return computeStats(values, null);
        return { mean: 0, std: 1 };
    }
    const mean = sum / count;
    let sq = 0;
    for (let i = 0; i < values.length; i++) {
        if (vetoFlags && vetoFlags[i]) continue;
        const d = values[i] - mean;
        sq += d * d;
    }
    return { mean, std: Math.sqrt(sq / count) };
}

function computePlannedSpend(state, camp, imperatorPlan) {
    let spend = 0;
    for (const act of imperatorPlan || []) {
        if (act.type === 'recruit' && act.unitType && UNIT_CONFIG[act.unitType]) {
            spend += getHistoricalRecruitCost(UNIT_CONFIG[act.unitType].cost, state, camp, act.unitType);
        } else if (act.type === 'droneDeploy') {
            spend += COMMANDER_CONFIG.tianyan.balance.deployGoldCost;
        }
    }
    return spend;
}

function computeDrawCardUtility(world, strategy, planDrawPlanned, plannedSpend = 0) {
    const hand = world.hand || [];
    const gold = world.gold || 0;
    const drawsDone = Number(world.gameState?.playerDrawsThisTurn?.[world.myCampKey] || 0);
    const drawCost = getHistoricalCost(CARD_SYSTEM_CONFIG.drawCost * (1 + drawsDone), world.gameState, world.myCamp);
    const hasEmptyRecruitCity = world.myCities.some(c => !c.disabled && !c.unit);
    const hasVacatableCity = world.myCities.some(c => !c.disabled && c.unit?.canAct && !world.isImmobile(c.unit));
    const earlyRecruitReserve = (world.round <= 3 || ((hasEmptyRecruitCity || hasVacatableCity) && world.myUnits.length < 11))
        && world.myUnits.length < 16 && world.myCities.some(c => !c.disabled)
        ? 8 : 0;
    const hasReadyAirStrike = world.round >= 6 && hand.length >= 1
        && world.myCities.some(c => c.installation?.type === 'airfield' && c.installation?.status === 'ready'
            && Number(c.installation?.airCommandReadyRound?.bombing || 0) <= world.round);
    const reserveFloor = Math.max(strategy.reserve || 0, earlyRecruitReserve, hasReadyAirStrike ? 5 : 0);
    const injuredCmd = world.myUnits.some(u => u.commander && u.hp < u.maxHp * 0.65);
    const hasSupportCard = hand.includes('heal') || hand.includes('shield');
    const urgentCmdRescue = injuredCmd && !hasSupportCard;

    if (gold - drawCost - plannedSpend < reserveFloor && !(urgentCmdRescue && gold >= drawCost + 2)) {
        return { utility: -70, boosted: false };
    }
    // 修复原版 drawCard 在 Z-score 归一化下被淹没：在不挤占计划招募与无人机预算的前提下，
    // 手牌稀疏（尤其第 4 回合起空手）且预算充裕时给予确定性抽牌效用。
    if ((hand.length === 0 && world.round >= 4)
        || (hand.length <= 1 && gold - plannedSpend >= (strategy.reserve || 0) + 9 && (world.round >= 2 || gold - plannedSpend >= 14))
        || planDrawPlanned
        || shouldDrawCard(world, strategy, plannedSpend)) {
        return { utility: urgentCmdRescue ? 108 : 82, boosted: true };
    }
    return { utility: 10, boosted: false };
}

function scoreCandidatesImperator(state, helpers, camp, world, strategy, imperatorPlan, candidates, fusion = null) {
    const planRankMap = new Map();
    const plannedCardCoords = new Set();
    const plannedMoveUnitIds = new Set();
    const plannedMoveDestMap = new Map();
    const plannedRecruitBySite = new Map();
    const plannedPrepRankByUnit = new Map();
    let planDrawPlanned = false;
    imperatorPlan.forEach((act, idx) => {
        const k = plannedActionKey(act, state);
        if (k && !planRankMap.has(k)) planRankMap.set(k, idx);
        if ((act.type === 'activateSkill' || act.type === 'guerrillaConcealment' || act.type === 'heavyCannonStance') && act.unitId != null) {
            if (!plannedPrepRankByUnit.has(act.unitId)) plannedPrepRankByUnit.set(act.unitId, idx);
        }
        if (act.type === 'recruit' && act.tileQ != null && act.tileR != null) {
            const sk = `${act.tileQ},${act.tileR}`;
            if (!plannedRecruitBySite.has(sk)) plannedRecruitBySite.set(sk, act.unitType);
        }
        if (act.type === 'move' && act.unitId != null) {
            plannedMoveUnitIds.add(act.unitId);
            if (!plannedMoveDestMap.has(act.unitId)) {
                const dest = state.tileMap.get(`${act.tileQ},${act.tileR}`);
                if (dest) plannedMoveDestMap.set(act.unitId, dest);
            }
        }
        if (act.type === 'drawCard') planDrawPlanned = true;
        if (act.type === 'tacticalCard') {
            const tile = state.tiles.find(t => t.unit?.id === act.targetId || t.id === act.targetId);
            if (tile) plannedCardCoords.add(`${act.cardId}:${tile.q},${tile.r}`);
        }
    });

    const campKey = campToKey(camp);
    const returnPlan = state._aiCoreMemory?.[campKey]?.ministerReturn;
    const ministerReservedCity = returnPlan && returnPlan.vacatedRound < getRoundIndex(state) + 1
        ? `${returnPlan.cityQ},${returnPlan.cityR}`
        : null;
    const emptyOwnCities = world.myCities.filter(c => !c.unit && !c.disabled);
    const hostileCityTiles = world.cities.filter(c => c.hostile);
    const rivalUnitMap = new Map(world.rivalUnits.map(u => [u.id, u]));
    const plannedSpend = computePlannedSpend(state, camp, imperatorPlan);
    const beamBonuses = computeBeamTacticalBonuses(state, world, strategy, candidates);
    const attackBias = fusion?.attackBias || 0;
    const moveBias = fusion?.moveBias || 0;
    const cardBias = fusion?.cardBias || 0;
    const beamScale = fusion?.beamWeight ?? 1.0;

    const activePrepRankByUnit = new Map();
    for (const c of candidates) {
        if ((c.actionType === 'activateSkill' || c.actionType === 'guerrillaConcealment' || c.actionType === 'heavyCannonStance')
            && c.unitId != null && plannedPrepRankByUnit.has(c.unitId) && planRankMap.has(c.key)) {
            activePrepRankByUnit.set(c.unitId, plannedPrepRankByUnit.get(c.unitId));
        }
    }

    const hasPlannedMatch = candidates.some(c => planRankMap.has(c.key));
    const hasOpenCapture = candidates.some(c => {
        if (c.actionType !== 'move') return false;
        const tile = state.tileMap.get(`${c.q},${c.r}`);
        const u = world.myUnits.find(x => x.id === c.unitId);
        return tile?.isCity && !tile.unit && Number(tile.hp || 0) <= 0 && canAttack(state, camp, tile.camp) && u && isFieldCapturer(world, u);
    });
    const prodMemoryReserve = Number(state._aiCoreMemory?.[campKey]?.strategicSaveReserve || 0);
    const hasDrawOption = candidates.some(c => c.actionType === 'drawCard');
    const hasHighValueDraw = hasDrawOption
        && prodMemoryReserve <= 0
        && computeDrawCardUtility(world, strategy, planDrawPlanned, plannedSpend).boosted;
    const utilities = new Float64Array(candidates.length);
    const vetoFlags = new Uint8Array(candidates.length);

    for (let i = 0; i < candidates.length; i++) {
        const c = candidates[i];
        if (c.actionType === 'endTurn') {
            if (hasPlannedMatch || hasOpenCapture || hasHighValueDraw) {
                utilities[i] = -95;
                vetoFlags[i] = 1;
            } else {
                utilities[i] = 55;
            }
            continue;
        }
        if (c.actionType === 'drawCard') {
            const { utility, boosted } = computeDrawCardUtility(world, strategy, planDrawPlanned, plannedSpend);
            const landCount = world.myUnits.filter(u => !world.isNaval(u)).length;
            const openingRecruitLock = emptyOwnCities.length > 0 && world.round <= 6 && landCount < 7 && (world.gold - c.drawCost) < 8;
            if (openingRecruitLock) {
                utilities[i] = -80;
                vetoFlags[i] = 1;
            } else {
                utilities[i] = boosted ? utility + cardBias * 0.5 : utility;
                if (utility < 0 || (prodMemoryReserve > 0 && world.gold - c.drawCost < prodMemoryReserve)) vetoFlags[i] = 1;
            }
            continue;
        }

        const rank = planRankMap.get(c.key);
        let utility = rank !== undefined ? Math.max(60, 118 - rank * 1.8) : 0;

        if (c.actionType === 'repairShip' || c.actionType === 'heavyCannonStance' || c.actionType === 'droneDeploy') {
            if (rank !== undefined) utility = Math.max(utility, 122);
        } else if (c.actionType === 'chooseSpecialization') {
            utility = Math.max(utility, 96);
        } else if (c.actionType === 'activateSkill') {
            if (rank !== undefined) {
                utility = Math.max(utility, 114);
            } else {
                const su = world.myUnits.find(x => x.id === c.unitId);
                const reach = su ? Math.max(1, Number(su.remainingMP || 0)) + Math.max(1, Number(su.getEffectiveRange?.() ?? su.config?.range ?? 1)) : 1;
                const hasEnemyInReach = su?.tile && [...world.rivalUnits, ...world.neutralUnits].some(e =>
                    e.tile && e.hp > 0 && hexDistCoords(su.tile.q, su.tile.r, e.tile.q, e.tile.r) <= reach);
                const priestHasWounded = su?.commander === 'priest' && su.hp >= su.maxHp * 0.55
                    && world.myUnits.some(ally => ally.id !== su.id && ally.tile && ally.hp < ally.maxHp * 0.65
                        && hexDistCoords(su.tile.q, su.tile.r, ally.tile.q, ally.tile.r) <= 2);
                if ((su?.commander === 'paladin' && Number(su._faith || 0) >= 1 && !su._smiteCharged && hasEnemyInReach)
                    || priestHasWounded) {
                    utility = 96;
                } else {
                    utility = -70;
                    vetoFlags[i] = 1;
                }
            }
        } else if (c.actionType === 'guerrillaConcealment') {
            const gu = world.myUnits.find(x => x.id === c.unitId);
            const mp = Number(gu?.remainingMP || 0);
            const nearEnemyDist = gu?.tile
                ? [...world.rivalUnits, ...world.neutralUnits].reduce((best, e) =>
                    (e.tile && e.hp > 0 ? Math.min(best, hexDistCoords(gu.tile.q, gu.tile.r, e.tile.q, e.tile.r)) : best), 20)
                : 20;
            if (rank !== undefined) {
                utility = Math.max(utility, 114);
            } else if (gu && mp >= 2 && nearEnemyDist <= mp) {
                utility = 98;
            } else if (gu && nearEnemyDist <= 4) {
                utility = 48;
            } else {
                utility = -55;
                vetoFlags[i] = 1;
            }
        } else if (c.actionType === 'tacticalCard') {
            const matchesPlannedCard = plannedCardCoords.has(`${c.cardId}:${c.q},${c.r}`);
            if (!matchesPlannedCard && ['lightning', 'imprison', 'poison'].includes(c.cardId)) {
                // 防止脱离 Imperator 卡牌剧本后误打中立缓冲带或浪费稀缺伤害/控制卡
                utility = -95;
                vetoFlags[i] = 1;
            } else if (matchesPlannedCard) {
                utility = Math.max(utility, 92 + cardBias);
            } else if (c.cardId === 'commanderDeploy') {
                const deployTile = state.tileMap.get(`${c.q},${c.r}`);
                const blocksSoleCity = deployTile?.isCity && deployTile.camp === camp && world.myCities.length <= 2;
                utility = Math.max(utility, blocksSoleCity ? 28 : 64);
            } else {
                utility += cardBias * 0.4;
            }
        } else if (c.actionType === 'attack') {
            const prepRank = activePrepRankByUnit.get(c.unitId);
            if (prepRank !== undefined && (rank === undefined || rank > prepRank)) {
                utility = -90;
                vetoFlags[i] = 1;
            } else if (rank === undefined && plannedMoveUnitIds.has(c.unitId)) {
                const au = world.myUnits.find(x => x.id === c.unitId);
                const freePoke = au && Number(au.remainingMP || 0) === 0 && !c.isCitySiege && c.targetId
                    ? planFollowupAttack(state, helpers, camp, TIER_CAPABILITIES.hard, c.unitId, c.targetId)
                    : null;
                if (freePoke && freePoke.counter === 0 && freePoke.damage > 0) {
                    utility = Math.max(utility, 72) + attackBias;
                } else {
                    // 该单位已承担 Imperator 机动/撤退/占城/腾位任务且原计划未安排顺手普攻或攻城，严禁违抗撤退/推进纪律就地死战
                    utility = -85;
                    vetoFlags[i] = 1;
                }
            } else if (!c.isCitySiege && c.targetId) {
                const trade = planFollowupAttack(state, helpers, camp, TIER_CAPABILITIES.hard, c.unitId, c.targetId);
                const tu = rivalUnitMap.get(c.targetId);
                const nearHostileCity = tu?.tile && hostileCityTiles.some(hc => hexDistCoords(tu.tile.q, tu.tile.r, hc.q, hc.r) <= 2);
                const lateAllInPush = strategy.posture === 'allin' && world.roundsRemaining <= 5 && nearHostileCity;
                if (!trade && !lateAllInPush) {
                    utility = -75;
                    vetoFlags[i] = 1;
                } else {
                    const isKill = tu && Number(tu.hp || 0) <= 45;
                    utility = Math.max(utility, (trade ? 65 : 42) + (isKill ? 30 : 0) + (tu?.commander ? 18 : 0)) + attackBias;
                }
            } else {
                utility = Math.max(utility, 68) + attackBias * 0.6;
            }
        } else if (c.actionType === 'move') {
            const tile = state.tileMap.get(`${c.q},${c.r}`);
            const unit = world.myUnits.find(u => u.id === c.unitId);
            const prepRank = activePrepRankByUnit.get(c.unitId);
            if (prepRank !== undefined && (rank === undefined || rank > prepRank)) {
                utility = -90;
                vetoFlags[i] = 1;
            } else if (returnPlan && c.unitId === returnPlan.unitId
                && returnPlan.vacatedRound === getRound(state)) {
                // 尚书同回合已执行腾位并在城旁待命，禁止继续远离原城或立刻回踩占格
                utility = -95;
                vetoFlags[i] = 1;
            } else if (unit?.commander === 'minister' && unit.tile?.isCity && unit.tile?.camp === camp && rank === undefined) {
                // 尚书驻守己方城市提供经济加成：除非 Imperator 明确规划腾位，否则不擅自离城
                utility = -95;
                vetoFlags[i] = 1;
            } else if (tile && tile.isCity && !tile.unit && Number(tile.hp || 0) <= 0 && canAttack(state, camp, tile.camp) && unit && isFieldCapturer(world, unit)) {
                utility = Math.max(utility, 128);
            } else if (rank === undefined && plannedMoveUnitIds.has(c.unitId)) {
                // Imperator 已为该单位规划撤退或卡位机动路线：若备选格比规划目的地更危险或直面致命火网则硬否决，否则轻罚以尊重路线规划
                const plannedDest = plannedMoveDestMap.get(c.unitId);
                const candThreat = tile && unit ? world.threatAt(tile, unit) : 0;
                const plannedThreat = plannedDest && unit ? world.threatAt(plannedDest, unit) : 0;
                const myPool = unit ? (unit.hp + (unit.activeShield ?? unit._shield ?? 0)) : 100;
                if (candThreat > plannedThreat + 5 || candThreat >= myPool) {
                    utility = -95;
                    vetoFlags[i] = 1;
                } else {
                    utility = -35;
                }
            } else if (rank === undefined) {
                const minHostileD = hostileCityTiles.reduce((best, hc) => Math.min(best, hexDistCoords(c.q, c.r, hc.q, hc.r)), 20);
                utility = (minHostileD <= 3 ? 12 : -10) + moveBias * 0.5;
            } else {
                utility += moveBias * 0.5;
            }
        } else if (c.actionType === 'recruit') {
            const siteKey = `${c.q},${c.r}`;
            const siteTile = state.tileMap.get(siteKey);
            const plannedTypeHere = plannedRecruitBySite.get(siteKey);
            const mySubs = world.myUnits.filter(u => u.type === 'submarine').length;
            if (ministerReservedCity && siteKey === ministerReservedCity && rank === undefined) {
                utility = -95;
                vetoFlags[i] = 1;
            } else if (plannedTypeHere && plannedTypeHere !== c.unitType) {
                utility = -85;
                vetoFlags[i] = 1;
            } else if (siteTile?.isPort && c.unitType === 'submarine' && mySubs >= 3 && rank === undefined) {
                utility = -85;
                vetoFlags[i] = 1;
            } else if (rank !== undefined) {
                const landCount = world.myUnits.filter(u => !world.isNaval(u)).length;
                utility = Math.max(utility, (world.round <= 6 && landCount < 7 && siteTile?.isCity) ? 116 : 110);
            } else {
                const landCount = world.myUnits.filter(u => !world.isNaval(u)).length;
                utility = (world.round <= 6 && landCount < 7 && siteTile?.isCity && !plannedTypeHere) ? 84 : 18;
            }
        } else if (c.actionType === 'reinforce') {
            if (rank === undefined) {
                const ru = world.myUnits.find(x => x.id === c.unitId);
                const hpRatio = ru ? Number(ru.hp || 0) / Math.max(1, Number(ru.maxHp || 100)) : 1;
                if (ru && ru.commander && hpRatio < 0.55 && world.gold >= 10) {
                    utility = 74;
                } else {
                    utility = 26;
                }
            }
        } else if (c.actionType === 'buildFortification') {
            const ft = state.tileMap.get(`${c.q},${c.r}`);
            const needsEmergencyFlak = c.fortKind === 'flak' && ft?.isCity && ft.camp === camp && !ft.fortification
                && ((world.rivalModel?.dominantStyle === 'airHeavy')
                    || (world.hostileAirfields || []).some(af => hexDistCoords(af.q, af.r, c.q, c.r) <= 8));
            if (needsEmergencyFlak) {
                utility = Math.max(utility, 58);
            } else if (rank === undefined) {
                utility = -65;
                vetoFlags[i] = 1;
            }
        } else if (c.actionType === 'buildAirfield') {
            const cityTile = state.tileMap.get(`${c.q},${c.r}`);
            const fragileFront = !cityTile || Number(cityTile.hp || 0) < 120
                || (!cityTile.unit && world.threatAt(cityTile) > 35);
            if (fragileFront || (rank === undefined && world.gold - CONSTRUCTION_CONFIG.airfield.cost < Math.max(16, plannedSpend + 8))) {
                utility = -85;
                vetoFlags[i] = 1;
            }
        } else if (c.actionType === 'airCommand') {
            if (rank !== undefined) {
                utility = Math.max(utility, 92);
            } else if (c.commandKind === 'airdrop') {
                const tile = state.tileMap.get(`${c.q},${c.r}`);
                const isHostileEmptyCity = tile?.isCity && !tile.unit && canAttack(state, camp, tile.camp) && Number(tile.hp || 0) <= 160;
                utility = isHostileEmptyCity ? 108 : -55;
                if (!isHostileEmptyCity) vetoFlags[i] = 1;
            } else {
                // 常规轰炸/扫射统一交由 js/ai.js runAiAirCommands 按完整防空与预算纪律结算，避免回合中乱烧招募与抽牌金币
                utility = -75;
                vetoFlags[i] = 1;
            }
        }

        if (!vetoFlags[i] && beamBonuses.has(c.key)) {
            utility += beamBonuses.get(c.key) * beamScale;
        }

        utilities[i] = utility;
    }

    // 2-Ply 对抗式 MiniMax + Alpha-Beta 剪枝：对 Top 关键候选复检对手反扑与空城偷袭风险
    const { bonuses: minimaxBonuses } = computeMinimaxAlphaBetaBonuses(state, world, strategy, candidates, {
        preScores: utilities,
        vetoFlags,
        maxRootBranches: 16,
        timeBudgetMs: 16
    });
    const minimaxScale = Math.min(1.25, beamScale);
    for (let i = 0; i < candidates.length; i++) {
        if (vetoFlags[i]) continue;
        const mmBonus = minimaxBonuses.get(candidates[i].key);
        if (mmBonus) utilities[i] += mmBonus * minimaxScale;
    }

    const jointBonuses = computeTurnJointRolloutBonuses(state, world, strategy, candidates, {
        preScores: utilities,
        vetoFlags
    });
    for (let i = 0; i < candidates.length; i++) {
        if (vetoFlags[i]) continue;
        utilities[i] += (jointBonuses.get(candidates[i].key) || 0) * minimaxScale;
    }

    return { utilities, vetoFlags };
}

export function candidateToExecutorAction(cand, state, plannedAct = null) {
    if (!cand || cand.actionType === 'endTurn') return { type: 'endTurn' };
    switch (cand.actionType) {
        case 'move': {
            const tile = state.tileMap.get(`${cand.q},${cand.r}`);
            const captureCity = Boolean(tile?.isCity && !tile.unit && canAttack(state, state.currentCamp, tile.camp));
            return {
                type: 'move',
                unitId: cand.unitId,
                tileQ: cand.q,
                tileR: cand.r,
                captureCity,
                autoAttack: false,
                ...(plannedAct?.returnToCity ? { returnToCity: plannedAct.returnToCity } : {})
            };
        }
        case 'attack':
            if (cand.isCitySiege || !cand.targetId) {
                return { type: 'siegeCityAttack', unitId: cand.unitId, tileQ: cand.q, tileR: cand.r };
            }
            return { type: 'attack', unitId: cand.unitId, targetId: cand.targetId };
        case 'recruit':
            return { type: 'recruit', unitType: cand.unitType, tileQ: cand.q, tileR: cand.r };
        case 'reinforce':
            return { type: 'reinforce', unitId: cand.unitId };
        case 'repairShip':
            return { type: 'repairShip', unitId: cand.unitId };
        case 'chooseSpecialization':
            return { type: 'chooseSpecialization', unitId: cand.unitId, specializationKey: cand.specializationKey };
        case 'buildAirfield':
            return { type: 'buildAirfield', tileQ: cand.q, tileR: cand.r };
        case 'buildFortification':
            return { type: 'buildFortification', unitId: cand.unitId, fortKind: cand.fortKind, tileQ: cand.q, tileR: cand.r };
        case 'heavyCannonStance':
            return { type: 'heavyCannonStance', unitId: cand.unitId };
        case 'guerrillaConcealment':
            return { type: 'guerrillaConcealment', unitId: cand.unitId };
        case 'activateSkill':
            return { type: 'activateSkill', unitId: cand.unitId, skillId: cand.skillId };
        case 'banzaiCharge':
            return { type: 'banzaiCharge', unitId: cand.unitId, targetQ: cand.q, targetR: cand.r };
        case 'droneDeploy':
            return { type: 'droneDeploy', unitId: cand.unitId, tileQ: cand.q, tileR: cand.r };
        case 'droneSuicide':
            return { type: 'droneSuicide', unitId: cand.unitId, targetId: cand.targetId };
        case 'airCommand':
            return {
                type: 'airCommand',
                airKind: cand.commandKind,
                commandKind: cand.commandKind,
                launcherQ: cand.fromQ,
                launcherR: cand.fromR,
                tileQ: cand.q,
                tileR: cand.r
            };
        case 'tacticalCard':
            return {
                type: 'tacticalCard',
                cardId: cand.cardId,
                commanderId: cand.commanderId || null,
                targetId: cand.targetId,
                tileQ: cand.q,
                tileR: cand.r
            };
        case 'drawCard':
            return { type: 'drawCard' };
        default:
            return { type: 'endTurn' };
    }
}

/**
 * 为当前局面从所有合法候选中选出 Hybrid（Micro BT + Beam 前瞻 + Imperator 规则 × MLP 策略网络，按学说融合）最优选并转换为执行动作。
 */
export function selectHybridAction(gameState, helpers, myCamp, options = {}) {
    const world = buildWorld(gameState, helpers, myCamp, TIER_CAPABILITIES.hard);
    const strategy = decideStrategy(world);
    const imperatorPlan = planTurn(gameState, helpers, myCamp, TIER_CAPABILITIES.hard);
    const blockedKeys = options.blockedKeys || null;
    const movedUnitIds = options.movedUnitIds || null;
    const forceMarchedUnitIds = options.forceMarchedUnitIds || null;

    let candidates = enumerateHybridCandidates(gameState, myCamp, helpers, world);
    candidates = candidates.filter(c => {
        if (c.actionType === 'endTurn') return true;
        if (blockedKeys && blockedKeys.has(c.key)) return false;
        if (c.actionType === 'move' && movedUnitIds?.has(c.unitId) && !forceMarchedUnitIds?.has(c.unitId)) {
            const tile = gameState.tileMap?.get(`${c.q},${c.r}`);
            const isOpenCityCap = tile?.isCity && !tile.unit && Number(tile.hp || 0) <= 0
                && canAttack(gameState, myCamp, tile.camp);
            if (!isOpenCityCap) return false;
        }
        return true;
    });
    if (candidates.length <= 1) {
        return { action: { type: 'endTurn' }, candidate: candidates[0] || { actionType: 'endTurn' } };
    }

    const plannedByKey = new Map();
    for (const act of imperatorPlan) {
        const k = plannedActionKey(act, gameState);
        if (k && !plannedByKey.has(k)) plannedByKey.set(k, act);
    }

    // 1. 微观行为树优先接管专精/修船/空城即时兑现/腾位募兵与返城/天眼/先走后打等强时序链
    const prereq = evaluateMicroBehaviorTree({
        state: gameState,
        camp: myCamp,
        world,
        imperatorPlan,
        candidates
    });
    if (prereq) {
        return {
            action: candidateToExecutorAction(prereq.candidate, gameState, prereq.plannedAct),
            candidate: prereq.candidate,
            score: 10.0,
            btNode: prereq.node
        };
    }

    const cultureId = getActiveCultureId(gameState, myCamp);
    const fusion = resolveHybridFusionProfile(world.doctrine, cultureId, strategy.posture);

    const { logits: mlpLogits, values: qValues } = scorePolicyAndValueCandidates(
        gameState, myCamp, candidates, helpers, fusion.styleTag
    );
    const { utilities: impUtils, vetoFlags } = scoreCandidatesImperator(
        gameState, helpers, myCamp, world, strategy, imperatorPlan, candidates, fusion
    );

    const mlpStats = computeStats(mlpLogits, vetoFlags);
    const valStats = computeStats(qValues, vetoFlags);
    const impStats = computeStats(impUtils, vetoFlags);
    const mlpStd = Math.max(0.25, mlpStats.std);
    const valStd = Math.max(0.08, valStats.std);
    const impStd = Math.max(10.0, impStats.std);

    const mlpScale = Number.isFinite(options?.mlpScale) ? Math.max(0, options.mlpScale) : 1.0;
    const polWeight = fusion.mlpWeight * 0.78 * mlpScale;
    const valWeight = (fusion.mlpWeight * 0.22 + 0.04) * mlpScale;
    const impWeight = Math.max(0.10, 1.0 - polWeight - valWeight);

    let bestIdx = candidates.length - 1;
    let bestScore = -Infinity;

    for (let i = 0; i < candidates.length; i++) {
        const rawMlpZ = ((mlpLogits[i] - mlpStats.mean) / mlpStd) / fusion.mlpTemp;
        const rawValZ = (qValues[i] - valStats.mean) / valStd;
        const rawImpZ = (impUtils[i] - impStats.mean) / impStd;
        // 截断单边极值 Z-score（当非否决候选很少时 std 会坍缩），保证规则否决壁垒不可被极端 logit 冲垮
        const mlpZ = Math.max(-3.5, Math.min(3.5, rawMlpZ));
        const valZ = Math.max(-3.5, Math.min(3.5, rawValZ));
        const impZ = Math.max(-3.5, Math.min(3.5, rawImpZ));
        let score = polWeight * mlpZ + valWeight * valZ + impWeight * impZ;
        if (vetoFlags[i]) score -= 50.0;
        if (score > bestScore) {
            bestScore = score;
            bestIdx = i;
        }
    }

    const chosen = candidates[bestIdx];
    return {
        action: candidateToExecutorAction(chosen, gameState, plannedByKey.get(chosen.key) || null),
        candidate: chosen,
        score: bestScore
    };
}
