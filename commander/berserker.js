// 狂战士 —— 血怒（被动）
// 实时根据已损生命值计算加成：每损失2%生命 → +1%攻击力、+1%防御力，上限各40%
export default {
  id: 'berserker',
  name: '狂战士',
  skill: '血怒',
  hpBonusPct: 0.25, atkBonusPct: 0, spdBonus: 0,
  desc: '每损失2%生命值，获得1%攻击力与1%防御力加成，最多40%',
  tooltipDesc: '每损失2%生命值分别获得1%攻击力和1%防御力加成，最多40%',

  _getStacks(unit) {
    if (!unit || unit.hp >= unit.maxHp) return 0;
    const hpLostPct = ((unit.maxHp - unit.hp) / unit.maxHp) * 100;
    return Math.min(40, Math.floor(hpLostPct / 2.0));
  },

  getAttackBonus(unit) {
    const stacks = this._getStacks(unit);
    return Math.round(unit.config.attack * stacks * 0.01);
  },

  getDefenseBonus(unit) {
    return this._getStacks(unit) * 0.01;
  }
};
