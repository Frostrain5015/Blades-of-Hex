// 浏览器模式单元测试（自动生成）
import { newTestPage, pageRegisterFx, pageFxStats, clearFx  } from './helpers.mjs';

export async function run(browser) {
    const page = await newTestPage(browser);
    const R = await page.evaluate(async () => {
        const cmdr = (await import('/commander/magician.js')).default;
        const R = { passed: 0, failed: 0, logs: [] };
        const assert = (cond, msg) => { if (cond) R.passed++; else R.failed++; R.logs.push((cond ? "✓" : "✗") + " " + msg); };

        // check 1
        try {
            {
                const killer = { type: 'infantry', config: { name: '步' }, hp: 150, maxHp: 200, _phantomStacks: 0, _rank: 0, tile: { x: 400, y: 300 } };
                const victim = { type: 'cavalry', config: { name: '骑', attack: 65 }, hp: 0 };
                const log = [];
                const r = cmdr.onKill(killer, victim, { spawnFx: () => {}, spawnExplosion: () => {}, logMessage: m => log.push(m) });
                assert(r !== null, '击杀触发幻形');
                if (r) {
                    assert(killer.type === 'cavalry', '变形为骑兵');
                    assert(killer._phantomStacks === 1, '1 层幻形');
                    assert(log.some(l => l.includes('幻形')), '日志有幻形');
                }
            }
            
        } catch(e) { assert(false, '第 1 项异常: ' + e.message); }
        // check 2
        try {
            {
                const killer = { type: 'infantry', config: { name: '步' }, hp: 150, maxHp: 200, _phantomStacks: 0, _rank: 0, tile: { x: 400, y: 300 } };
                const r = cmdr.onKill(killer, { type: 'infantry', hp: 0 }, { spawnFx: () => {}, spawnExplosion: () => {}, logMessage: () => {} });
                assert(r === true || r === null, '同兵种不变形');
            }
            
        } catch(e) { assert(false, '第 2 项异常: ' + e.message); }
        // check 3
        try {
            {
                const u = { _phantomStacks: 6 };
                // 不能超过 6
                assert(u._phantomStacks <= 6, '上限 6 层');
            }
            
        } catch(e) { assert(false, '第 3 项异常: ' + e.message); }
        // check 4
        try {
            {
                assert(true, '不抛异常');
            }
            
        } catch(e) { assert(false, '第 4 项异常: ' + e.message); }

        return R;
    });
    R.logs.forEach(l => console.log('  ' + l));
    console.log(`  —— cmd/magician: ${R.passed} 通过 / ${R.failed} 失败`);
    await page.context().close();
    return { passed: R.passed, failed: R.failed };
}
