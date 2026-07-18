// 测试基础设施：服务器启停、浏览器页面驱动、游戏流程助手、特效活动探针
import { spawn } from 'child_process';
import { chromium } from 'playwright';
import http from 'http';

export const TEST_PORT = Number(process.env.TEST_PORT || 3199);
export const BASE = `http://localhost:${TEST_PORT}`;

// ── 服务器 ──────────────────────────────────────────────
export async function startServer() {
    const child = spawn(process.execPath, ['server.js'], {
        env: { ...process.env, PORT: String(TEST_PORT), HTTPS_PORT: String(TEST_PORT + 1) },
        stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stdout.on('data', () => {});
    child.stderr.on('data', d => process.stderr.write(`[server] ${d}`));
    await waitFor(async () => (await httpGet(`${BASE}/`)).ok, 15000, 'HTTP 服务器启动');
    return () => { try { child.kill(); } catch {} };
}

function httpGet(url) {
    return new Promise(resolve => {
        http.get(url, res => { res.resume(); resolve({ ok: res.statusCode === 200 }); })
            .on('error', () => resolve({ ok: false }));
    });
}

// ── 通用等待 ────────────────────────────────────────────
export async function waitFor(fn, timeoutMs, what) {
    const t0 = Date.now();
    for (;;) {
        try { if (await fn()) return; } catch {}
        if (Date.now() - t0 > timeoutMs) throw new Error(`等待超时: ${what}`);
        await sleep(200);
    }
}
export const sleep = ms => new Promise(r => setTimeout(r, ms));

// ── 浏览器 ──────────────────────────────────────────────
export async function launchBrowser() {
    return chromium.launch({ headless: true });
}

export async function newGamePage(browser) {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await ctx.newPage();
    page._errors = [];
    page.on('pageerror', e => page._errors.push(e.message));
    await page.goto(BASE, { waitUntil: 'networkidle', timeout: 30000 });
    return page;
}

// 页面内 eval 辅助：import 真实模块实例执行
export function ev(page, fn, ...args) {
    return page.evaluate(fn, ...args);
}

// ── 游戏流程驱动 ─────────────────────────────────────────
export async function startSolo(page) {
    await page.click('#soloGameBtn');           // 首页 → 单人游戏二级菜单
    await page.click('#standardGameBtn');       // 二级菜单 → 标准对局准备页
    await page.waitForSelector('#prepConfirm', { timeout: 5000 });
    await page.click('#prepConfirm');
}

// 在选将界面选第一张卡（或按将领名优先选择），点选 + 再点确认；带重试
export async function pickCommander(page, preferNames = []) {
    await waitFor(async () =>
        page.evaluate(() => document.querySelectorAll('.commander-card').length > 0),
        20000, '选将卡片出现');
    await sleep(2500); // 等卡片入场动画
    for (let attempt = 0; attempt < 15; attempt++) {
        // 有选中卡则点它确认，否则点目标卡选中（与真实双击节奏一致）
        await page.evaluate((prefer) => {
            const cards = [...document.querySelectorAll('.commander-card')];
            if (!cards.length) return;
            for (const c of cards) c.classList.remove('animating');
            const sel = document.querySelector('.commander-card.selected');
            if (sel) { sel.click(); return; }
            let target = null;
            for (const name of prefer) {
                target = cards.find(c => c.textContent.includes(name));
                if (target) break;
            }
            (target || cards[0]).click();
        }, preferNames);
        await sleep(1500);
        const done = await page.evaluate(async () => {
            const { gameState } = await import('/js/state.js');
            const net = await import('/js/network.js');
            const gw = document.getElementById('gameWrapper');
            const canvasUp = gw && gw.style.display !== 'none';
            // 按自身角色判定确认位（联机下对手的确认标志会被同步过来，不能混用）
            const role = net.getMyRole();
            const myPicked = role === 'player2' ? gameState.commanderP2Confirmed
                : role === 'player3' ? gameState.commanderP3Confirmed
                : gameState.commanderP1Confirmed;
            return canvasUp || myPicked;
        });
        if (done) return;
    }
    // 诊断信息
    const diag = await page.evaluate(() => ({
        cards: document.querySelectorAll('.commander-card').length,
        selected: document.querySelectorAll('.commander-card.selected').length,
        overlay: document.getElementById('commanderOverlay')?.className || 'none',
    }));
    throw new Error(`选将确认失败: ${JSON.stringify(diag)}`);
}

export async function waitGameStart(page, timeoutMs = 40000) {
    await waitFor(async () => page.evaluate(async () => {
        const gw = document.getElementById('gameWrapper');
        const cv = document.getElementById('gameCanvas');
        if (!(gw && gw.style.display !== 'none' && cv && cv.offsetWidth > 0)) return false;
        const { gameState } = await import('/js/state.js');
        return gameState.tiles.length > 0; // 倒计时结束、initMap 完成
    }), timeoutMs, '游戏画布与地图就绪');
    // 关闭开局提示框（"知道了"）
    await sleep(500);
    await page.evaluate(() => {
        for (const b of document.querySelectorAll('button')) {
            if (b.textContent.trim() === '知道了' && b.offsetParent) b.click();
        }
    });
}

// 读取游戏状态摘要
export function gameSnapshot(page) {
    return page.evaluate(async () => {
        const { gameState } = await import('/js/state.js');
        const { campToKey } = await import('/rules/camps.js');
        return {
            turnCounter: gameState.turnCounter,
            currentCamp: gameState.currentCamp?.name || null,
            currentCampKey: campToKey(gameState.currentCamp),
            commanderP1: gameState.commanderP1,
            commanderP2: gameState.commanderP2,
            commanderPhase: gameState.commanderPhase,
            p1Deployed: gameState.commanderP1Deployed,
            p2Deployed: gameState.commanderP2Deployed,
            tiles: gameState.tiles.length,
            victory: document.getElementById('victoryOverlay')?.classList.contains('show') || false,
        };
    });
}

// 部署本方将领到第一个己方单位上（走真实 executeTacticalCard，联机自动同步）
export function deployCommander(page) {
    return page.evaluate(async () => {
        const { gameState } = await import('/js/state.js');
        const gl = await import('/js/gameLogic.js');
        const net = await import('/js/network.js');
        const myCamp = net.isNetworkGame()
            ? net.roleToCamp(net.getMyRole())
            : gameState.gameMode === 'pve'
                ? Object.values(gameState.factions || {}).find(faction => faction.controller === 'human') || gameState.currentCamp
                : gameState.currentCamp;
        const tile = gameState.tiles.find(t => t.unit && t.unit.camp === myCamp && !t.unit.commander);
        if (!tile) return { ok: false, reason: '找不到己方单位' };
        gl.executeTacticalCard('commanderDeploy', tile);
        return { ok: true, unit: tile.unit.config?.name };
    });
}

export async function clickEndTurn(page, pollMs = 3000) {
    // 回合逻辑由其他 UI 用例覆盖；这里直接调用规则入口，避免“仍有单位可行动”
    // 确认弹窗与浏览器动画时序导致联机/AI 回归测试随机漏点。
    await page.evaluate(() => { void import('/js/gameLogic.js').then(module => module.endTurn({ skipConfirmation: true })); });
    // 轮询确认弹窗：有则点确定，最多 pollMs
    const t0 = Date.now();
    while (Date.now() - t0 < pollMs) {
        const dismissed = await page.evaluate(() => {
            const ov = document.getElementById('confirmOverlay');
            if (ov && ov.classList.contains('show')) {
                document.getElementById('confirmYes')?.click();
                return true;
            }
            return false;
        });
        if (!dismissed) await sleep(100);
    }
    await sleep(200);
}

// ── 特效活动探针：rAF 记录哪些特效数组曾出现内容 ───────────
export function installFxProbe(page) {
    return page.evaluate(async () => {
        const fx = await import('/js/effects.js');
        const { gameState } = await import('/js/state.js');
        const watch = {
            particles: () => fx.particles.length,
            attackFlashes: () => fx.attackFlashes.length,
            meleeSlashes: () => fx.meleeSlashes.length,
            moraleEffects: () => fx.iconEffects.filter(e => e.kind === 'morale').length,
            coinParticles: () => fx.coinParticles.length,
            projectiles: () => fx.projectiles.length,
            cardUseEffects: () => fx.cardUseEffects.length,
            commanderSkillEffects: () => fx.iconEffects.filter(e => e.kind === 'skill' || e.kind === 'shield').length,
            airstrikeEffects: () => fx.airstrikeEffects.length,
            damageTexts: () => (gameState.damageTexts || []).length,
            goldTexts: () => (gameState.goldTexts || []).length,
            turnFlash: () => (fx.turnFlash.alpha > 0 ? 1 : 0),
        };
        window.__fxProbe = { max: {} };
        for (const k of Object.keys(watch)) window.__fxProbe.max[k] = 0;
        (function loop() {
            for (const [k, f] of Object.entries(watch)) {
                try { const v = f(); if (v > window.__fxProbe.max[k]) window.__fxProbe.max[k] = v; } catch {}
            }
            requestAnimationFrame(loop);
        })();
        return true;
    });
}

export function readFxProbe(page) {
    return page.evaluate(() => window.__fxProbe?.max || {});
}

// fx 注册表状态（验证按需装载后各图层已挂钩）
export function fxRegistryStats(page) {
    return page.evaluate(async () => (await import('/js/fxRegistry.js')).getFxRegistryStats());
}

// 页面已请求的 fx 模块文件
export function fetchedFxModules(page) {
    return page.evaluate(() =>
        performance.getEntriesByType('resource')
            .map(r => r.name).filter(n => n.includes('/commander/fx/'))
            .map(n => n.split('/').pop().replace('.js', ''))
    );
}

// ── 断言与报告 ──────────────────────────────────────────
export class Reporter {
    constructor(suite) { this.suite = suite; this.passed = 0; this.failed = 0; this.warnings = 0; }
    ok(msg) { this.passed++; console.log(`  ✓ ${msg}`); }
    fail(msg) { this.failed++; console.log(`  ✗ ${msg}`); }
    warn(msg) { this.warnings++; console.log(`  ⚠ ${msg}`); }
    assert(cond, msg) { cond ? this.ok(msg) : this.fail(msg); return !!cond; }
    softAssert(cond, msg) { cond ? this.ok(msg) : this.warn(`${msg}（未观测到，软断言）`); return !!cond; }
    assertNoPageErrors(page, label) {
        if (page._errors.length === 0) this.ok(`${label}：零页面错误`);
        else { this.failed++; console.log(`  ✗ ${label}：${page._errors.length} 个页面错误`); page._errors.forEach(e => console.log(`      ${e}`)); }
    }
    summary() {
        console.log(`  —— ${this.suite}: ${this.passed} 通过 / ${this.failed} 失败 / ${this.warnings} 警告`);
        return this.failed === 0;
    }
}
