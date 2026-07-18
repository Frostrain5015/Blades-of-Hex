// 浏览器模式单元测试（自动生成）
import { newTestPage, pageRegisterFx, pageFxStats, clearFx  } from './helpers.mjs';

export async function run(browser) {
    const page = await newTestPage(browser);
    const R = await page.evaluate(async () => {
        const cmdr = (await import('/commander/paladin.js')).default;
        const R = { passed: 0, failed: 0, logs: [] };
        const assert = (cond, msg) => { if (cond) R.passed++; else R.failed++; R.logs.push((cond ? "✓" : "✗") + " " + msg); };

        // check 1
        try {
            {
                const u = { _faith: 0, id: 'p1', tile: { x: 400, y: 300 } };
                const h = { spawnOrbitBeams: (uid, x, y, c) => { u._orbitSync = c; } };
                cmdr.onDeploy(u, {}, h);
                assert(u._faith === 1, '部署 _faith=1');
            }
            
        } catch(e) { assert(false, '第 1 项异常: ' + e.message); }
        // check 2
        try {
            {
                const u = { _faith: 1, _oathGainTurn: -1, id: 'p1', tile: { x: 400, y: 300 } };
                const h = { gameState: { turnCounter: 0, isThreePlayer: false }, spawnOrbitBeams: (uid, x, y, c) => { u._orbitSync = c; } };
                cmdr.onKill(u, { hp: 0 }, h);
                assert(u._faith === 2, '击杀 +1 誓言');
            }
            
        } catch(e) { assert(false, '第 2 项异常: ' + e.message); }
        // check 3
        try {
            {
                const u = { _faith: 2, _oathGainTurn: -1, camp: { name: '红军' } };
                const palUnit = { _faith: 2, id: 'p1', _oathGainTurn: -1, tile: { x: 400, y: 300 } };
                const log = [];
                const h = { gameState: { turnCounter: 0, isThreePlayer: false }, logMessage: m => log.push(m), spawnOrbitBeams: () => {} };
                cmdr.onAllyDamage(u, 30, palUnit, h);
                assert(palUnit._faith === 3, '友军受击 +1 誓言');
                assert(log.some(l => l.includes('誓言')), '日志有誓言');
            }
            
        } catch(e) { assert(false, '第 3 项异常: ' + e.message); }
        // check 4
        try {
            {
                const u = { _faith: 3, _smiteReady: false, _smiteCharged: false, tile: { x: 400, y: 300 } };
                const r = cmdr.activeSkill.onActivate(u, { logMessage: () => {}, spawnFx: () => {}, isReplay: false });
                assert(u._smiteReady === true, '蓄力后 _smiteReady=true');
                assert(u._faith === 2, '消耗 1 层誓言');
            }
            
        } catch(e) { assert(false, '第 4 项异常: ' + e.message); }
        // check 5
        try {
            {
                const u = { _faith: 0, _smiteReady: true, _smiteCharged: false, activeSkillCD: 0, id: 'p1', tile: { x: 400, y: 300 } };
                const target = { tile: { x: 450, y: 350 } };
                const log = [];
                const h = { logMessage: m => log.push(m), spawnGoldenBeam: () => {}, spawnOrbitBeams: () => {}, rng: { between: (min) => min } };
                const r = cmdr.onAttack(u, target, 50, h);
                assert(r !== null, '至圣斩触发');
                if (r) assert(r.smiteDmg === 25, '至圣斩使用注入 RNG，最低伤害为 25');
            }
            
        } catch(e) { assert(false, '第 5 项异常: ' + e.message); }

        return R;
    });
    R.logs.forEach(l => console.log('  ' + l));
    console.log(`  —— cmd/paladin: ${R.passed} 通过 / ${R.failed} 失败`);
    await page.context().close();
    return { passed: R.passed, failed: R.failed };
}
