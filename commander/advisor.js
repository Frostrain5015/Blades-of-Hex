// 谋士 —— 攻心（受击触发）
const HEX_NEIGHBORS = [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]];

export default {
  id: 'advisor',
  name: '谋士',
  skill: '攻心',
  hpBonusPct: 0.35, atkBonusPct: 0, spdBonus: 1,
  desc: '受到伤害时有75%概率使攻击者士气下降，若其已混乱则感化为友军单位（将领单位无法被感化）',
  tooltipDesc: '受到伤害时有75%概率使攻击者士气下降，若其已混乱则感化为友军单位（将领单位无法被感化）',

  _gongxin(source, enemy, helpers) {
    // 勇气灵光保护：相邻6格内有己方圣骑士时，士气不会下降
    const gs = helpers.gameState;
    if (gs && gs.tileMap && enemy.tile) {
      for (const [dq, dr] of HEX_NEIGHBORS) {
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
      helpers.spawnGongxinRipple(enemy.tile.x, enemy.tile.y, true);
      helpers.logMessage(`谋士【攻心】感化：${enemy.config.name}兵转为${source.camp.name}阵营`);
      return { moraleDropped: false, converted: true };
    }

    // 75%概率触发叠层
    if (!(helpers.rng ? helpers.rng.chance(0.75) : Math.random() < 0.75)) return null;

    const currentStacks = (enemy._gongxinStacks || 0) + 1;
    enemy._gongxinStacks = currentStacks;
    enemy._gongxinCamp = source.camp;

    // 每层当前士气-1
    enemy.morale = Math.max(0, enemy.morale - 1);

    helpers.spawnFx(enemy.tile.x, enemy.tile.y);
    helpers.spawnGongxinRipple(enemy.tile.x, enemy.tile.y, false);
    return { moraleDropped: true };
  },

  // 受击时触发：谋士挂载的部队受到伤害时，对攻击者触发攻心
  onDamageTaken(unit, attacker, dmg, helpers) {
    if (dmg <= 0 || !attacker || attacker.hp <= 0) return null;
    return this._gongxin(unit, attacker, helpers);
  }
};
