// fallenAngel（堕天使）逻辑测试
import { newTestPage } from './helpers.mjs';

export async function run(browser) {
    const page = await newTestPage(browser);
    const R = await page.evaluate(async () => {
        const cmdr = (await import('/commander/fallenAngel.js')).default;
        const R = { passed: 0, failed: 0, logs: [] };
        const assert = (cond, msg) => { if (cond) R.passed++; else R.failed++; R.logs.push((cond ? "✓" : "✗") + " " + msg); };
        const camp = { name: '红军' };

        // 1) onMoraleChange → 黑
        {
            const u = { _fallen: false, morale: 2, tile: { x: 400, y: 300 }, camp, config: { name: '步' }, hp: 150 };
            cmdr.onMoraleChange(u, 2, 1, { logMessage: () => {}, spawnFx: () => {} });
            assert(u._fallen === true, '士气下降→黑');
        }

        // 2) 白 → 回血30%
        {
            const u = { _fallen: false, hp: 100, maxHp: 200, commander: 'fallenAngel', camp, tile: { x: 400, y: 300, q: 0, r: 0 } };
            u.heal = function(amt) { const old = this.hp; this.hp = Math.min(this.maxHp, this.hp + amt); return this.hp - old; };
            const gs = { tiles: [{ q: 0, r: 0, x: 400, y: 300, unit: u }], damageTexts: [] };
            cmdr.onTurnStart(gs, camp, { logMessage: () => {}, spawnFx: () => {} });
            assert(u.hp > 100, '白形态回血30%');
        }

        // 3) 黑 → 流失20%
        {
            const u = { _fallen: true, hp: 150, maxHp: 200, commander: 'fallenAngel', camp,
                tile: { x: 400, y: 300, q: 0, r: 0 },
                applyDamage(d, o) { this.hp = Math.max(o?.minHp ?? 0, this.hp - d); return this.hp <= 0; } };
            const gs = { tiles: [{ q: 0, r: 0, x: 400, y: 300, unit: u }], damageTexts: [] };
            cmdr.onTurnStart(gs, camp, { logMessage: () => {}, spawnFx: () => {} });
            assert(gs.damageTexts.length > 0, '黑流失伤害数字');
            assert(u.hp < 150, 'HP下降');
        }

        // 4) 攻击/暴击加成
        {
            assert(cmdr.getAttackBonus({ _fallen: true }) === 30, '黑+30攻');
            assert(cmdr.getCritRateBonus({ _fallen: true }) === 0.60, '黑+60%暴');
            assert(cmdr.getAttackBonus({ _fallen: false }) === 0, '白+0攻');
            assert(cmdr.getCritRateBonus({ _fallen: false }) === 0, '白+0%暴');
        }
        return R;
    });
    R.logs.forEach(l => console.log('  ' + l));
    console.log(`  —— cmd/fallenAngel: ${R.passed} 通过 / ${R.failed} 失败`);
    await page.context().close();
    return { passed: R.passed, failed: R.failed };
}
