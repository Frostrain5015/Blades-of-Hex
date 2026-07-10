// 狂战士 —— 血怒（被动）
// 实时根据已损生命值计算加成：每损失2%生命 → +1%攻击力、+1%防御力，上限各40%
export default {
  id: 'berserker',
  name: '狂战士',
  skill: '血怒',
  hpBonusPct: 0.25, atkBonusPct: 0, spdBonus: 0,
  desc: '每损失2%生命值，获得1%攻击力与1%防御力加成，最多40%',
  tooltipDesc: '每损失2%生命值分别获得1%攻击力和1%防御力加成，最多40%',
  skills: [
    { name: '血怒', desc: '每损失2%生命值，获得1%攻击力与1%防御力加成，最多40%', type: 'passive' },
    { name: '泣血', desc: '立即消耗30%当前生命值使下一次攻击获得30%伤害加成并获得50%暴击率，同时主目标周围1格范围内的敌人受到原本40%的溅射伤害。', type: 'active' }
  ],

  activeSkill: {
    name: '泣血',
    desc: '立即消耗30%当前生命值使下一次攻击获得30%伤害加成并获得50%暴击率，同时主目标周围1格范围内的敌人受到原本40%的溅射伤害。',
    duration: 0,
    cooldown: 1,

    onActivate(unit, helpers) {
      if (!unit || !unit.tile) return false;
      if (helpers.isReplay) {
        helpers.spawnFx(unit.tile.x, unit.tile.y, '🩸', '泣血');
        return true;
      }
      const hpCost = Math.max(1, Math.round(unit.hp * 0.30));
      const hpBefore = unit.hp;
      unit.applyDamage(hpCost, { source: 'true', skipAura: true, minHp: 1 });
      const actualCost = hpBefore - unit.hp;
      unit.displayHp = unit.hp;
      unit._berserkerQixue = true;
      helpers.spawnFx(unit.tile.x, unit.tile.y, '🩸', '泣血');
      helpers.logMessage(`狂战士【泣血】：消耗${actualCost}生命，下次攻击伤害+30%、暴击率+50%并触发溅射`);
      return true;
    }
  },

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
