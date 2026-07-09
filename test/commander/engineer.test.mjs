import { newTestPage } from './helpers.mjs';

export async function run(browser) {
    const page = await newTestPage(browser);
    const R = await page.evaluate(async () => {
        const engineer = await import('/commander/engineer.js');
        const { CAMP } = await import('/js/config.js');
        const results = { passed: 0, failed: 0, logs: [] };
        const assert = (condition, message) => {
            if (condition) results.passed++;
            else results.failed++;
            results.logs.push((condition ? '✓' : '✗') + ' ' + message);
        };

        const makeEngineer = (tile, camp = CAMP.player1) => ({
            id: 'engineer-' + Math.random().toString(36).slice(2),
            commander: 'engineer',
            camp,
            hp: 200,
            tile,
            canAct: true,
            isNewRecruit: false,
            remainingMP: 5
        });
        const makeGameState = (tiles, gold = 20) => ({
            currentCamp: CAMP.player1,
            playerGold: { player1: gold, player2: gold, player3: gold, neutral: gold },
            tiles,
            tileMap: new Map(tiles.map(tile => [`${tile.q},${tile.r}`, tile]))
        });
        const logMessage = () => {};

        try {
            const source = { q: 0, r: 0, terrain: 'mountain', isCity: true, isVillage: false, fortification: null, unit: null };
            const unit = makeEngineer(source);
            source.unit = unit;
            const gameState = makeGameState([source]);
            const result = engineer.digEngineerTrench(unit, { gameState, logMessage });
            assert(result.ok, '城市与山地上的战壕可建造');
            assert(source.fortification === 'trench', '战壕写入独立工事层');
            assert(gameState.playerGold.player1 === 20 - engineer.ENGINEER_TRENCH_GOLD_COST, '战壕扣除$3');
            assert(unit.remainingMP === 0 && unit.canAct === false, '战壕清空行动力');
        } catch (error) {
            assert(false, '战壕异常: ' + error.message);
        }

        try {
            const source = { q: 0, r: 0, isCity: false, isVillage: false, unit: null };
            const target = { q: 1, r: 0, terrain: 'mountain', camp: CAMP.player2, isCity: false, isVillage: false, unit: null };
            const unit = makeEngineer(source);
            source.unit = unit;
            const gameState = makeGameState([source, target]);
            const start = engineer.beginEngineerBunkerConstruction(unit, target, { gameState, logMessage });
            assert(start.ok, '敌方山地空格可开始施工');
            assert(gameState.playerGold.player1 === 20 - engineer.ENGINEER_BUNKER_GOLD_COST, '碉堡施工扣除$6');
            assert(unit._engineerConstruction?.targetQ === 1 && !unit.canAct, '施工状态与行动锁定生效');

            class StubUnit {
                constructor(type, camp, tile) {
                    this.type = type;
                    this.camp = camp;
                    this.tile = tile;
                    this.hp = 200;
                    this.maxHp = 200;
                    this.displayHp = 200;
                    tile.unit = this;
                }
            }
            const complete = engineer.completeEngineerBunkerConstructions(gameState, CAMP.player1, { Unit: StubUnit, logMessage });
            assert(complete.length === 1 && complete[0].ok, '下个己方回合完成施工');
            assert(target.unit?.type === 'mgNest' && target.unit._isImmobile, '生成不可移动碉堡');
            assert(target.unit?.canAct === false, '新碉堡本回合不可行动');
        } catch (error) {
            assert(false, '碉堡异常: ' + error.message);
        }

        try {
            const source = { q: 0, r: 0, isCity: false, isVillage: false, unit: null };
            const target = { q: 1, r: 0, isCity: false, isVillage: true, unit: null };
            const unit = makeEngineer(source);
            source.unit = unit;
            const gameState = makeGameState([source, target]);
            const result = engineer.beginEngineerBunkerConstruction(unit, target, { gameState, logMessage });
            assert(!result.ok, '村庄不可建造工程师碉堡');
        } catch (error) {
            assert(false, '建造限制异常: ' + error.message);
        }

        return results;
    });
    R.logs.forEach(line => console.log('  ' + line));
    console.log(`  —— cmd/engineer: ${R.passed} 通过 / ${R.failed} 失败`);
    await page.context().close();
    return { passed: R.passed, failed: R.failed };
}
