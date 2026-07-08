// astrologer（占星者）FX 模块测试
import { newTestPage, pageRegisterFx, pageFxStats, clearFx } from '../helpers.mjs';

export async function run(browser) {
    const page = await newTestPage(browser);
    await clearFx(page);
    await pageRegisterFx(page, '/commander/fx/astrologer.js');
    const s = await pageFxStats(page);
    const r = { passed: 0, failed: 0 };
    if (s.layers.ground >= 1) { r.passed++; console.log('  ✓ ground 图层（星光力场）'); } else { r.failed++; console.log('  ✗ ground 缺失'); }
    if (s.layers.weatherOverlay >= 1) { r.passed++; console.log('  ✓ weatherOverlay 图层（力场覆绘）'); } else { r.failed++; console.log('  ✗ weatherOverlay 缺失'); }
    if (s.layers.aboveUnits >= 1) { r.passed++; console.log('  ✓ aboveUnits 图层（星移光柱）'); } else { r.failed++; console.log('  ✗ aboveUnits 缺失'); }
    await page.context().close();
    return r;
}
