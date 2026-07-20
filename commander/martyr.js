// 殉道者 —— 殉道 + 挽歌
import { COMMANDER_CONFIG } from '../rules/commanders.js';

const { definition: DEFINITION, balance: BALANCE } = COMMANDER_CONFIG.martyr;

export default {
  ...DEFINITION,

  onTurnStart(gameState, camp, helpers) {
    const unit = helpers.findCommanderUnit(camp, 'martyr');
    if (!unit || !unit.tile || unit.hp <= 0) return;

    // ── 挽歌被动：己方单位阵亡 → 永久+5%伤害（上限8层=40%） ──
    const campKey = helpers.campKey || 'player1';
    const deathCount = (gameState._friendlyDeathCount && gameState._friendlyDeathCount[campKey]) || 0;
    const alreadyProcessed = unit._elegyProcessed || 0;
    const newDeaths = deathCount - alreadyProcessed;
    if (newDeaths > 0) {
      const currentBonus = unit._elegyBonus || 0;
      const elegyDamageCap = Math.round((BALANCE.elegyDamageCap || 0.40) * 100);
      const addedBonus = Math.min(elegyDamageCap - currentBonus, newDeaths * Math.round((BALANCE.elegyDamagePerDeath || 0.05) * 100));
      if (addedBonus > 0) {
        unit._elegyBonus = currentBonus + addedBonus;
        helpers.spawnFx(unit.tile.x, unit.tile.y, '🎵', '挽歌');
        helpers.logMessage(`殉道者【挽歌】：${newDeaths}名友军阵亡 → 伤害+${addedBonus}% 累计+${unit._elegyBonus}%/${elegyDamageCap}%`);
      }
      unit._elegyProcessed = deathCount;
    }

    // ── 殉道引爆 ──
    if (unit._martyrPrimed) {
      const x = unit.tile.x, y = unit.tile.y;
      helpers.spawnExplosion(x, y, '#ff4400', 45);
      helpers.spawnExplosion(x, y, '#ffaa00', 30);
      helpers.spawnExplosion(x, y, '#ffff00', 15);
      helpers.spawnFx(x, y, '💥');
      helpers.playSound?.('explosion');

      helpers.logMessage(`殉道者【${unit.config.name}兵】殉道牺牲，造成范围伤害！`);

      const tileMap = gameState.tileMap;
      let killedCommander = false;
      if (tileMap) {
        if (!gameState.damageTexts) gameState.damageTexts = [];
        for (const [tile, dist] of _getTilesInRange(unit.tile, tileMap, BALANCE.explosionRange)) {
          if (!tile.unit || tile.unit.camp === unit.camp || tile.unit.hp <= 0) continue;
          const dmgMult = dist === 0 ? BALANCE.centerMultiplier : dist === 1 ? BALANCE.adjacentMultiplier : BALANCE.outerMultiplier;
          // 殉道自爆走完整四乘区（baseMulti 体现距离衰减），受目标防御/克制/暴击等影响
          const result = unit._resolveDamage(unit, tile.unit, dmgMult, 0, false, false, false);
          const dmg = Math.round(result.dmg);
          const victim = tile.unit;
          const killed = victim.applyDamage(dmg, { source: 'ranged', attacker: unit });
          gameState.damageTexts.push({
            x: tile.x, y: tile.y,
            value: dmg, isCrit: result.isCrit,
            timeLeft: 900, lastUpdate: performance.now()
          });
          if (killed) {
            helpers.logMessage(`殉道者自爆击杀${victim.camp.name}${victim.config.name}兵 ${dmg}伤害`);
            if (victim.isCommanderUnit ?? Boolean(victim.commander)) killedCommander = true;
          } else {
            helpers.logMessage(`殉道者自爆对${victim.camp.name}${victim.config.name}兵造成${dmg}伤害`);
          }
        }
      }

      // 自爆击杀敌方将领 → 殉道者阵营全军士气+1
      if (killedCommander) {
        for (const tile of gameState.tiles) {
          const u = tile.unit;
          if (u && u.camp === unit.camp && u.morale !== 0 && u.morale < 3) {
            const oldM = u.morale;
            u.morale = Math.min(3, u.morale + 1);
            // 士气上升持续2回合（moraleBoostUntil 为回合数, 0-indexed）
            if (u.morale === 3) u.moraleBoostUntil = Math.floor(gameState.turnCounter / (gameState.isThreePlayer ? 4 : 3)) + BALANCE.moraleBoostRounds;
            if (u.morale !== oldM) {
              helpers.spawnMoraleEffect(u);
            }
          }
        }
        helpers.logMessage(`⚔ ${unit.camp.name}殉道者自爆斩杀敌方将领，全军士气+1！`);
      }

      // 殉道者自毁（不归属击杀）
      unit.destroy(null);
    }
  },

  checkMartyrState(unit, gameState) {
    if (!unit || unit.commander !== 'martyr' || unit._martyrPrimed) return false;
    if (unit.hp <= BALANCE.triggerHp && unit.hp > 0) {
      unit._martyrPrimed = true;
      unit.hp = BALANCE.triggerHp;
      // 不重置 canAct 和 remainingMP —— 允许移动但禁止攻击（由 getAttackableTiles 拦截）
      return true;
    }
    return false;
  },

  getDamageBonusPct(unit) {
    return (unit._elegyBonus || 0) / 100;
  }
};

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
