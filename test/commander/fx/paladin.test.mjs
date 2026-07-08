// paladin（圣骑士）FX 模块测试
import { newTestPage, pageRegisterFx, pageFxStats, clearFx } from '../helpers.mjs';

export async function run(browser) {
    const page = await newTestPage(browser);
    await clearFx(page);
    await pageRegisterFx(page, '/commander/fx/paladin.js');
    const s = await pageFxStats(page);
    const r = { passed: 0, failed: 0 };
    if (s.layers.ground >= 1) { r.passed++; console.log('  ✓ ground 图层（勇气灵光）'); } else { r.failed++; console.log('  ✗ ground 缺失'); }
    if (s.layers.underUnits >= 1) { r.passed++; console.log('  ✓ underUnits 图层（剑环后圈）'); } else { r.failed++; console.log('  ✗ underUnits 缺失'); }
    if (s.layers.overSkillFx >= 1) { r.passed++; console.log('  ✓ overSkillFx 图层（剑环前圈）'); } else { r.failed++; console.log('  ✗ overSkillFx 缺失'); }
    if (s.layers.projectiles >= 1) { r.passed++; console.log('  ✓ projectiles 图层（弹射飞剑）'); } else { r.failed++; console.log('  ✗ projectiles 缺失'); }
    if (s.layers.preFog >= 1) { r.passed++; console.log('  ✓ preFog 图层（金色光束）'); } else { r.failed++; console.log('  ✗ preFog 缺失'); }
    if (s.updaters >= 1) { r.passed++; console.log('  ✓ updater'); } else { r.failed++; console.log('  ✗ updater 缺失'); }
    await page.context().close();
    return r;
}
