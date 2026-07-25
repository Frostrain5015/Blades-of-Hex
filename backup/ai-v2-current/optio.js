// Optio（入门档）—— 新架构下的薄 profile。
//
// 三档共用 ai/core/ 的同一条规划管线；入门档只是"看得少、想得浅、
// 决策带噪声"的同一个引擎：不预判威胁位移、不记情报、不做多回合任务、
// 卡牌逐张独立打分、没有胜利时钟。规则认知与困难档完全一致。

import { planTurn } from './core/planner.js';
import { TIER_CAPABILITIES } from './core/weights.js';
import { selectCommander, selectCommanderPair } from './doctrine.js';

export const meta = {
    name: 'Optio',
    title: '入门',
    description: '共享引擎的入门档：单回合贪心 + 决策噪声，不熟悉纵深与剧本。'
};

export function planActions(gameState, helpers, myCamp) {
    return planTurn(gameState, helpers, myCamp, TIER_CAPABILITIES.easy);
}

export { selectCommander, selectCommanderPair };
