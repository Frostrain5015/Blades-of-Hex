// 纵横家 —— 合纵 + 连横
// 被动【合纵】：手牌上限+1、每回合用卡次数+1
// 被动【连横】：处于敌方行政区内时，对方玩家每使用一张对策卡35%概率使本阵营获得同名复制

export default {
    id: 'diplomat',
    name: '纵横家',
    skill: '合纵',
    hpBonusPct: 0.30, atkBonusPct: 0.20, spdBonus: 0,
    desc: '手牌上限+1、每回合用卡次数+1；处于敌方行政区时35%复制对方使用的对策卡',
    tooltipDesc: '合纵：手牌+1/用卡+1；连横：敌区内35%复制对方卡牌（进手牌，用后不入弃牌堆）',
    skills: [
        { name: '合纵', desc: '手牌上限+1，每回合用卡次数+1', type: 'passive' },
        { name: '连横', desc: '处于敌方行政区时，对方每用一张对策卡35%概率获得同名复制（超上限不触发，用后不入弃牌堆）', type: 'passive' }
    ],

    // 部署时设置卡牌覆盖
    onDeploy(unit, gameState, helpers) {
        if (!gameState._cardOverrides) gameState._cardOverrides = {};
        const campKey = unit.camp === gameState.camp?.player1 ? 'player1'
                      : unit.camp === gameState.camp?.player2 ? 'player2' : 'player3';
        gameState._cardOverrides[campKey] = { handSizeBonus: 1, useBonus: 1 };
    },

    // 连横检查：在 executeTacticalCard 结束后由外部调用
    checkCardCopy(usedCardId, userCamp, gameState, helpers) {
        if (!gameState.tileMap) return;
        const campKeys = Object.keys(gameState._cardOverrides || {});
        for (const ck of campKeys) {
            // 找到纵横家所属阵营
            const dipCamp = ck === 'player1' ? gameState.camp?.player1
                          : ck === 'player2' ? gameState.camp?.player2 : gameState.camp?.player3;
            if (!dipCamp) continue;
            // 纵横家单位
            const dipUnit = helpers.findCommanderUnit(dipCamp, 'diplomat');
            if (!dipUnit || !dipUnit.tile || dipUnit.hp <= 0) continue;
            // 检查纵横家是否在对方（用卡方）行政区内
            const tile = dipUnit.tile;
            if (tile.camp !== userCamp) continue; // 不在敌区内
            // 35%概率复制
            if (!(gameState.rng ? gameState.rng.chance(0.35) : Math.random() < 0.35)) continue;
            // 检查手牌是否已满
            const hand = gameState.playerHands[ck] || [];
            const maxHand = (gameState._cardSystemConfig?.maxHandSize || 3) + (gameState._cardOverrides[ck]?.handSizeBonus || 0);
            if (hand.length >= maxHand) continue;
            // 添加复制卡（标记 _copy: true）
            hand.push({ id: usedCardId, _copy: true });
            helpers.logMessage(`纵横家【连横】：${ck}获得${usedCardId}的复制`);
        }
    }
};
