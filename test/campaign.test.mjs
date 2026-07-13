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

async function advanceCampaignDialogue(page) {
    await page.click('#tutorialCoach');
    await sleep(260);
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
    const objectiveHighlightContract = await page.evaluate(async () => {
        const { resolveActiveObjectiveHighlightTiles } = await import('/campaign/runtime/objectiveHighlights.js');
        const unitTile = { q: 0, r: 0, unit: { id: 'escort' } };
        const pointTile = { q: 1, r: 0, unit: null };
        const areaTile = { q: 1, r: -1, unit: null };
        const hiddenTile = { q: -1, r: 0, unit: null };
        const tileMap = new Map([
            ['0,0', unitTile], ['1,0', pointTile], ['1,-1', areaTile], ['-1,0', hiddenTile]
        ]);
        const config = {
            units: [{ id: 'escort' }],
            areas: [{ id: 'exit', tiles: [{ q: 1, r: -1 }, { q: 1, r: 0 }] }],
            objectives: {
                active: { active: true, highlight: { unit: 'escort', tiles: [{ q: 1, r: 0 }], area: 'exit' } },
                hidden: { active: false, highlight: { tiles: [{ q: -1, r: 0 }] } }
            }
        };
        const active = resolveActiveObjectiveHighlightTiles(config, { active: 'active', hidden: 'hidden' }, tileMap);
        unitTile.unit = null;
        hiddenTile.unit = { id: 'escort' };
        const moved = resolveActiveObjectiveHighlightTiles(config, { active: 'active', hidden: 'completed' }, tileMap);
        const ended = resolveActiveObjectiveHighlightTiles(config, { active: 'completed', hidden: 'hidden' }, tileMap);
        return {
            active: active.map(tile => `${tile.q},${tile.r}`).sort(),
            moved: moved.map(tile => `${tile.q},${tile.r}`).sort(),
            ended: ended.length
        };
    });
    R.assert(objectiveHighlightContract.active.join('|') === '0,0|1,-1|1,0'
        && objectiveHighlightContract.moved.join('|') === '-1,0|1,-1|1,0'
        && objectiveHighlightContract.ended === 0,
    '目标提示光圈仅在进行中显示、自动去重并跟随单位移动');
    const storyCommanderContract = await page.evaluate(async () => {
        const { config } = await import('/campaign/content/bloodIris/bi-04-gate.js');
        const { resolveCommanderMount, applyCommanderMount } = await import('/campaign/runtime/storyCommanders.js');
        const { Unit } = await import('/js/Unit.js');
        const { CAMP } = await import('/rules/camps.js');
        const createUnit = spec => {
            const mount = resolveCommanderMount(config, spec);
            const tile = { q: 0, r: 0, x: 400, y: 300, unit: null };
            return applyCommanderMount(new Unit('infantry', CAMP.player1, tile, false, spec.id, mount.commander), mount);
        };
        const cato = createUnit(config.units.find(unit => unit.id === 'cato_defender'));
        const captain = createUnit(config.units.find(unit => unit.id === 'petra_gate_guard'));
        const inspectAlpha = async source => {
            const image = new Image();
            image.src = source;
            await image.decode();
            const canvas = document.createElement('canvas');
            canvas.width = image.naturalWidth;
            canvas.height = image.naturalHeight;
            const context = canvas.getContext('2d');
            context.drawImage(image, 0, 0);
            const corner = context.getImageData(0, 0, 1, 1).data[3];
            const center = context.getImageData(Math.floor(canvas.width / 2), Math.floor(canvas.height * 0.55), 1, 1).data[3];
            return { width: image.naturalWidth, height: image.naturalHeight, corner, center };
        };
        return {
            cato: { commander: cato.commander, name: cato.getCommanderDisplayName(), portrait: cato.getCommanderPortraitId() },
            captain: { commander: captain.commander, name: captain.getCommanderDisplayName(), portrait: captain.getCommanderPortraitId(), identity: captain.isCommanderUnit },
            male: await inspectAlpha('/img/commander_tr/NPC男.webp'),
            female: await inspectAlpha('/img/commander_tr/NPC女.webp')
        };
    });
    R.assert(storyCommanderContract.cato.commander === 'minister'
        && storyCommanderContract.cato.name === '卡托'
        && storyCommanderContract.cato.portrait === 'minister',
    '剧情将领名字覆盖玩法原型名，同时保留原型技能与立绘');
    R.assert(storyCommanderContract.captain.commander === null
        && storyCommanderContract.captain.name === '佩特拉守备队长'
        && storyCommanderContract.captain.portrait === 'npcMale'
        && storyCommanderContract.captain.identity,
    '无玩法原型的自创人物仍作为剧情将领挂载');
    R.assert(storyCommanderContract.male.corner === 0 && storyCommanderContract.male.center > 0
        && storyCommanderContract.female.corner === 0 && storyCommanderContract.female.center > 0,
    'NPC 男女战场兜底立绘均使用真实透明背景资源');
    const objectiveEditorPage = await newGamePage(browser);
    await objectiveEditorPage.click('#soloGameBtn');
    await objectiveEditorPage.evaluate(() => document.getElementById('editorBtn')?.click());
    await objectiveEditorPage.locator('#editorOverlay').waitFor({ state: 'visible' });
    await objectiveEditorPage.click('.editor-tab[data-tab="triggers"]');
    await objectiveEditorPage.getByText('+ 新增目标', { exact: true }).click();
    R.assert(await objectiveEditorPage.getByText('任务提示光圈（仅“进行中”时常驻）', { exact: true }).count() === 1
        && await objectiveEditorPage.getByText('跟随单位', { exact: true }).count() === 1
        && await objectiveEditorPage.getByText('指定位置', { exact: true }).count() === 1
        && await objectiveEditorPage.getByText('命名区域', { exact: true }).count() === 1,
    '编辑器目标页提供单位、位置与区域三类图钉入口');
    await objectiveEditorPage.click('.editor-tab[data-tab="units"]');
    await objectiveEditorPage.getByText('+ 新建剧情将领', { exact: true }).click();
    R.assert(await objectiveEditorPage.getByText('剧情将领身份', { exact: true }).count() === 1
        && await objectiveEditorPage.getByText('剧情名字', { exact: true }).count() === 1
        && await objectiveEditorPage.getByText('玩法原型', { exact: true }).count() === 1
        && await objectiveEditorPage.getByText('人物立绘', { exact: true }).count() === 1,
    '编辑器可创建带可选玩法原型和兜底立绘的剧情将领');
    R.assert(objectiveEditorPage._errors.length === 0,
        `目标提示光圈编辑器无页面异常${objectiveEditorPage._errors.length ? `：${objectiveEditorPage._errors.join(' | ')}` : ''}`);
    await objectiveEditorPage.context().close();
    const timerLifecycle = await page.evaluate(async () => {
        const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
        const { createDefaultLevel } = await import('/campaign/runtime/schema.js');
        const { createTriggerFlow } = await import('/campaign/runtime/triggers.js');
        const { gameState } = await import('/js/state.js');
        const { HexTile } = await import('/js/HexTile.js');
        const { CAMP } = await import('/rules/camps.js');
        const previousState = {
            campaignMode: gameState.campaignMode,
            tiles: gameState.tiles,
            tileMap: gameState.tileMap,
            levelVariables: gameState.levelVariables,
            localPlayerCampKey: gameState.localPlayerCampKey,
            objectiveStates: gameState.objectiveStates
        };
        const level = createDefaultLevel();
        level.variables = [
            { id: 'opening_done', scope: 'level', type: 'boolean', initial: false },
            { id: 'dynamic_done', scope: 'level', type: 'boolean', initial: false },
            { id: 'empty_activation_done', scope: 'level', type: 'boolean', initial: false },
            { id: 'repeat_count', scope: 'level', type: 'number', initial: 0 }
        ];
        level.triggers = [
            {
                id: 'empty_activation_target', enabled: false, once: true,
                when: [],
                do: [{ kind: 'setVariable', variable: 'empty_activation_done', operation: 'set', value: true }]
            },
            {
                id: 'arm_dynamic', enabled: true, once: true,
                when: [],
                do: [
                    { kind: 'setTriggerEnabled', trigger: 'dynamic_timer', enabled: true },
                    { kind: 'setTriggerEnabled', trigger: 'empty_activation_target', enabled: true }
                ]
            },
            {
                id: 'opening_timer', enabled: true, once: true,
                when: [{ kind: 'timer', value: 180 }],
                do: [{ kind: 'setVariable', variable: 'opening_done', operation: 'set', value: true }]
            },
            {
                id: 'dynamic_timer', enabled: false, once: true,
                when: [{ kind: 'timer', value: 180 }],
                do: [{ kind: 'setVariable', variable: 'dynamic_done', operation: 'set', value: true }]
            },
            {
                id: 'arm_repeat', enabled: true, once: false,
                when: [{ kind: 'eventNextIs', value: '__arm_repeat' }],
                do: [{ kind: 'setTriggerEnabled', trigger: 'repeat_timer', enabled: true }]
            },
            {
                id: 'repeat_timer', enabled: false, once: false,
                when: [{ kind: 'timer', value: 180 }],
                do: [{ kind: 'setVariable', variable: 'repeat_count', operation: 'add', value: 1 }]
            }
        ];
        gameState.campaignMode = true;
        gameState.levelVariables = { opening_done: false, dynamic_done: false, empty_activation_done: false, repeat_count: 0 };
        const guardTile = new HexTile(0, 0);
        guardTile.camp = CAMP.player1;
        guardTile.startColor = CAMP.player1.color;
        guardTile.targetColor = CAMP.player1.color;
        guardTile.currentColor = CAMP.player1.color;
        gameState.tiles = [guardTile];
        gameState.tileMap = new Map([['0,0', guardTile]]);
        gameState.localPlayerCampKey = 'player1';
        gameState.objectiveStates = {};
        const flow = createTriggerFlow(level, {
            isActive: () => true,
            isResultShown: () => false,
            showStep: () => {}, showInlineStep: () => {}, setObjectiveStatus: () => {},
            showHint: () => {}, fail: () => {}, win: () => {}
        });

        await sleep(240);
        const waitsForLevelStart = !gameState.levelVariables.opening_done;
        flow.onLevelStarted();
        const emptyActivationWorked = gameState.levelVariables.empty_activation_done;
        await sleep(320);
        const openingAndDynamicWorked = gameState.levelVariables.opening_done && gameState.levelVariables.dynamic_done;

        flow.onAdvance('__arm_repeat');
        await sleep(120);
        flow.onAdvance('__arm_repeat');
        await sleep(120);
        const explicitEnableRestarts = gameState.levelVariables.repeat_count === 0;
        await sleep(180);
        const firedOnce = gameState.levelVariables.repeat_count === 1;
        await sleep(240);
        const consumedUntilReenabled = gameState.levelVariables.repeat_count === 1;
        flow.onAdvance('__arm_repeat');
        await sleep(320);
        const canRearm = gameState.levelVariables.repeat_count === 2;
        flow.dispose();
        Object.assign(gameState, previousState);
        return { waitsForLevelStart, emptyActivationWorked, openingAndDynamicWorked, explicitEnableRestarts, firedOnce, consumedUntilReenabled, canRearm };
    });
    R.assert(Object.values(timerLifecycle).every(Boolean), '空条件触发器启用即执行；计时器支持开场计时、运行中启用、重启与再次装填');
    const factionColorContract = await page.evaluate(async () => {
        const schema = await import('/campaign/runtime/schema.js');
        const diplomacy = await import('/rules/diplomacy.js');
        const camps = await import('/rules/camps.js');
        const legacy = schema.createDefaultLevel();
        legacy.factions[0].color = '#ffaaaa';
        const migrated = schema.normalizeLevel(legacy);
        const invalid = schema.createDefaultLevel();
        invalid.factions[0].color = '#123456';
        const runtime = diplomacy.createDefaultFactions([{
            id: 'player1', name: '测试阵营', color: 'purple', controller: 'human', participatesInTurns: true, active: true
        }]).player1;
        const authoredReserved = diplomacy.createDefaultFactions([{
            id: 'storyGuard', name: '剧情卫队', color: 'white', controller: 'scripted', participatesInTurns: true, active: true
        }]).storyGuard;
        const standard = diplomacy.createStandardFactions({ playerCount: 2, colors: { player1: 'white', player2: 'gray' } });
        const playerColorState = { factions: diplomacy.createStandardFactions({ playerCount: 2 }) };
        const campaignFlagState = { campaignMode: true, factions: diplomacy.createStandardFactions({ playerCount: 2 }) };
        const defaultFlagUrl = playerColorState.factions.player1.flagUrl;
        const validEmojiApplied = diplomacy.setPlayerFactionFlagEmoji(playerColorState, 'player1', '🐉');
        const emojiUrl = playerColorState.factions.player1.flagUrl;
        const recoloredFlag = diplomacy.setPlayerFactionColor(playerColorState, 'player1', 'purple');
        return {
            defaultUsesId: schema.createDefaultLevel().factions[0].color === 'red',
            legacyMigrates: migrated.factions[0].color === 'red',
            arbitraryHexRejected: schema.validateLevel(invalid).errors.some(message => message.includes('颜色选项')),
            runtimeResolved: runtime.colorId === 'purple' && runtime.color === '#d8aaff',
            paletteResolved: camps.getTileColor('purple') === '#d8aaff' && camps.getFlagColors('purple').main === '#9050c8',
            globalPaletteHasNine: camps.FACTION_PALETTE.length === 9,
            playerPaletteHasSeven: camps.PLAYER_FACTION_COLOR_KEYS.length === 7
                && !camps.PLAYER_FACTION_COLOR_KEYS.includes('gray')
                && !camps.PLAYER_FACTION_COLOR_KEYS.includes('white'),
            cityMarkersAvoidMainFlagColor: camps.FACTION_PALETTE.every(entry => {
                const marker = camps.getCityMarkerColors(entry.id);
                return marker.line !== camps.getFlagColors(entry.id).main;
            }),
            campaignCanUseReservedColors: authoredReserved.colorId === 'white',
            standardRejectsReservedColors: standard.player1.colorId === 'red' && standard.player2.colorId === 'blue',
            standardFlagsUseRuleGeneratedSvg: standard.player1.flagEmoji === '⚜️'
                && standard.player2.flagEmoji === '🛡️'
                && standard.player1.flagUrl?.startsWith('data:image/svg+xml'),
            flagEmojiSetterIsWhitelisted: validEmojiApplied
                && playerColorState.factions.player1.flagEmoji === '🐉'
                && !diplomacy.setPlayerFactionFlagEmoji(playerColorState, 'player1', 'not-an-emoji'),
            campaignRejectsStandardFlagEmoji: !diplomacy.setPlayerFactionFlagEmoji(campaignFlagState, 'player1', '🐉'),
            flagSvgRegeneratesWithColor: recoloredFlag
                && defaultFlagUrl !== emojiUrl
                && emojiUrl !== playerColorState.factions.player1.flagUrl,
            playerSetterRejectsReservedColors: diplomacy.setPlayerFactionColor(playerColorState, 'player1', 'gray') === false
                && diplomacy.setPlayerFactionColor(playerColorState, 'player1', 'white') === false
                && diplomacy.setPlayerFactionColor(playerColorState, 'player1', 'purple') === true
        };
    });
    R.assert(Object.values(factionColorContract).every(Boolean), '全局九色由规则层统一解析；战役可用九色，普通玩家对局只开放七种彩虹色');
    const flagWindContract = await page.evaluate(async () => {
        const flags = await import('/js/flagRenderer.js');
        const rendererSource = await fetch('/js/flagRenderer.js').then(response => response.text());
        return {
            clear: flags.getFlagWindStrength('clear'),
            rain: flags.getFlagWindStrength('rain'),
            fog: flags.getFlagWindStrength('fog'),
            wind: flags.getFlagWindStrength('wind'),
            gravitySag: flags.FLAG_CLOTH_PHYSICS.gravitySag,
            windFlattening: flags.FLAG_CLOTH_PHYSICS.windFlattening,
            usesCommandSash: rendererSource.includes('commandSashMask'),
            hasNoStarOverlay: !rendererSource.includes('starMask')
        };
    });
    R.assert(flagWindContract.clear === 0.7 && flagWindContract.rain === 0.7
        && flagWindContract.fog === 0.7 && flagWindContract.wind === 1.5
        && flagWindContract.gravitySag === 0.1 && flagWindContract.windFlattening === 0.22
        && flagWindContract.usesCommandSash && flagWindContract.hasNoStarOverlay,
    '旗帜保持风力与重力效果；将领旗使用右上斜向绶带且不再叠加五角星');
    const flagArtworkContract = await page.evaluate(async () => {
        const readTextMetrics = async url => {
            const source = await fetch(url).then(response => response.text());
            const text = new DOMParser().parseFromString(source, 'image/svg+xml').querySelector('text');
            return { size: Number(text?.getAttribute('font-size')), y: Number(text?.getAttribute('y')) };
        };
        return {
            kingdom: await readTextMetrics('/img/flags/aurelia-kingdom.svg'),
            regency: await readTextMetrics('/img/flags/aurelia-regency.svg'),
            petra: await readTextMetrics('/img/flags/petra-autonomy.svg'),
            targets: await readTextMetrics('/img/flags/training-targets.svg')
        };
    });
    R.assert(['kingdom', 'regency', 'targets'].every(key => flagArtworkContract[key].size === 380
        && flagArtworkContract[key].y === 420)
        && flagArtworkContract.petra.size === 230 && flagArtworkContract.petra.y === 237,
    '现有旗帜徽章统一放大并下移基线，保持视觉居中');
    const flagLayoutContract = await page.evaluate(async () => {
        const { UNIT_FLAG_LAYOUT, CITY_FLAG_LAYOUT } = await import('/js/flagLayout.js');
        return { unit: UNIT_FLAG_LAYOUT, city: CITY_FLAG_LAYOUT };
    });
    R.assert(
        flagLayoutContract.unit.width === 15 && flagLayoutContract.unit.height === 10
            && flagLayoutContract.unit.poleX === -15
            && flagLayoutContract.city.width === 24 && flagLayoutContract.city.height === 16
            && flagLayoutContract.city.poleTopOffset === -18
            && flagLayoutContract.city.clothOffsetY === 1
            && flagLayoutContract.city.width > flagLayoutContract.unit.width,
        '城市旗与部队旗均保持 3:2；城市旗更大，部队旗杆贴近血条左缘'
    );
    const flagBatchContract = await page.evaluate(async () => {
        const { gameState } = await import('/js/state.js');
        const { ctx } = await import('/js/config.js');
        const flags = await import('/js/flagRenderer.js');
        const faction = gameState.factions.player1;
        const tiles = Array.from({ length: 50 }, (_, index) => {
            const tile = {
                id: `stress-tile-${index}`,
                x: 80 + (index % 10) * 82,
                y: 120 + Math.floor(index / 10) * 105,
                isCity: false,
                isVillage: false,
                unit: null
            };
            tile.unit = { id: `stress-unit-${index}`, camp: faction, tile, commander: null };
            return tile;
        });
        const state = { tiles, factions: gameState.factions, weather: 'wind' };
        const prototype = WebGL2RenderingContext.prototype;
        const original = prototype.drawElementsInstanced;
        let drawCalls = 0;
        let instances = 0;
        prototype.drawElementsInstanced = function (...args) {
            drawCalls++;
            instances += Number(args[4]) || 0;
            return original.apply(this, args);
        };
        try {
            flags.drawBattlefieldFlags(ctx, state, performance.now());
        } finally {
            prototype.drawElementsInstanced = original;
        }
        return { drawCalls, instances, collected: flags.collectBattlefieldFlags(state, performance.now()).length };
    });
    R.assert(flagBatchContract.collected === 50 && flagBatchContract.instances === 50 && flagBatchContract.drawCalls === 1,
        `50 面部队旗保持单次 WebGL 实例化绘制（draw=${flagBatchContract.drawCalls}, instances=${flagBatchContract.instances}）`);
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
    if (await page.locator('#rainCityLevelBtn').count() === 0) {
        R.assert((await page.textContent('.campaign-level-card')).includes('花与剑'), '战役大厅展示当前正式教学关《花与剑》');
        R.assert(await page.locator('.campaign-start-btn').count() === 0, '关卡卡片直接进入战役，不再渲染重复的进入按钮');
        const sequentialLock = await page.evaluate(async () => {
            const storageKey = 'bladesOfHex.campaign.bloodIris';
            const { refreshCampaignLobbyProgress } = await import('/campaign/lobby.js');
            localStorage.removeItem(storageKey);
            refreshCampaignLobbyProgress();
            const first = document.getElementById('bi-t1-sheathLevelBtn');
            const second = document.getElementById('bi-02-flagLevelBtn');
            const initiallyLocked = !first.disabled && second.disabled
                && document.getElementById('bi-02-flagRating')?.textContent === '🔒';

            localStorage.setItem(storageKey, JSON.stringify({
                completedScenarioIds: ['bi-t1-sheath'],
                scenarioStars: { 'bi-t1-sheath': 1 },
                bestStars: 1
            }));
            refreshCampaignLobbyProgress();
            return {
                initiallyLocked,
                secondUnlockedAtOneStar: !second.disabled,
                thirdStillLocked: document.getElementById('bi-t3-mountainLevelBtn')?.disabled === true
            };
        });
        R.assert(sequentialLock.initiallyLocked
            && sequentialLock.secondUnlockedAtOneStar
            && sequentialLock.thirdStillLocked,
        '关卡按目录顺序逐关解锁：首关开放，前一关至少一星后仅开放下一关');
        const perScenarioProgress = await page.evaluate(async () => {
            const { readProgress, saveVictory } = await import('/campaign/progress.js');
            const key = '__campaign_progress_contract__';
            localStorage.removeItem(key);
            saveVictory(key, 'first', 3);
            saveVictory(key, 'second', 1);
            const progress = readProgress(key);
            localStorage.removeItem(key);
            return progress.scenarioStars;
        });
        R.assert(perScenarioProgress.first === 3 && perScenarioProgress.second === 1,
            '每个关卡分别保存最佳星级，解锁判断不会误用整部传记的最高分');
        await page.evaluate(() => localStorage.setItem('blades-of-hex.standard-flag-customizations.v1', JSON.stringify({
            player1: { colorId: 'purple', emoji: '🐉' }
        })));
        await page.click('.campaign-level-card');
        await waitFor(() => page.evaluate(async () => {
            const { gameState } = await import('/js/state.js');
            return gameState.campaignMode && gameState.scenarioId === 'bi-t1-sheath' && gameState.tiles.length > 0;
        }), 10000, '《花与剑》加载');
        const campaignFlagLock = await page.evaluate(async () => {
            const { gameState } = await import('/js/state.js');
            const faction = gameState.factions.player1;
            return faction?.flagUrl === 'img/flags/aurelia-kingdom.svg' && !faction.flagEmoji;
        });
        R.assert(campaignFlagLock, '战役模式忽略标准对局的本地旗帜偏好，强制使用关卡指定剧情旗帜');
        await page.click('#turnTransitionOverlay');
        await waitFor(() => page.evaluate(() => document.getElementById('campaignSpeakerCard')?.classList.contains('show')), 5000, '开场计时对白');
        R.assert((await page.textContent('#campaignSpeakerName')).trim() === '马库斯', '《花与剑》开场正确显示马库斯对白');
        const openingCharacterPresentation = await page.evaluate(async () => {
            const { gameState } = await import('/js/state.js');
            const severus = gameState.tileMap.get('0,-3')?.unit;
            const marcus = gameState.tileMap.get('0,-2')?.unit;
            const portrait = document.getElementById('campaignSpeakerPortrait');
            await portrait.decode();
            return {
                marcusPortraitLoaded: portrait.naturalWidth > 0 && decodeURI(portrait.src).endsWith('/img/commander/百夫长.webp'),
                severusOnAwardPlatform: severus?.id === 'severus_regent'
                    && severus.commander === 'advisor' && severus.getCommanderDisplayName() === '塞维鲁' && severus.canAct === false,
                storyNamesApplied: marcus?.commander === 'centurion' && marcus.getCommanderDisplayName() === '马库斯'
            };
        });
        R.assert(openingCharacterPresentation.marcusPortraitLoaded
            && openingCharacterPresentation.severusOnAwardPlatform
            && openingCharacterPresentation.storyNamesApplied,
        '人物立绘按玩法原型加载，马库斯与塞维鲁使用剧情名字覆盖原型名');
        const campaignInfo = await page.evaluate(() => ({
            chronicle: document.getElementById('campaignInfoChronicle')?.textContent.trim(),
            chapter: document.getElementById('campaignInfoChapter')?.textContent.trim(),
            level: document.getElementById('campaignInfoLevel')?.textContent.trim()
        }));
        R.assert(campaignInfo.chronicle === '染血的鸢尾花'
            && campaignInfo.chapter === '花旗向东'
            && campaignInfo.level === 'BI-T1 花与剑', '局内信息卡按“传记 · 章节 / 编号 关名”显示且不重复编号');

        await page.click('#factionListBtn');
        const factionListPresentation = await page.evaluate(() => {
            const rows = [...document.querySelectorAll('.faction-list-row')];
            const images = [...document.querySelectorAll('.faction-list-flag-image')];
            return {
                visible: document.getElementById('factionListOverlay')?.classList.contains('show'),
                noUnusedFooter: !document.querySelector('.faction-list-note'),
                noEmptyNotes: document.querySelectorAll('.faction-list-meta').length === 0,
                relationLabels: [...document.querySelectorAll('.faction-list-relation')].map(item => item.textContent.trim()),
                flagSizes: images.map(image => {
                    const style = getComputedStyle(image.parentElement);
                    const rect = image.parentElement.getBoundingClientRect();
                    return {
                        width: Math.round(rect.width), height: Math.round(rect.height),
                        naturalRatio: image.naturalWidth / image.naturalHeight,
                        borderRadius: style.borderRadius
                    };
                }),
                rowCount: rows.length
            };
        });
        R.assert(factionListPresentation.visible
            && factionListPresentation.noUnusedFooter
            && factionListPresentation.noEmptyNotes
            && factionListPresentation.rowCount === 2
            && factionListPresentation.relationLabels.includes('👤 自身')
            && factionListPresentation.relationLabels.includes('👊 敌对')
            && factionListPresentation.flagSizes.every(flag => flag.width === 42 && flag.height === 28
                && flag.naturalRatio === 1.5 && flag.borderRadius === '0px'),
        '阵营列表隐藏空备注并显示外交 emoji；SVG 旗帜以无圆角 3:2 大尺寸呈现');
        await page.click('#factionListClose');

        // v3 教学关完整路径：开场三页 → 选择 → 移动 → 攻击 → 两名新兵列队 → 授章七页。
        await advanceCampaignDialogue(page);
        await advanceCampaignDialogue(page);
        await advanceCampaignDialogue(page);
        await clickTile(page, -2, 0);
        await sleep(260);
        const selectionFlagPresentation = await page.evaluate(() => {
            const image = document.querySelector('.selection-hud-flag:not(.selection-hud-flag-color)');
            if (!image) return null;
            const style = getComputedStyle(image);
            const rect = image.getBoundingClientRect();
            return {
                width: Math.round(rect.width), height: Math.round(rect.height),
                naturalRatio: image.naturalWidth / image.naturalHeight,
                borderRadius: style.borderRadius,
                objectFit: style.objectFit
            };
        });
        R.assert(selectionFlagPresentation?.width === 27 && selectionFlagPresentation?.height === 18
            && selectionFlagPresentation?.naturalRatio === 1.5
            && selectionFlagPresentation?.borderRadius === '0px'
            && selectionFlagPresentation?.objectFit === 'contain',
        '左上角属性栏直接使用原始 900×600 SVG，保持无圆角 3:2 矢量显示');
        await clickTile(page, 0, 0);
        await sleep(260);
        await clickTile(page, 1, 0);
        await sleep(260);
        await advanceCampaignDialogue(page);
        await clickTile(page, -2, 1);
        await sleep(260);
        await clickTile(page, 0, 1);
        await sleep(260);
        await advanceCampaignDialogue(page);
        await clickTile(page, -1, -1);
        await sleep(260);
        await clickTile(page, 1, -1);
        await sleep(260);
        await advanceCampaignDialogue(page);
        const severusDialoguePresentation = await page.evaluate(async () => {
            const portrait = document.getElementById('campaignSpeakerPortrait');
            await portrait.decode();
            return {
                speaker: document.getElementById('campaignSpeakerName').textContent.trim(),
                portraitLoaded: portrait.naturalWidth > 0 && decodeURI(portrait.src).endsWith('/img/commander/谋士.webp')
            };
        });
        R.assert(severusDialoguePresentation.speaker === '塞维鲁'
            && severusDialoguePresentation.portraitLoaded,
        '授章对白由地图上的塞维鲁发言，并正确使用谋士立绘');
        for (let index = 0; index < 6; index++) await advanceCampaignDialogue(page);
        await waitFor(() => page.evaluate(() => document.getElementById('campaignResultOverlay')?.classList.contains('show')), 5000, '《花与剑》完成结算');
        R.assert((await page.textContent('#campaignResultTitle')).includes('花与剑'), '《花与剑》v3 可按教学路径完整通关');
        const standardTopbarAfterCampaign = await page.evaluate(async () => {
            const state = await import('/js/state.js');
            const { updateUI } = state;
            state.resetGameState();
            state.configureSkirmishState({
                playerCount: 2,
                controllers: { player1: 'human', player2: 'ai' }
            });
            updateUI();
            const display = id => getComputedStyle(document.getElementById(id)).display;
            const twoPlayer = {
                campaign: display('campaignInfoBar'),
                p1: display('campCard1'), p2: display('campCard2'), p3: display('campCard3'),
                campaignFieldsCleared: ['campaignInfoChronicle', 'campaignInfoChapter', 'campaignInfoLevel']
                    .every(id => document.getElementById(id).textContent === '')
            };
            state.configureSkirmishState({
                playerCount: 3,
                controllers: { player1: 'human', player2: 'ai', player3: 'ai' }
            });
            state.gameState.isThreePlayer = true;
            updateUI();
            const threePlayer = {
                campaign: display('campaignInfoBar'),
                p1: display('campCard1'), p2: display('campCard2'), p3: display('campCard3')
            };
            return { twoPlayer, threePlayer };
        });
        R.assert(standardTopbarAfterCampaign.twoPlayer.campaign === 'none'
            && standardTopbarAfterCampaign.twoPlayer.campaignFieldsCleared
            && standardTopbarAfterCampaign.twoPlayer.p1 !== 'none'
            && standardTopbarAfterCampaign.twoPlayer.p2 !== 'none'
            && standardTopbarAfterCampaign.twoPlayer.p3 === 'none'
            && standardTopbarAfterCampaign.threePlayer.campaign === 'none'
            && standardTopbarAfterCampaign.threePlayer.p1 !== 'none'
            && standardTopbarAfterCampaign.threePlayer.p2 !== 'none'
            && standardTopbarAfterCampaign.threePlayer.p3 !== 'none',
        '退出战役后清除标题栏，标准双人/三人对局恢复对应阵营信息卡');
        R.assert(page._errors.length === 0, `当前正式教学关启动无页面异常${page._errors.length ? `：${page._errors.join(' | ')}` : ''}`);
        await page.context().close();
        return R.summary();
    }

    R.assert((await page.textContent('#rainCityLevelBtn')).includes('雨幕下的孤城'), '二级菜单展示具体关卡');

    await page.click('#rainCityLevelBtn');
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
