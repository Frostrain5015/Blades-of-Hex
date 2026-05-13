// 百夫长 —— 乘胜追击
export default {
  id: 'centurion',
  name: '百夫长',
  skills: [
      { name: '老兵', desc: '晋升的速度+100%', type: 'passive' },
      { name: '乘胜', desc: '攻击时有30%概率行动力+3，击杀时必定触发（每回合最多1次）', type: 'passive' }
  ],
  hpBonus: 0, atkBonus: 25, spdBonus: 1,

  onAttack(attacker, target, dmg, helpers) {
    if (attacker._centurionTriggered) return null;
    if (target.hp <= 0) return null; // 击杀由 onKill 处理，避免与引擎 killResult 检查冲突
    if (Math.random() >= 0.30) return null;
    attacker._centurionTriggered = true;
    attacker.remainingMP = Math.min(attacker.config.speed, attacker.remainingMP + 3);
    helpers.spawnFx(attacker.tile.x, attacker.tile.y);
    helpers.logMessage(`百夫长【乘胜】攻击触发：${attacker.camp.name}${attacker.config.name}兵 MP+3，可再行动`);
    return { extraMP: 3, canActAgain: true };
  },

  onKill(killer, victim, helpers) {
    if (killer._centurionTriggered) return null;
    killer._centurionTriggered = true;
    killer.remainingMP = Math.min(killer.config.speed, killer.remainingMP + 3);
    helpers.spawnFx(killer.tile.x, killer.tile.y);
    helpers.logMessage(`百夫长【乘胜】击杀触发：${killer.camp.name}${killer.config.name}兵 MP+3，可再行动`);
    return { extraMP: 3, canActAgain: true };
  }
};
