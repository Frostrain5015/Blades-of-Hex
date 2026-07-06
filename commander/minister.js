// 尚书 —— 屯田
import { getRound } from '../js/config.js';

export default {
  id: 'minister',
  name: '尚书',
  skill: '屯田',
  hpBonusPct: 0.40, spdBonus: 0,
  desc: '驻扎于城市时，每回合额外产出$1×当前回合数（上限$12）',
  tooltipDesc: '驻扎于城市时，每回合产出$1×当前回合数（上限$12）',

  onTurnStart(gameState, camp, helpers) {
    if (camp.name === '中立') return;
    const unit = helpers.findCommanderUnit(camp, 'minister');
    if (!unit || !unit.tile || !unit.tile.isCity) return;
    const roundNum = getRound(gameState);  // 当前回合数(1-indexed)
    const gold = Math.min(roundNum, 12);
    helpers.addGold(gold);
    helpers.logMessage(`尚书【屯田】产出$${gold}`);
  }
};
