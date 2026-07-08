// vampire（吸血鬼）FX 模块测试
import { newTestPage, pageRegisterFx, pageFxStats, clearFx } from '../helpers.mjs';

export async function run(browser) {
    const page = await newTestPage(browser);
    await clearFx(page);
    const before = await pageFxStats(page);
    await pageRegisterFx(page, '/commander/fx/vampire.js');
    const after = await pageFxStats(page);
    const r = { passed: 0, failed: 0 };
    const newLayers = Object.keys(after.layers).filter(k => (after.layers[k] || 0) > (before.layers[k] || 0)).length;
    if (newLayers >= 1) { r.passed++; console.log('  ✓ combatFx 图层（吸血粒子流）'); } else { r.failed++; console.log('  ✗ 无新注册图层'); }
    if (after.updaters > before.updaters) { r.passed++; console.log('  ✓ updater'); } else { r.failed++; console.log('  ✗ updater 未增加'); }
    await page.context().close();
    return r;
}
