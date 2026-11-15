import { HEX_NEIGHBORS } from '../../rules/hex.js';

// Pointy-top hex vertices, clockwise from the top. The integer lattice
// identifies shared vertices without rounding their projected coordinates.
const VERTICES = [[0, -2], [1, -1], [1, 1], [0, 2], [-1, 1], [-1, -1]];

export function buildHexRegionContours(cells, size) {
    const cellKeys = new Set(cells.map(({ q, r }) => `${q},${r}`));
    const outgoing = new Map();
    const halfWidth = Math.sqrt(3) * size / 2;
    const halfHeight = size / 2;

    for (const { q, r, center } of cells) {
        for (let edge = 0; edge < VERTICES.length; edge++) {
            const [dq, dr] = HEX_NEIGHBORS[(7 - edge) % 6];
            if (cellKeys.has(`${q + dq},${r + dr}`)) continue;
            const [x, y] = VERTICES[edge];
            const [nextX, nextY] = VERTICES[(edge + 1) % 6];
            const column = 2 * q + r;
            const row = 3 * r;
            outgoing.set(`${column + x},${row + y}`, {
                point: { x: center.x + x * halfWidth, y: center.y + y * halfHeight },
                next: `${column + nextX},${row + nextY}`
            });
        }
    }

    const contours = [];
    // At each vertex at most three cells meet. Any boundary therefore has
    // exactly one outgoing edge, including the boundaries of interior holes.
    for (const start of outgoing.keys()) {
        const points = [];
        let key = start;
        while (outgoing.has(key)) {
            const { point, next } = outgoing.get(key);
            points.push(point);
            outgoing.delete(key);
            key = next;
        }
        contours.push(points);
    }
    return contours;
}
