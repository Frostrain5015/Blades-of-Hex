// 谋士 —— 攻心（攻击触发）
import { COMMANDER_CONFIG } from '../rules/commanders.js';

import { HEX_NEIGHBORS } from '../rules/hex.js';
const CONFIG = COMMANDER_CONFIG.advisor;
const { definition: DEFINITION, balance: BALANCE } = CONFIG;

export default {
  ...DEFINITION,

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

    const roll = helpers.rng.int(BALANCE.outcomeCount);
    if (roll === BALANCE.noEffectOutcome) {
      helpers.logMessage(`谋士【攻心】未能动摇${enemy.config.name}兵`);
      return null;
    }

    const expiresAt = gs ? Math.floor(gs.turnCounter / (gs.isThreePlayer ? 4 : 3)) + BALANCE.durationRounds : 0;
    if (roll === BALANCE.moraleDownOutcome) {
      // 已混乱的单位不会被较轻的结果解除混乱，但会刷新剩余时长。
      enemy.morale = Math.min(enemy.morale, BALANCE.moraleDownLevel);
      enemy.moralePenaltyUntil = Math.max(enemy.moralePenaltyUntil || 0, expiresAt);
      helpers.spawnFx(enemy.tile.x, enemy.tile.y);
      helpers.spawnGongxinRipple(enemy.tile.x, enemy.tile.y, false);
      helpers.logMessage(`谋士【攻心】使${enemy.config.name}兵士气下降（持续2回合）`);
      return { moraleDropped: true };
    }

    if (roll === BALANCE.confusedOutcome || enemy.commander) {
      enemy.morale = BALANCE.confusedLevel;
      enemy.moralePenaltyUntil = Math.max(enemy.moralePenaltyUntil || 0, expiresAt);
      enemy.canAct = false;
      helpers.spawnFx(enemy.tile.x, enemy.tile.y);
      helpers.spawnGongxinRipple(enemy.tile.x, enemy.tile.y, false);
      helpers.logMessage(roll === BALANCE.confusedOutcome
        ? `谋士【攻心】使${enemy.config.name}兵陷入混乱（持续2回合）`
        : `谋士【攻心】命中将领单位：感化免疫，${enemy.config.name}兵陷入混乱（持续2回合）`);
      return { moraleDropped: true };
    }

    if (!gs) return null;
    helpers.changeUnitCamp(enemy, source.camp, gs.tiles);
    enemy.morale = BALANCE.normalMorale;
    enemy.moralePenaltyUntil = 0;
    enemy.canAct = false;
    helpers.spawnFx(enemy.tile.x, enemy.tile.y);
    helpers.spawnGongxinRipple(enemy.tile.x, enemy.tile.y, true);
    helpers.logMessage(`谋士【攻心】感化：${enemy.config.name}兵转为${source.camp.name}阵营`);
    return { moraleDropped: false, converted: true };
  },

  // 攻击命中后触发：被击杀目标不会再承受攻心效果。
  onAttack(unit, target, dmg, helpers) {
    if (!target || target.hp <= 0) return null;
    return this._gongxin(unit, target, helpers);
  }
};
