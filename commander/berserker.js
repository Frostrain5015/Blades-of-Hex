// 狂战士 —— 血怒（被动）
// 实时根据已损生命值计算加成：每损失1.5%生命 → +1%攻击力、+1%防御力，上限各50%
export default {
  id: 'berserker',
  name: '狂战士',
  skill: '血怒',
  hpBonusPct: 0.25, atkBonusPct: 0, spdBonus: 0,
  desc: '根据已损失生命值获得加成：每损失1.5%生命，攻击力与防御力各+1%（上限各50%）',
  tooltipDesc: '每损失1.5%HP → ATK+1%、DEF+1%（各上限50%）',

  _getStacks(unit) {
    if (!unit || unit.hp >= unit.maxHp) return 0;
    const hpLostPct = ((unit.maxHp - unit.hp) / unit.maxHp) * 100;
    return Math.min(50, Math.floor(hpLostPct / 1.5));
  },

  getAttackBonus(unit) {
    const stacks = this._getStacks(unit);
    return Math.round(unit.config.attack * stacks * 0.01);
  },

  getDefenseBonus(unit) {
    return this._getStacks(unit) * 0.01;
  }
};
