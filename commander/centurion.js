// 百夫长 —— 乘胜追击
export default {
  id: 'centurion',
  name: '百夫长',
  skill: '乘胜',
  hpBonus: 0, atkBonus: 5, spdBonus: 0,
  desc: '消灭敌人时恢复3点行动力（该效果每回合最多触发1次）',

  onKill(killer, victim, helpers) {
    if (killer._centurionTriggered) return null;
    killer.canAct = true;
    killer.remainingMP = Math.min(killer.config.speed, killer.remainingMP + 3);
    killer._centurionTriggered = true;
    helpers.spawnFx(killer.tile.x, killer.tile.y);
    helpers.logMessage(`百夫长【乘胜】触发：${killer.camp.name}${killer.config.name}兵 MP+3，可再行动`);
    return { extraMP: 3, canActAgain: true };
  }
};
