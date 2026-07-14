// Pure, DOM-free authoring helpers for battlefield surfaces and hydrography.
// The editor mutates its level in place, while tests can exercise every rule
// without booting the canvas UI.
import { BOARD_RULES } from '../../rules/constants.js';
import { HEX_NEIGHBORS } from '../../rules/hex.js';
import { axialToBoardPixel, isBoardCoordinatePlayable } from '../../rules/boardLayout.js';
import { canUnitOccupyTile } from '../../rules/movement.js';
import {
    SURFACE_KIND,
    SURFACE_KINDS,
    buildSurfaceMap,
    getSurfaceKindAt,
    hasAdjacentWater,
    isWaterSurface,
    tileCoordinateKey
} from '../../rules/surfaces.js';
import {
    RIVER_CROSSING_KINDS,
    RIVER_WIDTHS,
    areCanonicalRiverVerticesAdjacent,
    canonicalRiverSegmentKey,
    canonicalRiverVertex,
    canonicalRiverVertexKey,
    findRiverPathSelfIntersections
} from '../../rules/hydrography.js';

const SQRT3 = Math.sqrt(3);
const COORDINATE_LISTS = Object.freeze([
    'cities', 'surface', 'terrain', 'villages', 'fortifications', 'districts', 'ports'
]);

function asArray(value) { return Array.isArray(value) ? value : []; }
function sameCoordinate(value, q, r) { return value?.q === q && value?.r === r; }

export function ensureBoardAuthoringModel(board) {
    if (!board || typeof board !== 'object') throw new TypeError('board is required');
    for (const key of [...COORDINATE_LISTS, 'rivers', 'crossings']) {
        if (!Array.isArray(board[key])) board[key] = [];
    }
    return board;
}

export function isEditableBoardCoordinate(board, q, r) {
    return Number.isInteger(q)
        && Number.isInteger(r)
        && isBoardCoordinatePlayable(board, q, r);
}

export function surfaceKindAt(board, q, r) {
    return getSurfaceKindAt(buildSurfaceMap(board?.surface), q, r);
}

function cityCells(city) {
    return [city, ...asArray(city?.footprint)];
}

function isAdjacentToCity(city, q, r) {
    return cityCells(city).some(value => HEX_NEIGHBORS.some(([dq, dr]) => (
        value.q + dq === q && value.r + dr === r
    )));
}

function cityRemainsConnected(city, footprint) {
    const keys = new Set([city, ...footprint].map(tileCoordinateKey));
    const visited = new Set([tileCoordinateKey(city)]);
    const queue = [city];
    while (queue.length) {
        const current = queue.shift();
        for (const [dq, dr] of HEX_NEIGHBORS) {
            const key = `${current.q + dq},${current.r + dr}`;
            if (!keys.has(key) || visited.has(key)) continue;
            visited.add(key);
            queue.push({ q: current.q + dq, r: current.r + dr });
        }
    }
    return visited.size === keys.size;
}

/**
 * Toggle one non-centre cell in a multi-hex city footprint. New cells attach
 * only when exactly one existing city is adjacent, so authors never have to
 * choose from an ambiguous hidden owner and two cities cannot merge by
 * accident. Clicking an existing footprint cell removes it again.
 */
export function toggleCityFootprint(level, q, r) {
    const board = ensureBoardAuthoringModel(level?.board);
    if (!isEditableBoardCoordinate(board, q, r)) {
        return { changed: false, placed: false, error: `地块 (${q},${r}) 不属于可编辑棋盘。` };
    }
    if (isWaterSurface(surfaceKindAt(board, q, r))) {
        return { changed: false, placed: false, error: '城市范围不能覆盖水域。' };
    }

    const existingOwner = board.cities.find(city => asArray(city.footprint)
        .some(value => sameCoordinate(value, q, r)));
    if (existingOwner) {
        const nextFootprint = existingOwner.footprint
            .filter(value => !sameCoordinate(value, q, r));
        if (!cityRemainsConnected(existingOwner, nextFootprint)) {
            return { changed: false, placed: true, error: '不能移除连接城市其他范围的地块；请先从城郭外缘缩减。' };
        }
        existingOwner.footprint = nextFootprint;
        if (!existingOwner.footprint.length) delete existingOwner.footprint;
        return { changed: true, placed: false, city: existingOwner, error: '' };
    }
    if (board.cities.some(city => sameCoordinate(city, q, r))) {
        return { changed: false, placed: false, error: '城市中心不能加入或移出范围；请使用城市画笔处理中心。' };
    }
    if (board.villages.some(village => sameCoordinate(village, q, r))) {
        return { changed: false, placed: false, error: '城市范围不能覆盖村庄；请先移除村庄。' };
    }

    const candidates = board.cities.filter(city => isAdjacentToCity(city, q, r));
    if (candidates.length === 0) {
        return { changed: false, placed: false, error: '城市范围必须紧邻一个现有城市中心或范围地块。' };
    }
    if (candidates.length > 1) {
        return { changed: false, placed: false, error: '该地块同时邻接多个城市，归属不明确；请从其他方向扩展。' };
    }

    const city = candidates[0];
    city.footprint = [...asArray(city.footprint), { q, r }];
    return { changed: true, placed: true, city, error: '' };
}

function removeCoordinate(list, q, r) {
    const source = asArray(list);
    const next = source.filter(value => !sameCoordinate(value, q, r));
    return { next, removed: source.length - next.length };
}

/**
 * Surface edits and board resizes can strand a previously valid port after
 * its last adjacent water cell disappears. Keep authoring state aligned with
 * runtime loading by pruning those ports first, then any unit that can no
 * longer occupy its resulting surface/port tile.
 */
function reconcileSurfaceOccupancy(level, board) {
    const surfaceMap = buildSurfaceMap(board.surface);
    const portKeys = new Set();
    const nextPorts = [];
    let removed = 0;
    for (const port of asArray(board.ports)) {
        const key = tileCoordinateKey(port);
        const valid = isEditableBoardCoordinate(board, port?.q, port?.r)
            && !isWaterSurface(getSurfaceKindAt(surfaceMap, port.q, port.r))
            && hasAdjacentWater(surfaceMap, port.q, port.r)
            && !portKeys.has(key);
        if (!valid) {
            removed++;
            continue;
        }
        portKeys.add(key);
        nextPorts.push(port);
    }
    board.ports = nextPorts;

    if (Array.isArray(level.units)) {
        const nextUnits = level.units.filter(unit => {
            if (!isEditableBoardCoordinate(board, unit?.q, unit?.r)) return false;
            return canUnitOccupyTile(unit, {
                q: unit.q,
                r: unit.r,
                surface: getSurfaceKindAt(surfaceMap, unit.q, unit.r),
                isPort: portKeys.has(tileCoordinateKey(unit)),
                playable: true
            });
        });
        removed += level.units.length - nextUnits.length;
        level.units = nextUnits;
    }
    return removed;
}

/**
 * Apply the land/shallow/deep brush and eagerly remove overlays that cannot
 * legally survive on water. Land remains implicit and is never serialized.
 */
export function applySurfaceBrush(level, q, r, kind) {
    const board = ensureBoardAuthoringModel(level?.board);
    if (!isEditableBoardCoordinate(board, q, r)) {
        return { changed: false, removed: 0, error: `地块 (${q},${r}) 不属于可编辑棋盘。` };
    }
    if (!SURFACE_KINDS.includes(kind)) {
        return { changed: false, removed: 0, error: `未知表面类型「${kind}」。` };
    }

    if (isWaterSurface(kind)) {
        const footprintOwner = board.cities.find(city => asArray(city.footprint)
            .some(value => sameCoordinate(value, q, r)));
        if (footprintOwner) {
            const remaining = footprintOwner.footprint.filter(value => !sameCoordinate(value, q, r));
            if (!cityRemainsConnected(footprintOwner, remaining)) {
                return {
                    changed: false,
                    removed: 0,
                    error: '该地块连接城市的其他范围；请先从城郭外缘缩减，再改为水域。'
                };
            }
        }
    }

    const before = surfaceKindAt(board, q, r);
    board.surface = board.surface.filter(value => !sameCoordinate(value, q, r));
    if (kind !== SURFACE_KIND.LAND) board.surface.push({ q, r, kind });

    let removed = 0;
    if (isWaterSurface(kind)) {
        for (const key of ['cities', 'terrain', 'villages', 'fortifications', 'districts', 'ports']) {
            const result = removeCoordinate(board[key], q, r);
            board[key] = result.next;
            removed += result.removed;
        }
        // A water brush may cut through a multi-cell city without deleting its
        // still-valid centre. Remove only the affected footprint cell.
        for (const city of board.cities) {
            const result = removeCoordinate(city.footprint, q, r);
            if (Array.isArray(city.footprint)) city.footprint = result.next;
            removed += result.removed;
        }
    }
    removed += reconcileSurfaceOccupancy(level, board);

    return { changed: before !== kind || removed > 0, removed, error: '' };
}

export function togglePort(level, q, r) {
    const board = ensureBoardAuthoringModel(level?.board);
    if (!isEditableBoardCoordinate(board, q, r)) {
        return { changed: false, placed: false, error: `地块 (${q},${r}) 不属于可编辑棋盘。` };
    }
    const existingIndex = board.ports.findIndex(value => sameCoordinate(value, q, r));
    if (existingIndex >= 0) {
        const strandedUnit = asArray(level.units).find(unit => sameCoordinate(unit, q, r)
            && !canUnitOccupyTile(unit, { q, r, surface: SURFACE_KIND.LAND, isPort: false, playable: true }));
        if (strandedUnit) {
            return { changed: false, placed: true, error: `请先移走港口上的单位「${strandedUnit.id || strandedUnit.type}」。` };
        }
        board.ports.splice(existingIndex, 1);
        return { changed: true, placed: false, error: '' };
    }
    const surfaceMap = buildSurfaceMap(board.surface);
    if (isWaterSurface(getSurfaceKindAt(surfaceMap, q, r))) {
        return { changed: false, placed: false, error: '港口只能放在陆地格。' };
    }
    if (!hasAdjacentWater(surfaceMap, q, r)) {
        return { changed: false, placed: false, error: '港口必须邻接至少一个实体浅水或深水地块。' };
    }
    board.ports.push({ q, r });
    return { changed: true, placed: true, error: '' };
}

export function riverVertexToPixel(ref, rules = BOARD_RULES) {
    if (!canonicalRiverVertex(ref)) return null;
    const center = axialToBoardPixel(ref.q, ref.r, rules);
    const angle = Math.PI / 3 * (ref.vertex + 0.5);
    return Object.freeze({
        x: center.x + Math.cos(angle) * rules.hexSize,
        y: center.y + Math.sin(angle) * rules.hexSize
    });
}

/** Snap a pointer to the nearest canonical vertex referenced by a real tile. */
export function snapRiverVertex(realTiles, x, y, {
    maxDistance = BOARD_RULES.hexSize * 0.48,
    rules = BOARD_RULES
} = {}) {
    let best = null;
    let bestDistance = Infinity;
    const seenCanonical = new Set();
    for (const tile of realTiles || []) {
        if (!Number.isInteger(tile?.q) || !Number.isInteger(tile?.r)) continue;
        for (let vertex = 0; vertex < 6; vertex++) {
            const ref = { q: tile.q, r: tile.r, vertex };
            const canonicalKey = canonicalRiverVertexKey(ref);
            if (!canonicalKey || seenCanonical.has(canonicalKey)) continue;
            seenCanonical.add(canonicalKey);
            const point = riverVertexToPixel(ref, rules);
            const distance = Math.hypot(point.x - x, point.y - y);
            if (distance < bestDistance) {
                bestDistance = distance;
                best = { ...ref, canonicalKey, x: point.x, y: point.y, distance };
            }
        }
    }
    return best && bestDistance <= maxDistance ? Object.freeze(best) : null;
}

export function appendRiverDraftPoint(points, ref) {
    const source = asArray(points);
    const canonical = canonicalRiverVertex(ref);
    if (!canonical) return { points: source, changed: false, error: '河流顶点引用无效。' };
    if (!source.length) return { points: [{ q: ref.q, r: ref.r, vertex: ref.vertex }], changed: true, error: '' };

    const previous = source[source.length - 1];
    const previousCanonical = canonicalRiverVertex(previous);
    if (previousCanonical?.key === canonical.key) {
        return { points: source, changed: false, error: '' };
    }
    if (!areCanonicalRiverVerticesAdjacent(previousCanonical, canonical)) {
        return { points: source, changed: false, error: '下一点必须与当前河流端点沿六边格边相邻。' };
    }
    if (source.some(point => canonicalRiverVertexKey(point) === canonical.key)) {
        return { points: source, changed: false, error: '河流不能重复经过同一个顶点。' };
    }
    const next = [...source, { q: ref.q, r: ref.r, vertex: ref.vertex }];
    if (findRiverPathSelfIntersections(next).length) {
        return { points: source, changed: false, error: '该河段会让河流自交。' };
    }
    return { points: next, changed: true, error: '' };
}

export function nextRiverId(board, preferred = 'river') {
    const safeBase = String(preferred || 'river').trim().replace(/[^a-z0-9_-]+/gi, '-').replace(/^-+|-+$/g, '') || 'river';
    const base = /^[a-z]/i.test(safeBase) ? safeBase : `river-${safeBase}`;
    const used = new Set(asArray(board?.rivers).map(river => river?.id));
    if (!used.has(base)) return base;
    let suffix = 2;
    while (used.has(`${base}-${suffix}`)) suffix++;
    return `${base}-${suffix}`;
}

export function commitRiverDraft(level, draft) {
    const board = ensureBoardAuthoringModel(level?.board);
    const points = asArray(draft?.points).map(point => ({ q: point.q, r: point.r, vertex: point.vertex }));
    if (points.length < 2) return { changed: false, error: '一条河流至少需要两个顶点。' };
    if (!RIVER_WIDTHS.includes(draft?.width)) return { changed: false, error: '请选择有效的河流宽度。' };
    if (points.some(point => !isEditableBoardCoordinate(board, point.q, point.r))) {
        return { changed: false, error: '河流包含棋盘外或假地块顶点。' };
    }

    const occupiedSegments = new Set();
    for (const river of board.rivers) {
        for (let index = 0; index < asArray(river?.points).length - 1; index++) {
            const key = canonicalRiverSegmentKey(river.points[index], river.points[index + 1]);
            if (key) occupiedSegments.add(key);
        }
    }
    for (let index = 0; index < points.length - 1; index++) {
        const key = canonicalRiverSegmentKey(points[index], points[index + 1]);
        if (occupiedSegments.has(key)) return { changed: false, error: '该河段已经属于另一条河流。' };
    }

    const id = nextRiverId(board, draft?.id || 'river');
    board.rivers.push({
        id,
        width: draft.width,
        points,
        navigable: draft.navigable === true
    });
    return { changed: true, id, error: '' };
}

function pointSegmentDistance(point, from, to) {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const lengthSquared = dx * dx + dy * dy;
    if (lengthSquared <= Number.EPSILON) return Math.hypot(point.x - from.x, point.y - from.y);
    const projection = Math.max(0, Math.min(1,
        ((point.x - from.x) * dx + (point.y - from.y) * dy) / lengthSquared));
    return Math.hypot(point.x - (from.x + projection * dx), point.y - (from.y + projection * dy));
}

/** Crossing tools can only resolve an actual persisted river segment. */
export function hitRiverSegment(board, x, y, {
    maxDistance = BOARD_RULES.hexSize * 0.24,
    rules = BOARD_RULES
} = {}) {
    let best = null;
    for (const river of asArray(board?.rivers)) {
        const points = asArray(river?.points);
        for (let segmentIndex = 0; segmentIndex < points.length - 1; segmentIndex++) {
            const from = riverVertexToPixel(points[segmentIndex], rules);
            const to = riverVertexToPixel(points[segmentIndex + 1], rules);
            if (!from || !to) continue;
            const distance = pointSegmentDistance({ x, y }, from, to);
            if (!best || distance < best.distance) {
                best = { riverId: river.id, segmentIndex, distance, from, to };
            }
        }
    }
    return best && best.distance <= maxDistance ? Object.freeze(best) : null;
}

export function toggleRiverCrossing(level, segment, kind) {
    const board = ensureBoardAuthoringModel(level?.board);
    if (!segment || !board.rivers.some(river => river.id === segment.riverId
        && segment.segmentIndex >= 0 && segment.segmentIndex < river.points.length - 1)) {
        return { changed: false, placed: false, error: '通行点只能放在已有河段上。' };
    }
    if (!RIVER_CROSSING_KINDS.includes(kind)) {
        return { changed: false, placed: false, error: `未知通行点类型「${kind}」。` };
    }
    const index = board.crossings.findIndex(crossing => crossing.riverId === segment.riverId
        && crossing.segmentIndex === segment.segmentIndex);
    if (index >= 0 && board.crossings[index].kind === kind) {
        board.crossings.splice(index, 1);
        return { changed: true, placed: false, error: '' };
    }
    const value = { riverId: segment.riverId, segmentIndex: segment.segmentIndex, kind };
    if (index >= 0) board.crossings[index] = value;
    else board.crossings.push(value);
    return { changed: true, placed: true, error: '' };
}

function uniqueSplitRiverId(baseId, partIndex, used) {
    const preferred = partIndex === 0 ? baseId : `${baseId}-${partIndex + 1}`;
    if (!used.has(preferred)) { used.add(preferred); return preferred; }
    let suffix = partIndex + 2;
    while (used.has(`${baseId}-${suffix}`)) suffix++;
    const result = `${baseId}-${suffix}`;
    used.add(result);
    return result;
}

/**
 * Prune data after a board resize/layout change. Rivers are split into valid
 * contiguous runs; crossings survive only when their original segment survives,
 * and their river id/segment index are remapped to the new run.
 */
export function pruneLevelToBoard(level) {
    const board = ensureBoardAuthoringModel(level?.board);
    const inside = value => isEditableBoardCoordinate(board, value?.q, value?.r);
    let removed = 0;
    let remappedCrossings = 0;

    for (const key of ['cities', 'surface', 'terrain', 'villages', 'fortifications', 'districts', 'ports']) {
        const before = board[key].length;
        board[key] = board[key].filter(inside);
        removed += before - board[key].length;
    }
    for (const city of board.cities) {
        if (!Array.isArray(city.footprint)) continue;
        const before = city.footprint.length;
        city.footprint = city.footprint.filter(inside);
        removed += before - city.footprint.length;
    }
    if (Array.isArray(level.units)) {
        const before = level.units.length;
        level.units = level.units.filter(inside);
        removed += before - level.units.length;
    }
    removed += reconcileSurfaceOccupancy(level, board);

    const previousCrossings = new Map(board.crossings.map(crossing => [
        `${crossing.riverId}:${crossing.segmentIndex}`,
        crossing
    ]));
    const nextRivers = [];
    const nextCrossings = [];
    const usedIds = new Set();

    for (const river of board.rivers) {
        const source = asArray(river?.points);
        const runs = [];
        let run = [];
        for (let pointIndex = 0; pointIndex < source.length; pointIndex++) {
            if (!inside(source[pointIndex])) {
                if (run.length) runs.push(run);
                run = [];
                removed++;
                continue;
            }
            run.push({ point: source[pointIndex], sourceIndex: pointIndex });
        }
        if (run.length) runs.push(run);

        let keptPartIndex = 0;
        for (const candidate of runs) {
            // Defensive split if legacy input already contains a discontinuity.
            let contiguous = [];
            const flush = () => {
                if (contiguous.length < 2) {
                    removed += contiguous.length;
                    contiguous = [];
                    return;
                }
                const id = uniqueSplitRiverId(river.id || 'river', keptPartIndex++, usedIds);
                const points = contiguous.map(item => ({ ...item.point }));
                nextRivers.push({ ...river, id, points });
                for (let index = 0; index < contiguous.length - 1; index++) {
                    const sourceSegmentIndex = contiguous[index].sourceIndex;
                    if (contiguous[index + 1].sourceIndex !== sourceSegmentIndex + 1) continue;
                    const crossing = previousCrossings.get(`${river.id}:${sourceSegmentIndex}`);
                    if (!crossing) continue;
                    nextCrossings.push({ ...crossing, riverId: id, segmentIndex: index });
                    if (crossing.riverId !== id || crossing.segmentIndex !== index) remappedCrossings++;
                }
                contiguous = [];
            };
            for (const item of candidate) {
                if (contiguous.length && !areCanonicalRiverVerticesAdjacent(
                    contiguous[contiguous.length - 1].point,
                    item.point
                )) flush();
                contiguous.push(item);
            }
            flush();
        }
        if (!runs.length) removed += source.length === 0 ? 1 : 0;
    }

    removed += Math.max(0, board.rivers.length - nextRivers.length);
    removed += board.crossings.length - nextCrossings.length;
    board.rivers = nextRivers;
    board.crossings = nextCrossings;

    return { removed: Math.max(0, removed), remappedCrossings };
}
