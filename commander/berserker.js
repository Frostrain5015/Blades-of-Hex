// 狂战士 —— 狂暴（主动技能）
export default {
  id: 'berserker',
  name: '狂战士',
  skill: '狂暴',
  hpBonus: 40, atkBonus: 25, spdBonus: 0,
  desc: '主动技能【狂暴】：攻击力+10，防御力+15%，持续2回合。（冷却3回合）',

  activeSkill: {
    name: '狂暴',
    desc: '攻击力+10，防御力+15%，持续2回合',
    duration: 2,
    cooldown: 3,
    buffs: { atk: 10, def: 0.15 },

    onActivate(unit, helpers) {
      unit._atkBonus += 10;
      unit._activeSkillBuffs = { atk: 10, def: 0.15 };
      helpers.spawnFx(unit.tile.x, unit.tile.y, '💢', '狂暴');
      helpers.logMessage('狂战士【狂暴】激活：+10ATK +15%防御，持续2回合');
    },

    onExpire(unit, helpers) {
      unit._atkBonus -= 10;
      unit._activeSkillBuffs = null;
      helpers.logMessage('狂战士【狂暴】效果结束');
    }
  },

  getDefenseBonus(unit) {
    return (unit._activeSkillBuffs && unit._activeSkillBuffs.def) ? unit._activeSkillBuffs.def : 0;
  }
};
