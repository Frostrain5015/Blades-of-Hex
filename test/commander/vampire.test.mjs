// 吸血鬼（vampire）逻辑单元测试 — 浏览器模式
import { newTestPage } from './helpers.mjs';

export async function run(browser) {
    const page = await newTestPage(browser);
    const R = await page.evaluate(async () => {
        const cmdr = (await import('/commander/vampire.js')).default;
        const R = { passed: 0, failed: 0, logs: [] };
        const log = R.logs;
        const assert = (cond, msg) => { if (cond) R.passed++; else R.failed++; log.push((cond ? '✓' : '✗') + ' ' + msg); };

        // 1) _getHeal: 30%~60% 区间
        {
            const dmg = 100;
            const minimum = cmdr._getHeal(dmg, { range: min => min });
            const midpoint = cmdr._getHeal(dmg, { range: (min, max) => (min + max) / 2 });
            const maximum = cmdr._getHeal(dmg, { range: (min, max) => max });
            assert(minimum === 30 && midpoint === 45 && maximum === 60, '_getHeal 使用注入 RNG 返回 30%-60% 区间');
        }

        // 2) _applyHealAndShield: 正常回血
        {
            const u = { hp: 100, maxHp: 200, heal(amt) { const o = this.hp; this.hp = Math.min(this.maxHp, this.hp + amt); return this.hp - o; }, _shield: 0 };
            const r = cmdr._applyHealAndShield(u, 40, { logMessage: () => {} });
            assert(r.healAmt === 40, '回血 40 HP');
            assert(r.shieldGain === 0, '无溢出护盾');
        }

        // 3) 溢出治疗转护盾
        {
            const u = { hp: 190, maxHp: 200, heal(amt) { const o = this.hp; this.hp = Math.min(this.maxHp, this.hp + amt); return this.hp - o; }, _shield: 0 };
            const r = cmdr._applyHealAndShield(u, 40, { logMessage: () => {} });
            assert(r.healAmt === 10, '只能回 10 到满血');
            assert(r.shieldGain > 0, '有护盾转化');
            assert(u._shield > 0, '护盾值>0');
        }

        // 4) 护盾上限 60
        {
            const u = { hp: 200, maxHp: 200, heal() { return 0; }, _shield: 55 };
            const r = cmdr._applyHealAndShield(u, 20, { logMessage: () => {} });
            assert(u._shield <= 60, '护盾不超过 60');
        }

        // 5) onAttack 不回显 dmg<=0
        {
            const att = { tile: { x: 100, y: 200 }, heal() { return 0; } };
            const r = cmdr.onAttack(att, null, -1, { spawnFx: () => {}, logMessage: () => {} });
            assert(r === null, 'dmg<=0 返回 null');
        }

        return R;
    });

    R.logs.forEach(l => console.log('  ' + l));
    console.log(`  —— 吸血鬼: ${R.passed} 通过 / ${R.failed} 失败`);
    await page.context().close();
    return { passed: R.passed, failed: R.failed };
}
