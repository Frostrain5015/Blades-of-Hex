// “无边军事地图”的纯视觉延伸层。
// 真地块仍由 gameState.tiles / tileMap 唯一管理；本模块只在画布边缘补齐被裁切的
// 六角格，并把最近真地块的阵营色、区划与迷雾状态投影过去。
import { HEX_SIZE, hexPath } from './config.js';
import { axialToBoardPixel, getViewportHexCoordinates } from '../rules/boardLayout.js';

const visualGridCache = new WeakMap();

function nearestRealTile(q, r, realTiles) {
    const point = axialToBoardPixel(q, r);
    let bestTile = null;
    let bestDistance = Infinity;
    for (const tile of realTiles) {
        const dx = tile.x - point.x;
        const dy = tile.y - point.y;
        const distance = dx * dx + dy * dy;
        if (distance < bestDistance) {
            bestDistance = distance;
            bestTile = tile;
        }
    }
    return bestTile;
}

function createVisualFiller(q, r, sourceTile, index) {
    const { x, y } = axialToBoardPixel(q, r);
    return Object.freeze({
        id: Number.MIN_SAFE_INTEGER + index,
        q,
        r,
        s: -q - r,
        x,
        y,
        isVisualFiller: true,
        // These cells exist exclusively in the render footprint.  Explicit
        // flags keep every topology/cache consumer from accidentally treating
        // a filler as playable data.
        renderOnly: true,
        playable: false,
        sourceTile,
        get camp() { return sourceTile.camp; },
        get districtId() { return sourceTile.districtId; },
        get surface() { return sourceTile.surface; },
        get currentColor() { return sourceTile.currentColor; }
    });
}

/**
 * 返回供绘制边缘假地块和连续边界使用的视觉网格。
 * fillers 永远不会写入真实 tileMap，因此输入、寻路、触发器与序列化均看不到它们。
 */
export function getBorderlessVisualGrid(realTiles, realTileMap) {
    const cached = visualGridCache.get(realTiles);
    if (cached?.realTileMap === realTileMap) return cached;

    const fillers = [];
    for (const { q, r } of getViewportHexCoordinates({ includePartial: true })) {
        if (realTileMap.has(`${q},${r}`)) continue;
        const sourceTile = nearestRealTile(q, r, realTiles);
        if (!sourceTile) continue;
        fillers.push(createVisualFiller(q, r, sourceTile, fillers.length));
    }

    const tiles = [...realTiles, ...fillers];
    const tileMap = new Map(realTileMap);
    for (const tile of fillers) tileMap.set(`${tile.q},${tile.r}`, tile);
    const grid = Object.freeze({ realTileMap, tiles, tileMap, fillers });
    visualGridCache.set(realTiles, grid);
    return grid;
}

/** 只画连续的阵营底色，不画单格阴影、地形、城镇、工事、单位或交互覆盖层。 */
export function drawVisualFillerTile(context, tile) {
    context.save();
    hexPath(context, tile.x, tile.y, HEX_SIZE);
    context.fillStyle = tile.currentColor;
    context.fill();
    context.restore();
}

export function drawVisualFillerTiles(context, fillers) {
    for (const tile of fillers) drawVisualFillerTile(context, tile);
}
