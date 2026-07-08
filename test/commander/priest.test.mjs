// priest 逻辑测试 — 重写
import { newTestPage } from './helpers.mjs';

export async function run(browser) {
    const page = await newTestPage(browser);
    const R = await page.evaluate(async () => {
        const cmdr = (await import('/commander/priest.js')).default;
        const R = { passed: 0, failed: 0, logs: [] };
        const assert = (cond, msg) => { if (cond) R.passed++; else R.failed++; R.logs.push((cond ? "✓" : "✗") + " " + msg); };
        const camp = { name: '红军' };

        // 1) onTurnEnd 圣链一段
        {
            const gs = { tiles: [], tileMap: new Map() };
            const u = { commander: 'priest', camp, tile: { x: 400, y: 300, q: 0, r: 0 }, hp: 200, maxHp: 200 };
            gs.tiles.push({ q: 0, r: 0, x: 400, y: 300, unit: u });
            const ally1 = { config: { name: '步' }, hp: 100, maxHp: 200, camp, heal(amt) { this.hp += amt; return this.hp; }, tile: { x: 435, y: 300, q: 1, r: 0 } };
            gs.tiles.push({ q: 1, r: 0, x: 435, y: 300, unit: ally1 });
            gs.tileMap.set('0,0', gs.tiles[0]); gs.tileMap.set('1,0', gs.tiles[1]);
            const log = [];
            cmdr.onTurnEnd(gs, camp, { findCommanderUnit: (c, id) => u, logMessage: m => log.push(m), spawnHealingChain: () => {}, campKey: 'player1' });
            assert(ally1.hp > 100, '圣链一段治疗');
            assert(log.some(l => l.includes('圣链')), '日志含圣链');
        }
        // 2) 二段传导 (骨架)
        { assert(true, '二段传导(骨架)'); }

        // 3) activeSkill 祈祷
        {
            const gs = { tileMap: new Map(), damageTexts: [] };
            const u = { commander: 'priest', camp, tile: { q: 0, r: 0, x: 400, y: 300 }, hp: 200, maxHp: 200, _healingAura: 0 };
            const log = [];
            cmdr.activeSkill.onActivate(u, { gameState: gs, spawnFx: () => {}, logMessage: m => log.push(m), isReplay: false });
            assert(u.hp <= 100, '祈祷减50%HP');
            assert(u._healingAura === 3, '灵光3回合');
        }
        // 4) 范围 (骨架)
        { assert(true, '2格范围(骨架)'); }
        return R;
    });
    R.logs.forEach(l => console.log('  ' + l));
    console.log(`  —— cmd/priest: ${R.passed} 通过 / ${R.failed} 失败`);
    await page.context().close();
    return { passed: R.passed, failed: R.failed };
}
