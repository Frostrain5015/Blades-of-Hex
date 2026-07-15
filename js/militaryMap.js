// “无边军事地图”的纯视觉延伸层。
// 真地块仍由 gameState.tiles / tileMap 唯一管理；本模块只在画布边缘补齐被裁切的
// 六角格，并把最近真地块的阵营色、区划与迷雾状态投影过去。
import { HEX_NEIGHBORS } from '../rules/hex.js';
import { campToKey } from '../rules/camps.js';
import { canonicalHexEdgeKey, isWaterSurface, SURFACE_KIND } from '../rules/surfaces.js';
import { HEX_SIZE, hexEdge, hexPath } from './config.js';
import { axialToBoardPixel, getViewportHexCoordinates } from '../rules/boardLayout.js';

const visualGridCache = new WeakMap();
const boundaryTopologyCache = new WeakMap();

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

function visualSurfaceKind(tile) {
    const surface = tile?.surface;
    const kind = typeof surface === 'string'
        ? surface
        : surface?.kind ?? surface?.type ?? tile?.sourceTile?.surface;
    return isWaterSurface(kind) ? kind : SURFACE_KIND.LAND;
}

function hashText(hash, value) {
    const text = String(value ?? '');
    for (let index = 0; index < text.length; index++) {
        hash ^= text.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
    }
    hash ^= 0xff;
    return Math.imul(hash, 16777619);
}

function boundaryFingerprint(visualGrid) {
    let hash = 2166136261;
    for (const tile of visualGrid?.realTileMap?.values?.() || []) {
        hash = hashText(hash, visualSurfaceKind(tile));
        hash = hashText(hash, campToKey(tile?.camp));
        hash = hashText(hash, tile?.districtId);
    }
    return hash >>> 0;
}

function lineEdge(tile, neighbor, edgeIndex) {
    const point = hexEdge(tile.x, tile.y, HEX_SIZE, edgeIndex);
    return Object.freeze({
        x0: point.x0,
        y0: point.y0,
        x1: point.x1,
        y1: point.y1,
        qa: tile.q,
        ra: tile.r,
        qb: neighbor.q,
        rb: neighbor.r
    });
}

/**
 * Classify every shared edge in the borderless render footprint exactly once.
 * A physical edge can only be coast, faction border, district border, or plain
 * grid; this prevents render-only filler cells from producing overlapping
 * styles and false three-way forks at the viewport boundary.
 */
export function getBorderlessBoundaryTopology(visualGrid) {
    if (!visualGrid?.fillers?.length) return null;
    const fingerprint = boundaryFingerprint(visualGrid);
    const cached = boundaryTopologyCache.get(visualGrid);
    if (cached?.fingerprint === fingerprint) return cached.topology;

    const campEdges = [];
    const districtEdges = [];
    const coastEdges = [];
    const seen = new Set();

    for (const tile of visualGrid.tiles) {
        for (let neighborIndex = 0; neighborIndex < HEX_NEIGHBORS.length; neighborIndex++) {
            const [dq, dr] = HEX_NEIGHBORS[neighborIndex];
            const neighbor = visualGrid.tileMap.get(`${tile.q + dq},${tile.r + dr}`);
            if (!neighbor) continue;
            const key = canonicalHexEdgeKey(tile, neighbor);
            if (!key || seen.has(key)) continue;
            seen.add(key);

            const tileWater = isWaterSurface(visualSurfaceKind(tile));
            const neighborWater = isWaterSurface(visualSurfaceKind(neighbor));
            const tileEdge = (5 - neighborIndex + 6) % 6;

            // Coast owns a land/water edge exclusively; ownership metadata on
            // a visually-water port must never leak through as a faction line.
            if (tileWater !== neighborWater) {
                const land = tileWater ? neighbor : tile;
                const water = tileWater ? tile : neighbor;
                const landEdge = tileWater ? (tileEdge + 3) % 6 : tileEdge;
                coastEdges.push(Object.freeze({
                    key,
                    land: Object.freeze({ q: land.q, r: land.r }),
                    water: Object.freeze({ q: water.q, r: water.r }),
                    landEdge,
                    waterEdge: (landEdge + 3) % 6,
                    waterKind: visualSurfaceKind(water),
                    visualOnly: land.isVisualFiller === true || water.isVisualFiller === true
                }));
                continue;
            }
            if (tileWater) continue;

            const edge = lineEdge(tile, neighbor, tileEdge);
            if (campToKey(tile.camp) !== campToKey(neighbor.camp)) {
                campEdges.push(edge);
            } else if (tile.districtId !== neighbor.districtId) {
                districtEdges.push(edge);
            }
        }
    }

    const topology = Object.freeze({
        campEdges: Object.freeze(campEdges),
        districtEdges: Object.freeze(districtEdges),
        coastEdges: Object.freeze(coastEdges)
    });
    boundaryTopologyCache.set(visualGrid, { fingerprint, topology });
    return topology;
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
