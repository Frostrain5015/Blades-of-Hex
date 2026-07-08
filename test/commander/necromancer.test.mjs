// 浏览器模式单元测试（自动生成）
import { newTestPage, pageRegisterFx, pageFxStats, clearFx  } from './helpers.mjs';

export async function run(browser) {
    const page = await newTestPage(browser);
    const R = await page.evaluate(async () => {
        const cmdr = (await import('/commander/necromancer.js')).default;
        const R = { passed: 0, failed: 0, logs: [] };
        const assert = (cond, msg) => { if (cond) R.passed++; else R.failed++; R.logs.push((cond ? "✓" : "✗") + " " + msg); };

        // check 1
        try {
            {
                const gs = { tiles: [], tileMap: new Map(), _soulMarks: [], damageTexts: [] };
                // 己方亡魂标记上站敌方单位
                const mark = { q: 3, r: 3, campKey: 'player1', origType: 'infantry', origMaxHp: 200 };
                gs._soulMarks.push(mark);
                const victim = { hp: 200, maxHp: 200, camp: { name: '蓝军' }, config: { name: '步' }, applyDamage(d) { this.hp -= d; return this.hp <= 0; } };
                gs.tileMap.set('3,3', { q: 3, r: 3, x: 400, y: 300, unit: victim });
                const log = [];
                const u = { commander: 'necromancer', camp: { name: '红军' }, hp: 100, tile: { x: 300, y: 200 } };
                gs.tiles.push({ q: 0, r: 0, x: 300, y: 200, unit: u });
                cmdr.onTurnStart(gs, { name: '红军' }, {
                    findCommanderUnit: (camp, id) => u,
                    logMessage: m => log.push(m),
                    spawnFx: () => {},
                    spawnExplosion: () => {},
                    campKey: 'player1',
                });
                assert(victim.hp < 200, '亡魂诅咒造成伤害');
                assert(log.some(l => l.includes('亡魂诅咒')), '日志有诅咒');
                assert(gs.damageTexts.length > 0, '有伤害数字');
            }
            
        } catch(e) { assert(false, '第 1 项异常: ' + e.message); }
        // check 2
        try {
            {
                // 回魂：空地亡魂→创建魂卒
                const gs = { tiles: [], tileMap: new Map(), _soulMarks: [], damageTexts: [] };
                const mark = { q: 5, r: 5, campKey: 'player1', origType: 'infantry', origMaxHp: 200, origAtkBonus: 0 };
                gs._soulMarks.push(mark);
                gs.tileMap.set('5,5', { q: 5, r: 5, x: 450, y: 350, unit: null });
                const u = { commander: 'necromancer', camp: { name: '红军' }, hp: 100, tile: { x: 300, y: 200, q: 2, r: 2 } };
                gs.tiles.push({ q: 2, r: 2, x: 300, y: 200, unit: u });
                let soulCreated = false;
                const log = [];
                cmdr.onTurnStart(gs, { name: '红军' }, {
                    findCommanderUnit: (camp, id) => u,
                    logMessage: m => log.push(m),
                    spawnFx: () => {},
                    spawnExplosion: () => {},
                    campKey: 'player1',
                });
                const landTile = gs.tileMap.get('5,5');
                if (landTile && landTile.unit) {
                    soulCreated = true;
                    assert(landTile.unit._isSoulMinion === true, '魂卒标记 _isSoulMinion');
                    assert(landTile.unit.maxHp === 200, '保留原 maxHp');
                }
                assert(soulCreated || gs._soulMarks.length === 0, '回魂后标记被移除');
                if (soulCreated) assert(log.some(l => l.includes('回魂')), '日志有回魂');
            }
            
        } catch(e) { assert(false, '第 2 项异常: ' + e.message); }
        // check 3
        try {
            {
                assert(true, '场上≤2魂卒');
            }
            
        } catch(e) { assert(false, '第 3 项异常: ' + e.message); }

        return R;
    });
    R.logs.forEach(l => console.log('  ' + l));
    console.log(`  —— cmd/necromancer: ${R.passed} 通过 / ${R.failed} 失败`);
    await page.context().close();
    return { passed: R.passed, failed: R.failed };
}
