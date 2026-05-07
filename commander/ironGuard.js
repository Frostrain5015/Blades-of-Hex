// 铁卫 —— 守护
export default {
  id: 'ironGuard',
  name: '铁卫',
  skill: '守护',
  hpBonus: 30, atkBonus: 0, spdBonus: 0,
  desc: '自身受伤−30% 每回合回复40%已损生命；相邻友军受伤−20%且50%转由铁卫承担',

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

  // 自身受到伤害时修正
  onDamageTakenSelf(unit, rawDmg, sourceUnit, helpers) {
    return Math.round(rawDmg * 0.7);
  },

  // 灵光buff：相邻友军受伤−20%，50%转由铁卫承担
  // 返回 { reducedDmg, transferred }，由调用方处理铁卫扣血
  onDamageTakenAlly(allyUnit, rawDmg, ironGuardUnit, helpers) {
    const reduced = Math.round(rawDmg * 0.8);
    const transferred = Math.round(reduced * 0.5);
    const finalDmg = reduced - transferred;
    // 铁卫承担转移伤害
    if (transferred > 0 && ironGuardUnit.hp > 0) {
      ironGuardUnit.takeDamage(transferred, null, true);
      // 伤害数字反馈到铁卫
      const gs = helpers.gameState;
      gs.damageTexts.push({
        x: ironGuardUnit.tile.x, y: ironGuardUnit.tile.y,
        value: transferred, isCrit: false,
        timeLeft: 800, lastUpdate: Date.now()
      });
      helpers.spawnFx(ironGuardUnit.tile.x, ironGuardUnit.tile.y, '🛡');
    }
    return finalDmg;
  }
};
