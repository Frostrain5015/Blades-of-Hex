// 规划器 —— 一条管线：感知 → 战略 → 任务 → 卡牌/战术 → 生产。
//
// 三档共用这一条管线；档位差异只来自 TIER_CAPABILITIES 的信息深度旋钮
// （噪声、威胁外推、情报记忆、任务持久化、卡牌剧本、胜利时钟）。
// 动作顺序即执行顺序：setup 卡（净化/伤害/控制）→ 港口维修与腾位招募
// → 战术（技能→夺城→攻击→攻城→移动）→ sustain 卡（防御）→ 生产→抽牌。

import { buildWorld } from './perceive.js';
import { decideStrategy } from './strategize.js';
import { assignMissions } from './missions.js';
import { planTactics, bestAttackFor, evaluateAttack } from './tactics.js';
import { planCards, shouldDrawCard } from './cards.js';
import { planProduction } from './production.js';

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
    if (plannedTargetId != null) {
        const target = [...world.rivalUnits, ...world.neutralUnits].find(candidate => candidate.id === plannedTargetId);
        if (!target || evaluateAttack(world, context, unit, target).veto) return null;
        return { type: 'attack', unitId, targetId: target.id };
    }
    const best = bestAttackFor(world, context, unit);
    return best ? { type: 'attack', unitId, targetId: best.target.id } : null;
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
    const cards = planCards(world, strategy, missionsCtx);
    const production = planProduction(world, strategy, missionsCtx);
    const reserved = new Set(production.setup.filter(action => action.type === 'move').map(action => action.unitId));
    const tactics = planTactics(world, strategy, missionsCtx).filter(action => !reserved.has(action.unitId));

    const actions = [
        ...production.emergencyRecruits,
        ...cards.setup,
        ...production.setup,
        ...tactics,
        ...cards.sustain,
        ...production.actions
    ];

    if (shouldDrawCard(world, strategy, production.recruitSpend, cards.setup.length + cards.sustain.length)) {
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
