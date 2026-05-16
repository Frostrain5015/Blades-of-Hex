// 狂战士 —— 狂暴（主动技能）
// 发动时根据已损失生命值百分比，每2%提高1攻击力和1%防御力
export default {
  id: 'berserker',
  name: '狂战士',
  skill: '狂暴',
  hpBonus: 35, atkBonus: 15, spdBonus: 0,
  desc: '根据当前已损失生命值，每2%提高1点攻击力和1%防御力（⏱2 ⏳3）',

  activeSkill: {
    name: '狂暴',
    desc: '根据当前已损失生命值，每2%提高1点攻击力和1%防御力，持续2回合',
    duration: 2,
    cooldown: 3,

    onActivate(unit, helpers) {
      // 远端重放保护：状态已由序列化同步，仅重放特效
      if (unit._activeSkillBuffs && unit._activeSkillBuffs.atk !== undefined) {
        helpers.spawnFx(unit.tile.x, unit.tile.y, '💢', '狂暴');
        return;
      }
      const hpLostPct = ((unit.maxHp - unit.hp) / unit.maxHp) * 100;
      const stacks = Math.floor(hpLostPct / 2);
      const bonusAtk = stacks;
      const bonusDef = stacks * 0.01;

      unit._atkBonus += bonusAtk;
      unit._activeSkillBuffs = { atk: bonusAtk, def: bonusDef };
      helpers.spawnFx(unit.tile.x, unit.tile.y, '💢', '狂暴');
      helpers.logMessage(
        `狂战士【狂暴】激活：已损失${Math.round(hpLostPct)}%生命 → +${bonusAtk}ATK +${stacks}%防御，持续${this.duration}回合`
      );
    },

    onExpire(unit, helpers) {
      if (unit._activeSkillBuffs) {
        unit._atkBonus -= unit._activeSkillBuffs.atk;
      }
      unit._activeSkillBuffs = null;
      helpers.logMessage('狂战士【狂暴】效果结束');
    }
  },

  getDefenseBonus(unit) {
    return (unit._activeSkillBuffs && unit._activeSkillBuffs.def) ? unit._activeSkillBuffs.def : 0;
  }
};
