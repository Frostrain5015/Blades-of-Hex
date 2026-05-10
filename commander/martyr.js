// 殉道者 —— 殉道
export default {
  id: 'martyr',
  name: '殉道者',
  skill: '殉道',
  hpBonus: 60, spdBonus: 0,
  desc: '生命≤1时锁定并进入殉道倒计时，下回合开始时对2格内非己方造成AOE伤害（越近越高），殉道时攻击力+40',

  // 殉道状态标记
  onTurnStart(gameState, camp, helpers) {
    const unit = helpers.findCommanderUnit(camp, 'martyr');
    if (!unit || !unit.tile || unit.hp <= 0) return;

    // 检查是否处于殉道状态
    if (unit._martyrPrimed) {
      // 殉道！提升面板攻击力+40
      unit._atkBonus = (unit._atkBonus || 0) + 40;

      const x = unit.tile.x, y = unit.tile.y;

      // 大范围爆炸特效
      helpers.spawnExplosion(x, y, '#ff4400', 45);
      helpers.spawnExplosion(x, y, '#ffaa00', 30);
      helpers.spawnExplosion(x, y, '#ffff00', 15);

      helpers.logMessage(`殉道者【${unit.config.name}兵】殉道牺牲，造成范围伤害！`);

      // 对2格内非己方单位造成AOE伤害
      const tileMap = gameState.tileMap;
      if (tileMap) {
        if (!gameState.damageTexts) gameState.damageTexts = [];
        for (const [tile, dist] of _getTilesInRange(unit.tile, tileMap, 2)) {
          if (!tile.unit || tile.unit.camp === unit.camp || tile.unit.hp <= 0) continue;
          const dmgMult = dist === 0 ? 4.0 : dist === 1 ? 2.0 : 1.0;
          const baseDmg = unit.getEffectiveAttack ? unit.getEffectiveAttack() : 40;
          const dmg = Math.round(baseDmg * dmgMult);
          tile.unit.hp -= dmg;
          // 爆炸伤害数字（暴击红色样式）
          gameState.damageTexts.push({
            x: tile.x, y: tile.y,
            value: dmg, isCrit: true,
            timeLeft: 900, lastUpdate: Date.now()
          });
          if (tile.unit.hp <= 0) {
            helpers.logMessage(`殉道者自爆击杀${tile.unit.camp.name}${tile.unit.config.name}兵（${dmg}伤害）`);
            tile.unit.hp = 0;
            tile.unit = null;
          } else {
            helpers.logMessage(`殉道者自爆对${tile.unit.camp.name}${tile.unit.config.name}兵造成${dmg}伤害`);
          }
        }
      }

      // 殉道者自己死亡
      unit.hp = 0;
      unit.tile.unit = null;
    }
  },

  // 钩子：检查并触发殉道状态
  // 由外部在伤害结算后调用
  checkMartyrState(unit, gameState) {
    if (!unit || unit.commander !== 'martyr' || unit._martyrPrimed) return false;
    if (unit.hp <= 1 && unit.hp > 0) {
      unit._martyrPrimed = true;
      unit.hp = 1;
      unit.canAct = false;
      unit.remainingMP = 0;
      return true;
    }
    return false;
  }
};

// 获取指定范围内的所有tile及距离
function _getTilesInRange(centerTile, tileMap, range) {
  const results = [];
  for (let dq = -range; dq <= range; dq++) {
    for (let dr = Math.max(-range, -dq - range); dr <= Math.min(range, -dq + range); dr++) {
      const tile = tileMap.get(`${centerTile.q + dq},${centerTile.r + dr}`);
      if (tile) {
        const dist = Math.max(Math.abs(dq), Math.abs(dr), Math.abs(dq + dr));
        results.push([tile, dist]);
      }
    }
  }
  return results;
}
