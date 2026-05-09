// 堕天使 —— 堕落（双形态转换）
export default {
  id: 'fallenAngel',
  name: '堕天使',
  skill: '堕落',
  hpBonus: 70, atkBonus: 0, spdBonus: 0,
  desc: '【☆堕天使·白】每回合回复已损失生命值的20%，士气上升或下降时切换至【★堕天使·黑】\n【★堕天使·黑】每回合流失当前生命值的20%，攻击力+25、暴击率100%，士气恢复正常时切换至【☆堕天使·白】',

  onMoraleChange(unit, oldMorale, newMorale, helpers) {
    const { logMessage, spawnFx } = helpers;
    if (!unit._fallen && (newMorale === 1 || newMorale === 3)) {
      unit._fallen = true;
      spawnFx(unit.tile.x, unit.tile.y, '😈', '堕落');
      logMessage(`堕天使【堕落】：${unit.camp.name}${unit.config.name}兵进入黑形态，攻击力+25、暴击率100%`);
    } else if (unit._fallen && newMorale === 2) {
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
        const burn = Math.max(1, Math.round(u.hp * 0.20));
        u.hp = Math.max(1, u.hp - burn);
        if (gameState.damageTexts) {
          gameState.damageTexts.push({
            x: tile.x, y: tile.y, value: burn, isCrit: false,
            timeLeft: 800, lastUpdate: Date.now()
          });
        }
      } else {
        if (u.hp < u.maxHp) {
          const healAmt = Math.round((u.maxHp - u.hp) * 0.20);
          u.heal(healAmt);
        }
      }
    }
  },

  getAttackBonus(unit) {
    return unit._fallen ? 25 : 0;
  },

  guaranteesCrit(unit) {
    return unit._fallen === true;
  }
};
