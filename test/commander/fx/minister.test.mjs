// minister（尚书）FX 模块测试
import { newTestPage, pageRegisterFx, pageFxStats, clearFx } from '../helpers.mjs';

export async function run(browser) {
    const page = await newTestPage(browser);
    await clearFx(page);
    await pageRegisterFx(page, '/commander/fx/minister.js');
    const s = await pageFxStats(page);
    const r = { passed: 0, failed: 0 };
    if (s.layers.preFog >= 1) { r.passed++; console.log('  ✓ preFog 图层（统御环）'); } else { r.failed++; console.log('  ✗ preFog 缺失'); }
    if (s.updaters >= 1) { r.passed++; console.log('  ✓ updater'); } else { r.failed++; console.log('  ✗ updater 缺失'); }
    await page.context().close();
    return r;
}
