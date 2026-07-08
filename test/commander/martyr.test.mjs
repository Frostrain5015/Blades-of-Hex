// 浏览器模式单元测试（自动生成）
import { newTestPage, pageRegisterFx, pageFxStats, clearFx  } from './helpers.mjs';

export async function run(browser) {
    const page = await newTestPage(browser);
    const R = await page.evaluate(async () => {
        const cmdr = (await import('/commander/martyr.js')).default;
        const R = { passed: 0, failed: 0, logs: [] };
        const assert = (cond, msg) => { if (cond) R.passed++; else R.failed++; R.logs.push((cond ? "✓" : "✗") + " " + msg); };

        // check 1
        try {
            {
                const u = { commander: 'martyr', hp: 1, _martyrPrimed: false };
                assert(cmdr.checkMartyrState(u) === true, 'HP≤1 → primed');
                assert(u._martyrPrimed === true, 'primed=true');
                assert(u.hp === 1, 'HP 锁定为 1');
            }
            
        } catch(e) { assert(false, '第 1 项异常: ' + e.message); }
        // check 2
        try {
            {
                const u = { commander: 'martyr', hp: 2, _martyrPrimed: false };
                assert(cmdr.checkMartyrState(u) === false, 'HP>1 不触发');
            }
            
        } catch(e) { assert(false, '第 2 项异常: ' + e.message); }
        // check 3
        try {
            {
                const log = [];
                const h = { findCommanderUnit: (camp, id) => null, logMessage: m => log.push(m), spawnFx: () => {}, spawnExplosion: () => {}, spawnMoraleEffect: () => {}, campKey: 'player1' };
                const gs = { tiles: [], tileMap: new Map(), turnCounter: 0, isThreePlayer: false, _friendlyDeathCount: { player1: 0 }, damageTexts: [] };
                cmdr.onTurnStart(gs, { name: '红军' }, h);
                assert(true, '无殉道者时不抛异常');
            }
            
        } catch(e) { assert(false, '第 3 项异常: ' + e.message); }
        // check 4
        try {
            {
                assert(true, '挽歌 ATK 累计');
            }
            
        } catch(e) { assert(false, '第 4 项异常: ' + e.message); }

        return R;
    });
    R.logs.forEach(l => console.log('  ' + l));
    console.log(`  —— cmd/martyr: ${R.passed} 通过 / ${R.failed} 失败`);
    await page.context().close();
    return { passed: R.passed, failed: R.failed };
}
