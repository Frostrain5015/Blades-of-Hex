// ironGuard 逻辑测试 — 重写
import { newTestPage } from './helpers.mjs';

export async function run(browser) {
    const page = await newTestPage(browser);
    const R = await page.evaluate(async () => {
        const cmdr = (await import('/commander/ironGuard.js')).default;
        const R = { passed: 0, failed: 0, logs: [] };
        const assert = (cond, msg) => { if (cond) R.passed++; else R.failed++; R.logs.push((cond ? "✓" : "✗") + " " + msg); };
        const camp = { name: '红军' };

        // 1) onDeploy → 120盾
        { const u = { _shield: 0, _shieldMax: 0, _shieldTurns: 0 }; cmdr.onDeploy(u, {}, {}); assert(u._shield === 120, '盾120'); assert(u._shieldMax === 120, '上限120'); }
        // 2) onTurnStart → 回盾
        {
            const log = [];
            const u = { commander: 'ironGuard', camp, _shield: 50, _shieldMax: 120, _shieldTurns: 0, tile: { x: 400, y: 300, q: 0, r: 0 } };
            const gs = { tiles: [{ q: 0, r: 0, x: 400, y: 300, unit: u }] };
            cmdr.onTurnStart(gs, camp, { logMessage: m => log.push(m) });
            assert(u._shield === 90, '回盾40(50→90)');
            assert(log.some(l => l.includes('回复')), '日志含回复');
        }
        // 3) 吸收伤害
        { const ig = { commander: 'ironGuard', _shield: 100, tile: { x: 400, y: 300 } }; const gs = { damageTexts: [], tiles: [] }; const r = cmdr.onDamageTakenAlly(null, 60, ig, { gameState: gs, spawnFx: () => {} }); assert(ig._shield === 40, '吸收40'); assert(r === 0, '剩余0'); }
        // 4) 盾耗尽
        { const ig = { commander: 'ironGuard', _shield: 10, tile: { x: 400, y: 300 } }; const gs = { damageTexts: [], tiles: [] }; const r = cmdr.onDamageTakenAlly(null, 30, ig, { gameState: gs, spawnFx: () => {} }); assert(ig._shield === 0, '盾=0'); assert(r === 20, '剩20'); }
        // 5) 灵光10%
        { assert(Math.abs(cmdr.getAuraDefenseBonus() - 0.10) < 0.001, '灵光10%'); }
        return R;
    });
    R.logs.forEach(l => console.log('  ' + l));
    console.log(`  —— cmd/ironGuard: ${R.passed} 通过 / ${R.failed} 失败`);
    await page.context().close();
    return { passed: R.passed, failed: R.failed };
}
