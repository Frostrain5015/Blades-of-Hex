// 尚书 —— 屯田
import { COMMANDER_CONFIG } from '../rules/commanders.js';

const { definition: DEFINITION, balance: BALANCE } = COMMANDER_CONFIG.minister;

export default {
  ...DEFINITION,

  onTurnStart(gameState, camp, helpers) {
    if (camp.name === '中立') return;
    const unit = helpers.findCommanderUnit(camp, 'minister');
    if (!unit || !unit.tile || !unit.tile.isCity) return;
    const factionCount = gameState.isThreePlayer ? 4 : 3;
    const roundNum = Math.floor(gameState.turnCounter / factionCount) + 1;  // 当前回合数(1-indexed)
    const gold = Math.min(roundNum * BALANCE.goldPerRound, BALANCE.maxGoldPerRound);
    helpers.addGold(gold);
    helpers.logMessage(`尚书【屯田】产出$${gold}`);
  }
};
