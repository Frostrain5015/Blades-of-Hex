// 谋士 —— 攻心
export default {
  id: 'advisor',
  name: '谋士',
  skill: '攻心',
  hpBonus: 75, atkBonus: 0, spdBonus: 1,
  desc: '攻击或反击时有75%概率使对方永久士气-1，若目标士气已为0则直接感化为己方单位（将领单位无法被感化）',
  tooltipDesc: '攻击/反击时75%概率使对方士气-1，士气为0时感化为己方（将领除外）',

  _gongxin(source, enemy, helpers) {
    // 勇气灵光保护：相邻6格内有己方圣骑士时，士气不会下降
    const gs = helpers.gameState;
    if (gs && gs.tileMap && enemy.tile) {
      const dirs = [[1,0],[1,-1],[0,-1],[-1,0],[-1,1],[0,1]];
      for (const [dq, dr] of dirs) {
        const nb = gs.tileMap.get(`${enemy.tile.q + dq},${enemy.tile.r + dr}`);
        if (nb && nb.unit && nb.unit.commander === 'paladin' && nb.unit.camp === enemy.camp) {
          helpers.logMessage(`勇气灵光护体，${enemy.config.name}兵免疫攻心`);
          return null;
        }
      }
    }

    // 士气已为0 → 攻心使其降至负数，直接感化招降
    if (enemy.morale === 0) {
      if (enemy.commander) return null;
      if (!gs) return null;
      helpers.changeUnitCamp(enemy, source.camp, gs.tiles);
      enemy.morale = 2;
      enemy.canAct = false;
      enemy._gongxinStacks = 0;
      helpers.spawnFx(enemy.tile.x, enemy.tile.y);
      helpers.logMessage(`谋士【攻心】感化：${enemy.config.name}兵转为${source.camp.name}阵营`);
      return { moraleDropped: false, converted: true };
    }

    // 75%概率触发叠层
    if (Math.random() >= 0.75) return null;

    const currentStacks = (enemy._gongxinStacks || 0) + 1;
    enemy._gongxinStacks = currentStacks;
    enemy._gongxinCamp = source.camp;

    // 每层当前士气-1（混乱由士气=0自然决定，与攻心无关）
    enemy.morale = Math.max(0, enemy.morale - 1);

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
