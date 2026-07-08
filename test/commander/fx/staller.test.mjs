// staller（停滞者）FX 模块测试
import { newTestPage, pageRegisterFx, pageFxStats, clearFx } from '../helpers.mjs';

export async function run(browser) {
    const page = await newTestPage(browser);
    await clearFx(page);
    await pageRegisterFx(page, '/commander/fx/staller.js');
    const s = await pageFxStats(page);
    const r = { passed: 0, failed: 0 };
    if (s.layers.ground >= 1) { r.passed++; console.log('  ✓ ground 图层（缚足/力场/殉道预警）'); } else { r.failed++; console.log('  ✗ ground 缺失'); }
    await page.context().close();
    return r;
}
