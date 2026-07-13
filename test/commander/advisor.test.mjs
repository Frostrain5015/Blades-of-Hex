// 谋士（advisor）逻辑单元测试
import { newTestPage } from './helpers.mjs';

export async function run(browser) {
    const page = await newTestPage(browser);
    const R = await page.evaluate(async () => {
        const cmdr = (await import('/commander/advisor.js')).default;
        const R = { passed: 0, failed: 0, logs: [] };
        const assert = (cond, msg) => {
            if (cond) R.passed++;
            else R.failed++;
            R.logs.push((cond ? '✓' : '✗') + ' ' + msg);
        };
        const red = { name: '红军' };
        const blue = { name: '蓝军' };
        const makeState = () => ({ tiles: [], tileMap: new Map(), damageTexts: [], turnCounter: 0, isThreePlayer: false });
        const makeHelpers = (roll, gameState = makeState()) => ({
            gameState,
            logMessage: () => {},
            spawnFx: () => {},
            spawnGongxinRipple: () => {},
            rng: { int: () => roll },
            changeUnitCamp: (unit, camp) => { unit.camp = camp; }
        });
        const makeUnit = (overrides = {}) => ({
            morale: 2,
            moralePenaltyUntil: 0,
            hp: 200,
            maxHp: 200,
            canAct: true,
            camp: blue,
            config: { name: '步兵' },
            tile: { q: 0, r: 0, x: 400, y: 300 },
            ...overrides
        });

        // 1) 攻击命中后触发攻心的士气下降结果。
        {
            const advisor = makeUnit({ commander: 'advisor', camp: red });
            const target = makeUnit();
            const result = cmdr.onAttack(advisor, target, 30, makeHelpers(1));
            assert(result?.moraleDropped === true && target.morale === 1, '攻击命中触发攻心并降低士气');
            assert(target.moralePenaltyUntil === 2, '士气下降持续两回合');
        }

        // 2) 第四种结果会把普通单位感化为谋士阵营。
        {
            const advisor = makeUnit({ commander: 'advisor', camp: red });
            const target = makeUnit({ morale: 0 });
            const result = cmdr.onAttack(advisor, target, 60, makeHelpers(3));
            assert(result?.converted === true && target.camp === red, '普通单位可被感化为己方阵营');
            assert(target.morale === 2 && target.canAct === false, '感化后恢复正常士气且当回合不能行动');
        }

        // 3) 将领单位命中感化结果时改为混乱，不改变阵营。
        {
            const advisor = makeUnit({ commander: 'advisor', camp: red });
            const target = makeUnit({ commander: 'centurion', isCommanderUnit: true });
            const result = cmdr.onAttack(advisor, target, 60, makeHelpers(3));
            assert(result?.moraleDropped === true && !result.converted, '将领免疫感化并改为混乱');
            assert(target.camp === blue && target.morale === 0 && target.canAct === false, '混乱不会改变将领所属阵营');
        }

        // 4) 相邻圣骑士的勇气灵光使目标免疫攻心。
        {
            const state = makeState();
            const paladinTile = { q: 1, r: 0, x: 435, y: 300, unit: null };
            const paladin = makeUnit({ commander: 'paladin', camp: blue, tile: paladinTile });
            paladinTile.unit = paladin;
            state.tileMap.set('1,0', paladinTile);
            const advisor = makeUnit({ commander: 'advisor', camp: red, tile: { q: -1, r: 0, x: 365, y: 300 } });
            const target = makeUnit({ tile: { q: 0, r: 0, x: 400, y: 300 } });
            const result = cmdr.onAttack(advisor, target, 30, makeHelpers(1, state));
            assert(result === null && target.morale === 2, '勇气灵光保护相邻友军免受攻心');
        }

        // 5) 已阵亡或不存在的目标不触发攻心。
        {
            const advisor = makeUnit({ commander: 'advisor', camp: red });
            assert(cmdr.onAttack(advisor, null, 30, makeHelpers(1)) === null, '空目标不触发攻心');
            assert(cmdr.onAttack(advisor, makeUnit({ hp: 0 }), 30, makeHelpers(1)) === null, '已阵亡目标不触发攻心');
        }
        return R;
    });
    R.logs.forEach(line => console.log('  ' + line));
    console.log(`  —— cmd/advisor: ${R.passed} 通过 / ${R.failed} 失败`);
    await page.context().close();
    return { passed: R.passed, failed: R.failed };
}
