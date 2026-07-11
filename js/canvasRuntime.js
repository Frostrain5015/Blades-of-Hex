// Browser-only Canvas ownership. Rules and engine modules must not import this file.
import { BOARD_RULES } from '../rules/constants.js';

export const HEX_SIZE = BOARD_RULES.hexSize;
export const LOGICAL_W = BOARD_RULES.logicalWidth;
export const LOGICAL_H = BOARD_RULES.logicalHeight;

export const canvas = document.getElementById('gameCanvas');
export const ctx = canvas.getContext('2d');
export const cardCanvas = document.getElementById('cardCanvas');
export const cardCtx = cardCanvas ? cardCanvas.getContext('2d') : null;

let dpr = 1;
export let HEX_WIDTH;

export function initCanvas() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = LOGICAL_W * dpr;
    canvas.height = LOGICAL_H * dpr;
    canvas.style.width = `${LOGICAL_W}px`;
    canvas.style.height = `${LOGICAL_H}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    HEX_WIDTH = Math.sqrt(3) * HEX_SIZE;
}

export let boardDirty = true;
export function invalidateBoard() { boardDirty = true; }
export const frameInfo = { now: performance.now() };

export function hexToRgb(hex) {
    const shorthand = /^#?([a-f\d])([a-f\d])([a-f\d])$/i;
    const expanded = hex.replace(shorthand, (match, red, green, blue) => red + red + green + green + blue + blue);
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(expanded);
    return result
        ? { r: parseInt(result[1], 16), g: parseInt(result[2], 16), b: parseInt(result[3], 16) }
        : { r: 0, g: 0, b: 0 };
}

export function rgbToHex(red, green, blue) {
    return `#${((1 << 24) + (red << 16) + (green << 8) + blue).toString(16).slice(1)}`;
}

const HEX_VERTICES = Array.from({ length: 6 }, (_, index) => {
    const angle = Math.PI / 3 * (index + 0.5);
    return { x: Math.cos(angle), y: Math.sin(angle) };
});

export function hexPath(ctx2d, cx, cy, size) {
    ctx2d.beginPath();
    ctx2d.moveTo(cx + HEX_VERTICES[0].x * size, cy + HEX_VERTICES[0].y * size);
    for (let index = 1; index < 6; index++) {
        ctx2d.lineTo(cx + HEX_VERTICES[index].x * size, cy + HEX_VERTICES[index].y * size);
    }
    ctx2d.closePath();
}

export function hexEdge(cx, cy, size, edgeIndex) {
    const first = HEX_VERTICES[edgeIndex];
    const second = HEX_VERTICES[(edgeIndex + 1) % 6];
    return {
        x0: cx + first.x * size,
        y0: cy + first.y * size,
        x1: cx + second.x * size,
        y1: cy + second.y * size
    };
}

export function drawHexagonOutline(ctx2d, centerX, centerY, size, strokeStyle, lineWidth) {
    hexPath(ctx2d, centerX, centerY, size);
    ctx2d.strokeStyle = strokeStyle;
    ctx2d.lineWidth = lineWidth;
    ctx2d.stroke();
}

export function pulseSine(time, frequency = 0.0025) {
    return (Math.sin(time * frequency) + 1) / 2;
}

export function roundRectPath(ctx2d, x, y, width, height, radius) {
    ctx2d.beginPath();
    ctx2d.moveTo(x + radius, y);
    ctx2d.lineTo(x + width - radius, y);
    ctx2d.quadraticCurveTo(x + width, y, x + width, y + radius);
    ctx2d.lineTo(x + width, y + height - radius);
    ctx2d.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
    ctx2d.lineTo(x + radius, y + height);
    ctx2d.quadraticCurveTo(x, y + height, x, y + height - radius);
    ctx2d.lineTo(x, y + radius);
    ctx2d.quadraticCurveTo(x, y, x + radius, y);
    ctx2d.closePath();
}
