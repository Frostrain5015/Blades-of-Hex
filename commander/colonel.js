// 空军上校 —— 专属空军卡 + 燃料系统
// 选将时替换牌库为3张空军卡，部署前禁用
// 燃料：每5回合发2点，可花$3买2点
// 雾天停飞
import { CAMP } from '../js/config.js';

export default {
    id: 'colonel',
    name: '空军上校',
    skill: '制空',
    hpBonusPct: 0.30, atkBonusPct: 0.20, spdBonus: 0,
    desc: '部署后获得3张专属空军对策卡，消耗燃料释放，上校阵亡时移除',
    tooltipDesc: '3张专属空军对策卡，消耗燃料释放，上校阵亡时移除',
    skills: [
        { name: '空军指挥官', desc: '🔥燃料：空军卡消耗燃料使用，不消耗手牌。雾天停飞。上校阵亡时空军卡被收回。', type: 'passive' },
        { name: '俯冲扫射 2🔥', desc: '对单体目标造成基于攻击力130%的伤害，对要塞/炮兵降至20~35', type: 'active' },
        { name: '地毯轰炸 3🔥', desc: '对目标及相邻6格造成范围伤害：中心100%攻击力，溅射60%攻击力', type: 'active' },
        { name: '空运 3🔥', desc: '运送一名自己以外的友军单位至航程内已探索空地并清空行动力；降落防空区时每层防空火力损失15%当前HP（封顶45%）', type: 'active' }
    ],

    onDeploy(unit, gameState, helpers) {
        const campKey = unit.camp === CAMP.player1 ? 'player1'
            : unit.camp === CAMP.player2 ? 'player2' : 'player3';
        if (!gameState._colonelDeployed) gameState._colonelDeployed = {};
        gameState._colonelDeployed[campKey] = true;
        if (!gameState._fuel) gameState._fuel = { player1: 0, player2: 0, player3: 0 };
        // 部署后立即从共享牌堆发放3张常驻空军卡（手牌不足才补）
        const hand = gameState.playerHands[campKey];
        const airCards = ['diveStrafe', 'carpetBomb', 'airlift'];
        for (const cid of airCards) {
            if (!hand.includes(cid)) hand.push(cid);
        }
    }
};