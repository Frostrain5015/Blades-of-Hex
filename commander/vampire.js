// 吸血鬼 —— 嗜血
export default {
  id: 'vampire',
  name: '吸血鬼',
  skill: '嗜血',
  hpBonus: 30, atkBonus: 25, spdBonus: 0,
  desc: '攻击造成伤害时随机回复伤害值30%~60%的生命值',
  tooltipDesc: '攻击造成伤害时回复伤害值30%~60%的生命值',

  _getHeal(dmg) {
    const ratio = 0.30 + Math.random() * 0.30; // 30% ~ 60%
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
