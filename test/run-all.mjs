// 一键全量测试入口：node test/run-all.mjs [--quick] [--suite=static|pve|net|cmdr|fx]
//   static — 语法 + import/export 审计（无浏览器）
//   pve    — 单机完整对局（--quick 只跑 3 轮回合循环）
//   net    — WebSocket 双人对局 + 断线重连
//   cmdr   — 16 名将领技能逻辑单元测试（浏览器）
//   fx     — 12 个头像特效模块注册测试（浏览器）
// 自动启动测试服务器（端口 TEST_PORT，默认 3199），全程无需人工。
import { readdirSync } from 'fs';
import { join } from 'path';
import { startServer, launchBrowser } from './lib/helpers.mjs';

const args = process.argv.slice(2);
const quick = args.includes('--quick');
const only = (args.find(a => a.startsWith('--suite=')) || '').split('=')[1] || null;

const t0 = Date.now();
const results = {};
let stopServer = null, browser = null;

function banner(name) { console.log(`\n══════════ 套件: ${name} ══════════`); }
function needServer(s) { return !s || s === 'pve' || s === 'net' || s === 'cmdr' || s === 'fx'; }

try {
    if (!only || only === 'static') {
        banner('static（静态审计）');
        results.static = await (await import('./static.test.mjs')).run();
    }

    if (needServer(only)) {
        stopServer = await startServer();
        browser = await launchBrowser();
    }

    if (!only || only === 'pve') {
        banner(`pve（单机${quick ? '·快速' : '·完整对局'}）`);
        results.pve = await (await import('./pve.test.mjs')).run(browser, { quick });
    }

    if (!only || only === 'net') {
        banner('net（WebSocket 联机对局）');
        results.net = await (await import('./net.test.mjs')).run(browser);
    }

    // ── 将领逻辑单元测试 ──
    if (!only || only === 'cmdr') {
        banner('cmdr（将领技能逻辑单元测试）');
        const cmdDir = join(import.meta.dirname, 'commander');
        const files = readdirSync(cmdDir).filter(f => f.endsWith('.test.mjs') && !f.startsWith('fx') && f !== 'run-all.mjs');
        let cmdPass = 0, cmdFail = 0;
        for (const f of files.sort()) {
            const run = (await import('./commander/' + f)).run;
            if (typeof run !== 'function') continue;
            try {
                const r = await run(browser);
                if (r) { cmdPass += r.passed || 0; cmdFail += r.failed || 0; }
            } catch (e) { cmdFail++; console.log(`  💥 ${f}: ${e.message?.split('\n')[0] || e}`); }
        }
        results.cmdr = cmdFail === 0;
        console.log(`  —— 总计: ${cmdPass} 通过 / ${cmdFail} 失败`);
    }

    // ── 特效模块注册测试 ──
    if (!only || only === 'fx') {
        banner('fx（特效模块注册）');
        const fxDir = join(import.meta.dirname, 'commander/fx');
        const files = readdirSync(fxDir).filter(f => f.endsWith('.test.mjs'));
        let fxPass = 0, fxFail = 0;
        for (const f of files.sort()) {
            const run = (await import('./commander/fx/' + f)).run;
            if (typeof run !== 'function') continue;
            try {
                const r = await run(browser);
                if (r) { fxPass += r.passed || 0; fxFail += r.failed || 0; }
            } catch (e) { fxFail++; console.log(`  💥 ${f}: ${e.message?.split('\n')[0] || e}`); }
        }
        results.fx = fxFail === 0;
        console.log(`  —— 总计: ${fxPass} 通过 / ${fxFail} 失败`);
    }
} catch (err) {
    console.error('\n💥 测试运行异常:', err);
    results._fatal = false;
} finally {
    if (browser) await browser.close().catch(() => {});
    if (stopServer) stopServer();
}

const secs = ((Date.now() - t0) / 1000).toFixed(1);
console.log('\n══════════ 总结 ══════════');
for (const [k, v] of Object.entries(results)) console.log(`  ${v ? '✅' : '❌'} ${k}`);
console.log(`  用时 ${secs}s`);
const pass = Object.values(results).every(Boolean) && Object.keys(results).length > 0;
console.log(pass ? '\n✅ 全部套件通过' : '\n❌ 存在失败套件');
process.exit(pass ? 0 : 1);
