// 棋盘布局的纯几何规则。运行时、编辑器与 JSON 校验必须共同使用本模块，
// 避免“编辑器看得到、运行时却越界”或反向的不一致。
import { BOARD_RULES } from './constants.js';

export const BOARD_LAYOUT = Object.freeze({
    HEX: 'hex',
    BORDERLESS: 'borderless'
});

export const BOARD_LAYOUT_KEYS = Object.freeze(Object.values(BOARD_LAYOUT));

const SQRT3 = Math.sqrt(3);
const EPSILON = 1e-7;
const viewportCoordinateCache = new Map();

export function normalizeBoardLayout(layout) {
    return BOARD_LAYOUT_KEYS.includes(layout) ? layout : BOARD_LAYOUT.HEX;
}

export function axialToBoardPixel(q, r, rules = BOARD_RULES) {
    const hexWidth = SQRT3 * rules.hexSize;
    return {
        x: rules.logicalWidth / 2 + hexWidth * (q + r * 0.5),
        y: rules.logicalHeight / 2 + (3 / 2 * rules.hexSize) * r
    };
}

export function isBoardHexFullyVisible(q, r, rules = BOARD_RULES) {
    const { x, y } = axialToBoardPixel(q, r, rules);
    const halfWidth = SQRT3 * rules.hexSize / 2;
    return x - halfWidth >= -EPSILON
        && x + halfWidth <= rules.logicalWidth + EPSILON
        && y - rules.hexSize >= -EPSILON
        && y + rules.hexSize <= rules.logicalHeight + EPSILON;
}

export function doesBoardHexIntersectViewport(q, r, rules = BOARD_RULES) {
    const { x, y } = axialToBoardPixel(q, r, rules);
    const halfWidth = SQRT3 * rules.hexSize / 2;
    return x + halfWidth > EPSILON
        && x - halfWidth < rules.logicalWidth - EPSILON
        && y + rules.hexSize > EPSILON
        && y - rules.hexSize < rules.logicalHeight - EPSILON;
}

function viewportCacheKey(rules, includePartial) {
    return [rules.hexSize, rules.logicalWidth, rules.logicalHeight, includePartial ? 1 : 0].join(':');
}

/** 返回按 r、q 排序的画布六角格。includePartial=false 时仅含完整可见真地块。 */
export function getViewportHexCoordinates({ includePartial = false, rules = BOARD_RULES } = {}) {
    const cacheKey = viewportCacheKey(rules, includePartial);
    if (viewportCoordinateCache.has(cacheKey)) return viewportCoordinateCache.get(cacheKey);

    const size = rules.hexSize;
    const halfWidth = SQRT3 * size / 2;
    const hexWidth = SQRT3 * size;
    const rowStep = 1.5 * size;
    const minR = Math.floor((-size - rules.logicalHeight / 2) / rowStep) - 1;
    const maxR = Math.ceil((rules.logicalHeight + size - rules.logicalHeight / 2) / rowStep) + 1;
    const coordinates = [];

    for (let r = minR; r <= maxR; r++) {
        const minQ = Math.floor((-halfWidth - rules.logicalWidth / 2) / hexWidth - r * 0.5) - 1;
        const maxQ = Math.ceil((rules.logicalWidth + halfWidth - rules.logicalWidth / 2) / hexWidth - r * 0.5) + 1;
        for (let q = minQ; q <= maxQ; q++) {
            const visible = includePartial
                ? doesBoardHexIntersectViewport(q, r, rules)
                : isBoardHexFullyVisible(q, r, rules);
            if (visible) coordinates.push(Object.freeze({ q, r }));
        }
    }

    const frozen = Object.freeze(coordinates);
    viewportCoordinateCache.set(cacheKey, frozen);
    return frozen;
}

export function isBoardCoordinatePlayable(board, q, r, rules = BOARD_RULES) {
    if (normalizeBoardLayout(board?.layout) === BOARD_LAYOUT.BORDERLESS) {
        return isBoardHexFullyVisible(q, r, rules);
    }
    const radius = Number.isFinite(board?.radius) ? board.radius : 0;
    return Math.max(Math.abs(q), Math.abs(r), Math.abs(q + r)) <= radius;
}

export function getPlayableBoardCoordinates(board, rules = BOARD_RULES) {
    if (normalizeBoardLayout(board?.layout) === BOARD_LAYOUT.BORDERLESS) {
        return getViewportHexCoordinates({ rules });
    }
    const radius = Number.isFinite(board?.radius) ? board.radius : 0;
    const coordinates = [];
    for (let q = -radius; q <= radius; q++) {
        for (let r = -radius; r <= radius; r++) {
            if (Math.max(Math.abs(q), Math.abs(r), Math.abs(q + r)) <= radius) coordinates.push({ q, r });
        }
    }
    return coordinates;
}
