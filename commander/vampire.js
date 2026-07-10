// 吸血鬼 —— 嗜血
import { COMMANDER_CONFIG } from '../js/gameData.js';

const { definition: DEFINITION, balance: BALANCE } = COMMANDER_CONFIG.vampire;

export default {
  ...DEFINITION,

  _getHeal(dmg, rng) {
    const ratio = rng
      ? rng.range(BALANCE.healMinPct, BALANCE.healMaxPct)
      : BALANCE.healMinPct + Math.random() * (BALANCE.healMaxPct - BALANCE.healMinPct);
    return Math.round(dmg * ratio);
  },

  _applyHealAndShield(unit, healAmt, helpers) {
    const actualHeal = unit.heal(healAmt);
    const overflow = healAmt - actualHeal;
    let shieldGain = 0;
    if (overflow > 0) {
      shieldGain = Math.round(overflow * BALANCE.overflowToShieldPct);
      if (shieldGain > 0) {
        const newShield = Math.min(BALANCE.shieldCap, (unit._shield || 0) + shieldGain);
        shieldGain = newShield - (unit._shield || 0);
        unit._shield = newShield;
        unit._shieldMax = Math.max(unit._shieldMax || 0, BALANCE.shieldCap);
        if (shieldGain > 0) {
          helpers.logMessage(`吸血鬼【嗜血】：溢出治疗转化为护盾+${shieldGain} 当前护盾${unit._shield}/${BALANCE.shieldCap}`);
        }
      }
    }
    return { healAmt: actualHeal, shieldGain };
  },

  onAttack(attacker, target, dmg, helpers) {
    if (dmg <= 0) return null;
    const healAmt = this._getHeal(dmg, helpers.rng);
    helpers.spawnFx(attacker.tile.x, attacker.tile.y);
    // 吸血粒子流（由 commander 钩子自行触发，不再由 gameLogic 硬编码）
    const isTargetDead = helpers.isTargetDead;
    const bloodDestX = (isTargetDead && helpers.attackerType !== 'archer') ? helpers.targetTile.x : helpers.attackerTile.x;
    const bloodDestY = (isTargetDead && helpers.attackerType !== 'archer') ? helpers.targetTile.y : helpers.attackerTile.y;
    helpers.spawnBloodDrain(helpers.targetTile.x, helpers.targetTile.y, bloodDestX, bloodDestY);
    return this._applyHealAndShield(attacker, healAmt, helpers);
  },

  onCounterAttack(attacker, target, dmg, helpers) {
    if (dmg <= 0) return null;
    const healAmt = this._getHeal(dmg, helpers.rng);
    helpers.spawnFx(target.tile.x, target.tile.y);
    // 反击吸血粒子流
    helpers.spawnBloodDrain(attacker.tile.x, attacker.tile.y, target.tile.x, target.tile.y);
    return this._applyHealAndShield(target, healAmt, helpers);
  }
};
