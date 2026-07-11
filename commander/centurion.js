// 百夫长 —— 乘胜追击
import { COMMANDER_CONFIG } from '../rules/commanders.js';

const { definition: DEFINITION, balance: BALANCE } = COMMANDER_CONFIG.centurion;

export default {
  ...DEFINITION,

  onAttack(attacker, target, dmg, helpers) {
    if (attacker._centurionTriggered) return null;
    if (target.hp <= 0) return null; // 击杀由 onKill 处理，避免与引擎 killResult 检查冲突
    if (!(helpers.rng ? helpers.rng.chance(BALANCE.attackTriggerChance) : Math.random() < BALANCE.attackTriggerChance)) return null;
    attacker._centurionTriggered = true;
    attacker.remainingMP = Math.min(attacker.config.speed, attacker.remainingMP + BALANCE.movementPoints);
    helpers.spawnFx(attacker.tile.x, attacker.tile.y);
    helpers.logMessage(`百夫长【乘胜】攻击触发：${attacker.camp.name}${attacker.config.name}兵 MP+${BALANCE.movementPoints}，可再行动`);
    return { extraMP: BALANCE.movementPoints, canActAgain: true };
  },

  onKill(killer, victim, helpers) {
    if (killer._centurionTriggered) return null;
    killer._centurionTriggered = true;
    killer.remainingMP = Math.min(killer.config.speed, killer.remainingMP + BALANCE.movementPoints);
    helpers.spawnFx(killer.tile.x, killer.tile.y);
    helpers.logMessage(`百夫长【乘胜】击杀触发：${killer.camp.name}${killer.config.name}兵 MP+${BALANCE.movementPoints}，可再行动`);
    return { extraMP: BALANCE.movementPoints, canActAgain: true };
  }
};
