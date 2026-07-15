import { HEX_NEIGHBORS } from './hex.js';

const SQRT3 = Math.sqrt(3);

function axialPoint(q, r) {
    return { x: SQRT3 * (q + r / 2), y: 1.5 * r };
}

/**
 * Choose the adjacent land cell that a port's quay visually connects to.
 * The choice is projection-independent and shared by authoring and rendering,
 * so administrative ownership can never disagree with the drawn gangway.
 */
export function resolvePortLandAnchor(port, getTile, isWater) {
    if (!port || typeof getTile !== 'function' || typeof isWater !== 'function') return null;
    const origin = axialPoint(port.q, port.r);
    const land = [];
    let seaX = 0;
    let seaY = 0;
    for (const [dq, dr] of HEX_NEIGHBORS) {
        const tile = getTile(port.q + dq, port.r + dr);
        if (!tile) continue;
        const point = axialPoint(tile.q, tile.r);
        if (isWater(tile)) {
            seaX += point.x - origin.x;
            seaY += point.y - origin.y;
        } else {
            land.push(tile);
        }
    }
    if (!land.length) return null;
    const seaLength = Math.hypot(seaX, seaY);
    if (seaLength < 0.001) return land[0];
    seaX /= seaLength;
    seaY /= seaLength;
    let best = land[0];
    let bestScore = Infinity;
    for (const tile of land) {
        const point = axialPoint(tile.q, tile.r);
        const dx = point.x - origin.x;
        const dy = point.y - origin.y;
        const length = Math.hypot(dx, dy) || 1;
        const score = dx / length * seaX + dy / length * seaY;
        if (score < bestScore) {
            best = tile;
            bestScore = score;
        }
    }
    return best;
}
