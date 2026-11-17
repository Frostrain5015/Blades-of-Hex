// Optio（入门档）—— 承接原 Legatus 脚本与能力深度，整体下调一档作为简单 AI。
//
// 启用协同集火、反制招募与常规卡牌剧本，但不启用全图视野透视、威胁外推与终局时钟。

import { planTurn } from './core/planner.js';
import { TIER_CAPABILITIES } from './core/weights.js';
import { selectCommander, selectCommanderPair } from './doctrine.js';

export const meta = {
    name: 'Optio',
    tier: 'Basic',
    difficultyId: 'easy',
    description: '共享引擎的入门档（原 Legatus）：保留协同集火与卡牌剧本，不启用全图透视与深度推演。'
};

export function planActions(gameState, helpers, myCamp) {
    return planTurn(gameState, helpers, myCamp, TIER_CAPABILITIES.easy);
}

export { selectCommander, selectCommanderPair };
