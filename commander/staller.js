// 停滞者 —— 缚足
const HEX_NEIGHBORS = [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]];

export default {
  id: 'staller',
  name: '停滞者',
  skill: '缚足',
  hpBonus: 15, atkBonus: 5, spdBonus: 0,
  desc: '自身及相邻6格敌军移动消耗+3',

  // 判定某地块对friendlyCamp的友军是否处于缚足区域
  isInSnareZone(tile, friendlyCamp, tileMap) {
    if (tile.unit && tile.unit.commander === 'staller' && tile.unit.camp !== friendlyCamp) return true;
    for (const [dq, dr] of HEX_NEIGHBORS) {
      const nb = tileMap.get(`${tile.q + dq},${tile.r + dr}`);
      if (nb && nb.unit && nb.unit.commander === 'staller' && nb.unit.camp !== friendlyCamp) return true;
    }
    return false;
  },

  getMoveCostModifier(unit, tile) {
    // This is checked per-tile during move cost calculation
    return 3; // additional cost per step
  }
};
