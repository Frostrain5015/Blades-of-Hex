// 停滞者 —— 迟滞力场（统一被动）
// 2格范围内：
//   1. 敌军移动消耗额外+2/步（缚足）
//   2. 友军单位对远程攻击（炮兵/碉堡/空军）防御力+25%（单层；对空时作为防空层计入，不与力场叠加）
import { COMMANDER_CONFIG } from '../rules/commanders.js';
import { HEX_NEIGHBORS } from '../rules/hex.js';
import { areCommanderMechanicsSuppressed } from '../rules/movement.js';

const RANGE2 = (() => {
    const set = new Set(HEX_NEIGHBORS.map(([q, r]) => `${q},${r}`));
    for (const [q1, r1] of HEX_NEIGHBORS) {
        for (const [q2, r2] of HEX_NEIGHBORS) {
            const q = q1 + q2, r = r1 + r2;
            if (q === 0 && r === 0) continue;
            set.add(`${q},${r}`);
        }
    }
    return Array.from(set).map(s => s.split(',').map(Number));
})();

// 距离环：[0]=自身, [1]=相邻6格, [2]=距离2共12格
const RINGS = [[[0, 0]], HEX_NEIGHBORS, RANGE2];
const { definition: DEFINITION, balance: BALANCE } = COMMANDER_CONFIG.staller;

export default {
  ...DEFINITION,

  // ── 缚足：返回该地块对 friendlyCamp 的束缚层数（0=无效果） ──
  getSnareLayers(tile, friendlyCamp, tileMap) {
    if (!tileMap) return 0;
    let best = 0;
    for (let d = 0; d <= BALANCE.range; d++) {
      for (const [dq, dr] of RINGS[d]) {
        const nb = tileMap.get(`${tile.q - dq},${tile.r - dr}`);
        if (nb && nb.unit && nb.unit.commander === 'staller' && !areCommanderMechanicsSuppressed(nb.unit) &&
            nb.unit.camp !== friendlyCamp && nb.unit.hp > 0) {
          best = Math.max(best, BALANCE.range + 1 - d);
        }
      }
      if (best > 0) break;
    }
    return best;
  },

  isInSnareZone(tile, friendlyCamp, tileMap) {
    return this.getSnareLayers(tile, friendlyCamp, tileMap) > 0;
  },

  // ── 射程压制：检查远程单位是否被2格内敌方停滞者压制 ──
  getRangeReduction(tile, tileMap) {
    if (!tile || !tile.unit || !tileMap) return 0;
    const unit = tile.unit;
    if (unit.type !== 'archer' && unit.type !== 'mgNest') return 0;
    for (let d = 1; d <= BALANCE.range; d++) {
      for (const [dq, dr] of RINGS[d]) {
        const nb = tileMap.get(`${tile.q + dq},${tile.r + dr}`);
        if (nb && nb.unit && nb.unit.commander === 'staller' && !areCommanderMechanicsSuppressed(nb.unit) &&
            nb.unit.camp !== unit.camp && nb.unit.hp > 0) {
          return BALANCE.rangeReduction;
        }
      }
    }
    return 0;
  },

  // ── 力场防御：检查友军是否在2格内己方停滞者力场中（对远程攻击+25%防御） ──
  isInField(tile, friendlyCamp, tileMap) {
    if (!tile || !tileMap) return false;
    for (let d = 0; d <= BALANCE.range; d++) {
      for (const [dq, dr] of RINGS[d]) {
        const nb = tileMap.get(`${tile.q + dq},${tile.r + dr}`);
        if (nb && nb.unit && nb.unit.commander === 'staller' && !areCommanderMechanicsSuppressed(nb.unit) &&
            nb.unit.camp === friendlyCamp && nb.unit.hp > 0) {
          return true;
        }
      }
    }
    return false;
  }
};
