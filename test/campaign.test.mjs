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
    R.assert((await page.textContent('#campaignChronicleTitle')).trim() === '染血的鸢尾花', '第一部传记名为《染血的鸢尾花》');
    R.assert((await page.textContent('.campaign-chronicle-index')).includes('将星列传'), '传记档案编号正确');
    if (await page.locator('.campaign-level-card').count() === 0) {
        R.ok('正式关卡尚未录入，按当前开发阶段改测战役编辑器基础设施');
        await page.click('#campaignBackBtn');
        await page.evaluate(() => document.getElementById('editorBtn')?.click());
        await page.locator('#editorOverlay').waitFor({ state: 'visible' });
        await page.click('.editor-tab[data-tab="meta"]');
        R.assert(await page.getByText('本关开放机制', { exact: true }).count() === 1, '编辑器提供关卡机制开关');
        await page.click('.editor-tab[data-tab="factions"]');
        R.assert(await page.getByText('初始外交关系（双向）', { exact: true }).count() === 1, '编辑器提供双向外交配置');
        await page.click('.editor-tab[data-tab="meta"]');
        R.assert(await page.getByText(/联盟共享视野/).count() >= 1, '联盟共享视野为独立开关');
        await page.click('.editor-tab[data-tab="triggers"]');
        await page.getByText('+ 新增触发器', { exact: true }).click();
        R.assert(await page.getByText('指定单位/单位组移动到指定地块', { exact: true }).count() >= 1, '触发器编辑器提供单位进入指定地块条件');
        const infrastructure = await page.evaluate(async () => {
            const schema = await import('/campaign/runtime/schema.js');
            const diplomacy = await import('/rules/diplomacy.js');
            const mechanics = await import('/rules/mechanics.js');
            const level = schema.createDefaultLevel();
            const validation = schema.validateLevel(level);
            const state = { diplomacy: diplomacy.createDefaultDiplomacy(), mechanics: mechanics.createDefaultMechanics() };
            const change = diplomacy.setRelation(state, 'player1', 'neutral', 'enemy');
            const triggers = await import('/campaign/runtime/triggers.js');
            const { gameState } = await import('/js/state.js');
            const flowLevel = schema.createDefaultLevel();
            flowLevel.units = [{ id: 'centurion', type: 'infantry', camp: 'player1', q: -1, r: 0 }];
            flowLevel.steps = { centurionAtGate: { mode: 'character', text: '终于到了。', speaker: { name: '百夫长', portrait: 'centurion' }, next: null } };
            flowLevel.objectives = {
                takeCity: { title: '攻占主城', detail: '', active: true, main: true },
                holdCity: { title: '防守主城', detail: '', active: false, main: true }
            };
            flowLevel.triggers = [{
                id: 'centurion-enters-city', once: true,
                when: [{ kind: 'unitMovesToTile', target: { unit: 'centurion' }, q: 0, r: 0 }],
                do: [
                    { kind: 'showStep', step: 'centurionAtGate' },
                    { kind: 'setObjectiveStatus', objective: 'takeCity', status: 'completed' },
                    { kind: 'setObjectiveStatus', objective: 'holdCity', status: 'active' }
                ]
            }];
            const shownSteps = [];
            const changedObjectives = [];
            let wins = 0;
            gameState.tiles = [{ unit: { id: 'centurion', camp: diplomacy.campFromKey('player1'), hp: 1 }, camp: diplomacy.campFromKey('player1') }];
            gameState.localPlayerCampKey = 'player1';
            gameState.objectiveStates = { takeCity: 'active', holdCity: 'hidden' };
            const flow = triggers.createTriggerFlow(flowLevel, {
                isActive: () => true,
                isResultShown: () => false,
                showStep: id => shownSteps.push(id),
                setObjectiveStatus: (id, status) => { gameState.objectiveStates[id] = status; changedObjectives.push(`${id}:${status}`); },
                hideGuidance: () => {}, showHint: () => {}, fail: () => {}, win: () => { wins++; }, getStepId: () => ''
            });
            flow.dispatch('tileSelected', { unitId: 'centurion', q: 0, r: 0 });
            const ignoredNonMove = shownSteps.length === 0;
            flow.dispatch('unitMoved', { unitId: 'centurion', q: 0, r: 0 });
            return {
                schemaOk: validation.errors.length === 0,
                symmetric: change?.previous === 'neutral' && diplomacy.getRelation(state, 'neutral', 'player1') === 'enemy',
                alliedVisionDefault: mechanics.isMechanicEnabled(state, 'alliedVision'),
                cardDefault: mechanics.isMechanicEnabled(state, 'tacticalCards'),
                flowSchemaOk: schema.validateLevel(flowLevel).errors.length === 0,
                ignoredNonMove,
                movementTriggerWorked: shownSteps[0] === 'centurionAtGate'
                    && changedObjectives.join(',') === 'takeCity:completed,holdCity:active'
                    && gameState.objectiveStates.holdCity === 'active'
                    && wins === 0
            };
        });
        R.assert(infrastructure.schemaOk, '新版默认 Schema 可直接编译');
        R.assert(infrastructure.symmetric, '外交修改保持双向对称');
        R.assert(!infrastructure.alliedVisionDefault && infrastructure.cardDefault, '机制默认值正确（共享视野关、对策卡开）');
        R.assert(infrastructure.flowSchemaOk, 'AoE 式“单位移动到地块→对白→切换主要目标”配置可通过校验');
        R.assert(infrastructure.ignoredNonMove && infrastructure.movementTriggerWorked, '移动事件条件只响应实际移动，并按动作顺序显示对白、完成旧目标、启用新目标');
        R.assert(page._errors.length === 0, `编辑器基础设施无页面异常${page._errors.length ? `：${page._errors.join(' | ')}` : ''}`);
        await page.context().close();
        return R.summary();
    }
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
