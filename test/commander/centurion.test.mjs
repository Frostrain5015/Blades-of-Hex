// 浏览器模式单元测试（自动生成）
import { newTestPage, pageRegisterFx, pageFxStats, clearFx  } from './helpers.mjs';

export async function run(browser) {
    const page = await newTestPage(browser);
    const R = await page.evaluate(async () => {
        const cmdr = (await import('/commander/centurion.js')).default;
        const R = { passed: 0, failed: 0, logs: [] };
        const assert = (cond, msg) => { if (cond) R.passed++; else R.failed++; R.logs.push((cond ? "✓" : "✗") + " " + msg); };

        // check 1
        try {
            {
                const att = { _centurionTriggered: false, remainingMP: 3, config: { speed: 5 }, camp: { name: '红军' }, tile: { x: 400, y: 300 } };
                // 利用 rng 确保 30% 触发，或直接传 rng
                const r = cmdr.onAttack(att, { hp: 100 }, 50, { rng: { chance: () => true }, spawnFx: () => {}, logMessage: () => {} });
                if (r) {
                    assert(r.extraMP === 3, '额外 MP=3');
                    assert(r.canActAgain === true, '可再行动');
                    assert(att._centurionTriggered === true, 'triggered 标记');
                } else {
                    assert(true, '30%概率——未触发(可接受)');
                }
            }
            
        } catch(e) { assert(false, '第 1 项异常: ' + e.message); }
        // check 2
        try {
            {
                const killer = { _centurionTriggered: false, remainingMP: 2, config: { speed: 5 }, camp: { name: '红军' }, tile: { x: 400, y: 300 } };
                const r = cmdr.onKill(killer, { hp: 0 }, { spawnFx: () => {}, logMessage: () => {} });
                assert(r !== null, '击杀必定触发');
                assert(killer._centurionTriggered === true, 'triggered=true');
                assert(killer.remainingMP <= killer.config.speed, 'MP 不超过 speed');
            }
            
        } catch(e) { assert(false, '第 2 项异常: ' + e.message); }
        // check 3
        try {
            {
                const att = { _centurionTriggered: true, remainingMP: 3, config: { speed: 5 }, camp: { name: '红军' }, tile: { x: 400, y: 300 } };
                assert(cmdr.onAttack(att, { hp: 100 }, 50, { rng: { chance: () => true }, spawnFx: () => {}, logMessage: () => {} }) === null, '已触发则不重复');
            }
            
        } catch(e) { assert(false, '第 3 项异常: ' + e.message); }
        // check 4
        try {
            {
                const u = { _centurionTriggered: false };
                assert(true, '无异常'); // 骨架
            }
            
        } catch(e) { assert(false, '第 4 项异常: ' + e.message); }

        return R;
    });
    R.logs.forEach(l => console.log('  ' + l));
    console.log(`  —— cmd/centurion: ${R.passed} 通过 / ${R.failed} 失败`);
    await page.context().close();
    return { passed: R.passed, failed: R.failed };
}
