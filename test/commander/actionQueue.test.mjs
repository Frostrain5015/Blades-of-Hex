import { newTestPage } from './helpers.mjs';

export async function run(browser) {
    const page = await newTestPage(browser);
    const R = await page.evaluate(async () => {
        const state = await import('/js/state.js');
        const input = await import('/js/input.js');
        const targeting = await import('/rules/targeting.js');
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

        input.initInput();
        input.syncBoardActionBar();
        const actionBar = document.getElementById('canvasActionButtons');
        const actionButtons = document.querySelectorAll('#canvasActionButtons button');
        const airfield = document.getElementById('boardBuild-airfield');
        const construction = document.getElementById('boardConstructionMenu');
        const repair = document.getElementById('boardFieldRepair');
        const reinforce = document.getElementById('boardReinforce');
        assert(actionButtons.length === 4, '工程师驻城显示机场、建设、抢修与补员共4项动作');
        assert(actionBar?.classList.contains('visible'), '选中单位时画布内动作条淡入');
        assert(!!airfield && !!construction && !!repair && !!reinforce, '队列使用新版统一建设动作标识');
        assert(construction?.getAttribute('aria-disabled') === 'false' && repair?.getAttribute('aria-disabled') === 'true', '建设可用；没有相邻受损建筑时抢修明确禁用');
        assert(construction?.style.getPropertyValue('--board-action-background').includes('#8c6a2e'), '统一建设入口使用工程主题色');
        construction?.click();
        const constructionCardCount = document.querySelectorAll('#choiceModalGrid .specialization-card').length;
        const constructionOverlayOpen = document.getElementById('weatherChoiceOverlay')?.classList.contains('show');
        assert(constructionOverlayOpen && constructionCardCount === 5,
        `单击常驻建设按钮打开包含五种工事的二级弹窗（open=${constructionOverlayOpen}, cards=${constructionCardCount}）`);
        const constructionCards = [...document.querySelectorAll('#choiceModalGrid .specialization-card')];
        assert(constructionCards[0]?.disabled === false && constructionCards[1]?.disabled === false,
        `可行动地面单位的战壕与高射机枪选项正常启用（disabled=${constructionCards.slice(0, 2).map(card => card.disabled).join(',')}）`);
        const constructionCosts = [...document.querySelectorAll('#choiceModalGrid .specialization-stat')].map(node => node.textContent).join('|');
        assert(constructionCosts === '费用 $1|费用 $1|费用 $7|费用 $10|费用 $15', `工程师折扣在二级弹窗中统一展示（${constructionCosts}）`);
        constructionCards[4]?.click();
        const laserPreview = targeting.resolveTargetingPreview(gameState, gameState.cardTargeting, { myCamp: CAMP.player1 });
        assert(gameState.cardTargeting?.cardId === 'build_laser_tower'
            && laserPreview.candidateTileKeys.has('1,0'), `激光塔按钮进入选址且显示6格内非己方空地为合法目标（card=${gameState.cardTargeting?.cardId || 'none'}, candidates=${[...laserPreview.candidateTileKeys].join('|')}）`);
        gameState.cardTargeting = null;

        city.fortification = 'trench';
        input.syncBoardActionBar();
        assert(!document.getElementById('boardConstructionMenu')?.classList.contains('is-disabled'), '已有本格工事时仍可从建设菜单选择相邻碉堡');

        gameState.playerGold.player1 = 0;
        input.syncBoardActionBar();
        assert(!document.getElementById('boardConstructionMenu')?.classList.contains('is-disabled'), '金币不足仍允许打开建设菜单查看规则与禁用原因');
        assert(document.getElementById('boardReinforce')?.classList.contains('is-disabled'), '金币不足时补员按钮变灰');

        gameState.selectedUnit = null;
        gameState.selectedTile = null;
        input.syncBoardActionBar();
        assert(actionBar?.classList.contains('visible')
            && document.querySelectorAll('#canvasActionButtons button').length === 1
            && !!document.getElementById('boardConstructionMenu'), '取消选中后仍保留唯一的常驻建设入口');

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
