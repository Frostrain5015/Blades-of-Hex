// 参数化建图 —— 把 config.board 变成一整套 gameState.tiles（含区划/地形/城市/村庄/工事）。
// 完全确定性：不依赖 RNG，同一份 config 每次生成完全相同的棋盘。
// 这是 gameLogic.initMap 的战役版替身：initMap 写死半径 7 与固定城市表，本函数按配置生成。
import { CAMP } from '../../rules/camps.js';
import { hexDistance } from '../../rules/hex.js';
import { HexTile, computeCampBorders, computeDistrictBorders } from '../../js/HexTile.js';
import { boardContains, BOARD_RADIUS_DEFAULT } from './schema.js';

function campFromKey(key) {
    if (key === 'player1') return CAMP.player1;
    if (key === 'player2') return CAMP.player2;
    if (key === 'player3') return CAMP.player3;
    return CAMP.neutral;
}

/**
 * 依配置构建棋盘，写入 gameState.tiles / tileMap / villageTiles / 边界缓存。
 * @param {object} config  归一化后的 level 配置
 * @param {object} gameState 目标状态对象（就地修改）
 */
export function buildBoardFromConfig(config, gameState) {
    const board = config.board || {};
    const radius = board.radius ?? BOARD_RADIUS_DEFAULT;

    // 1) 生成半径 R 的六边形所有地块。
    const tiles = [];
    for (let q = -radius; q <= radius; q++) {
        for (let r = -radius; r <= radius; r++) {
            if (boardContains(radius, q, r)) tiles.push(new HexTile(q, r));
        }
    }

    // 2) Voronoi：每块归最近城市（决定 districtId 与底色阵营）。
    const cities = board.cities || [];
    for (const tile of tiles) {
        let bestDist = Infinity;
        let best = null;
        for (const city of cities) {
            const d = hexDistance(tile, city);
            if (d < bestDist) { bestDist = d; best = city; }
        }
        if (best) {
            tile.districtId = best.districtId ?? 0;
            const camp = campFromKey(best.camp);
            tile.camp = camp;
            tile.startColor = camp.color;
            tile.targetColor = camp.color;
            tile.currentColor = camp.color;
        }
    }

    // 建立坐标索引（后续覆盖表按坐标定位）。
    const tileMap = new Map();
    for (const tile of tiles) tileMap.set(`${tile.q},${tile.r}`, tile);
    const at = (q, r) => tileMap.get(`${q},${r}`) || null;

    // 3) 地形覆盖。
    for (const entry of (board.terrain || [])) {
        const tile = at(entry.q, entry.r);
        if (tile) tile.terrain = entry.type || 'plains';
    }

    // 4) 行政区覆盖（少数情况下地块归属与 Voronoi 不同）。
    for (const entry of (board.districts || [])) {
        const tile = at(entry.q, entry.r);
        if (tile) tile.districtId = entry.districtId ?? tile.districtId;
    }

    // 5) 阵营覆盖（争夺区：底色阵营独立于行政区归属）。
    for (const entry of (board.camps || [])) {
        const tile = at(entry.q, entry.r);
        if (!tile) continue;
        const camp = campFromKey(entry.camp);
        tile.camp = camp;
        tile.startColor = camp.color;
        tile.targetColor = camp.color;
        tile.currentColor = camp.color;
    }

    // 6) 标记城市。
    for (const city of cities) {
        const tile = at(city.q, city.r);
        if (tile) tile.isCity = true;
    }

    // 7) 村庄（携行政区归属；构建 villageTiles 索引）。
    const villageEntries = [];
    for (const v of (board.villages || [])) {
        const tile = at(v.q, v.r);
        if (!tile || tile.isCity) continue;
        tile.isVillage = true;
        tile.villageDistrictId = v.districtId ?? tile.districtId;
        villageEntries.push([`${v.q},${v.r}`, { districtId: tile.villageDistrictId, q: v.q, r: v.r }]);
    }

    // 8) 工事。
    for (const f of (board.fortifications || [])) {
        const tile = at(f.q, f.r);
        if (tile) tile.fortification = f.type || null;
    }

    // 9) 写回状态并计算边界缓存。
    gameState.tiles = tiles;
    gameState.tileMap = tileMap;
    gameState.villageTiles = new Map(villageEntries);
    gameState.campBorderEdges = computeCampBorders(tiles, tileMap);
    gameState.districtBorderEdges = computeDistrictBorders(tiles, tileMap);

    return tiles;
}
