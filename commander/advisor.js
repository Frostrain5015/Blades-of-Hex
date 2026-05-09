// 谋士 —— 攻心
export default {
  id: 'advisor',
  name: '谋士',
  skill: '攻心',
  hpBonus: 75, atkBonus: 0, spdBonus: 1,
  desc: '攻击或反击时有75%概率使对方士气下降，叠至第2层目标混乱，叠至第3层感化为己方单位（将领单位无法被感化）',

  _gongxin(source, enemy, helpers) {
    // 75%概率触发（第3层感化无需概率判定）
    const currentStacks = enemy._gongxinStacks || 0;
    if (currentStacks < 2 && Math.random() >= 0.75) return null;

    enemy._gongxinStacks = currentStacks + 1;
    const stacks = enemy._gongxinStacks;

    // 第3层：感化招降
    if (stacks >= 3) {
      if (enemy.commander) return null;
      const gs = helpers.gameState;
      if (!gs) return null;
      helpers.changeUnitCamp(enemy, source.camp, gs.tiles);
      enemy.morale = 2;
      enemy.canAct = false;
      enemy._gongxinStacks = 0;
      helpers.spawnFx(enemy.tile.x, enemy.tile.y);
      helpers.logMessage(`谋士【攻心】感化：${enemy.config.name}兵转为${source.camp.name}阵营`);
      return { moraleDropped: false, converted: true };
    }

    // 第2层：士气强制为0（混乱）
    if (stacks >= 2) {
      enemy.morale = 0;
      enemy.canAct = false;
    } else {
      // 第1层：士气降到1
      enemy.morale = Math.max(1, enemy.morale - 1);
    }

    helpers.spawnFx(enemy.tile.x, enemy.tile.y);
    return { moraleDropped: true };
  },

  onAttack(attacker, target, dmg, helpers) {
    if (dmg <= 0 || target.hp <= 0) return null;
    return this._gongxin(attacker, target, helpers);
  },

  onCounterAttack(attacker, target, dmg, helpers) {
    if (dmg <= 0 || attacker.hp <= 0) return null;
    return this._gongxin(target, attacker, helpers);
  }
};
