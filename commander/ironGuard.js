// 铁卫 —— 守护
export default {
  id: 'ironGuard',
  name: '铁卫',
  skill: '守护',
  hpBonus: 30, atkBonus: 0, spdBonus: 0,
  desc: '防御力+20%，每回合回复40%已损失的生命值；相邻友军获得【守护灵光】：防御+10%，所受伤害的50%转由铁卫承担',

  onTurnStart(gameState, camp, helpers) {
    const { logMessage, spawnFx } = helpers;
    for (const tile of gameState.tiles) {
      if (!tile.unit) continue;
      const u = tile.unit;
      if (u.commander === 'ironGuard' && u.camp === camp && u.hp < u.maxHp) {
        const lostHp = u.maxHp - u.hp;
        const healAmt = Math.round(lostHp * 0.4);
        const actualHeal = u.heal(healAmt);
        if (actualHeal > 0) {
          spawnFx(tile.x, tile.y, '🛡');
          logMessage(`铁卫【守护】回复${Math.round(actualHeal)}生命值`);
        }
      }
    }
  },

  // 自身防御加成（在防御乘区加算）
  getDefenseBonus(unit) {
    return 0.20;
  },

  // 灵光：相邻友军防御+10%（在防御乘区加算）
  getAuraDefenseBonus(allyUnit) {
    return 0.10;
  },

  // 灵光转移：相邻友军所受最终伤害的50%转由铁卫承担
  onDamageTakenAlly(allyUnit, actualDmg, ironGuardUnit, helpers) {
    const transferred = Math.round(actualDmg * 0.5);
    if (transferred <= 0 || ironGuardUnit.hp <= 0) return actualDmg;
    ironGuardUnit.takeDamage(transferred, null, true);
    const gs = helpers.gameState;
    gs.damageTexts.push({
      x: ironGuardUnit.tile.x, y: ironGuardUnit.tile.y,
      value: transferred, isCrit: false,
      timeLeft: 800, lastUpdate: Date.now()
    });
    helpers.spawnFx(ironGuardUnit.tile.x, ironGuardUnit.tile.y, '🛡');
    return actualDmg - transferred;
  }
};
