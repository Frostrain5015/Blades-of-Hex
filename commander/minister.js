// 尚书 —— 屯田
export default {
  id: 'minister',
  name: '尚书',
  skill: '屯田',
  hpBonus: 80, spdBonus: 0,
  desc: '驻扎于城市时每回合金币产出+15，招募费用−25%',

  onTurnEnd(gameState, camp, helpers) {
    if (camp.name === '中立') return;
    const unit = helpers.findCommanderUnit(camp, 'minister');
    if (!unit || !unit.tile || !unit.tile.isCity) return;
    helpers.addGold(15);
    helpers.logMessage('尚书【屯田】产出15金币');
  },

  getRecruitCost(baseCost, gameState, camp, helpers) {
    const unit = helpers.findCommanderUnit(camp, 'minister');
    if (!unit || !unit.tile || !unit.tile.isCity) return baseCost;
    return Math.floor(baseCost * 0.75);
  }
};
