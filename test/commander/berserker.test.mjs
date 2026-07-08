// 浏览器模式单元测试（自动生成）
import { newTestPage, pageRegisterFx, pageFxStats, clearFx  } from './helpers.mjs';

export async function run(browser) {
    const page = await newTestPage(browser);
    const R = await page.evaluate(async () => {
        const cmdr = (await import('/commander/berserker.js')).default;
        const R = { passed: 0, failed: 0, logs: [] };
        const assert = (cond, msg) => { if (cond) R.passed++; else R.failed++; R.logs.push((cond ? "✓" : "✗") + " " + msg); };

        // check 1
        try {
            {
                const u = { hp: 200, maxHp: 200, config: { attack: 50 } };
                assert(cmdr._getStacks(u) === 0, '满血 0 层');
            }
            
        } catch(e) { assert(false, '第 1 项异常: ' + e.message); }
        // check 2
        try {
            {
                const u = { hp: 100, maxHp: 200, config: { attack: 50 } };
                assert(cmdr._getStacks(u) === 25, '损失 50% HP → 25 层');
            }
            
        } catch(e) { assert(false, '第 2 项异常: ' + e.message); }
        // check 3
        try {
            {
                const u = { hp: 10, maxHp: 200, config: { attack: 50 } };
                assert(cmdr._getStacks(u) === 40, '损失 95% HP → 40 层（上限）');
            }
            
        } catch(e) { assert(false, '第 3 项异常: ' + e.message); }
        // check 4
        try {
            {
                const u = { hp: 100, maxHp: 200, config: { attack: 50 } };
                assert(cmdr.getAttackBonus(u) === Math.round(50 * 25 * 0.01), '攻击加成 = floor(50*25*0.01)=12');
            }
            
        } catch(e) { assert(false, '第 4 项异常: ' + e.message); }
        // check 5
        try {
            {
                const u = { hp: 100, maxHp: 200, config: { attack: 50 } };
                assert(Math.abs(cmdr.getDefenseBonus(u) - 0.25) < 0.01, '防御加成 25%');
            }
            
        } catch(e) { assert(false, '第 5 项异常: ' + e.message); }

        return R;
    });
    R.logs.forEach(l => console.log('  ' + l));
    console.log(`  —— cmd/berserker: ${R.passed} 通过 / ${R.failed} 失败`);
    await page.context().close();
    return { passed: R.passed, failed: R.failed };
}
