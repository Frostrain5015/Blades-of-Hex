// 狂战士 —— 狂暴（主动技能）
export default {
  id: 'berserker',
  name: '狂战士',
  skill: '狂暴',
  hpBonus: 35, atkBonus: 15, spdBonus: 0,
  desc: '攻击力+20，防御力+25%（⏱2 ⏳3）',

  activeSkill: {
    name: '狂暴',
    desc: '攻击力+20，防御力+25%，持续2回合',
    duration: 2,
    cooldown: 3,
    buffs: { atk: 20, def: 0.25 },

    onActivate(unit, helpers) {
      const b = this.buffs;
      unit._atkBonus += b.atk;
      unit._activeSkillBuffs = { atk: b.atk, def: b.def };
      helpers.spawnFx(unit.tile.x, unit.tile.y, '💢', '狂暴');
      helpers.logMessage(`狂战士【狂暴】激活：+${b.atk}ATK +${Math.round(b.def * 100)}%防御，持续${this.duration}回合`);
    },

    onExpire(unit, helpers) {
      unit._atkBonus -= this.buffs.atk;
      unit._activeSkillBuffs = null;
      helpers.logMessage('狂战士【狂暴】效果结束');
    }
  },

  getDefenseBonus(unit) {
    return (unit._activeSkillBuffs && unit._activeSkillBuffs.def) ? unit._activeSkillBuffs.def : 0;
  }
};
