// 铁卫 —— 守护
import { HEX_SIZE } from '../js/config.js';

export default {
  id: 'ironGuard',
  name: '铁卫',
  hpBonusPct: 0.30, spdBonus: 0,
  tooltipDesc: '部署时获得永久护盾（每回合回复40点，上限120）；自身及相邻友军获得【守护灵光】',
  skills: [
      { name: '守护', desc: '部署时获得120点永久护盾，每回合回复40点（上限120）', type: 'passive' },
      { name: '守护灵光', desc: '防御力+10%，所受伤害转由铁卫护盾承担', type: 'passive' }
  ],

  onDeploy(unit, gameState, helpers) {
    unit._shield = 120;
    unit._shieldMax = 120;
    unit._shieldTurns = 999;
  },

  onTurnStart(gameState, camp, helpers) {
    const { logMessage } = helpers;
    for (const tile of gameState.tiles) {
      if (!tile.unit) continue;
      const u = tile.unit;
      if (u.commander === 'ironGuard' && u.camp === camp) {
        if (u._shield < 120) {
          const oldShield = u._shield;
          u._shield = Math.min(120, u._shield + 40);
          u._shieldMax = 120;
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
    return 0.10;
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
