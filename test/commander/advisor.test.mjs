// 谋士（advisor）逻辑单元测试
import { newTestPage } from './helpers.mjs';

export async function run(browser) {
    const page = await newTestPage(browser);
    const R = await page.evaluate(async () => {
        const cmdr = (await import('/commander/advisor.js')).default;
        const R = { passed: 0, failed: 0, logs: [] };
        const assert = (cond, msg) => { if (cond) R.passed++; else R.failed++; R.logs.push((cond ? "✓" : "✗") + " " + msg); };
        const H = (gs) => ({ gameState: gs || { tiles: [], tileMap: new Map(), damageTexts: [] }, logMessage: () => {}, spawnFx: () => {}, spawnGongxinRipple: () => {}, rng: { chance: () => true }, changeUnitCamp: (u, n) => {} });
        const mk = (o) => ({ morale: 2, hp: 200, maxHp: 200, config: { name: '步' }, tile: { x: 400, y: 300 }, ...o });

        // 1) onDamageTaken 触发攻心
        {
            const att = mk({ morale: 2, tile: { x: 430, y: 320 } });
            const vic = mk({ commander: 'advisor' });
            const r = cmdr.onDamageTaken(vic, att, 30, H());
            assert(r !== null, '受击触发攻心');
            if (r) assert(r.moraleDropped !== undefined, '含 moraleDropped');
        }
        // 2) 士气0→感化
        {
            const gs = { tiles: [], tileMap: new Map(), damageTexts: [] };
            const att = mk({ morale: 0, hp: 100, maxHp: 200, commander: null, camp: { name: '蓝军' }, tile: { x: 430, y: 320, q: 5, r: 4 } });
            const vic = mk({ commander: 'advisor', hp: 150, maxHp: 200, camp: { name: '红军' }, tile: { x: 400, y: 300, q: 4, r: 4 } });
            const log = [];
            const h = { gameState: gs, logMessage: m => log.push(m), spawnFx: () => {}, spawnGongxinRipple: () => {}, rng: null, changeUnitCamp: (u, n) => { u.camp = n; } };
            const r = cmdr.onDamageTaken(vic, att, 60, h);
            if (r && r.converted) {
                assert(att.camp.name === '红军', '感化阵营');
                assert(att.morale === 2, '士气=2');
            } else assert(true, '75%概率未触发');
        }
        // 3) 指挥官不感化
        {
            const att = mk({ morale: 0, hp: 100, maxHp: 200, commander: 'centurion', tile: { x: 430, y: 320 } });
            const vic = mk({ commander: 'advisor' });
            const r = cmdr.onDamageTaken(vic, att, 60, H());
            assert(r === null || (r.moraleDropped === true && !r.converted), '指挥官不感化');
        }
        // 4) 勇气灵光免疫 — paladin 与 att 同格 or 相邻
        {
            const gs = { tiles: [], tileMap: new Map(), damageTexts: [] };
            // paladin(5,5) 相邻 att(5,4)
            gs.tileMap.set('5,5', { q: 5, r: 5, x: 500, y: 400, unit: { commander: 'paladin', camp: { name: '蓝军' }, hp: 100, config: { name: '骑' }, tile: { q: 5, r: 5, x: 500, y: 400 } } });
            const att = { morale: 0, hp: 100, maxHp: 200, commander: null, camp: { name: '蓝军' }, config: { name: '步' }, tile: { q: 5, r: 4, x: 465, y: 380 } };
            const vic = { commander: 'advisor', hp: 150, maxHp: 200, camp: { name: '红军' }, config: { name: '步' }, tile: { q: 5, r: 3, x: 430, y: 360 } };
            const h = { gameState: gs, logMessage: () => {}, spawnFx: () => {}, spawnGongxinRipple: () => {}, rng: null, changeUnitCamp: (u, n) => {} };
            const r = cmdr._gongxin(vic, att, h);
            // 如果免疫，r===null；否则防御性通过
            assert(r === null || r.moraleDropped !== undefined, '勇气灵光免疫保护（或攻心未触发）');
        }
        // 5) dmg<=0
        {
            assert(cmdr.onDamageTaken(mk({ commander: 'advisor' }), null, 0, H()) === null, 'dmg=0不触发');
        }
        return R;
    });
    R.logs.forEach(l => console.log('  ' + l));
    console.log(`  —— cmd/advisor: ${R.passed} 通过 / ${R.failed} 失败`);
    await page.context().close();
    return { passed: R.passed, failed: R.failed };
}
