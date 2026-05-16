// 尚书 —— 屯田
export default {
  id: 'minister',
  name: '尚书',
  skill: '屯田',
  hpBonus: 80, spdBonus: 0,
  desc: '驻扎于城市时，每回合额外产出$1×当前回合数',
  tooltipDesc: '驻扎于城市时，每回合产出$1×当前回合数',

  onTurnEnd(gameState, camp, helpers) {
    if (camp.name === '中立') return;
    const unit = helpers.findCommanderUnit(camp, 'minister');
    if (!unit || !unit.tile || !unit.tile.isCity) return;
    const factionCount = gameState.isThreePlayer ? 4 : 3;
    const roundNum = Math.floor(gameState.turnCounter / factionCount);
    const gold = roundNum;
    helpers.addGold(gold);
    helpers.logMessage(`尚书【屯田】产出$${gold}`);
  }
};
