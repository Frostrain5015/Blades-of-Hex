// 单机（PVE）完整对局套件：
//   懒加载断言 → FX 管线排空 → 部署 → 逐回合推进（事件/特效活动探针）→ 胜利 → 再来一局
import {
    BASE, newGamePage, startSolo, pickCommander, waitGameStart, gameSnapshot,
    deployCommander, clickEndTurn, installFxProbe, readFxProbe, fxRegistryStats,
    fetchedFxModules, waitFor, sleep, Reporter,
} from './lib/helpers.mjs';

const FX_MANIFEST = ['ironGuard', 'astrologer', 'staller', 'necromancer', 'fallenAngel',
    'berserker', 'paladin', 'priest', 'diplomat', 'vampire', 'advisor', 'minister'];

export async function run(browser, { quick = false } = {}) {
    const R = new Reporter('pve');
    const page = await newGamePage(browser);

    // ── 1. 开局流程 ──
    await startSolo(page);
    const colorPickerInitial = await page.evaluate(() => {
        const picker = document.getElementById('commanderColorPicker');
        const swatches = [...picker.querySelectorAll('.commander-color-swatch')];
        const headerRect = document.querySelector('.commander-header').getBoundingClientRect();
        const panelRect = document.querySelector('.commander-panel').getBoundingClientRect();
        return {
            colors: swatches.map(element => element.dataset.colorId),
            emojis: [...picker.querySelectorAll('.commander-emoji-option')].map(element => element.dataset.emoji),
            blueEnabled: !swatches.find(element => element.dataset.colorId === 'blue')?.disabled,
            pickerPosition: getComputedStyle(picker).position,
            headerHeight: headerRect.height,
            panelTop: panelRect.top
        };
    });
    R.assert(colorPickerInitial.colors.length === 7 && colorPickerInitial.emojis.length === 13
        && !colorPickerInitial.colors.includes('gray') && !colorPickerInitial.colors.includes('white')
        && colorPickerInitial.blueEnabled,
    `普通对局选将页显示七种颜色与十三种旗面徽记，未完成选将的 AI 不会占用蓝色（${colorPickerInitial.colors.join('、')}）`);
    await page.click('#commanderLogo');
    const colorPickerOpen = await page.evaluate((initial) => {
        const picker = document.getElementById('commanderColorPicker');
        const logo = document.getElementById('commanderLogo');
        const pickerRect = picker.getBoundingClientRect();
        const logoRect = logo.getBoundingClientRect();
        const headerRect = document.querySelector('.commander-header').getBoundingClientRect();
        const panelRect = document.querySelector('.commander-panel').getBoundingClientRect();
        const style = getComputedStyle(logo);
        return {
            centered: Math.abs((pickerRect.left + pickerRect.width / 2) - (logoRect.left + logoRect.width / 2)) < 1,
            noLayoutShift: Math.abs(headerRect.height - initial.headerHeight) < 1
                && Math.abs(panelRect.top - initial.panelTop) < 1,
            popupPosition: getComputedStyle(picker).position,
            colorColumns: getComputedStyle(picker.querySelector('.commander-picker-options.colors')).gridTemplateColumns.split(' ').length,
            emojiColumns: getComputedStyle(picker.querySelector('.commander-picker-options.emojis')).gridTemplateColumns.split(' ').length,
            noPole: !document.querySelector('.commander-flag-pole'),
            noFlagFrame: style.borderTopWidth === '0px' && style.backgroundColor === 'rgba(0, 0, 0, 0)'
        };
    }, colorPickerInitial);
    R.assert(colorPickerOpen.centered && colorPickerOpen.colorColumns === 7 && colorPickerOpen.emojiColumns === 7
        && colorPickerOpen.noLayoutShift && colorPickerOpen.popupPosition === 'absolute'
        && colorPickerOpen.noPole && colorPickerOpen.noFlagFrame,
    '指挥官预览仅显示旗面；颜色和徽记按钮在居中叠加弹层中排列且不挤动布局');
    await page.click('#commanderColorPicker .commander-color-swatch[data-color-id="purple"]');
    await page.click('#commanderColorPicker .commander-emoji-option[data-emoji="🐉"]');
    const selectedFlag = await page.evaluate(async () => {
        const { gameState } = await import('/js/state.js');
        const faction = gameState.factions.player1;
        return { color: faction.colorId, emoji: faction.flagEmoji, flagUrl: faction.flagUrl, saved: localStorage.getItem('blades-of-hex.player-profile.v2') };
    });
    R.assert(selectedFlag.color === 'purple' && selectedFlag.emoji === '🐉'
        && selectedFlag.flagUrl?.startsWith('data:image/svg+xml') && selectedFlag.saved?.includes('🐉'),
    '选将页可组合阵营色与旗面徽记，并写入统一玩家档案（访客回退本地）');
    await pickCommander(page);
    await waitFor(() => page.evaluate(() => document.getElementById('factionReveal')?.classList.contains('show')
        && document.querySelectorAll('.faction-reveal-flag').length === 2), 10000, '回合准备旗帜展示');
    const revealStartedAt = Date.now();
    const revealPresentation = await page.evaluate(async () => {
        const { gameState } = await import('/js/state.js');
        const expectedNames = gameState.turnOrder
            .filter(key => key !== 'neutral')
            .map(key => gameState.factions[key]?.name || key);
        return {
            expectedNames,
            names: [...document.querySelectorAll('.faction-reveal-name')].map(element => element.textContent),
            onlyFlagCards: document.getElementById('factionRevealInner')?.children.length === 1,
            noDice: !document.getElementById('factionRevealDice'),
            noTextBanner: !document.getElementById('factionRevealText')
        };
    });
    R.assert(JSON.stringify(revealPresentation.names) === JSON.stringify(revealPresentation.expectedNames)
        && revealPresentation.onlyFlagCards && revealPresentation.noDice && revealPresentation.noTextBanner,
    '准备动画仅按随机行动顺序从左至右展示预览旗帜及阵营名，不显示骰子或标题');
    await waitGameStart(page);
    const revealDuration = Date.now() - revealStartedAt;
    R.assert(revealDuration >= 3600 && revealDuration <= 8000, `准备旗帜展示约 5 秒后进入对局（${revealDuration}ms）`);
    let snap = await gameSnapshot(page);
    R.assert(snap.tiles > 0, `对局开始（地图 ${snap.tiles} 格，P1=${snap.commanderP1}，P2=${snap.commanderP2}）`);

    // 行动顺序由掷骰决定，AI 可能拿到先手。测试以稳定的 human controller
    // 识别本地玩家，不再把“当前轮到谁”误当成玩家身份。
    const humanCampKey = await page.evaluate(async () => {
        const { gameState } = await import('/js/state.js');
        return Object.entries(gameState.factions || {})
            .find(([, faction]) => faction.controller === 'human')?.[0] || 'player1';
    });
    await waitFor(async () => page.evaluate(async (campKey) => {
        const { gameState } = await import('/js/state.js');
        const { campToKey } = await import('/rules/camps.js');
        return !gameState.aiActing && campToKey(gameState.currentCamp) === campKey;
    }, humanCampKey), 50000, '开局先手 AI 回合完成');

    // ── 2. 懒加载断言：只请求了在场将领的 fx 模块 ──
    const expected = [snap.commanderP1, snap.commanderP2].filter(id => FX_MANIFEST.includes(id));
    const fetched = await fetchedFxModules(page);
    R.assert(
        expected.every(id => fetched.includes(id)) && fetched.every(id => expected.includes(id)),
        `按需加载：仅请求在场将领模块 [${fetched.join(', ') || '无'}]，期望 [${expected.join(', ') || '无'}]`
    );
    const stats = await fxRegistryStats(page);
    if (expected.length > 0) {
        const total = Object.values(stats.layers).reduce((a, b) => a + b, 0);
        R.assert(total > 0, `fx 注册表已挂钩（图层钩子 ${total} 个，updater ${stats.updaters} 个）`);
    } else {
        R.ok('本局无清单内将领，跳过注册表断言');
    }

    // ── 3. FX 管线全量排空测试（全部 12 模块 + 每种特效） ──
    const drain = await page.evaluate(async (ALL) => {
        const fx = await import('/js/effects.js');
        const { gameState } = await import('/js/state.js');
        const reg = await import('/js/fxRegistry.js');
        reg.clearFxLayers();
        for (const id of ALL) (await import(`/commander/fx/${id}.js`)).register();
        const t = gameState.tiles[Math.floor(gameState.tiles.length / 2)];
        fx.spawnBloodDrain(t.x, t.y, t.x + 60, t.y - 30);
        fx.spawnGongxinRipple(t.x, t.y, true);
        fx.spawnGoldenBeam(t.x, t.y);
        fx.spawnHealingChain(t.x, t.y, t.x + 50, t.y + 20);
        fx.spawnMinisterDominionRing(t.x, t.y);
        fx.spawnCoinRain(t.x, t.y, 3);
        fx.spawnAirstrikeEffect(t.x, t.y, [], 'airstrike', t.q, t.r);
        fx.spawnAirliftEffect(t.x - 80, t.y, t.x + 80, t.y, { color: '#3388ff', q: t.q, r: t.r });
        fx.spawnSoulRecallEffect(t.x - 60, t.y - 60, t.x, t.y);
        fx.spawnLightningStrike(t.x, t.y);
        fx.spawnPaladinOrbitBeams('no-such-unit', t.x, t.y, 3);
        fx.spawnPaladinBeamProjectiles(t.x, t.y, t.x + 90, t.y - 40, 2);
        gameState._soulMarks = gameState._soulMarks || [];
        gameState._soulMarks.push({ q: t.q, r: t.r });
        await new Promise(r => setTimeout(r, 6000));
        gameState._soulMarks.pop();
        const counts = {
            blood: fx.bloodDrains.length, gongxin: fx.gongxinRipples.length,
            beams: fx.goldenBeams.length, chains: fx.healingChains.length,
            rings: fx.ministerRings.length, coins: fx.coinParticles.length,
            airstrike: fx.airstrikeEffects.length, airlift: fx.airliftEffects.length,
            soul: fx.soulRecallEffects.length, orbit: fx.paladinOrbitBeams.length,
            proj: fx.paladinBeamProjectiles.length,
        };
        // 恢复本局正确的按需注册
        const { loadCommanderFx } = await import('/js/commanderFx.js');
        await loadCommanderFx(gameState);
        return counts;
    }, FX_MANIFEST);
    const leaks = Object.entries(drain).filter(([, v]) => v > 0);
    R.assert(leaks.length === 0,
        leaks.length === 0 ? 'FX 管线排空：12 模块全部特效播放后归零（含无主环绕剑剔除）'
            : `FX 管线泄漏: ${leaks.map(([k, v]) => `${k}=${v}`).join(', ')}`);

    // ── 4. 部署将领 + 逐回合推进 ──
    await installFxProbe(page);
    const dep = await deployCommander(page);
    R.assert(dep.ok, `部署将领（${dep.unit || dep.reason}）`);

    const maxCycles = quick ? 3 : 60;
    let cycles = 0, victory = false, stuck = false;
    while (cycles < maxCycles) {
        const before = await gameSnapshot(page);
        if (before.victory) { victory = true; break; }
        await clickEndTurn(page);
        try {
            await waitFor(async () => {
                const s = await gameSnapshot(page);
                return s.victory || (s.currentCampKey === humanCampKey && s.turnCounter > before.turnCounter);
            }, 60000, `第 ${cycles + 1} 轮 AI 回合完成`);
        } catch (e) { stuck = true; R.fail(e.message); break; }
        cycles++;
        const s = await gameSnapshot(page);
        if (s.victory) { victory = true; break; }
    }
    if (!stuck) R.ok(`回合推进 ${cycles} 轮无卡死`);
    if (!quick) R.assert(victory, `完整对局结束（胜利判定触发，共 ${cycles} 轮）`);
    else R.ok(`快速模式：${cycles} 轮回合循环通过`);

    // ── 5. 事件/特效活动断言 ──
    const probe = await readFxProbe(page);
    R.assert(probe.goldTexts > 0, `回合收入事件触发（goldTexts 峰值 ${probe.goldTexts}）`);
    R.assert(probe.coinParticles > 0, `金币雨特效播放（峰值 ${probe.coinParticles} 粒）`);
    R.assert(probe.turnFlash > 0, '回合切换闪光播放');
    R.assert(probe.cardUseEffects > 0 || probe.commanderSkillEffects > 0,
        `卡牌/将领技能特效播放（card=${probe.cardUseEffects}, skill=${probe.commanderSkillEffects}）`);
    R.softAssert(probe.damageTexts > 0, `战斗伤害数字（峰值 ${probe.damageTexts}）`);
    R.softAssert(probe.attackFlashes > 0 || probe.meleeSlashes > 0 || probe.projectiles > 0,
        `战斗攻击特效（flash=${probe.attackFlashes}, slash=${probe.meleeSlashes}, proj=${probe.projectiles}）`);
    R.softAssert(probe.particles > 0, `通用粒子（峰值 ${probe.particles}）`);
    R.assertNoPageErrors(page, '整场对局');

    // ── 6. 再来一局（换将重开，验证 clear + 重新装载） ──
    if (victory) {
        try {
            await page.evaluate(() => document.getElementById('rematchBtn')?.click());
            await pickCommander(page);
            await waitGameStart(page);
            const s2 = await gameSnapshot(page);
            R.assert(s2.tiles > 0 && !s2.victory, `再来一局成功（新将领 P1=${s2.commanderP1}）`);
            R.assertNoPageErrors(page, '再来一局');
        } catch (e) { R.warn(`再来一局流程未完成: ${e.message}`); }
    }

    await page.context().close();
    return R.summary();
}
