// Hybrid 3.0（困难档）—— Imperator 完整规则推理 × 112 维人类模仿双头策略+价值网络。
//
// 继承完整规则情报与四学说推演，决策时在合法候选中对 Imperator 规则效用、Beam/MiniMax 与策略价值网络做 Z-score 融合。

import { planTurn } from './core/planner.js';
import { selectHybridAction } from './core/hybridScorer.js';
import { TIER_CAPABILITIES } from './core/weights.js';
import { selectCommander, selectCommanderPair } from './doctrine.js';

export const meta = {
    name: 'Hybrid 3.0',
    tier: 'Max',
    difficultyId: 'hard',
    description: '最强混合架构 AI：Imperator 全图规则推演 + MiniMax/Beam 前瞻 + 双头策略价值网络联合决策。'
};

export function selectNextAction(gameState, helpers, myCamp, options = {}) {
    return selectHybridAction(gameState, helpers, myCamp, options);
}

export function planActions(gameState, helpers, myCamp) {
    const pick = selectHybridAction(gameState, helpers, myCamp);
    const basePlan = planTurn(gameState, helpers, myCamp, TIER_CAPABILITIES.hard);
    if (!pick?.action || pick.action.type === 'endTurn') return basePlan;
    return [pick.action, ...basePlan.filter(act =>
        act.type !== pick.action.type
        || act.unitId !== pick.action.unitId
        || act.tileQ !== pick.action.tileQ
        || act.tileR !== pick.action.tileR
        || act.cardId !== pick.action.cardId
    )];
}

export { selectCommander, selectCommanderPair };
