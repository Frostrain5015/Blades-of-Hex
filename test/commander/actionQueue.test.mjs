import { newTestPage } from './helpers.mjs';

export async function run(browser) {
    const page = await newTestPage(browser);
    const R = await page.evaluate(async () => {
        const state = await import('/js/state.js');
        const input = await import('/js/input.js');
        const { CAMP } = await import('/js/config.js');
        const { HexTile } = await import('/js/HexTile.js');
        const { Unit } = await import('/js/Unit.js');
        const results = { passed: 0, failed: 0, logs: [] };
        const assert = (condition, message) => {
            if (condition) results.passed++;
            else results.failed++;
            results.logs.push((condition ? '✓' : '✗') + ' ' + message);
        };

        state.resetGameState();
        const gameState = state.gameState;
        const city = new HexTile(0, 0);
        city.isCity = true;
        city.camp = CAMP.player1;
        const constructionTarget = new HexTile(1, 0);
        constructionTarget.camp = CAMP.player2;
        gameState.tiles = [city, constructionTarget];
        gameState.tileMap = new Map(gameState.tiles.map(tile => [`${tile.q},${tile.r}`, tile]));
        gameState.currentCamp = CAMP.player1;
        gameState.playerGold.player1 = 20;
        gameState.skirmishFog = false;

        const engineer = new Unit('infantry', CAMP.player1, city, false, null, 'engineer');
        engineer.hp = engineer.maxHp - 40;
        engineer.displayHp = engineer.hp;
        engineer.canAct = true;

        input.showTooltipForTile(city);
        const actionButtons = document.querySelectorAll('#tooltipActionButtons button');
        const trench = document.getElementById('tooltipActiveSkill');
        const bunker = document.getElementById('tooltipSecondarySkill');
        const reinforce = document.getElementById('tooltipReinforce');
        assert(actionButtons.length === 3, '工程师驻城可注册两项技能与补员共3项动作');
        assert(!!trench && !!bunker && !!reinforce, '队列保留兼容按钮标识');
        assert(!trench?.disabled && !bunker?.disabled && !reinforce?.disabled, '满足条件时三项动作均可用');
        assert(trench?.style.getPropertyValue('--skill-button-background').includes('#947026'), '工程师技能使用工程主题色');

        city.fortification = 'trench';
        input.showTooltipForTile(city);
        assert(document.getElementById('tooltipActiveSkill')?.disabled === true, '已有战壕时挖掘按钮直接变灰');
        assert(document.getElementById('tooltipSecondarySkill')?.disabled === false, '其他工程师技能保持可用');

        gameState.playerGold.player1 = 0;
        input.showTooltipForTile(city);
        assert(document.getElementById('tooltipSecondarySkill')?.disabled === true, '金币不足时碉堡按钮直接变灰');
        assert(document.getElementById('tooltipReinforce')?.disabled === true, '金币不足时补员按钮直接变灰');

        return results;
    });
    R.logs.forEach(line => console.log('  ' + line));
    console.log(`  —— cmd/actionQueue: ${R.passed} 通过 / ${R.failed} 失败`);
    await page.context().close();
    return { passed: R.passed, failed: R.failed };
}
