// 空军上校 —— 专属空军卡（金币消耗）
// 选将时替换牌库为3张空军卡，部署前禁用
// 空军卡直接消耗金币；伤害以上校自身攻击力走标准管线（越强的上校空军越猛）
// 雾天停飞
import { campToKey } from '../rules/camps.js';
import { COMMANDER_CONFIG } from '../rules/commanders.js';

const { definition: DEFINITION } = COMMANDER_CONFIG.colonel;

export default {
    ...DEFINITION,

    onDeploy(unit, gameState, helpers) {
        const campKey = campToKey(unit.camp);
        if (!gameState._colonelDeployed) gameState._colonelDeployed = {};
        gameState._colonelDeployed[campKey] = true;
        // 部署后立即从共享牌堆发放3张常驻空军卡（手牌不足才补）
        const hand = gameState.playerHands[campKey];
        const airCards = ['diveStrafe', 'carpetBomb', 'airlift'];
        for (const cid of airCards) {
            if (!hand.includes(cid)) hand.push(cid);
        }
    }
};
