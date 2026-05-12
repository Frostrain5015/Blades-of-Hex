// 百夫长 —— 乘胜追击
export default {
  id: 'centurion',
  name: '百夫长',
  skill: '乘胜',
  hpBonus: 0, atkBonus: 25, spdBonus: 1,
  desc: '攻击时30%概率行动力+3并可再行动，击杀必定触发（每回合最多1次）· 常驻获取经验速度+100%',

  onAttack(attacker, target, dmg, helpers) {
    if (attacker._centurionTriggered) return null;
    const isKill = target.hp <= 0;
    if (!isKill && Math.random() >= 0.30) return null;
    attacker.canAct = true;
    attacker.remainingMP = Math.min(attacker.config.speed, attacker.remainingMP + 3);
    attacker._centurionTriggered = true;
    helpers.spawnFx(attacker.tile.x, attacker.tile.y);
    helpers.logMessage(`百夫长【乘胜】${isKill ? '击杀' : '攻击'}触发：${attacker.camp.name}${attacker.config.name}兵 MP+3，可再行动`);
    return { extraMP: 3, canActAgain: true };
  },

  onKill(killer, victim, helpers) {
    // onAttack 优先处理；此处作为兜底
    if (killer._centurionTriggered) return null;
    killer.canAct = true;
    killer.remainingMP = Math.min(killer.config.speed, killer.remainingMP + 3);
    killer._centurionTriggered = true;
    helpers.spawnFx(killer.tile.x, killer.tile.y);
    helpers.logMessage(`百夫长【乘胜】击杀触发：${killer.camp.name}${killer.config.name}兵 MP+3，可再行动`);
    return { extraMP: 3, canActAgain: true };
  }
};
