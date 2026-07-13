import { newTestPage } from './helpers.mjs';

export async function run(browser) {
    const page = await newTestPage(browser);
    const R = await page.evaluate(async () => {
        const state = await import('/js/state.js');
        const input = await import('/js/input.js');
        const { CAMP, TERRAIN_CONFIG, FORTIFICATION_CONFIG } = await import('/js/config.js');
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
        gameState.selectedUnit = engineer;
        gameState.selectedTile = city;

        input.syncBoardActionBar();
        const actionBar = document.getElementById('canvasActionButtons');
        const actionButtons = document.querySelectorAll('#canvasActionButtons button');
        const trench = document.getElementById('boardActiveSkill');
        const flak = document.getElementById('boardSecondarySkill');
        const bunker = document.getElementById('boardCommanderSkill2');
        const reinforce = document.getElementById('boardReinforce');
        assert(actionButtons.length === 4, '工程师驻城可注册三项技能与补员共4项动作');
        assert(actionBar?.classList.contains('visible'), '选中单位时画布内动作条淡入');
        assert(!!trench && !!flak && !!bunker && !!reinforce, '队列使用当前画布动作按钮标识');
        assert([trench, flak, bunker, reinforce].every(button => button?.getAttribute('aria-disabled') === 'false'), '满足条件时四项动作均可用');
        assert(trench?.style.getPropertyValue('--board-action-background').includes('#947026'), '工程师技能使用工程主题色');
        assert(trench?.querySelector('.canvas-action-cost')?.textContent === '$2', '战壕动作显示$2成本');

        city.fortification = 'trench';
        input.syncBoardActionBar();
        assert(document.getElementById('boardActiveSkill')?.classList.contains('is-disabled'), '已有工事时战壕按钮变灰');
        assert(document.getElementById('boardSecondarySkill')?.classList.contains('is-disabled'), '已有工事时高射机枪按钮变灰');
        assert(!document.getElementById('boardCommanderSkill2')?.classList.contains('is-disabled'), '碉堡施工仍可指定相邻空地');

        gameState.playerGold.player1 = 0;
        input.syncBoardActionBar();
        assert(document.getElementById('boardCommanderSkill2')?.classList.contains('is-disabled'), '金币不足时碉堡按钮变灰');
        assert(document.getElementById('boardReinforce')?.classList.contains('is-disabled'), '金币不足时补员按钮变灰');

        gameState.selectedUnit = null;
        gameState.selectedTile = null;
        input.syncBoardActionBar();
        assert(!actionBar?.classList.contains('visible'), '取消选中后画布内动作条淡出');

        const glyphCalls = [];
        const fakeContext = {
            save() {}, restore() {}, beginPath() {}, moveTo() {}, lineTo() {}, closePath() {}, fill() {},
            measureText() { return { width: 12 }; },
            fillText(icon) { glyphCalls.push(icon); }
        };
        const terrainTile = new HexTile(2, 0);
        terrainTile.isVillage = true;
        terrainTile.terrain = 'forest';
        terrainTile.fortification = 'trench';
        terrainTile.drawBase(fakeContext);
        const glyphs = glyphCalls.slice(-3);
        assert(glyphs.join('|') === `🏡|${TERRAIN_CONFIG.forest.icon}|${FORTIFICATION_CONFIG.trench.icon}`, '地物图标按村庄、地形、战壕顺序横向绘制');

        return results;
    });
    R.logs.forEach(line => console.log('  ' + line));
    console.log(`  —— cmd/actionQueue: ${R.passed} 通过 / ${R.failed} 失败`);
    await page.context().close();
    return { passed: R.passed, failed: R.failed };
}
