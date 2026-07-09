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
                const victim = {
                    hp: 100,
                    maxHp: 200,
                    camp: { name: '蓝军' },
                    config: { name: '步' },
                    lastDamage: 0,
                    applyDamage(d) {
                        this.lastDamage = d;
                        this.hp -= d;
                        return this.hp <= 0;
                    }
                };
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
                assert(victim.lastDamage === 60, '亡魂诅咒按20+40%已损生命计算伤害');
                assert(victim.hp === 40, '亡魂诅咒造成正确伤害');
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
                // 亡魂诅咒致死：亡灵法师本人获得普通击杀奖励
                const gs = { tiles: [], tileMap: new Map(), _soulMarks: [], damageTexts: [], turnCounter: 3, isThreePlayer: false };
                const mark = { q: 6, r: 6, campKey: 'player1', origType: 'infantry', origMaxHp: 200 };
                gs._soulMarks.push(mark);
                const victim = {
                    hp: 30,
                    maxHp: 200,
                    _rank: 2,
                    camp: { name: '蓝军' },
                    config: { name: '骑' },
                    lastDamage: 0,
                    lastAttacker: null,
                    applyDamage(d, opts) {
                        this.lastDamage = d;
                        this.lastAttacker = opts.attacker;
                        this.hp -= d;
                        return this.hp <= 0;
                    }
                };
                gs.tileMap.set('6,6', { q: 6, r: 6, x: 500, y: 360, unit: victim });
                const u = {
                    commander: 'necromancer',
                    camp: { name: '红军' },
                    config: { name: '步' },
                    hp: 100,
                    morale: 2,
                    moraleBoostUntil: 0,
                    _xp: 0,
                    tile: { x: 300, y: 200, q: 2, r: 2 },
                    addXP(amount) { this._xp += amount; }
                };
                gs.tiles.push({ q: 2, r: 2, x: 300, y: 200, unit: u });
                let moraleFx = 0;
                let onKillCalled = false;
                cmdr.onTurnStart(gs, { name: '红军' }, {
                    findCommanderUnit: (camp, id) => u,
                    logMessage: () => {},
                    spawnFx: () => {},
                    spawnExplosion: () => {},
                    spawnMoraleEffect: () => { moraleFx++; },
                    triggerCommanderOnKill: (killer, killed) => {
                        onKillCalled = killer === u && killed === victim;
                    },
                    campKey: 'player1',
                });
                assert(victim.lastDamage === 88, '致死诅咒按斩杀公式计算伤害');
                assert(victim.lastAttacker === u, '诅咒击杀传入亡灵法师作为击杀者');
                assert(u.morale === 3 && u.moraleBoostUntil === 3, '亡灵法师获得普通击杀士气');
                assert(moraleFx === 1, '亡灵法师击杀士气特效触发');
                assert(u._xp === 8, '亡灵法师获得普通击杀经验');
                assert(onKillCalled, '亡魂诅咒致死触发将领击杀钩子');
            }
            
        } catch(e) { assert(false, '第 3 项异常: ' + e.message); }

        return R;
    });
    R.logs.forEach(l => console.log('  ' + l));
    console.log(`  —— cmd/necromancer: ${R.passed} 通过 / ${R.failed} 失败`);
    await page.context().close();
    return { passed: R.passed, failed: R.failed };
}
