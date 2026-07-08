// 将领单元测试基础设施
// 核心职责：在真实浏览器环境中，为单名将领提供模拟的 gameState + helpers 对象，
// 以便单独测试 commander/*.js 中的技能钩子和 commander/fx/*.js 的注册/绘制逻辑。
//
// 用法：每个将领/特效测试文件导出一个 run(browser) 函数，
// test/commander/run-all.mjs 会统一遍历执行。

import { newGamePage, waitFor, sleep, Reporter } from '../lib/helpers.mjs';

// ── 模拟单位创建（page.evaluate 内用 window 版本，此处仅用作 run-all 导入验证） ──
export function makeUnit(type = 'infantry', overrides = {}) {
    return {
        id: 'u_' + Math.random().toString(36).slice(2, 8),
        type,
        config: { name: '步兵', hp: 200, attack: 50, speed: 3 },
        hp: overrides.hp ?? 200, maxHp: overrides.maxHp ?? 200,
        morale: overrides.morale ?? 2,
        camp: overrides.camp ?? { name: '红军', color: '#ff6666' },
        commander: overrides.commander || null,
        tile: overrides.tile || null,
        canAct: true,
        _shield: 0, _shieldMax: 0, _faith: 0,
        getVisualPos() { return { x: this.tile?.x ?? 400, y: this.tile?.y ?? 300 }; },
        heal(amt) { const o = this.hp; this.hp = Math.min(this.maxHp, this.hp + amt); return this.hp - o; },
        applyDamage(dmg, o) { this.hp = Math.max(o?.minHp ?? 0, this.hp - dmg); return this.hp <= 0; },
        ...overrides,
    };
}

export function makeTile(q, r, overrides = {}) {
    return { q, r, x: 400 + (q - r) * 35, y: 400 + (q + r) * 20, unit: null, isCity: false, camp: { name: '中立' }, ...overrides };
}

export const CAMP = { player1: { name: '红军', color: '#ff6666' }, player2: { name: '蓝军', color: '#6688ff' }, neutral: { name: '中立', color: '#888888' } };
export const UNIT_CONFIG = {
    infantry: { name: '步兵', hp: 200, attack: 50, speed: 3 },
    cavalry:  { name: '骑兵', hp: 250, attack: 65, speed: 5 },
    archer:   { name: '弓兵', hp: 150, attack: 60, speed: 3 },
    mgNest:   { name: '要塞', hp: 220, attack: 80, speed: 2 },
};

export function makeGameState(overrides = {}) {
    return {
        tiles: [], tileMap: new Map(), turnCounter: 0, currentCamp: { name: '红军' },
        isThreePlayer: false, skirmishFog: false, gameMode: 'local',
        playerGold: { player1: 4, player2: 4, neutral: 4 },
        damageTexts: [], _soulMarks: [], _cardOverrides: {},
        gameOver: false, commanderP1: null, commanderP2: null,
        ...overrides,
    };
}

// ── 注入 helpers 到浏览器 page 环境 ──
export async function injectHelpers(page) {
    await page.evaluate(() => {
        if (window.__testHelpers) return;
        window.__testHelpers = {
            makeUnit(type = 'infantry', overrides = {}) {
                return {
                    id: 'u_' + Math.random().toString(36).slice(2, 8),
                    type,
                    config: { name: '步兵', hp: 200, attack: 50, speed: 3 },
                    hp: overrides?.hp ?? 200, maxHp: overrides?.maxHp ?? 200,
                    morale: overrides?.morale ?? 2,
                    camp: overrides?.camp ?? { name: '红军', color: '#ff6666' },
                    commander: overrides?.commander || null,
                    tile: overrides?.tile || null,
                    _shield: 0, _shieldMax: 0, _faith: 0,
                    getVisualPos() { return { x: this.tile?.x ?? 400, y: this.tile?.y ?? 300 }; },
                    heal(amt) { const o = this.hp; this.hp = Math.min(this.maxHp, this.hp + amt); return this.hp - o; },
                    applyDamage(dmg, o) { this.hp = Math.max(o?.minHp ?? 0, this.hp - dmg); return this.hp <= 0; },
                    ...overrides,
                };
            },
            makeTile(q, r, overrides) {
                return { q, r, x: 400 + (q - r) * 35, y: 400 + (q + r) * 20, unit: null, isCity: false, camp: { name: '中立' }, ...(overrides || {}) };
            },
            CAMP: {
                player1: { name: '红军', color: '#ff6666' },
                player2: { name: '蓝军', color: '#6688ff' },
                neutral: { name: '中立', color: '#888888' },
            },
            UNIT_CONFIG: {
                infantry: { name: '步兵', hp: 200, attack: 50, speed: 3 },
                cavalry:  { name: '骑兵', hp: 250, attack: 65, speed: 5 },
            },
            makeGameState(overrides) {
                return { tiles: [], tileMap: new Map(), turnCounter: 0, currentCamp: { name: '红军' },
                    isThreePlayer: false, playerGold: { player1: 4 }, damageTexts: [], _soulMarks: [],
                    ...(overrides || {}) };
            },
        };
    });
}

export async function newTestPage(browser) {
    const page = await newGamePage(browser);
    await page.evaluate(() => { window.__testFxLog = []; });
    await injectHelpers(page);
    return page;
}

// ── 页面内 commander import + helpers 注入 ──
export async function pageImportCmdr(page, cmdrId) {
    return page.evaluate(async (id) => {
        const mod = await import('/commander/' + id + '.js');
        return mod.default || mod;
    }, cmdrId);
}

// ── FX 注册表 ──
export async function pageRegisterFx(page, fxPath) {
    return page.evaluate(async (p) => {
        const mod = await import(p);
        const fn = mod.register || (mod.default && mod.default.register);
        if (fn) fn();
    }, fxPath);
}

export async function pageFxStats(page) {
    return page.evaluate(async () => {
        const reg = await import('/js/fxRegistry.js');
        return reg.getFxRegistryStats();
    });
}

export async function clearFx(page) {
    return page.evaluate(async () => {
        const reg = await import('/js/fxRegistry.js');
        reg.clearFxLayers();
    });
}

// ── 启动测试页 ──
export { newGamePage, waitFor, sleep, Reporter };

