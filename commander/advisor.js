// 谋士 —— 攻心
export default {
  id: 'advisor',
  name: '谋士',
  skill: '攻心',
  hpBonus: 60, atkBonus: 15, spdBonus: 0,
  desc: '攻击时有75%概率使对方士气下降，若此时目标已陷入混乱，则被感化为己方单位（将领单位无法被感化）',

  onAttack(attacker, target, dmg, helpers) {
    if (dmg <= 0 || target.hp <= 0) return null;

    // 目标已混乱 → 感化招降
    if (target.morale === 0) {
      if (target.commander) return null; // 将领单位不可感化
      const gs = helpers.gameState;
      if (!gs) return null;
      helpers.changeUnitCamp(target, attacker.camp, gs.tiles);
      target.morale = 2; // 感化后士气恢复为正常
      target.canAct = false; // 当回合不可行动
      helpers.spawnFx(target.tile.x, target.tile.y);
      helpers.logMessage(`谋士【攻心】感化：${target.config.name}兵转为${attacker.camp.name}阵营`);
      return { moraleDropped: false, converted: true };
    }

    // 正常降士气：75%概率
    if (Math.random() >= 0.75) return null;
    target.morale = Math.max(0, target.morale - 1);
    if (target.morale === 0) target.canAct = false;
    helpers.spawnFx(target.tile.x, target.tile.y);
    return { moraleDropped: true };
  }
};
