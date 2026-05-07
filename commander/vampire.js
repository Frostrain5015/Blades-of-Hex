// 吸血鬼 —— 嗜血
export default {
  id: 'vampire',
  name: '吸血鬼',
  skill: '嗜血',
  hpBonus: 25, atkBonus: 25, spdBonus: 0,
  desc: '攻击造成伤害时随机回复伤害值25%~75%的生命值',

  _getHeal(dmg) {
    const ratio = 0.25 + Math.random() * 0.5; // 25% ~ 75%
    return Math.round(dmg * ratio);
  },

  onAttack(attacker, target, dmg, helpers) {
    if (dmg <= 0) return null;
    const healAmt = this._getHeal(dmg);
    const actualHeal = attacker.heal(healAmt);
    helpers.spawnFx(attacker.tile.x, attacker.tile.y);
    return { healAmt: actualHeal };
  },

  onCounterAttack(attacker, target, dmg, helpers) {
    if (dmg <= 0) return null;
    const healAmt = this._getHeal(dmg);
    const actualHeal = target.heal(healAmt);
    helpers.spawnFx(target.tile.x, target.tile.y);
    return { healAmt: actualHeal };
  }
};
