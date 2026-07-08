// staller 逻辑测试 — 重写
import { newTestPage } from './helpers.mjs';

export async function run(browser) {
    const page = await newTestPage(browser);
    const R = await page.evaluate(async () => {
        const cmdr = (await import('/commander/staller.js')).default;
        const R = { passed: 0, failed: 0, logs: [] };
        const assert = (cond, msg) => { if (cond) R.passed++; else R.failed++; R.logs.push((cond ? "✓" : "✗") + " " + msg); };
        const campB = { name: '蓝军' }, campR = { name: '红军' };

        // 1) getSnareLayers ≥1 在范围内
        {
            const tileMap = new Map();
            tileMap.set('3,3', { q: 3, r: 3, x: 400, y: 300, unit: { commander: 'staller', camp: campB, hp: 100 } });
            assert(cmdr.getSnareLayers({ q: 4, r: 3 }, campR, tileMap) >= 1, '缚足层数≥1');
        }
        // 2) 范围外 = 0
        {
            const tileMap = new Map();
            tileMap.set('3,3', { q: 3, r: 3, x: 400, y: 300, unit: { commander: 'staller', camp: campB, hp: 100 } });
            assert(cmdr.getSnareLayers({ q: 10, r: 10 }, campR, tileMap) === 0, '范围外=0');
        }
        // 3) isInSnareZone
        {
            const tileMap = new Map();
            tileMap.set('3,3', { q: 3, r: 3, x: 400, y: 300, unit: { commander: 'staller', camp: campB, hp: 100 } });
            assert(cmdr.isInSnareZone({ q: 4, r: 3 }, campR, tileMap) === true, 'inSnareZone');
        }
        // 4) getRangeReduction
        {
            const tileMap = new Map();
            tileMap.set('0,0', { q: 0, r: 0, x: 400, y: 300, unit: { commander: 'staller', camp: campB, hp: 100 } });
            const archer = { q: 1, r: 0, x: 435, y: 310, unit: { type: 'archer', camp: campR } };
            tileMap.set('1,0', archer);
            assert(cmdr.getRangeReduction(archer, tileMap) === 1, '远程被压制');
        }
        // 5) isInField
        {
            const tileMap = new Map();
            tileMap.set('3,3', { q: 3, r: 3, x: 400, y: 300, unit: { commander: 'staller', camp: campR, hp: 100 } });
            assert(cmdr.isInField({ q: 4, r: 3 }, campR, tileMap) === true, '友军在力场内');
            assert(cmdr.isInField({ q: 10, r: 10 }, campR, tileMap) === false, '范围外不在力场');
        }
        return R;
    });
    R.logs.forEach(l => console.log('  ' + l));
    console.log(`  —— cmd/staller: ${R.passed} 通过 / ${R.failed} 失败`);
    await page.context().close();
    return { passed: R.passed, failed: R.failed };
}
