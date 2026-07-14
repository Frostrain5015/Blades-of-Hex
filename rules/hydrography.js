// Exact integer hydrography topology. River vertices are authored relative to
// hexes, but physically coincident references collapse to one canonical key.

export const RIVER_VERTEX_OFFSETS = Object.freeze([
    Object.freeze([1, 1]),
    Object.freeze([0, 2]),
    Object.freeze([-1, 1]),
    Object.freeze([-1, -1]),
    Object.freeze([0, -2]),
    Object.freeze([1, -1])
]);

export const RIVER_WIDTHS = Object.freeze(['stream', 'river']);
export const RIVER_CROSSING_KINDS = Object.freeze(['ford', 'bridge']);

function readVertexArgs(refOrQ, r, vertex) {
    return typeof refOrQ === 'object' && refOrQ !== null
        ? { q: refOrQ.q, r: refOrQ.r, vertex: refOrQ.vertex }
        : { q: refOrQ, r, vertex };
}

/** Return the canonical integer lattice coordinate for one authored ref. */
export function canonicalRiverVertex(refOrQ, r, vertex) {
    const ref = readVertexArgs(refOrQ, r, vertex);
    if (!Number.isInteger(ref.q) || !Number.isInteger(ref.r)
        || !Number.isInteger(ref.vertex) || ref.vertex < 0 || ref.vertex >= RIVER_VERTEX_OFFSETS.length) {
        return null;
    }
    const [dx, dy] = RIVER_VERTEX_OFFSETS[ref.vertex];
    const x = 2 * ref.q + ref.r + dx;
    const y = 3 * ref.r + dy;
    return Object.freeze({ x, y, key: `${x},${y}` });
}

export function canonicalRiverVertexKey(refOrQ, r, vertex) {
    return canonicalRiverVertex(refOrQ, r, vertex)?.key || null;
}

function compareCanonicalVertices(a, b) {
    return a.x - b.x || a.y - b.y;
}

export function canonicalRiverSegmentKey(aRef, bRef) {
    const a = aRef?.key != null && Number.isInteger(aRef.x) && Number.isInteger(aRef.y)
        ? aRef
        : canonicalRiverVertex(aRef);
    const b = bRef?.key != null && Number.isInteger(bRef.x) && Number.isInteger(bRef.y)
        ? bRef
        : canonicalRiverVertex(bRef);
    if (!a || !b) return null;
    const [first, second] = compareCanonicalVertices(a, b) <= 0 ? [a, b] : [b, a];
    return `${first.key}|${second.key}`;
}

/** Two canonical vertices are adjacent iff they form one physical hex edge. */
export function areCanonicalRiverVerticesAdjacent(aRef, bRef) {
    const a = aRef?.key != null && Number.isInteger(aRef.x) && Number.isInteger(aRef.y)
        ? aRef
        : canonicalRiverVertex(aRef);
    const b = bRef?.key != null && Number.isInteger(bRef.x) && Number.isInteger(bRef.y)
        ? bRef
        : canonicalRiverVertex(bRef);
    if (!a || !b) return false;
    const dx = Math.abs(a.x - b.x);
    const dy = Math.abs(a.y - b.y);
    return (dx === 1 && dy === 1) || (dx === 0 && dy === 2);
}

function orientation(a, b, c) {
    return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

function between(a, b, c) {
    return Math.min(a.x, c.x) <= b.x && b.x <= Math.max(a.x, c.x)
        && Math.min(a.y, c.y) <= b.y && b.y <= Math.max(a.y, c.y);
}

/** Exact integer segment intersection, including endpoint and collinear overlap. */
export function canonicalRiverSegmentsIntersect(a, b, c, d) {
    if (![a, b, c, d].every(point => Number.isInteger(point?.x) && Number.isInteger(point?.y))) return false;
    const o1 = orientation(a, b, c);
    const o2 = orientation(a, b, d);
    const o3 = orientation(c, d, a);
    const o4 = orientation(c, d, b);
    if ((o1 > 0 && o2 < 0 || o1 < 0 && o2 > 0)
        && (o3 > 0 && o4 < 0 || o3 < 0 && o4 > 0)) return true;
    if (o1 === 0 && between(a, c, b)) return true;
    if (o2 === 0 && between(a, d, b)) return true;
    if (o3 === 0 && between(c, a, d)) return true;
    if (o4 === 0 && between(c, b, d)) return true;
    return false;
}

/** Return non-consecutive segment pairs that make a path self-intersect. */
export function findRiverPathSelfIntersections(points = []) {
    const canonical = (points || []).map(point => canonicalRiverVertex(point));
    const intersections = [];
    for (let left = 0; left < canonical.length - 1; left++) {
        const a = canonical[left];
        const b = canonical[left + 1];
        if (!a || !b) continue;
        for (let right = left + 2; right < canonical.length - 1; right++) {
            // Consecutive segments share one legal endpoint. Every other contact
            // (including a closed path's first/last point) is an intersection.
            const c = canonical[right];
            const d = canonical[right + 1];
            if (!c || !d) continue;
            if (canonicalRiverSegmentsIntersect(a, b, c, d)) {
                intersections.push(Object.freeze({ leftSegmentIndex: left, rightSegmentIndex: right }));
            }
        }
    }
    return Object.freeze(intersections);
}

/**
 * Resolve authoring specs into canonical runtime graph topology. Invalid input
 * is retained as diagnostics on a segment instead of making the loader throw;
 * validateLevel is responsible for blocking authoring/export.
 */
export function buildRiverTopology(rivers = [], crossings = []) {
    const vertices = new Map();
    const riversById = new Map();
    const segments = [];
    const segmentsByKey = new Map();
    const segmentsByRef = new Map();

    for (const river of rivers || []) {
        const resolvedPoints = [];
        for (const ref of river?.points || []) {
            const canonical = canonicalRiverVertex(ref);
            if (!canonical) {
                resolvedPoints.push(null);
                continue;
            }
            let vertex = vertices.get(canonical.key);
            if (!vertex) {
                vertex = {
                    key: canonical.key,
                    x: canonical.x,
                    y: canonical.y,
                    refs: []
                };
                vertices.set(vertex.key, vertex);
            }
            vertex.refs.push(Object.freeze({ q: ref.q, r: ref.r, vertex: ref.vertex }));
            resolvedPoints.push(vertex);
        }

        const riverSegments = [];
        for (let segmentIndex = 0; segmentIndex < resolvedPoints.length - 1; segmentIndex++) {
            const from = resolvedPoints[segmentIndex];
            const to = resolvedPoints[segmentIndex + 1];
            const key = from && to ? canonicalRiverSegmentKey(from, to) : null;
            const segment = Object.freeze({
                key,
                riverId: river?.id || '',
                segmentIndex,
                width: river?.width || 'stream',
                from,
                to,
                zeroLength: !!from && !!to && from.key === to.key,
                adjacent: areCanonicalRiverVerticesAdjacent(from, to)
            });
            riverSegments.push(segment);
            segments.push(segment);
            segmentsByRef.set(`${segment.riverId}:${segmentIndex}`, segment);
            if (key) {
                const sameEdge = segmentsByKey.get(key) || [];
                sameEdge.push(segment);
                segmentsByKey.set(key, sameEdge);
            }
        }

        riversById.set(river?.id || '', Object.freeze({
            id: river?.id || '',
            width: river?.width || 'stream',
            points: Object.freeze(resolvedPoints),
            segments: Object.freeze(riverSegments)
        }));
    }

    for (const vertex of vertices.values()) Object.freeze(vertex.refs);

    const resolvedCrossings = [];
    const crossingsBySegment = new Map();
    for (const crossing of crossings || []) {
        const refKey = `${crossing?.riverId || ''}:${crossing?.segmentIndex}`;
        const segment = segmentsByRef.get(refKey) || null;
        const resolved = Object.freeze({
            riverId: crossing?.riverId || '',
            segmentIndex: crossing?.segmentIndex,
            kind: crossing?.kind,
            segment
        });
        resolvedCrossings.push(resolved);
        if (segment) {
            const values = crossingsBySegment.get(segment.key) || [];
            values.push(resolved);
            crossingsBySegment.set(segment.key, values);
        }
    }
    for (const values of crossingsBySegment.values()) Object.freeze(values);

    return Object.freeze({
        vertices,
        rivers: riversById,
        segments: Object.freeze(segments),
        segmentsByKey,
        segmentsByRef,
        crossings: Object.freeze(resolvedCrossings),
        crossingsBySegment
    });
}
