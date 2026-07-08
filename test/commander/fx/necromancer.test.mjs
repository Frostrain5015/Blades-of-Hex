// necromancer（亡灵法师）FX 模块测试
import { newTestPage, pageRegisterFx, pageFxStats, clearFx } from '../helpers.mjs';

export async function run(browser) {
    const page = await newTestPage(browser);
    await clearFx(page);
    await pageRegisterFx(page, '/commander/fx/necromancer.js');
    const s = await pageFxStats(page);
    const r = { passed: 0, failed: 0 };
    if (s.layers.ground >= 1) { r.passed++; console.log('  ✓ ground 图层（魂印）'); } else { r.failed++; console.log('  ✗ ground 缺失'); }
    if (s.layers.top >= 1) { r.passed++; console.log('  ✓ top 图层（回魂黑烟）'); } else { r.failed++; console.log('  ✗ top 缺失'); }
    if (s.updaters >= 1) { r.passed++; console.log('  ✓ updater'); } else { r.failed++; console.log('  ✗ updater 缺失'); }
    await page.context().close();
    return r;
}
