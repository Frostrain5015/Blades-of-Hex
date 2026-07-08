// astrologer 逻辑测试 — 重写
import { newTestPage } from './helpers.mjs';

export async function run(browser) {
    const page = await newTestPage(browser);
    const R = await page.evaluate(async () => {
        const cmdr = (await import('/commander/astrologer.js')).default;
        const R = { passed: 0, failed: 0, logs: [] };
        const assert = (cond, msg) => { if (cond) R.passed++; else R.failed++; R.logs.push((cond ? "✓" : "✗") + " " + msg); };

        // 1) isInWeatherShield 3格内
        try {
            const tileMap = new Map();
            const campR = { name: '红军' };
            const astroUnit = { commander: 'astrologer', camp: campR, hp: 100, config: { name: '步' } };
            const astroTile = { q: 0, r: 0, x: 400, y: 300, unit: astroUnit };
            tileMap.set('0,0', astroTile);
            const target = { q: 3, r: 0 };
            assert(cmdr.isInWeatherShield(target, campR, tileMap) === true, '3格内友军受保护');
        } catch(e) { assert(false, 'shield异常: ' + e.message); }
        // 2) 范围外
        try {
            const tileMap = new Map();
            tileMap.set('0,0', { q: 0, r: 0, x: 400, y: 300, unit: { commander: 'astrologer', camp: { name: '红军' }, hp: 100 } });
            assert(cmdr.isInWeatherShield({ q: 6, r: 0 }, { name: '红军' }, tileMap) === false, '范围外不保护');
        } catch(e) { assert(false, 'shield异常: ' + e.message); }
        // 3) isInDebuffZone
        {
            const gs = { tileMap: new Map(), weatherLockUntil: 99 };
            gs.tileMap.set('5,5', { q: 5, r: 5, x: 480, y: 380, unit: { commander: 'astrologer', camp: { name: '蓝军' }, hp: 100 } });
            assert(cmdr.isInDebuffZone({ q: 6, r: 4 }, { name: '红军' }, gs) === true, '星移期间敌方减益');
        }
        // 4) activeSkill
        {
            const u = { _pendingWeatherChoice: false, tile: { x: 400, y: 300 } };
            const log = [];
            cmdr.activeSkill.onActivate(u, { logMessage: m => log.push(m), spawnFx: () => {}, isReplay: false });
            assert(u._pendingWeatherChoice === true, 'pendingWeatherChoice=true');
            assert(log.some(l => l.includes('选择天气')), '日志提示选天气');
        }
        return R;
    });
    R.logs.forEach(l => console.log('  ' + l));
    console.log(`  —— cmd/astrologer: ${R.passed} 通过 / ${R.failed} 失败`);
    await page.context().close();
    return { passed: R.passed, failed: R.failed };
}
