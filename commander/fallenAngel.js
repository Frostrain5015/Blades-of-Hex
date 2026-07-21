// 堕天使 —— 堕落（双形态转换）
import { COMMANDER_CONFIG } from '../rules/commanders.js';
import { enqueueFloatText } from '../js/floatTexts.js';

const { definition: DEFINITION, balance: BALANCE } = COMMANDER_CONFIG.fallenAngel;

export default {
  ...DEFINITION,

  onMoraleChange(unit, oldMorale, newMorale, helpers) {
    const { logMessage, spawnFx } = helpers;
    if (!unit._fallen && BALANCE.blackMoraleLevels.includes(newMorale)) {
      unit._fallen = true;
      spawnFx(unit.tile.x, unit.tile.y, '😈', '堕落');
      logMessage(`堕天使【堕落】：${unit.camp.name}${unit.config.name}兵进入黑形态，造成的伤害+${Math.round(BALANCE.blackDamageBonus * 100)}%、暴击率+${Math.round(BALANCE.blackCritBonus * 100)}%`);
    } else if (unit._fallen && newMorale === BALANCE.normalMorale) {
      unit._fallen = false;
      spawnFx(unit.tile.x, unit.tile.y, '😇', '净化');
      logMessage(`堕天使【净化】：${unit.camp.name}${unit.config.name}兵恢复白形态`);
    }
  },

  onTurnStart(gameState, camp, helpers) {
    for (const tile of gameState.tiles) {
      if (!tile.unit || tile.unit.commander !== 'fallenAngel' || tile.unit.camp !== camp) continue;
      const u = tile.unit;

      if (u._fallen) {
        const burn = Math.max(1, Math.round(u.hp * BALANCE.blackHpLossPct));
        u.applyDamage(burn, { source: 'true', minHp: 1 });
        enqueueFloatText({
          x: tile.x, y: tile.y, value: burn, timeLeft: 800
        }, { gs: gameState });
      } else {
        if (u.hp < u.maxHp) {
          const healAmt = Math.round((u.maxHp - u.hp) * BALANCE.whiteMissingHpHealPct);
          u.heal(healAmt);
        }
      }
    }
  },

  getDamageBonusPct(unit) {
    return unit._fallen ? BALANCE.blackDamageBonus : 0;
  },

  // 黑形态：暴击率在原有基础上+60%（不再必定暴击）
  getCritRateBonus(unit) {
    return unit._fallen ? BALANCE.blackCritBonus : 0;
  }
};
