// 狂战士 —— 血怒（被动）
// 实时根据已损生命值计算加成：每损失2%生命 → +1%攻击力、+1%防御力，上限各40%
import { COMMANDER_CONFIG } from '../js/gameData.js';

const { definition: DEFINITION, balance: BALANCE } = COMMANDER_CONFIG.berserker;

export default {
  ...DEFINITION,

  activeSkill: {
    ...DEFINITION.activeSkill,

    onActivate(unit, helpers) {
      if (!unit || !unit.tile) return false;
      if (helpers.isReplay) {
        helpers.spawnFx(unit.tile.x, unit.tile.y, '🩸', '泣血');
        return true;
      }
      const hpCost = Math.max(1, Math.round(unit.hp * BALANCE.qixueHpCostPct));
      const hpBefore = unit.hp;
      unit.applyDamage(hpCost, { source: 'true', skipAura: true, minHp: 1 });
      const actualCost = hpBefore - unit.hp;
      unit.displayHp = unit.hp;
      unit._berserkerQixue = true;
      helpers.spawnFx(unit.tile.x, unit.tile.y, '🩸', '泣血');
      helpers.logMessage(`狂战士【泣血】：消耗${actualCost}生命，下次攻击伤害+${BALANCE.qixueDamageBonus * 100}%、暴击率+${BALANCE.qixueCritBonus * 100}%并触发溅射`);
      return true;
    }
  },

  _getStacks(unit) {
    if (!unit || unit.hp >= unit.maxHp) return 0;
    const hpLostRatio = (unit.maxHp - unit.hp) / unit.maxHp;
    return Math.min(BALANCE.maxStacks, Math.floor(hpLostRatio / BALANCE.hpLossPerStackPct));
  },

  getAttackBonus(unit) {
    const stacks = this._getStacks(unit);
    return Math.round(unit.config.attack * stacks * BALANCE.statBonusPerStackPct);
  },

  getDefenseBonus(unit) {
    return this._getStacks(unit) * BALANCE.statBonusPerStackPct;
  }
};
