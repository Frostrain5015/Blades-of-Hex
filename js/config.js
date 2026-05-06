// ==== 核心配置与常量 ====
export const HEX_SIZE = 30;
export const LOG_LIMIT = 20;

export const canvas = document.getElementById('gameCanvas');
export const ctx = canvas.getContext('2d');

// 逻辑分辨率（所有游戏坐标基于此）
export const LOGICAL_W = 1000;
export const LOGICAL_H = 750;

export let dpr = 1;
export let HEX_WIDTH, HEX_HEIGHT;

export let boardCanvas, boardCtx;

export function initCanvas() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width  = LOGICAL_W * dpr;
    canvas.height = LOGICAL_H * dpr;
    canvas.style.width  = LOGICAL_W + 'px';
    canvas.style.height = LOGICAL_H + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    boardCanvas = document.createElement('canvas');
    boardCanvas.width  = LOGICAL_W * dpr;
    boardCanvas.height = LOGICAL_H * dpr;
    boardCtx = boardCanvas.getContext('2d');
    boardCtx.setTransform(dpr, 0, 0, dpr, 0, 0);

    HEX_WIDTH  = Math.sqrt(3) * HEX_SIZE;
    HEX_HEIGHT = 2 * HEX_SIZE;
}

export let boardDirty = true;
export function invalidateBoard() { boardDirty = true; }

// Shared frame timestamp so we don't call Date.now() dozens of times per frame
export const frameInfo = { now: Date.now() };

// Board cache utilities (available for future use, not currently used in render loop)
export function renderBoardToCache(tiles, tileMap) {
    boardCtx.clearRect(0, 0, LOGICAL_W, LOGICAL_H);
    for (const tile of tiles) tile.drawBase(boardCtx, tileMap);
    boardDirty = false;
}

export function blitCachedBoard(targetCtx) {
    targetCtx.drawImage(
        boardCanvas,
        0, 0, LOGICAL_W * dpr, LOGICAL_H * dpr,
        0, 0, LOGICAL_W, LOGICAL_H
    );
}

// ==== 工具函数 ====================

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

export function getDarkCampColor(camp) {
    const rgb = hexToRgb(camp.color);
    const darkR = Math.max(0, Math.round(rgb.r * 0.7));
    const darkG = Math.max(0, Math.round(rgb.g * 0.7));
    const darkB = Math.max(0, Math.round(rgb.b * 0.7));
    return rgbToHex(darkR, darkG, darkB);
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
    ctx2d.save();
    hexPath(ctx2d, centerX, centerY, size);
    ctx2d.strokeStyle = strokeStyle;
    ctx2d.lineWidth = lineWidth;
    ctx2d.stroke();
    ctx2d.restore();
}

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

export function hexDistance(a, b) {
    return (Math.abs(a.q - b.q) + Math.abs(a.r - b.r) + Math.abs(a.s - b.s)) / 2;
}

// Axial hex neighbor offsets (q, r)
export const HEX_NEIGHBORS = [
    [1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]
];

// ==== 兵种配置 ====================
export const UNIT_CONFIG = {
    infantry: { name: '步', hp: 100, attack: 30, speed: 5, range: 1, cost: 25, color: '#0a0a0a' },
    cavalry:  { name: '骑', hp: 90,  attack: 55, speed: 8, range: 1, cost: 40, color: '#0a0a0a' },
    archer:   { name: '炮', hp: 70,  attack: 55, speed: 3, range: 2, cost: 35, color: '#0a0a0a' }
};

// ==== 阵营配置 ====================
export const CAMP = {
    player1: { name: '红军', color: '#ffaaaa', flag: '🔴' },
    player2: { name: '蓝军', color: '#aaaaff', flag: '🔵' },
    neutral: { name: '中立', color: '#c0c0c0', flag: '⚫' }
};

// Saturated flag colors shared by unit & city flags
export const CAMP_FLAG_COLORS = {
    p1: { main: '#d44040', dark: '#8b1a1a', light: '#f06060' },
    p2: { main: '#4060d0', dark: '#1a2a80', light: '#6080f0' },
    neu: { main: '#777', dark: '#444', light: '#999' }
};

// ==== 克制关系 ====================
export const COUNTER_RELATION = {
    infantry: { archer: 0.75, cavalry: 1.25, infantry: 1 },
    archer:   { cavalry: 0.75, infantry: 1.25, archer: 1 },
    cavalry:  { infantry: 0.75, archer: 1.25, cavalry: 1 }
};

// ==== 地形配置 ====================
export const TERRAIN_CONFIG = {
    plains:   { name: '平原', defenseBonus: 0,    stepCost: 2, moveDesc: '',          icon: '',   iconFont: '' },
    forest:   { name: '森林', defenseBonus: 0.15, stepCost: 3, moveDesc: '部队移动较慢', icon: '🌲', iconFont: '13px "Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", sans-serif' },
    mountain: { name: '山地', defenseBonus: 0.25, stepCost: 6, moveDesc: '部队移动缓慢', icon: '⛰', iconFont: '15px "Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", sans-serif' }
};

// ==== 士气配置 ====================
// 士气等级: 3=上升 2=正常 1=下降 0=混乱
export const MORALE_CONFIG = {
    3: { name: '士气上升', dmgMulti: 1.15, icon: '▲', color: '#ffd700', desc: '攻击力+15%' },
    2: { name: '正常',     dmgMulti: 1.00, icon: '',   color: '#aaa',    desc: '' },
    1: { name: '士气下降', dmgMulti: 0.80, icon: '▼', color: '#ff8800', desc: '攻击力−20%' },
    0: { name: '混乱',     dmgMulti: 0,    icon: '？', color: '#999',    desc: '无法操控' }
};

// ==== 设置（通过 localStorage 持久化） ====================
const SETTINGS_KEY = 'bladesOfHex_settings';

const DEFAULT_SETTINGS = {
    animationSpeed: 1.0,
    particleDensity: 1.0,
    screenShake: true,
    turnFlash: true,
    soundEnabled: true
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
