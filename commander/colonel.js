// 空军上校 —— 专属空军卡（金币消耗）
// 选将时替换牌库为3张空军卡，部署前禁用
// 空军卡直接消耗金币；伤害以上校自身攻击力走标准管线（越强的上校空军越猛）
// 雾天停飞
import { CAMP } from '../js/config.js';

export default {
    id: 'colonel',
    name: '空军上校',
    hpBonusPct: 0.30, atkBonusPct: 0.20, spdBonus: 0,
    skills: [
        { name: '制空', desc: '无法使用普通对策卡。上校存活且部署时可消耗金币使用专属空军对策卡，最大航程为6格，空袭目标2格内每有1个敌方防空单位，伤害降低20%，最多40%，雾天停飞无法使用', type: 'passive' },
        { name: '扫射', desc: '$4 对指定单体目标造成上校150%攻击力的伤害', type: 'active' },
        { name: '轰炸', desc: '$5 对指定目标及相邻6格单位造成范围伤害（中心50%/溅射35%）', type: 'active' },
        { name: '空运', desc: '$4 运送一名自己以外的友军单位至指定空地，清空其行动力', type: 'active' }
    ],

    onDeploy(unit, gameState, helpers) {
        const campKey = unit.camp === CAMP.player1 ? 'player1'
            : unit.camp === CAMP.player2 ? 'player2' : 'player3';
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