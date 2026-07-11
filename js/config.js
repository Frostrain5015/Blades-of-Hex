// ==== 运行时画布与几何 ====
// 规则与展示数据在 rules/ 目录；此文件仅保留浏览器画布运行时、
// 本地设置，以及给遗留导入路径的兼容再导出（新代码请直接从 rules/ 导入）。

import { BOARD_RULES } from '../rules/constants.js';

// ==== 兼容再导出（规则层） ====================
export { UNIT_CONFIG, COUNTER_RELATION } from '../rules/units.js';
export { CAMP, CAMP_FLAG_COLORS, campToKey } from '../rules/camps.js';
export { TERRAIN_CONFIG, FORTIFICATION_CONFIG, MORALE_CONFIG, WEATHER_CONFIG } from '../rules/terrain.js';
export { HEX_NEIGHBORS, hexDistance } from '../rules/hex.js';
export { getFactionCount, getRoundIndex, getRound } from '../rules/turns.js';
export {
    calcIncome, VILLAGE_GOLD, VILLAGE_MIN_DIST, COMMANDER_REROLL_COST,
    CARD_SYSTEM_CONFIG, WEATHER_CYCLE, DECK_COMPOSITION, SKIRMISH_EXTRAS
} from '../rules/constants.js';
export { TACTICAL_CARD_CONFIG, COLONEL_CARDS, COLONEL_CARD_GOLD } from '../rules/cards.js';

export const HEX_SIZE = BOARD_RULES.hexSize;
export const LOG_LIMIT = BOARD_RULES.logLimit;

export const canvas = document.getElementById('gameCanvas');
export const ctx = canvas.getContext('2d');
export const cardCanvas = document.getElementById('cardCanvas');
export const cardCtx = cardCanvas ? cardCanvas.getContext('2d') : null;

// 逻辑分辨率（所有游戏坐标基于此）
export const LOGICAL_W = BOARD_RULES.logicalWidth;
export const LOGICAL_H = BOARD_RULES.logicalHeight;

let dpr = 1;
export let HEX_WIDTH;
let HEX_HEIGHT;

export function initCanvas() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width  = LOGICAL_W * dpr;
    canvas.height = LOGICAL_H * dpr;
    canvas.style.width  = LOGICAL_W + 'px';
    canvas.style.height = LOGICAL_H + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    HEX_WIDTH  = Math.sqrt(3) * HEX_SIZE;
    HEX_HEIGHT = 2 * HEX_SIZE;
}

export let boardDirty = true;
export function invalidateBoard() { boardDirty = true; }

// Shared frame timestamp so we don't call Date.now() dozens of times per frame
export const frameInfo = { now: performance.now() };

// ==== 画布绘制工具（渲染专用，勿在规则层引用） ====================

export function hexToRgb(hex) {
    const shorthandRegex = /^#?([a-f\d])([a-f\d])([a-f\d])$/i;
    hex = hex.replace(shorthandRegex, (m, r, g, b) => r + r + g + g + b + b);
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result
        ? { r: parseInt(result[1], 16), g: parseInt(result[2], 16), b: parseInt(result[3], 16) }
        : { r: 0, g: 0, b: 0 };
}

export function rgbToHex(r, g, b) {
    return `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`;
}

// Precomputed unit-hex vertex offsets (normalized, multiplied by size at call site)
const _HV = (() => {
    const v = [];
    for (let i = 0; i < 6; i++) {
        const a = Math.PI / 3 * (i + 0.5);
        v.push({ x: Math.cos(a), y: Math.sin(a) });
    }
    return v;
})();

export function hexPath(ctx2d, cx, cy, size) {
    ctx2d.beginPath();
    const sx = _HV[0].x * size, sy = _HV[0].y * size;
    ctx2d.moveTo(cx + sx, cy + sy);
    for (let i = 1; i < 6; i++) {
        ctx2d.lineTo(cx + _HV[i].x * size, cy + _HV[i].y * size);
    }
    ctx2d.closePath();
}

// Return the two endpoints for a single hex edge (index 0..5)
export function hexEdge(cx, cy, size, edgeIdx) {
    const v0 = _HV[edgeIdx];
    const v1 = _HV[(edgeIdx + 1) % 6];
    return {
        x0: cx + v0.x * size, y0: cy + v0.y * size,
        x1: cx + v1.x * size, y1: cy + v1.y * size
    };
}

export function drawHexagonOutline(ctx2d, centerX, centerY, size, strokeStyle, lineWidth) {
    hexPath(ctx2d, centerX, centerY, size);
    ctx2d.strokeStyle = strokeStyle;
    ctx2d.lineWidth = lineWidth;
    ctx2d.stroke();
}

export function pulseSine(t, freq = 0.0025) { return (Math.sin(t * freq) + 1) / 2; }

export function roundRectPath(ctx2d, x, y, w, h, r) {
    ctx2d.beginPath();
    ctx2d.moveTo(x + r, y);
    ctx2d.lineTo(x + w - r, y);
    ctx2d.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx2d.lineTo(x + w, y + h - r);
    ctx2d.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx2d.lineTo(x + r, y + h);
    ctx2d.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx2d.lineTo(x, y + r);
    ctx2d.quadraticCurveTo(x, y, x + r, y);
    ctx2d.closePath();
}

// ==== 设置（通过 localStorage 持久化） ====================
const SETTINGS_KEY = 'bladesOfHex_settings';

const DEFAULT_SETTINGS = {
    animationSpeed: 1.0,
    particleDensity: 1.0,
    screenShake: true,
    turnFlash: true,
    soundEnabled: true,
    soundVolume: 0.7
};

export let settings = { ...DEFAULT_SETTINGS };

export function loadSettings() {
    try {
        const saved = localStorage.getItem(SETTINGS_KEY);
        if (saved) {
            settings = { ...DEFAULT_SETTINGS, ...JSON.parse(saved) };
        }
    } catch (e) {
        settings = { ...DEFAULT_SETTINGS };
    }
}

export function saveSettings() {
    try {
        localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    } catch (e) { /* ignore */ }
}
