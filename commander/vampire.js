// 吸血鬼 —— 嗜血
export default {
  id: 'vampire',
  name: '吸血鬼',
  skill: '嗜血',
  hpBonus: 0, atkBonus: 10, spdBonus: 0,
  desc: '攻击造成伤害时回复伤害值25%~75%的生命值',

  _getHeal(dmg) {
    const ratio = 0.25 + Math.random() * 0.5; // 25% ~ 75%
    return Math.round(dmg * ratio);
  },

  onAttack(attacker, target, dmg, helpers) {
    if (dmg <= 0) return null;
    const healAmt = this._getHeal(dmg);
    const actualHeal = attacker.heal(healAmt);
    if (actualHeal > 0) {
      helpers.spawnFx(attacker.tile.x, attacker.tile.y);
      return { healAmt: actualHeal };
    }
    return null;
  },

  onCounterAttack(attacker, target, dmg, helpers) {
    if (dmg <= 0) return null;
    const healAmt = this._getHeal(dmg);
    const actualHeal = target.heal(healAmt);
    if (actualHeal > 0) {
      helpers.spawnFx(target.tile.x, target.tile.y);
      return { healAmt: actualHeal };
    }
    return null;
  }
};
