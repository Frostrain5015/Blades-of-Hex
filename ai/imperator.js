// Imperator（困难档）—— 新架构下的薄 profile。
//
// 共享引擎的全功能档：威胁外推、情报龄期、跨回合任务编组、卡牌剧本、
// 胜利条件时钟、攻心夺城路径与运输抢滩规划全部开启，决策无噪声。

import { planTurn } from './core/planner.js';
import { TIER_CAPABILITIES } from './core/weights.js';
import { selectCommander, selectCommanderPair } from './doctrine.js';

export const meta = {
    name: 'Imperator',
    tier: 'Max',
    difficultyId: 'hard',
    description: '共享引擎的全功能档：任务化指挥 + 胜利时钟 + 全部认知能力。'
};

export function planActions(gameState, helpers, myCamp) {
    return planTurn(gameState, helpers, myCamp, TIER_CAPABILITIES.hard);
}

export { selectCommander, selectCommanderPair };
