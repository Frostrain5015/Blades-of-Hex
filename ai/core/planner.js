// 规划器 —— 一条管线：感知 → 战略 → 任务 → 卡牌/战术 → 生产。
//
// 三档共用这一条管线；档位差异只来自 TIER_CAPABILITIES 的信息深度旋钮
// （噪声、威胁外推、情报记忆、任务持久化、卡牌剧本、胜利时钟）。
// 动作顺序即执行顺序：setup 卡（净化/伤害/控制）→ 港口维修与腾位招募
// → 战术（技能→夺城→攻击→攻城→移动）→ sustain 卡（防御）→ 生产→抽牌。

import { buildWorld } from './perceive.js';
import { decideStrategy } from './strategize.js';
import { assignMissions } from './missions.js';
import { planTactics, bestAttackFor, evaluateAttack, planCaptureFinishers } from './tactics.js';
import { planCards, shouldDrawCard } from './cards.js';
import { planProduction } from './production.js';
import { isFieldCapturer, shouldHoldCityPosition } from './roster.js';
import { COMMANDER_CONFIG } from '../../rules/commanders.js';
import { TACTICAL_CARD_DATA } from '../../rules/cards.js';
import { isHealingBlocked } from '../../rules/healing.js';
import { distributeKmtPoolChange, getKmtLinkedUnits, getKmtReinforceDeficit } from '../../rules/kmtStronghold.js';

function applyVirtualHealingAction(world, action, revertCallbacks) {
    const unit = world.myUnits.find(candidate => candidate.id === (action.unitId ?? action.targetId));
    if (!unit || !unit.tile) return;
    if (action.type === 'reinforce' || action.type === 'repairShip') {
        if (isHealingBlocked(unit, world.gameState, { allowReinforce: true })) return;
        const linked = action.type === 'reinforce' ? getKmtLinkedUnits(unit, world.gameState) : [];
        const deficit = linked.length > 0
            ? getKmtReinforceDeficit(unit, world.gameState)
            : Math.max(0, unit.maxHp - unit.hp);
        const healAmt = Math.min(Math.floor(unit.maxHp * 0.50), deficit);
        if (healAmt <= 0) return;
        if (linked.length > 0) {
            for (const entry of distributeKmtPoolChange(linked, healAmt, true)) {
                const prevHp = entry.unit.hp;
                entry.unit.hp = entry.hp;
                revertCallbacks.push(() => { entry.unit.hp = prevHp; });
            }
        } else {
            const prevHp = unit.hp;
            unit.hp = Math.min(unit.maxHp, unit.hp + healAmt);
            revertCallbacks.push(() => { unit.hp = prevHp; });
        }
        return;
    }
    if (action.type === 'tacticalCard' && action.cardId === 'heal') {
        const prevPoison = unit._poison;
        const prevHp = unit.hp;
        if (!isHealingBlocked(unit, world.gameState)) {
            const pct = TACTICAL_CARD_DATA.heal?.balance?.healMaxHpPct ?? 0.30;
            const healAmt = Math.min(Math.max(0, unit.maxHp - unit.hp), Math.round(unit.maxHp * pct));
            unit.hp = Math.min(unit.maxHp, unit.hp + healAmt);
        }
        unit._poison = null;
        revertCallbacks.push(() => {
            unit.hp = prevHp;
            unit._poison = prevPoison;
        });
    }
}

// 移动后的追击复用战术评分，只刷新可见局面，不重新分配整支军队的任务。
export function planFollowupAttack(gameState, helpers, myCamp, caps, unitId, plannedTargetId = null) {
    const world = buildWorld(gameState, helpers, myCamp, caps);
    const unit = world.myUnits.find(candidate => candidate.id === unitId);
    if (!unit) return null;
    const memory = gameState._aiCoreMemory?.[world.myCampKey];
    const missions = memory?.missions || [];
    const assignment = new Map();
    for (const mission of missions) {
        for (const id of [mission.occupierId, ...(mission.escortIds || [])]) {
            if (id != null) assignment.set(id, mission);
        }
    }
    const context = {
        missions, assignment, suppressNeutralEngagements: !!memory?.suppressNeutralEngagements
    };
    const holdPosition = shouldHoldCityPosition(world, unit, assignment.get(unit.id));
    const attack = targetId => ({ type: 'attack', unitId, targetId, ...(holdPosition ? { holdPosition } : {}) });
    if (plannedTargetId != null) {
        const target = [...world.rivalUnits, ...world.neutralUnits].find(candidate => candidate.id === plannedTargetId);
        if (!target || evaluateAttack(world, context, unit, target).veto) return null;
        return attack(target.id);
    }
    if (unit.canAct && !holdPosition && isFieldCapturer(world, unit)) {
        // 移动可能刚好进入攻城射程，先兑现可一击拿下的任务目标。
        const city = helpers.getAttackableTiles(unit).find(tile => tile.isCity && !tile.unit
            && helpers.hexDistance(unit.tile, tile) === 1 && tile.hp > 0
            && missions.some(mission => mission.kind === 'siege'
                && mission.targetQ === tile.q && mission.targetR === tile.r)
            && world.estimateSiegeDamage(unit, tile) >= tile.hp);
        if (city) return { type: 'siegeCityAttack', unitId, tileQ: city.q, tileR: city.r };
    }
    const best = bestAttackFor(world, context, unit);
    return best ? attack(best.target.id) : null;
}

export function planOpenCityCaptures(gameState, helpers, myCamp, caps) {
    const world = buildWorld(gameState, helpers, myCamp, caps);
    const actions = [];
    planCaptureFinishers(world, null, actions, new Set(), true);
    return actions;
}

/**
 * 生成一回合的完整动作列表。
 * @param {object} gameState 引擎状态
 * @param {object} helpers   js/ai.js helpers
 * @param {object} myCamp    本阵营 faction
 * @param {object} caps      TIER_CAPABILITIES 中的一档
 */
export function planTurn(gameState, helpers, myCamp, caps) {
    const world = buildWorld(gameState, helpers, myCamp, caps);
    if (world.myUnits.length === 0 && world.myCities.length === 0) return [];

    const strategy = decideStrategy(world);
    const missionsCtx = assignMissions(world, strategy);
    const production = planProduction(world, strategy, missionsCtx);
    const setupReinforces = production.actions.filter(action => action.type === 'reinforce');
    const postTacticsProduction = production.actions.filter(action => action.type !== 'reinforce');
    const reserved = new Set(production.setup.filter(action => action.type === 'move').map(action => action.unitId));
    const unspentReserve = production.remainingReserve ?? strategy.reserve;
    const availableGold = production.recruitSpend >= world.gold
        ? 0
        : Math.max(0, world.gold - unspentReserve - production.recruitSpend);

    // 残血处理三段优先：先原地补员/修船 → 再打治疗卡（基于补员后的最新血量，避免重复浪费治疗）
    // → 最后带回复后血量进入战术规划（能撤回安全陆地就撤，必死局直接在陆上爆掉换伤）。
    const virtualReverts = [];
    let cards;
    let tactics;
    try {
        for (const action of [...setupReinforces, ...production.setup.filter(a => a.type === 'repairShip')]) {
            applyVirtualHealingAction(world, action, virtualReverts);
        }
        const prevWorldGold = world.gold;
        world.gold = Math.max(0, world.gold - (production.earlySpend || 0));
        virtualReverts.push(() => { world.gold = prevWorldGold; });

        cards = planCards(world, strategy, missionsCtx);
        for (const action of cards.setup) {
            if (action.cardId === 'heal') applyVirtualHealingAction(world, action, virtualReverts);
        }
        tactics = planTactics(world, strategy, missionsCtx, availableGold).filter(action => !reserved.has(action.unitId));
    } finally {
        for (let i = virtualReverts.length - 1; i >= 0; i--) virtualReverts[i]();
    }

    const actions = [
        ...production.emergencyRecruits,
        ...setupReinforces,
        ...production.setup,
        ...cards.setup,
        ...tactics,
        ...cards.sustain,
        ...postTacticsProduction
    ];

    const droneSpend = tactics.some(action => action.type === 'droneDeploy') ? COMMANDER_CONFIG.tianyan.balance.deployGoldCost : 0;
    if (shouldDrawCard(world, strategy, production.recruitSpend + droneSpend, cards.setup.length + cards.sustain.length)) {
        actions.push({ type: 'drawCard' });
    }

    // 战略遥测：写入 gameState 供 matchRecorder 的 decisionContext.strategicIntent 使用。
    const telemetry = (gameState._imperatorStrategicTelemetry ||= {});
    const list = (telemetry[myCamp.id && helpers.CAMP ? campKeyOf(world) : world.myCampKey] ||= []);
    const entry = {
        round: world.round,
        posture: strategy.posture,
        urgency: strategy.urgency,
        objective: missionsCtx.missions.find(m => m.kind === 'siege')
            ? { q: missionsCtx.missions.find(m => m.kind === 'siege').targetQ, r: missionsCtx.missions.find(m => m.kind === 'siege').targetR }
            : null,
        objectiveAssetValue: missionsCtx.missions.find(m => m.kind === 'siege')?.cityValue || 0,
        projectedIncome: world.economy.projectedIncome,
        rivalProjectedIncome: world.strongestRivalEconomy.projectedIncome,
        forceRatio: strategy.forceRatio,
        capitalThreat: strategy.capitalThreat,
        portThreat: 0,
        assaultCapacity: strategy.assaultCapacity,
        siegeMission: missionsCtx.missions.find(m => m.kind === 'siege') || null,
        missions: missionsCtx.missions.map(m => ({ kind: m.kind, q: m.targetQ, r: m.targetR, phase: m.phase }))
    };
    if (list.at(-1)?.round === world.round) {
        Object.assign(list[list.length - 1], entry);
    } else {
        list.push(entry);
        while (list.length > 40) list.shift();
    }

    return actions;
}

function campKeyOf(world) {
    return world.myCampKey;
}
