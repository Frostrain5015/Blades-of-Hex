import { newGamePage, waitFor, sleep, Reporter } from './lib/helpers.mjs';

async function clickTile(page, q, r) {
    const point = await page.evaluate(async ({ q, r }) => {
        const { gameState } = await import('/js/state.js');
        const tile = gameState.tileMap.get(`${q},${r}`);
        const canvas = document.getElementById('gameCanvas');
        const rect = canvas.getBoundingClientRect();
        if (!tile) return null;
        return {
            x: rect.left + tile.x * (rect.width / 1000),
            y: rect.top + tile.y * (rect.height / 750)
        };
    }, { q, r });
    if (!point) throw new Error(`找不到关卡地块 ${q},${r}`);
    await page.mouse.click(point.x, point.y);
}

async function clickVisibleButton(page, text) {
    await waitFor(() => page.evaluate((label) => [...document.querySelectorAll('button')]
        .some(button => button.offsetParent && button.textContent.trim().includes(label)), text), 8000, `按钮 ${text}`);
    await page.evaluate((label) => {
        const button = [...document.querySelectorAll('button')]
            .find(item => item.offsetParent && item.textContent.trim().includes(label));
        button?.click();
    }, text);
}

export async function run(browser) {
    const R = new Reporter('campaign');
    const page = await newGamePage(browser);

    await page.click('#soloGameBtn');   // 首页 → 单人游戏二级菜单
    await page.click('#campaignBtn');
    await waitFor(() => page.evaluate(() => {
        const view = document.getElementById('campaignLobbyContent');
        return view?.classList.contains('active') && getComputedStyle(view).display === 'flex';
    }), 3000, '单人战役页签切换');
    R.assert(true, '单人战役拥有独立大厅页签');
    R.assert((await page.textContent('#campaignChronicleTitle')).trim() === '我心如火', '第一部传记名为《我心如火》');
    R.assert((await page.textContent('.campaign-chronicle-index')).includes('将星列传01'), '传记档案编号正确');
    R.assert((await page.textContent('#rainCityLevelBtn')).includes('雨幕下的孤城'), '二级菜单展示具体关卡');

    await page.click('#startRainCityBtn');
    await waitFor(() => page.evaluate(async () => {
        const { gameState } = await import('/js/state.js');
        return gameState.campaignMode && gameState.scenarioId === 'rain-city' && gameState.tiles.length > 0;
    }), 10000, '雨幕下的孤城加载');
    R.assert(await page.locator('#campaignObjectiveHud').evaluate(el => el.classList.contains('show')), '局内任务 HUD 已显示');
    R.assert((await page.textContent('#campaignObjectiveTitle')).trim() === '突破城门', '初始主目标正确');

    await clickVisibleButton(page, '进入雨幕');
    await clickVisibleButton(page, '查看主将');
    await sleep(260);
    await clickTile(page, -2, 0);
    await clickVisibleButton(page, '使用疗愈');
    await sleep(260);

    const cardPoint = await page.evaluate(() => {
        const canvas = document.getElementById('cardCanvas');
        const rect = canvas.getBoundingClientRect();
        return { x: rect.left + 30, y: rect.top + rect.height - 65 };
    });
    await page.mouse.click(cardPoint.x, cardPoint.y);
    await clickTile(page, -2, 0);
    await waitFor(() => page.evaluate(async () => (await import('/js/state.js')).gameState.campaignPhase === 'approach'), 4000, '疗愈结算');

    await clickTile(page, -2, 0);
    await clickTile(page, -1, 0);
    await waitFor(() => page.evaluate(async () => (await import('/js/state.js')).gameState.campaignPhase === 'skill'), 4000, '进入森林');

    const skillButton = page.locator('#canvasActionButtons button');
    await skillButton.dblclick();
    await waitFor(() => page.evaluate(async () => (await import('/js/state.js')).gameState.campaignPhase === 'duelCenturion'), 4000, '百夫长战前对白');
    await waitFor(() => page.evaluate(() => document.getElementById('campaignSpeakerCard')?.classList.contains('show')), 2000, '人物立绘卡入场');
    R.assert(await page.locator('#campaignSpeakerCard').evaluate(el => el.classList.contains('show')), '人物对白显示左侧将领立绘卡');
    R.assert((await page.textContent('#campaignSpeakerName')).trim() === '百夫长', '人物立绘卡显示说话者姓名');
    await clickVisibleButton(page, '回应');
    await clickVisibleButton(page, '攻城');
    await waitFor(() => page.evaluate(async () => (await import('/js/state.js')).gameState.campaignPhase === 'attack'), 4000, '进入攻击指引');
    await sleep(260);

    await clickTile(page, 0, 0);
    await sleep(500);
    R.assert(!await page.locator('#tutorialOverlay').evaluate(el => el.classList.contains('show')), '击杀后先留出棋盘演出时间');
    await waitFor(() => page.evaluate(() => document.getElementById('tutorialText')?.textContent.includes('信号火')), 6000, '击杀演出后的剧情对白');
    R.assert(await page.evaluate(async () => (await import('/js/state.js')).gameState.gameOver === false), '夺城不会触发普通对战提前胜利');

    await clickVisibleButton(page, '迎击反扑');
    const counterattack = await page.evaluate(async () => {
        const { gameState } = await import('/js/state.js');
        return {
            phase: gameState.campaignPhase,
            cavalry: !!gameState.tiles.find(tile => tile.unit?.id === 'rain_city_counter_cavalry'),
            guided: gameState.tutorialMode
        };
    });
    R.assert(counterattack.phase === 'counterattack' && counterattack.cavalry && !counterattack.guided, '夺城后生成反扑并解除严格教学锁');

    await page.click('#endTurnBtn');
    await sleep(100);
    await page.evaluate(() => document.getElementById('confirmYes')?.click());
    await waitFor(() => page.evaluate(async () => (await import('/js/state.js')).gameState.campaignPhase === 'lastStand'), 30000, '敌军反扑完成');
    await clickVisibleButton(page, '守到天明');
    R.assert((await page.textContent('#campaignObjectiveTitle')).trim() === '守到天明', '反扑后切换守城目标');

    await page.click('#endTurnBtn');
    await sleep(100);
    await page.evaluate(() => document.getElementById('confirmYes')?.click());
    await waitFor(() => page.evaluate(() => document.getElementById('campaignResultOverlay')?.classList.contains('show')), 8000, '战役专用结算');
    R.assert((await page.textContent('#campaignResultKicker')).trim() === '战役完成', '特殊守城胜利正确结算');
    R.assert((await page.textContent('#campaignResultStars')).includes('★'), '战役结算包含星级评价');

    await page.click('#campaignReturnBtn');
    await waitFor(() => page.evaluate(() => {
        const view = document.getElementById('campaignLobbyContent');
        return view?.classList.contains('active') && getComputedStyle(view).display === 'flex';
    }), 5000, '返回战役菜单');
    R.assert((await page.textContent('#rainCityRating')).includes('★'), '通关进度持久化并回显');
    R.assert((await page.textContent('#campaignProgressMark')).includes('100%'), '关卡完成比例显示正确');
    R.assert(page._errors.length === 0, `流程无页面异常${page._errors.length ? `：${page._errors.join(' | ')}` : ''}`);

    await page.context().close();
    return R.summary();
}
