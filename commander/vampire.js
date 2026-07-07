// 吸血鬼 —— 嗜血
const SHIELD_CAP = 60;

export default {
  id: 'vampire',
  name: '吸血鬼',
  skill: '嗜血',
  hpBonusPct: 0.20, atkBonusPct: 0.40, spdBonus: 0,
  desc: '攻击造成伤害时随机回复伤害值30%~60%的生命值（溢出部分按50%转化为护盾，上限60）',

  _getHeal(dmg, rng) {
    const ratio = rng ? rng.range(0.30, 0.60) : 0.30 + Math.random() * 0.30;
    return Math.round(dmg * ratio);
  },

  _applyHealAndShield(unit, healAmt, helpers) {
    const actualHeal = unit.heal(healAmt);
    const overflow = healAmt - actualHeal;
    let shieldGain = 0;
    if (overflow > 0) {
      shieldGain = Math.round(overflow * 0.50);
      if (shieldGain > 0) {
        const newShield = Math.min(SHIELD_CAP, (unit._shield || 0) + shieldGain);
        shieldGain = newShield - (unit._shield || 0);
        unit._shield = newShield;
        unit._shieldMax = Math.max(unit._shieldMax || 0, SHIELD_CAP);
        if (shieldGain > 0) {
          helpers.logMessage(`吸血鬼【嗜血】：溢出治疗转化为护盾+${shieldGain}（当前护盾${unit._shield}/${SHIELD_CAP}）`);
        }
      }
    }
    return { healAmt: actualHeal, shieldGain };
  },

  onAttack(attacker, target, dmg, helpers) {
    if (dmg <= 0) return null;
    const healAmt = this._getHeal(dmg, helpers.rng);
    helpers.spawnFx(attacker.tile.x, attacker.tile.y);
    return this._applyHealAndShield(attacker, healAmt, helpers);
  },

  onCounterAttack(attacker, target, dmg, helpers) {
    if (dmg <= 0) return null;
    const healAmt = this._getHeal(dmg, helpers.rng);
    helpers.spawnFx(target.tile.x, target.tile.y);
    return this._applyHealAndShield(target, healAmt, helpers);
  }
};
