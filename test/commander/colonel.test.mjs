import { newTestPage } from './helpers.mjs';

export async function run(browser) {
    const page = await newTestPage(browser);
    const R = await page.evaluate(async () => {
        const cmdr = (await import('/commander/colonel.js')).default;
        const cfg = await import('/js/config.js');
        const CAMP = cfg.CAMP;
        const R = { passed: 0, failed: 0, logs: [] };
        const assert = (cond, msg) => { if (cond) R.passed++; else R.failed++; R.logs.push((cond ? "✓" : "✗") + " " + msg); };

        try {
            {
                const gs = { _colonelDeployed: {}, playerHands: { player1: [] } };
                const u = { camp: CAMP.player1 };
                cmdr.onDeploy(u, gs, {});
                assert(gs._colonelDeployed.player1 === true, '_colonelDeployed.player1=true');
                assert(gs.playerHands.player1.length === 3, '发放 3 张空军卡');
                assert(gs.playerHands.player1.includes('diveStrafe'), '含扫射');
                assert(gs.playerHands.player1.includes('carpetBomb'), '含轰炸');
                assert(gs.playerHands.player1.includes('airlift'), '含空运');
            }
        } catch(e) { assert(false, '第 1 项异常: ' + e.message); }
        try {
            {
                const gs = { _colonelDeployed: {}, playerHands: { player2: [] } };
                const u = { camp: CAMP.player2 };
                cmdr.onDeploy(u, gs, {});
                assert(gs._colonelDeployed.player2 === true, '蓝军 campKey=player2');
                assert(gs.playerHands.player2.length === 3, '蓝军也获得 3 卡');
            }
        } catch(e) { assert(false, '第 2 项异常: ' + e.message); }
        { assert(true, '不抛异常'); }
        return R;
    });
    R.logs.forEach(l => console.log('  ' + l));
    console.log(`  —— cmd/colonel: ${R.passed} 通过 / ${R.failed} 失败`);
    await page.context().close();
    return { passed: R.passed, failed: R.failed };
}
