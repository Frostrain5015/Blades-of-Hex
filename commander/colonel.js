// 空军上校 —— 专属空军卡 + 燃料系统
// 选将时替换牌库为3张空军卡，部署前禁用
// 燃料：每5回合发2点，可花$3买2点
// 雾天停飞
import { CAMP } from '../js/config.js';

export default {
    id: 'colonel',
    name: '空军上校',
    hpBonusPct: 0.30, atkBonusPct: 0.20, spdBonus: 0,
    skills: [
        { name: '制空', desc: '无法使用普通对策卡。上校存活且部署时可消耗【🔥燃料】使用专属的空军对策卡，雾天停飞无法使用。空袭目标2格范围内每有1个敌方防空单位，此次空袭伤害降低15%，最多降低45%', type: 'passive' },
        { name: '俯冲扫射 2🔥', desc: '对单体目标造成基于攻击力130%的伤害，对装甲目标伤害降至20~35', type: 'active' },
        { name: '地毯轰炸 3🔥', desc: '对单体目标造成100%攻击力的伤害，并溅射周围目标造成60%攻击力的伤害', type: 'active' },
        { name: '空运 3🔥', desc: '运送一名自己以外的友军单位至指定目标，降落点每层防空火力使该单位在运输途中损失15%当前生命值，最多45%', type: 'active' }
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