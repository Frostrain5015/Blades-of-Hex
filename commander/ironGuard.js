// 铁卫 —— 守护
import { BOARD_RULES } from '../rules/constants.js';
import { COMMANDER_CONFIG } from '../rules/commanders.js';
import { enqueueFloatText } from '../js/floatTexts.js';

const { definition: DEFINITION, balance: BALANCE } = COMMANDER_CONFIG.ironGuard;
const HEX_SIZE = BOARD_RULES.hexSize;

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
            enqueueFloatText({
              kind: 'shield', sign: '+',
              x: tile.x, y: tile.y, value: gained, timeLeft: 1000
            }, { gs: gameState });
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
    // 飞行中攻击：护盾跳字随受击友军的弹着时刻跳出
    const shieldDelayMs = Math.max(0, (allyUnit?._deferImpactFxUntil || 0) - performance.now());
    enqueueFloatText({
      kind: 'shield', sign: '-',
      x: ironGuardUnit.tile.x, y: ironGuardUnit.tile.y,
      value: absorbed, timeLeft: 800, delayMs: shieldDelayMs
    }, { gs: helpers.gameState });
    ironGuardUnit._shieldPulseUntil = performance.now() + 800;
    helpers.spawnFx(ironGuardUnit.tile.x, ironGuardUnit.tile.y - HEX_SIZE * 0.82, '🛡');
    return actualDmg - absorbed;
  }
};
