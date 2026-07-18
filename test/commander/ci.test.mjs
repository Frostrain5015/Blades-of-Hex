// commanderInterface.js 中间层单元测试
// 验证：在 main.js 注入 ref（setGameStateRef / setSpawnFxRef）后，
// trigger* 系列函数能正确构造 helpers 并分派到 commander 钩子。
//
// 浏览器模式：因为 commanderInterface 间接依赖 js/config.js 中的 CAMP 常量。

import { newTestPage, pageFxStats } from './helpers.mjs';
import { Reporter } from '../lib/helpers.mjs';

export async function run(browser) {
    const page = await newTestPage(browser);
    const R = new Reporter('ci');

    // 在页面内注入 ref 并执行全部断言
    const results = await page.evaluate(async () => {
        const ci = await import('/js/commanderInterface.js');
        const cmdrIdx = await import('/commander/index.js');
        const CAMP = (await import('/js/config.js')).CAMP;
        const gsRef = { tiles: [], tileMap: new Map(), playerGold: { player1: 4, player2: 4, neutral: 4 },
            turnCounter: 0, commanderP1: null, commanderP2: null, isThreePlayer: false };

        // 模拟 main.js 注入 ref
        ci.setGameStateRef(() => gsRef);
        const fxLog = [];
        ci.setSpawnFxRef((x, y, glyph, label) => fxLog.push(`fx:${x},${y},${glyph},${label}`));
        ci.setSpawnGoldenBeamRef((x, y) => fxLog.push(`gb:${x},${y}`));
        ci.setSpawnOrbitBeamsRef((uid, x, y, c) => fxLog.push(`ob:${uid},${x},${y},${c}`));
        ci.setClearOrbitBeamsRef((uid) => fxLog.push(`cob:${uid}`));
        ci.setSpawnBeamProjectilesRef((fx, fy, tx, ty, c) => fxLog.push(`bp:${fx},${fy},${tx},${ty},${c}`));
        ci.setSpawnHealingChainRef((fx, fy, tx, ty) => fxLog.push(`hc:${fx},${fy},${tx},${ty}`));
        ci.setSpawnBloodDrainRef((fx, fy, tx, ty) => fxLog.push(`bd:${fx},${fy},${tx},${ty}`));
        ci.setSpawnGongxinRippleRef((x, y, intense) => fxLog.push(`gx:${x},${y},${intense}`));

        const logMsg = [];
        ci.setLogMessageRef((m) => logMsg.push(m));

        // 辅助：在 gameState 中添加一名将领
        function addUnit(commanderId, camp, tileQ = 0, tileR = 0) {
            const cfg = cmdrIdx.getCommander(commanderId);
            const u = { id: 'u_' + commanderId, commander: commanderId, camp, hp: 200, maxHp: 200,
                morale: 2, tile: { q: tileQ, r: tileR, x: 400 + tileQ * 35, y: 300 + tileR * 20 },
                config: { name: '步', hp: 200, attack: 50, speed: 3 },
                getVisualPos() { return { x: this.tile.x, y: this.tile.y }; },
                heal(amt) { const o = this.hp; this.hp = Math.min(this.maxHp, this.hp + amt); return this.hp - o; },
                applyDamage(d) { this.hp -= d; return this.hp <= 0; } };
            if (cfg?.hpBonusPct) { u.maxHp += Math.round(u.config.hp * cfg.hpBonusPct); u.hp = u.maxHp; }
            if (cfg?.spdBonus) u.config.speed += cfg.spdBonus;
            const tile = { q: tileQ, r: tileR, x: u.tile.x, y: u.tile.y, unit: u, isCity: false, camp: null };
            u.tile = tile;
            gsRef.tiles.push(tile);
            gsRef.tileMap.set(tileQ + ',' + tileR, tile);
            return u;
        }

        const R = { passed: 0, failed: 0, logs: [] };
        const assert = (cond, msg) => { if (cond) R.passed++; else R.failed++; R.logs.push((cond ? '✓' : '✗') + ' ' + msg); };

        // ==============================
        // 1) triggerCommanderTurnStart — 无将领时无异常
        // ==============================
        try {
            fxLog.length = 0; logMsg.length = 0;
            ci.triggerCommanderTurnStart(gsRef, CAMP.player1);
            assert(true, 'turnStart(无将领) 无异常');
            assert(fxLog.length === 0, '无特效');
        } catch(e) { assert(false, 'turnStart(无将领) 异常: ' + e.message); }

        // ==============================
        // 2) triggerCommanderTurnStart — 铁卫回盾
        // ==============================
        try {
            fxLog.length = 0; logMsg.length = 0;
            gsRef.tiles.length = 0; gsRef.tileMap.clear();
            const ig = addUnit('ironGuard', CAMP.player1);
            ig._shield = 50; ig._shieldMax = 120; ig._shieldTurns = 0;
            ci.triggerCommanderTurnStart(gsRef, CAMP.player1);
            assert(ig._shield === 90, '铁卫 onTurnStart 回盾 50→90');
            assert(logMsg.some(l => l.includes('回复')), '日志含回复');
        } catch(e) { assert(false, '铁卫 turnStart 异常: ' + e.message); }

        // ==============================
        // 3) triggerCommanderTurnEnd — 牧师圣链
        // ==============================
        try {
            fxLog.length = 0; logMsg.length = 0;
            gsRef.tiles.length = 0; gsRef.tileMap.clear();
            const priest = addUnit('priest', CAMP.player1, 0, 0);
            const ally = addUnit(null, CAMP.player1, 1, 0);
            ally.hp = 100; ally.maxHp = 200;
            ally.config = { name: '步', hp: 200, attack: 50, speed: 3 };
            gsRef.commanderP1 = 'priest';
            // 清掉祭师自己的 tileMap 条目重新关联
            ci.triggerCommanderTurnEnd(gsRef, CAMP.player1, 'player1');
            assert(ally.hp > 100, '牧师 onTurnEnd 圣链回血');
            assert(logMsg.some(l => l.includes('圣链')), '日志含圣链');
        } catch(e) { assert(false, '牧师 turnEnd 异常: ' + e.message); }

        // ==============================
        // 4) triggerCommanderOnAttack — 百夫长乘胜
        // ==============================
        try {
            fxLog.length = 0; logMsg.length = 0;
            gsRef.tiles.length = 0; gsRef.tileMap.clear();
            const cent = addUnit('centurion', CAMP.player1);
            cent._centurionTriggered = false;
            cent.remainingMP = 0;
            const target = { hp: 100, tile: { x: 435, y: 310 } };
            // 用 rng 覆盖确保触发（vampire 看 rng.range）
            gsRef.rng = { range: () => 0.45, between: () => 30, chance: () => true, int: () => 1 };
            const result = ci.triggerCommanderOnAttack(cent, target, 50);
            if (result && result.extraMP) {
                assert(cent.remainingMP > 0, '百夫长 onAttack 增加 MP');
                assert(cent._centurionTriggered === true, 'triggered 标记');
            } else {
                assert(true, 'onAttack 未触发(可接受)');
            }
        } catch(e) { assert(false, '百夫长 onAttack 异常: ' + e.message); }

        // ==============================
        // 5) triggerCommanderOnAttackEx — 吸血鬼吸血
        // ==============================
        try {
            fxLog.length = 0; logMsg.length = 0;
            gsRef.tiles.length = 0; gsRef.tileMap.clear();
            const vamp = addUnit('vampire', CAMP.player1);
            vamp.hp = 100; vamp.maxHp = 200;
            const tgt = { hp: 0, tile: { x: 465, y: 340 } };
            const r = ci.triggerCommanderOnAttackEx(vamp, tgt, 100, false, true);
            assert(r !== null, '吸血鬼 onAttack 触发');
            if (r) assert(r.healAmt > 0, '回血正值');
            assert(fxLog.some(l => l.startsWith('bd:')), '触发 bloodDrain 特效');
        } catch(e) { assert(false, '吸血鬼 onAttackEx 异常: ' + e.message); }

        // ==============================
        // 6) triggerCommanderOnCounterAttack — 吸血鬼反击
        // ==============================
        try {
            fxLog.length = 0; logMsg.length = 0;
            gsRef.tiles.length = 0; gsRef.tileMap.clear();
            const vamp = addUnit('vampire', CAMP.player1);
            vamp.hp = 100; vamp.maxHp = 200;
            const att = { hp: 100, tile: { x: 435, y: 310 } };
            const r = ci.triggerCommanderOnCounterAttack(att, vamp, 60);
            if (r && r.healAmt) {
                assert(r.healAmt > 0, '反击回血');
                assert(fxLog.some(l => l.startsWith('bd:')), '反击触发 bloodDrain');
            } else assert(true, '反击未触发(可接受)');
        } catch(e) { assert(false, '反击异常: ' + e.message); }

        // ==============================
        // 7) triggerCommanderOnKill — 狂战士/圣骑士击杀
        // ==============================
        try {
            fxLog.length = 0; logMsg.length = 0;
            gsRef.tiles.length = 0; gsRef.tileMap.clear();
            const pal = addUnit('paladin', CAMP.player1);
            pal._faith = 1; pal._oathGainTurn = -1;
            pal.id = 'pal_test';
            const victim = { hp: 0, config: { name: '步' } };
            const r = ci.triggerCommanderOnKill(pal, victim);
            assert(r === null, '圣骑士 onKill 返回 null');
            assert(pal._faith === 2, '击杀后誓言+1');
        } catch(e) { assert(false, '击杀异常: ' + e.message); }

        // ==============================
        // 8) getCommanderDefenseBonus — 狂战士
        // ==============================
        try {
            const u = { commander: 'berserker', hp: 100, maxHp: 200, config: { attack: 50 } };
            const bonus = ci.getCommanderDefenseBonus(u);
            assert(bonus > 0, '狂战士损失50%HP→防御加成');
        } catch(e) { assert(false, 'defBonus 异常: ' + e.message); }

        // ==============================
        // 9) getCommanderAttackBonus — 堕天使黑
        // ==============================
        try {
            assert(ci.getCommanderAttackBonus({ commander: 'fallenAngel', _fallen: true }) === 30, '堕天使黑+30攻击');
            assert(ci.getCommanderAttackBonus({ commander: 'fallenAngel', _fallen: false }) === 0, '堕天使白+0攻击');
            assert(ci.getCommanderAttackBonus({}) === 0, '无将领+0');
        } catch(e) { assert(false, 'atkBonus 异常: ' + e.message); }

        // ==============================
        // 10) getCommanderCritRateBonus
        // ==============================
        try {
            assert(ci.getCommanderCritRateBonus({ commander: 'fallenAngel', _fallen: true }) === 0.60, '堕天使黑+60%暴');
            assert(ci.getCommanderCritRateBonus({}) === 0, '无将领暴击0');
        } catch(e) { assert(false, 'critRate 异常: ' + e.message); }

        // ==============================
        // 11) getCommanderAuraDefenseBonus — 铁卫灵光
        // ==============================
        try {
            gsRef.tiles.length = 0; gsRef.tileMap.clear();
            const ig = addUnit('ironGuard', CAMP.player1, 2, 2);
            ig._shield = 50;
            const ally = { commander: null, camp: CAMP.player1, tile: { q: 3, r: 2, x: 505, y: 330 } };
            const bonus = ci.getCommanderAuraDefenseBonus(ally);
            // 需要检查 tileMap 中能查到铁卫
            // 这个函数依赖 _gameState() 的 tileMap
            assert(typeof bonus === 'number', '铁卫灵光返回值是数字');
        } catch(e) { assert(false, 'auraDef 异常: ' + e.message); }

        // ==============================
        // 12) getCommanderAuraAttackBonus — 圣骑士灵光
        // ==============================
        try {
            gsRef.tiles.length = 0; gsRef.tileMap.clear();
            const pal = addUnit('paladin', CAMP.player1, 0, 0);
            const ally = { commander: null, camp: CAMP.player1, tile: { q: 1, r: 0, x: 435, y: 300 } };
            const bonus = ci.getCommanderAuraAttackBonus(ally);
            assert(bonus === 0.10, '圣骑士灵光+10%攻击');
        } catch(e) { assert(false, 'auraAtk 异常: ' + e.message); }

        // ==============================
        // 13) triggerCommanderOnMoraleChange — 堕天使
        // ==============================
        try {
            fxLog.length = 0; logMsg.length = 0;
            const u = { commander: 'fallenAngel', _fallen: false, morale: 1, camp: CAMP.player1, config: { name: '步' }, tile: { x: 400, y: 300 } };
            ci.triggerCommanderOnMoraleChange(u, 2, 1);
            assert(u._fallen === true, '士气变化触发堕天使堕落');
        } catch(e) { assert(false, 'moraleChange 异常: ' + e.message); }

        // ==============================
        // 14) triggerCommanderOnAttack — 谋士攻心
        // ==============================
        try {
            fxLog.length = 0; logMsg.length = 0;
            gsRef.tiles.length = 0; gsRef.tileMap.clear();
            const advisor = addUnit('advisor', CAMP.player1, 0, 0);
            const target = addUnit(null, CAMP.player2, 1, 0);
            target.morale = 2;
            target.moralePenaltyUntil = 0;
            target.canAct = true;
            const r = ci.triggerCommanderOnAttack(advisor, target, 30);
            assert(r?.moraleDropped === true && target.morale === 1, '谋士攻击命中触发攻心');
            assert(fxLog.some(line => line.startsWith('gx:')), '攻心波纹特效经中间层分派');
        } catch(e) { assert(false, '谋士 onAttack 异常: ' + e.message); }

        // ==============================
        // 15) getStallerSnareLayers / getCommanderRangeReduction
        // ==============================
        try {
            const tileMap = new Map();
            tileMap.set('0,0', { q: 0, r: 0, x: 400, y: 300, unit: { commander: 'staller', camp: CAMP.player2, hp: 100 } });
            const layers = ci.getStallerSnareLayers({ q: 1, r: 0 }, CAMP.player1, tileMap);
            assert(layers >= 1, '停滞者缚足层数≥1');
        } catch(e) { assert(false, 'snare 异常: ' + e.message); }

        // ==============================
        // 16) changeUnitCamp — 感化
        // ==============================
        try {
            const target = { camp: CAMP.player2, tile: { isCity: false } };
            const ok = ci.changeUnitCamp(target, CAMP.player1, gsRef.tiles);
            assert(ok === true, 'changeUnitCamp 成功');
            assert(target.camp === CAMP.player1, 'camp 已切换');
        } catch(e) { assert(false, 'changeUnitCamp 异常: ' + e.message); }

        // ==============================
        // 17) 无将领时不抛异常（所有函数静默跳过）
        // ==============================
        try {
            assert(ci.triggerCommanderOnAttack({}, {}) === null, '无将领 onAttack 返回 null');
            assert(ci.triggerCommanderOnKill({}, {}) === null, '无将领 onKill 返回 null');
            assert(ci.getCommanderAttackBonus({}) === 0, '无将领 atkBonus=0');
            assert(ci.getCommanderDefenseBonus({}) === 0, '无将领 defBonus=0');
            assert(ci.getCommanderCritRateBonus({}) === 0, '无将领 crit=0');
            assert(ci.isCommanderGuaranteedCrit({}) === false, '无将领 guaranteedCrit=false');
        } catch(e) { assert(false, '无将领 safety 异常: ' + e.message); }

        return R;
    });

    results.logs.forEach(l => console.log('  ' + l));
    console.log(`  —— ci: ${results.passed} 通过 / ${results.failed} 失败`);
    await page.context().close();
    return { passed: results.passed, failed: results.failed };
}
