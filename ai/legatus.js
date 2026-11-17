// Legatus（中档）—— 承接原 Imperator 完整规则脚本，整体下调一档作为中等 AI。
//
// 保留原 Imperator 的全图遭遇战情报、威胁外推、跨回合任务编组、四学说推演、卡牌剧本与胜利时钟。

import { planTurn } from './core/planner.js';
import { TIER_CAPABILITIES } from './core/weights.js';
import { selectCommander, selectCommanderPair } from './doctrine.js';

export const meta = {
    name: 'Legatus',
    tier: 'Pro',
    difficultyId: 'medium',
    description: '完整规则引擎的中档（原 Imperator）：全图推演 + 四学说动态切换 + 胜利时钟。'
};

export function planActions(gameState, helpers, myCamp) {
    return planTurn(gameState, helpers, myCamp, TIER_CAPABILITIES.medium);
}

export { selectCommander, selectCommanderPair };
