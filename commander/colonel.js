// 空军上校 —— 专属空军卡 + 燃料系统
// 选将时替换牌库为3张空军卡，部署前禁用
// 燃料：每5回合发2点，可花$3买2点
// 雾天停飞

export default {
    id: 'colonel',
    name: '空军上校',
    skill: '制空',
    hpBonusPct: 0.30, atkBonusPct: 0.20, spdBonus: 0,
    desc: '牌库替换为3张专属空军对策卡（部署后启用）；燃料系统：🔥每5回合发2点，$3可买2🔥',
    tooltipDesc: '专属空军卡（部署后启用）；燃料🔥系统',
    skills: [
        { name: '制空', desc: '牌库替换为3张专属空军对策卡（部署前禁用），消耗燃料使用', type: 'passive' },
        { name: '燃料', desc: '每5回合发放2🔥，$3可购买2🔥（不限次数）', type: 'passive' }
    ],

    onDeploy(unit, gameState, helpers) {
        const campKey = unit.camp === (typeof CAMP !== 'undefined' ? CAMP.player1 : null)
            ? 'player1' : unit.camp === (typeof CAMP !== 'undefined' ? CAMP.player2 : null) ? 'player2' : 'player3';
        if (!gameState._colonelDeployed) gameState._colonelDeployed = {};
        gameState._colonelDeployed[campKey] = true;
        if (!gameState._fuel) gameState._fuel = { player1: 0, player2: 0, player3: 0 };
    }
};