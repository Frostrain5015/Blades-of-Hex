// 铁卫 —— 守护
import { HEX_SIZE } from '../js/config.js';
import { COMMANDER_CONFIG } from '../js/gameData.js';

const { definition: DEFINITION, balance: BALANCE } = COMMANDER_CONFIG.ironGuard;

export default {
  ...DEFINITION,

  onDeploy(unit, gameState, helpers) {
    unit._shield = BALANCE.shieldMax;
    unit._shieldMax = BALANCE.shieldMax;
    unit._shieldTurns = 999;
  },

  onTurnStart(gameState, camp, helpers) {
    const { logMessage } = helpers;
    for (const tile of gameState.tiles) {
      if (!tile.unit) continue;
      const u = tile.unit;
      if (u.commander === 'ironGuard' && u.camp === camp) {
        if (u._shield < BALANCE.shieldMax) {
          const oldShield = u._shield;
          u._shield = Math.min(BALANCE.shieldMax, u._shield + BALANCE.shieldRestorePerRound);
          u._shieldMax = BALANCE.shieldMax;
          u._shieldTurns = 999;
          const gained = u._shield - oldShield;
          if (gained > 0) {
            logMessage(`铁卫【守护】回复${gained}点护盾`);
          }
        } else {
          u._shieldTurns = 999;
        }
      }
    }
  },

  // 灵光：自身及相邻友军防御+10%（在防御乘区加算）
  getAuraDefenseBonus(allyUnit) {
    return BALANCE.auraDefenseBonus;
  },

  // 灵光转移：友军所受伤害由铁卫护盾值承担，护盾耗尽后不再承担
  onDamageTakenAlly(allyUnit, actualDmg, ironGuardUnit, helpers) {
    if (actualDmg <= 0 || ironGuardUnit._shield <= 0) return actualDmg;
    const absorbed = Math.min(ironGuardUnit._shield, actualDmg);
    ironGuardUnit._shield -= absorbed;
    const gs = helpers.gameState;
    gs.damageTexts.push({
      x: ironGuardUnit.tile.x, y: ironGuardUnit.tile.y,
      value: absorbed, isCrit: false,
      timeLeft: 800, lastUpdate: performance.now()
    });
    ironGuardUnit._shieldPulseUntil = performance.now() + 800;
    helpers.spawnFx(ironGuardUnit.tile.x, ironGuardUnit.tile.y - HEX_SIZE * 0.82, '🛡');
    return actualDmg - absorbed;
  }
};
