// 停滞者 —— 缚足
const HEX_NEIGHBORS = [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]];

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

export default {
  id: 'staller',
  name: '停滞者',
  skill: '缚足',
  hpBonus: 60, atkBonus: 15, spdBonus: 0,
  desc: '距0/1/2格的地块各具3/2/1层【缚足】，每层额外消耗2行动力 · 免疫炮兵攻击',

  // 返回该地块对friendlyCamp的缚足层数（0=无效果）
  getSnareLayers(tile, friendlyCamp, tileMap) {
    if (!tileMap) return 0;
    let best = 0;
    for (let d = 0; d <= 2; d++) {
      for (const [dq, dr] of RINGS[d]) {
        const nb = tileMap.get(`${tile.q - dq},${tile.r - dr}`);
        if (nb && nb.unit && nb.unit.commander === 'staller' &&
            nb.unit.camp !== friendlyCamp && nb.unit.hp > 0) {
          best = Math.max(best, 3 - d);
        }
      }
      if (best > 0) break; // 最近距离优先
    }
    return best;
  },

  // 兼容旧接口
  isInSnareZone(tile, friendlyCamp, tileMap) {
    return this.getSnareLayers(tile, friendlyCamp, tileMap) > 0;
  }
};
