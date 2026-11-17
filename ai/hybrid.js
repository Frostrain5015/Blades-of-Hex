// Hybrid（困难档）—— Imperator 完整规则推理 × 91 维人类模仿 MLP 混合架构。
//
// 继承完整规则情报与四学说推演，决策时在合法候选中对 Imperator 规则效用与人类策略网络做 Z-score 融合。

import { planTurn } from './core/planner.js';
import { selectHybridAction } from './core/hybridScorer.js';
import { TIER_CAPABILITIES } from './core/weights.js';
import { selectCommander, selectCommanderPair } from './doctrine.js';

export const meta = {
    name: 'Hybrid',
    tier: 'Max',
    difficultyId: 'hard',
    description: '最强混合架构 AI：Imperator 全图规则推演 + 人类行为模仿策略模型联合决策。'
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
