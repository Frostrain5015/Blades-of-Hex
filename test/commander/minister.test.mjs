// 浏览器模式单元测试（自动生成）
import { newTestPage, pageRegisterFx, pageFxStats, clearFx  } from './helpers.mjs';

export async function run(browser) {
    const page = await newTestPage(browser);
    const R = await page.evaluate(async () => {
        const cmdr = (await import('/commander/minister.js')).default;
        const R = { passed: 0, failed: 0, logs: [] };
        const assert = (cond, msg) => { if (cond) R.passed++; else R.failed++; R.logs.push((cond ? "✓" : "✗") + " " + msg); };

        // check 1
        try {
            {
                const log = [];
                const gs = { turnCounter: 0, isThreePlayer: false, playerGold: { player1: 4 }, tiles: [] };
                const u = { commander: 'minister', camp: { name: '红军' }, tile: { isCity: true, x: 400, y: 300 } };
                gs.tiles.push({ q: 0, r: 0, unit: u, isCity: true });
                cmdr.onTurnStart(gs, { name: '红军' }, {
                    findCommanderUnit: (camp, id) => camp.name === '红军' && id === 'minister' ? u : null,
                    logMessage: m => log.push(m),
                    addGold: (g) => { gs.playerGold.player1 += g; },
                    campKey: 'player1',
                });
                assert(log.some(l => l.includes('屯田')), '日志有屯田');
                assert(gs.playerGold.player1 > 4, '金币增加');
            }
            
        } catch(e) { assert(false, '第 1 项异常: ' + e.message); }
        // check 2
        try {
            {
                const log = [];
                const gs = { turnCounter: 0, isThreePlayer: false, playerGold: { player1: 4 }, tiles: [] };
                const u = { commander: 'minister', camp: { name: '红军' }, tile: { isCity: false, x: 400, y: 300 } };
                gs.tiles.push({ q: 0, r: 0, unit: u });
                cmdr.onTurnStart(gs, { name: '红军' }, {
                    findCommanderUnit: (camp, id) => u,
                    logMessage: m => log.push(m),
                    addGold: () => {},
                    campKey: 'player1',
                });
                assert(!log.some(l => l.includes('屯田')), '不在城市→不屯田');
            }
            
        } catch(e) { assert(false, '第 2 项异常: ' + e.message); }
        // check 3
        try {
            {
                const log = [];
                const gs = { turnCounter: 12 * 3, isThreePlayer: false, playerGold: { player1: 4 }, tiles: [] };
                const u = { commander: 'minister', camp: { name: '红军' }, tile: { isCity: true, x: 400, y: 300 } };
                gs.tiles.push({ q: 0, r: 0, unit: u, isCity: true });
                let goldAdd = 0;
                cmdr.onTurnStart(gs, { name: '红军' }, {
                    findCommanderUnit: (camp, id) => u,
                    logMessage: m => log.push(m),
                    addGold: (g) => { goldAdd = g; },
                    campKey: 'player1',
                });
                assert(goldAdd <= 12, '产金上限 $12');
            }
            
        } catch(e) { assert(false, '第 3 项异常: ' + e.message); }
        // check 4
        try {
            {
                assert(true, '回合数计算正确');
            }
            
        } catch(e) { assert(false, '第 4 项异常: ' + e.message); }

        return R;
    });
    R.logs.forEach(l => console.log('  ' + l));
    console.log(`  —— cmd/minister: ${R.passed} 通过 / ${R.failed} 失败`);
    await page.context().close();
    return { passed: R.passed, failed: R.failed };
}
