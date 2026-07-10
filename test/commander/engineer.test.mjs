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
        let _stubId = 1000;
        class StubUnit {
            constructor(type, camp, tile) {
                this.id = ++_stubId;
                this.type = type;
                this.camp = camp;
                this.tile = tile;
                this.hp = 200;
                this.maxHp = 200;
                this.displayHp = 200;
                this.canAct = true;
                this.remainingMP = 0;
                this._isImmobile = false;
                this._engineerScaffold = null;
                tile.unit = this;
            }
        }

        try {
            const source = { q: 0, r: 0, terrain: 'mountain', isCity: true, isVillage: false, fortification: null, unit: null };
            const unit = makeEngineer(source);
            source.unit = unit;
            const gameState = makeGameState([source]);
            const result = engineer.digEngineerTrench(unit, { gameState, logMessage });
            assert(result.ok, '城市与山地上的战壕可建造');
            assert(source.fortification === 'trench', '战壕写入独立工事层');
            assert(gameState.playerGold.player1 === 20 - engineer.ENGINEER_TRENCH_GOLD_COST, '战壕扣除$2');
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
            const start = engineer.beginEngineerBunkerConstruction(unit, target, { gameState, logMessage, Unit: StubUnit });
            assert(start.ok, '身旁1格敌方山地空格可开始施工');
            assert(gameState.playerGold.player1 === 20 - engineer.ENGINEER_BUNKER_GOLD_COST, '碉堡施工扣除$6');
            // 目标格立即出现建造中的脚手架
            const scaffold = target.unit;
            assert(!!scaffold && scaffold._engineerScaffold, '目标格立即出现脚手架');
            assert(scaffold.type === 'mgNest' && scaffold._isImmobile && scaffold.canAct === false, '脚手架不可移动、不可行动');
            assert(scaffold.hp === engineer.ENGINEER_BUNKER_HP, '脚手架拥有满血HP');
            assert(unit._engineerConstruction?.scaffoldId === scaffold.id && !unit.canAct, '施工状态与行动锁定生效');
            assert(unit._engineerConstruction?.turnsRemaining === engineer.ENGINEER_BUNKER_BUILD_TURNS, '记录施工所需回合数');

            // 施工期间再次尝试建造：应被拒绝（同时只能修建1个碉堡）
            const reBuild = engineer.beginEngineerBunkerConstruction(unit, target, { gameState, logMessage, Unit: StubUnit });
            assert(!reBuild.ok, '施工期间不能再次开始建造');

            // 模拟脚手架承受了一些伤害（用于验证碉堡继承剩余HP）
            scaffold.hp = 150;

            // 下一个己方回合开始（建造只需1回合）：脚手架变为碉堡并继承剩余HP，并进入冷却。
            unit.canAct = true;
            unit.remainingMP = 5;
            scaffold.canAct = true;
            const built = engineer.completeEngineerBunkerConstructions(gameState, CAMP.player1, { Unit: StubUnit, logMessage });
            assert(built.length === 1 && built[0].ok, '1回合后完成施工');
            assert(target.unit === scaffold && !scaffold._engineerScaffold, '脚手架原地变为碉堡');
            assert(scaffold.type === 'mgNest' && scaffold._isImmobile, '碉堡不可移动');
            assert(scaffold.hp === 150, '碉堡继承脚手架剩余HP');
            assert(scaffold.canAct === false, '新碉堡本回合不可行动');
            assert(!unit._engineerConstruction, '完工后清除工程师施工状态');
            assert(unit._engineerBunkerCD === engineer.ENGINEER_BUNKER_CD_TURNS, '建成后进入建造冷却');

            // 冷却期内不能再建
            const target2 = { q: 0, r: 1, isCity: false, isVillage: false, unit: null };
            gameState.tiles.push(target2); gameState.tileMap.set('0,1', target2);
            const cdBlocked = engineer.beginEngineerBunkerConstruction(unit, target2, { gameState, logMessage, Unit: StubUnit });
            assert(!cdBlocked.ok, '冷却期内不能再次建造碉堡');
            // 冷却递减到 0 后可再建
            engineer.completeEngineerBunkerConstructions(gameState, CAMP.player1, { Unit: StubUnit, logMessage });
            engineer.completeEngineerBunkerConstructions(gameState, CAMP.player1, { Unit: StubUnit, logMessage });
            assert(unit._engineerBunkerCD === 0, '冷却递减到0');
            unit.canAct = true; unit.remainingMP = 5;
            const rebuildOk = engineer.beginEngineerBunkerConstruction(unit, target2, { gameState, logMessage, Unit: StubUnit });
            assert(rebuildOk.ok, '冷却结束后可再次建造');
        } catch (error) {
            assert(false, '碉堡异常: ' + error.message);
        }

        // 高射机枪工事：架设 + 与战壕互斥
        try {
            const source = { q: 0, r: 0, isCity: false, isVillage: false, fortification: null, unit: null };
            const unit = makeEngineer(source);
            source.unit = unit;
            const gameState = makeGameState([source]);
            const flak = engineer.digEngineerFlak(unit, { gameState, logMessage });
            assert(flak.ok && source.fortification === 'flak', '架设高射机枪写入flak工事');
            assert(gameState.playerGold.player1 === 20 - engineer.ENGINEER_FLAK_GOLD_COST, '高射机枪扣除$2');
            assert(unit.remainingMP === 0 && unit.canAct === false, '高射机枪清空行动力');
            unit.canAct = true;
            const trenchBlocked = engineer.digEngineerTrench(unit, { gameState, logMessage });
            assert(!trenchBlocked.ok, '已有工事时战壕与高射机枪互斥');
        } catch (error) {
            assert(false, '高射机枪异常: ' + error.message);
        }

        // 施工中脚手架被摧毁：工程师立即解除锁定
        try {
            const source = { q: 0, r: 0, isCity: false, isVillage: false, unit: null };
            const target = { q: 1, r: 0, isCity: false, isVillage: false, unit: null };
            const unit = makeEngineer(source);
            source.unit = unit;
            const gameState = makeGameState([source, target]);
            const start = engineer.beginEngineerBunkerConstruction(unit, target, { gameState, logMessage, Unit: StubUnit });
            assert(start.ok && unit._engineerConstruction, '施工开始');
            const scaffold = target.unit;
            // 模拟脚手架被摧毁离场
            const builder = engineer.releaseEngineerOnScaffoldLost(scaffold, gameState);
            assert(builder === unit, '找回施工的工程师');
            assert(!unit._engineerConstruction, '脚手架被摧毁后工程师立即解除锁定');
        } catch (error) {
            assert(false, '脚手架摧毁异常: ' + error.message);
        }

        try {
            const source = { q: 0, r: 0, isCity: false, isVillage: false, unit: null };
            const target = { q: 1, r: 0, isCity: false, isVillage: true, unit: null };
            const unit = makeEngineer(source);
            source.unit = unit;
            const gameState = makeGameState([source, target]);
            const result = engineer.beginEngineerBunkerConstruction(unit, target, { gameState, logMessage, Unit: StubUnit });
            assert(!result.ok, '村庄不可建造工程师碉堡');
        } catch (error) {
            assert(false, '建造限制异常: ' + error.message);
        }

        try {
            const source = { q: 0, r: 0, isCity: false, isVillage: false, unit: null };
            const near = { q: 1, r: 0, isCity: false, isVillage: false, unit: null };
            const far = { q: 2, r: 0, isCity: false, isVillage: false, unit: null };
            const unit = makeEngineer(source);
            source.unit = unit;
            const gameState = makeGameState([source, near, far]);
            assert(engineer.isEngineerBunkerTargetTile(near, unit), '身旁1格空地为合法目标');
            assert(!engineer.isEngineerBunkerTargetTile(far, unit), '2格外空地不是合法目标');
            const farResult = engineer.beginEngineerBunkerConstruction(unit, far, { gameState, logMessage, Unit: StubUnit });
            assert(!farResult.ok, '不能在身旁1格之外施工');
            assert(gameState.playerGold.player1 === 20, '非法目标不扣金币');
        } catch (error) {
            assert(false, '相邻门禁异常: ' + error.message);
        }

        return results;
    });
    R.logs.forEach(line => console.log('  ' + line));
    console.log(`  —— cmd/engineer: ${R.passed} 通过 / ${R.failed} 失败`);
    await page.context().close();
    return { passed: R.passed, failed: R.failed };
}
