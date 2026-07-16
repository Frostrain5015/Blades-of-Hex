// 参数化建图 —— 把 config.board 变成一整套 gameState.tiles（含区划/地形/城市/村庄/工事）。
// 完全确定性：不依赖 RNG，同一份 config 每次生成完全相同的棋盘。
// 这是 gameLogic.initMap 的战役版替身：initMap 写死半径 7 与固定城市表，本函数按配置生成。
import { campFromKey, createDefaultFactions } from '../../rules/diplomacy.js';
import { hexDistance } from '../../rules/hex.js';
import { getPlayableBoardCoordinates, normalizeBoardLayout } from '../../rules/boardLayout.js';
import {
    buildCoastTopology, buildSurfaceMap, getSurfaceBaseColor, getSurfaceKindAt,
    isLandTile, isWaterTile, tileCoordinateKey
} from '../../rules/surfaces.js';
import { buildRiverTopology } from '../../rules/hydrography.js';
import { resolvePortLandAnchor } from '../../rules/ports.js';
import { HexTile, computeCampBorders, computeDistrictBorders } from '../../js/HexTile.js';

/**
 * 依配置构建棋盘，写入 gameState.tiles / tileMap / villageTiles / 边界缓存。
 * @param {object} config  归一化后的 level 配置
 * @param {object} gameState 目标状态对象（就地修改）
 */
export function buildBoardFromConfig(config, gameState) {
    const board = config.board || {};
    const layout = normalizeBoardLayout(board.layout);
    const factions = gameState.factions && Object.keys(gameState.factions).length
        ? gameState.factions
        : createDefaultFactions(config.factions || []);
    const campFor = (key) => campFromKey(key, { factions });

    // 1) 经典布局生成半径 R 的六边形；无边布局生成画布内完整可见的真地块。
    // 画布边缘被裁切的假地块属于纯渲染层，绝不进入 tiles / tileMap。
    const tiles = getPlayableBoardCoordinates({ ...board, layout })
        .map(({ q, r }) => new HexTile(q, r));

    // 建立坐标索引（后续所有稀疏表仅能命中真实地块）。
    const tileMap = new Map();
    for (const tile of tiles) tileMap.set(tileCoordinateKey(tile), tile);
    const at = (q, r) => tileMap.get(tileCoordinateKey(q, r)) || null;

    // 2) 表面先于阵营、区划和地物落位。旧地图没有 surface 时全部
    // 自然归一化为 land；水域使用材质色且永远不带 camp。
    const authoredSurfaceMap = buildSurfaceMap(board.surface || []);
    for (const tile of tiles) {
        tile.surface = getSurfaceKindAt(authoredSurfaceMap, tile.q, tile.r);
        if (!isWaterTile(tile)) continue;
        tile.camp = null;
        tile.districtId = null;
        const waterColor = getSurfaceBaseColor(tile.surface);
        tile.startColor = waterColor;
        tile.targetColor = waterColor;
        tile.currentColor = waterColor;
    }
    const surfaceMap = new Map(tiles.filter(isWaterTile).map(tile => [tileCoordinateKey(tile), tile.surface]));

    // 3) Voronoi：每块陆地归最近的合法城市中心，决定 districtId。
    const cities = board.cities || [];
    const landCities = cities.filter(city => {
        const centre = at(city?.q, city?.r);
        return centre && isLandTile(centre);
    });
    for (const tile of tiles) {
        if (!isLandTile(tile)) continue;
        let bestDist = Infinity;
        let best = null;
        for (const city of landCities) {
            const d = hexDistance(tile, { q: city.q, r: city.r, s: -city.q - city.r });
            if (d < bestDist) { bestDist = d; best = city; }
        }
        if (best) tile.districtId = best.districtId ?? 0;
    }

    // 4) 陆地地形覆盖。
    for (const entry of (board.terrain || [])) {
        const tile = at(entry.q, entry.r);
        if (tile && isLandTile(tile)) tile.terrain = entry.type || 'plains';
    }

    // 5) 行政区范围覆盖；水格没有 districtId。
    for (const entry of (board.districts || [])) {
        const tile = at(entry.q, entry.r);
        if (tile && isLandTile(tile)) tile.districtId = entry.districtId ?? tile.districtId;
    }

    // 6) 阵营派生：与游戏内 updateDistrictColor 同一条规则——阵营从来不是逐格独立属性，
    // 而是由该区划的颜色来源（城市）单向决定。districtId 已在上面定稿，这里统一回填。
    // 若某 districtId 没有城市（无颜色来源），落回中立（编辑器会在校验中提示）。
    const districtCampMap = new Map();
    for (const city of landCities) districtCampMap.set(city.districtId, campFor(city.camp));
    for (const tile of tiles) {
        if (!isLandTile(tile)) continue;
        const camp = districtCampMap.get(tile.districtId) || campFor('neutral');
        tile.camp = camp;
        tile.startColor = camp.color;
        tile.targetColor = camp.color;
        tile.currentColor = camp.color;
    }

    // 7) 标记城市中心与多格 footprint。中心仍是唯一 isCity；城郭范围
    // 只设置 isUrban，以兼容所有依赖单格城市中心的旧规则。
    for (const city of landCities) {
        const centre = at(city.q, city.r);
        const centreKey = tileCoordinateKey(city.q, city.r);
        centre.isCity = true;
        const footprint = [{ q: city.q, r: city.r }, ...(Array.isArray(city.footprint) ? city.footprint : [])];
        const seen = new Set();
        for (const point of footprint) {
            const key = tileCoordinateKey(point?.q, point?.r);
            if (seen.has(key)) continue;
            seen.add(key);
            const tile = at(point?.q, point?.r);
            if (!tile || !isLandTile(tile)) continue;
            tile.isUrban = true;
            tile.urbanCenterKey = centreKey;
        }
    }

    // 8) 村庄（携行政区归属；构建 villageTiles 索引）。
    const villageEntries = [];
    for (const v of (board.villages || [])) {
        const tile = at(v.q, v.r);
        if (!tile || !isLandTile(tile) || tile.isUrban) continue;
        tile.isVillage = true;
        tile.villageDistrictId = v.districtId ?? tile.districtId;
        villageEntries.push([`${v.q},${v.r}`, { districtId: tile.villageDistrictId, q: v.q, r: v.r }]);
    }

    // 9) 工事。无论输入是否先经过校验，水格都不会落入工事状态。
    for (const f of (board.fortifications || [])) {
        const tile = at(f.q, f.r);
        if (tile && isLandTile(tile)) {
            tile.fortification = f.type || null;
            tile.fieldFortification = f.type ? {
                type: f.type,
                campKey: f.campKey || f.camp || tile.camp?.id || null,
                ownerKnown: !!(f.campKey || f.camp || tile.camp?.id)
            } : null;
        }
    }

    for (const installation of (board.installations || [])) {
        const tile = at(installation.q, installation.r);
        if (!tile?.isCity || !installation.type) continue;
        tile.installation = {
            type: installation.type,
            campKey: installation.campKey || installation.camp || tile.camp?.id || null,
            status: installation.status || 'ready',
            turnsRemaining: Math.max(0, Number(installation.turnsRemaining) || 0),
            constructionReadyRound: Number.isFinite(installation.constructionReadyRound)
                ? installation.constructionReadyRound
                : undefined,
            airCommandUsedThisTurn: false,
            airCommandReadyRound: { ...(installation.airCommandReadyRound || {}) },
            cooldowns: { ...(installation.cooldowns || {}) }
        };
    }

    // 10) 港口是独立的受控浅水格，通过 districtId 跟随所属行政区变色。
    const ports = [];
    const portTiles = new Map();
    for (const port of (board.ports || [])) {
        const tile = at(port?.q, port?.r);
        if (!tile || !isWaterTile(tile)) continue;
        const key = tileCoordinateKey(tile);
        if (portTiles.has(key)) continue;
        const authoredAnchor = at(port.landQ, port.landR);
        const landAnchor = authoredAnchor && isLandTile(authoredAnchor)
            ? authoredAnchor
            : resolvePortLandAnchor(tile, at, isWaterTile);
        if (!landAnchor) continue;
        tile.isPort = true;
        tile.surface = 'shallowWater';
        tile.districtId = landAnchor.districtId ?? null;
        tile.camp = districtCampMap.get(tile.districtId) || campFor('neutral');
        const waterColor = getSurfaceBaseColor(tile.surface);
        tile.startColor = waterColor;
        tile.targetColor = waterColor;
        tile.currentColor = waterColor;
        const value = Object.freeze({
            q: tile.q, r: tile.r, districtId: tile.districtId,
            landQ: landAnchor.q, landR: landAnchor.r
        });
        ports.push(value);
        portTiles.set(key, tile);
    }

    // 11) 河网使用 canonical integer topology；地图加载不因坏输入抛错，
    // 导出/运行前的 validateLevel 会把非法河段作为阻断错误报告。
    const rivers = (board.rivers || []).map(river => ({
        ...river,
        points: (river?.points || []).map(point => ({ ...point }))
    }));
    const riverCrossings = (board.crossings || []).map(crossing => ({ ...crossing }));
    const riverTopology = buildRiverTopology(rivers, riverCrossings);

    // 12) 写回状态并计算派生拓扑/边界缓存。国界和区划只消费
    // 陆地子图；海岸只消费真实陆水邻边，因此不会在棋盘边缘造假边界。
    gameState.tiles = tiles;
    gameState.tileMap = tileMap;
    gameState.boardLayout = layout;
    gameState.villageTiles = new Map(villageEntries);
    gameState.surfaceMap = surfaceMap;
    gameState.coastEdges = buildCoastTopology(tiles, tileMap);
    gameState.rivers = rivers;
    gameState.riverCrossings = riverCrossings;
    gameState.riverTopology = riverTopology;
    gameState.ports = ports;
    gameState.portTiles = portTiles;
    const landTiles = tiles.filter(isLandTile);
    const landTileMap = new Map(landTiles.map(tile => [tileCoordinateKey(tile), tile]));
    gameState.campBorderEdges = computeCampBorders(landTiles, landTileMap);
    gameState.districtBorderEdges = computeDistrictBorders(landTiles, landTileMap);

    return tiles;
}
