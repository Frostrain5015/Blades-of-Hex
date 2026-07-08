import { newTestPage } from './helpers.mjs';

export async function run(browser) {
    const page = await newTestPage(browser);
    const R = await page.evaluate(async () => {
        const cmdr = (await import('/commander/diplomat.js')).default;
        const cfg = await import('/js/config.js');
        const CAMP = cfg.CAMP;
        const R = { passed: 0, failed: 0, logs: [] };
        const assert = (cond, msg) => { if (cond) R.passed++; else R.failed++; R.logs.push((cond ? "✓" : "✗") + " " + msg); };

        try {
            {
                const gs = { _cardOverrides: {} };
                const u = { camp: CAMP.player1 };
                cmdr.onDeploy(u, gs, {});
                assert(gs._cardOverrides.player1 !== undefined, 'cardOverrides.player1 已设置');
                assert(gs._cardOverrides.player1.handSizeBonus === 1, 'handSizeBonus=1');
                assert(gs._cardOverrides.player1.useBonus === 1, 'useBonus=1');
            }
        } catch(e) { assert(false, '第 1 项异常: ' + e.message); }
        try {
            {
                const gs = { _cardOverrides: {} };
                const u = { camp: CAMP.player2 };
                cmdr.onDeploy(u, gs, {});
                assert(gs._cardOverrides.player2 !== undefined, '蓝军 campKey=player2');
            }
        } catch(e) { assert(false, '第 2 项异常: ' + e.message); }
        { assert(true, '不抛异常'); }
        return R;
    });
    R.logs.forEach(l => console.log('  ' + l));
    console.log(`  —— cmd/diplomat: ${R.passed} 通过 / ${R.failed} 失败`);
    await page.context().close();
    return { passed: R.passed, failed: R.failed };
}
