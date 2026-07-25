// Legatus（中档）—— 新架构下的薄 profile。
//
// 与困难档同一引擎，差别在信息深度：记录情报但不预判威胁位移，
// 任务只记目标不锁定编组，有卡牌剧本与胜利时钟但不做运输阶段规划。

import { planTurn } from './core/planner.js';
import { TIER_CAPABILITIES } from './core/weights.js';
import { selectCommander, selectCommanderPair } from './doctrine.js';

export const meta = {
    name: 'Legatus',
    tier: 'Pro',
    difficultyId: 'medium',
    description: '共享引擎的中档：有任务与卡牌剧本，缺威胁外推、残局时钟与运输规划。'
};

export function planActions(gameState, helpers, myCamp) {
    return planTurn(gameState, helpers, myCamp, TIER_CAPABILITIES.medium);
}

export { selectCommander, selectCommanderPair };
